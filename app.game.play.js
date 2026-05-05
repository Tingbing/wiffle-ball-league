// Wiffle Ball League - app.game.play.js
// Split from the source-of-truth app.game.js. Load after app.core.js in the required order.
// Purpose: Live gameplay actions including game start, batting/pitching results, undo, manual runner actions, and early end.

function startGameWithTeams(t1, t2, scheduleRef = null, lockInfo = null, gameContext = null) {
	const activeTeam1 = buildActiveTeamForGame(t1, scheduleRef);
	const activeTeam2 = buildActiveTeamForGame(t2, scheduleRef);

	const shouldInitSeasonStatBuckets = !gameContext?.postseasonRef;
	if (shouldInitSeasonStatBuckets) {
		activeTeam1.players.forEach(playerName => {
			const statsKey = activeTeam1._playerMeta?.[playerName]?.statsKey;
			if (isSubKey(statsKey)) initSubStats(playerName);
			else initPlayerStats(activeTeam1.name, playerName);
		});

		activeTeam2.players.forEach(playerName => {
			const statsKey = activeTeam2._playerMeta?.[playerName]?.statsKey;
			if (isSubKey(statsKey)) initSubStats(playerName);
			else initPlayerStats(activeTeam2.name, playerName);
		});
	}

	let batting = Math.random() > 0.5 ? activeTeam1 : activeTeam2;
	let fielding = batting === activeTeam1 ? activeTeam2 : activeTeam1;

game = {
	team1: activeTeam1,
	team2: activeTeam2,
	team1Score: 0,
	team2Score: 0,
	batting: batting,
	fielding: fielding,
	outs: 0,
	inning: 1,
	halfInning: "top",
	batterIndex: 0,
	batterIndexByTeam: {
		[activeTeam1.name]: 0,
		[activeTeam2.name]: 0
	},
	currentPitcher: null,
	bases: { first: null, second: null, third: null },
	gameStats: {},
	currentInningPitchers: {},
	halfInningRuns: 0,
	lineScore: {
		[activeTeam1.name]: [],
		[activeTeam2.name]: []
	},
	pitcherDecisions: {
	winningPitcher: null,
	losingPitcher: null,
	pendingWinningPitcherTeamName: null,
	pitcherOfRecordByTeam: {}
},
overtime: {
	active: false,
	round: 0,
	halfSetupKeys: {},
	automaticRunners: {}
},
_scheduleRef: scheduleRef,
	_lockId: lockInfo?.lockId || null,
	_lockInfo: lockInfo || null,
		_gameInstanceId: scheduleRef
		? `scheduled-${scheduleRef.dayIndex}-${scheduleRef.seriesIndex}-${scheduleRef.seriesGameIndex}`
		: (gameContext?.postseasonRef?.slotId
			? `postseason-${gameContext.postseasonRef.bracketId || "current"}-${gameContext.postseasonRef.slotId}-g${gameContext.postseasonRef.seriesGameNumber || 1}`
			: (lockInfo?.lockId ? `manual-${lockInfo.lockId}` : `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)),
	_postseasonRef: gameContext?.postseasonRef ? { ...gameContext.postseasonRef } : null,
	_gameContext: gameContext ? deepCloneJson(gameContext) : null,
	_startedAt: Date.now()
};

	[activeTeam1, activeTeam2].forEach(teamObj => {
		(teamObj.players || []).forEach(playerName => {
			const statsKey = getGameStatsKey(teamObj, playerName);
			game.gameStats[statsKey] = createEmptyStats(teamObj.name, playerName, {
				playerName,
				teamName: teamObj.name,
				isSub: isSubKey(statsKey),
				replacedPlayer: teamObj._playerMeta?.[playerName]?.originalPlayer || playerName
			});
		});
	});

	gameHistory = [];
	pendingBattingResult = null;
	lastPlay = null;
	playInputLock = false;
	document.getElementById("undoButton").disabled = true;
	keepLiveGameSectionsEnabled();
	showGame();
	updatePitcherSelect();
	updateGameScreen();
	persistLiveGameAutosave();
}

async function beginLockedGame(t1, t2, scheduleRef = null, extraLockDetails = {}, gameContext = null, startActionId = null) {
	const attempt = await acquireGameLock({
		type: extraLockDetails?.type || (scheduleRef ? "scheduled" : (gameContext?.postseasonRef ? "postseason" : "manual")),
		team1: t1?.name || "",
		team2: t2?.name || "",
		...extraLockDetails
	});

	if (!isCurrentGameStartAction(startActionId)) {
		if (attempt?.ok) await releaseGameLockWithTimeout(attempt.lockId, { quiet: true, timeoutMs: 2500 });
		return false;
	}
	
	if (!attempt.ok) {
		refreshGameLockUI();
		const lockLabel = getActiveGameLockLabel(attempt.lock || activeGameLock);
		alert(lockLabel
			? `Another game is already being recorded.\n\n${lockLabel}\n\nWait until that game is finished or ended early.`
			: "Another game is already being recorded. Wait until it is finished or ended early.");
		return false;
	}

	if (scheduleRef && attempt.row) {
	const serverSchedule = ensureScheduleShape(attempt.row.schedule_json);
	const freshSeriesEntry = serverSchedule?.days?.[scheduleRef.dayIndex]?.games?.[scheduleRef.seriesIndex];
	const freshSeriesGame = freshSeriesEntry?.gamesInSeries?.[scheduleRef.seriesGameIndex];

	const freshTeamsMatch =
		!!freshSeriesEntry &&
		(
			(freshSeriesEntry.away === t1?.name && freshSeriesEntry.home === t2?.name) ||
			(freshSeriesEntry.away === t2?.name && freshSeriesEntry.home === t1?.name)
		);

	if (!freshSeriesEntry || !freshSeriesGame || !freshTeamsMatch) {
		await releaseGameLockWithTimeout(attempt.lockId, { quiet: true, timeoutMs: 2500 });
		applyServerSeasonRow(attempt.row, { source: "lock-acquire" });
		alert("That scheduled slot changed on another device. The game was not started. Sync the schedule and pick the game again.");
		return false;
	}

	if (freshSeriesGame?.result) {
		await releaseGameLockWithTimeout(attempt.lockId, { quiet: true, timeoutMs: 2500 });
		applyServerSeasonRow(attempt.row, { source: "lock-acquire" });
		alert("That game was already recorded on another device.");
		return false;
	}

	if (freshSeriesGame?.skipped) {
		await releaseGameLockWithTimeout(attempt.lockId, { quiet: true, timeoutMs: 2500 });
		applyServerSeasonRow(attempt.row, { source: "lock-acquire" });
		alert("That game was marked not played because the series ended early.");
		return false;
	}
}

		if (!isCurrentGameStartAction(startActionId)) {
		await releaseGameLockWithTimeout(attempt.lockId, { quiet: true, timeoutMs: 2500 });
		return false;
	}
	startGameWithTeams(t1, t2, scheduleRef, attempt.lock, gameContext);
	return true;
}

let liveGameActionInProgress = false;
let gameStartInProgress = false;
let gameStartActionId = 0;
let activeGameStartActionId = 0;

function isCurrentGameStartAction(actionId) {
	return !actionId || activeGameStartActionId === actionId;
}

function setLiveActionControlsBusy(isBusy) {
	const selectors = [
		"#gameScreen .live-button-grid button",
		"#gameScreen .live-top-tools button:not(.undo-button)",
		"#gameScreen .live-runner-out-card button",
		"#gameScreen .live-manual-controls button",
		"#gameScreen #pitcherSelect",
		"#gameScreen #manualRunnerSelect",
		"#gameScreen #manualTargetBaseSelect"
	].join(",");

	document.querySelectorAll(selectors).forEach(el => {
		if (!el) return;
		if (isBusy) {
			if (!el.disabled) el.dataset.liveWasEnabled = "1";
			el.disabled = true;
		} else if (el.dataset.liveWasEnabled === "1") {
			el.disabled = false;
			delete el.dataset.liveWasEnabled;
		}
	});
}

function runLiveGameAction(actionLabel, fn) {
	if (!game) return false;
if (liveGameActionInProgress || playInputLock) {
	showNotification("Play is still saving — tap again after it finishes.", 900);
	return false;
}
	liveGameActionInProgress = true;
	playInputLock = true;
	setLiveActionControlsBusy(true);

	try {
		const result = fn();
		try { persistLiveGameAutosave(actionLabel || "play"); } catch (e) {}
		return result;
	} catch (error) {
		console.error("Live game action failed:", error);
		try { persistLiveGameAutosave("error"); } catch (e) {}
		showNotification("That play hit an app error. Local save was kept.", 2200);
		return false;
	} finally {
		setTimeout(() => {
			liveGameActionInProgress = false;
			playInputLock = false;

			// If the last play completed the game, keep play controls locked while the
			// final save is pending. End Game Early remains outside this control group.
			if (game?._finalizeInProgress || game?._gameCompletePendingSave) return;

			setLiveActionControlsBusy(false);
		}, 220);
	}
}

async function runGameStartAction(fn) {
	if (gameStartInProgress) {
		showNotification("Already starting a game. Please wait.", 1000);
		return false;
	}

	gameStartInProgress = true;
	const actionId = ++gameStartActionId;
	activeGameStartActionId = actionId;

	const manualBtn = document.getElementById("manualStartGameBtn");
	const scheduledBtn = document.getElementById("startScheduledGameBtn");
	if (manualBtn) manualBtn.disabled = true;
	if (scheduledBtn) scheduledBtn.disabled = true;

	try {
	const result = await withAppWorking("Starting game…", async () => {
return await withTimeout(fn(actionId), 12000, "__start_timeout__");
});

		if (result === "__start_timeout__") {
			if (activeGameStartActionId === actionId) activeGameStartActionId = 0;
			alert("Starting the game is taking too long. The app did not start a new game. Sync/reload and try again.");
			return false;
		}

		return result;
	} catch (error) {
		console.error("Start game action failed:", error);
		alert("The game could not start cleanly. No game was recorded. Try again after syncing/reloading.");
		return false;
	} finally {
		if (activeGameStartActionId === actionId) activeGameStartActionId = 0;
		gameStartInProgress = false;

		if (!game) {
			if (manualBtn) manualBtn.disabled = false;
			if (scheduledBtn) scheduledBtn.disabled = false;
		}
	}
}

async function startGame() {
	return await runGameStartAction(async (startActionId) => {
		let validTeams = league.teams.filter(t => t.players.length > 0);

		let team1Index = parseInt(document.getElementById("team1Select").value);
		let team2Index = parseInt(document.getElementById("team2Select").value);

		if (team1Index === team2Index) {
			alert("Please select two different teams!");
			return false;
		}

		let t1 = validTeams[team1Index];
		let t2 = validTeams[team2Index];

	return await beginLockedGame(t1, t2, null, { type: "manual" }, null, startActionId);
	});
}

async function endGameEarly() {
	if (!game) {
		if (!activeGameLock) return;
		if (!confirm("There is no live game on this device, but a server lock is still active. Clear it now?")) return;
		const orphanLockId = activeGameLock?.lockId || null;
		try { persistActiveGameLock(null); } catch (e) {}
		try { localStorage.removeItem(ACTIVE_GAME_LOCK_KEY); } catch (e) {}
		showMainMenu();
		await releaseGameLockWithTimeout(orphanLockId, { quiet: true, timeoutMs: 2500 });
		return true;
	}

	const t1Score = Number(game.team1Score || 0);
	const t2Score = Number(game.team2Score || 0);
	const isTied = t1Score === t2Score;
	const summary = `Current score: ${game.team1.name} ${t1Score} — ${game.team2.name} ${t2Score}`;

	if (isTied) {
		const firstWarn = confirm(
			"⚠️ THIS GAME IS TIED.\n\n" +
			summary + "\n\n" +
			"Saving a tied game early can MESS UP standings, seeding, and the playoff bracket.\n\n" +
			"In real play you should only End & Save when there is a clear winner. Continue playing or break the tie unless you absolutely have no other option.\n\n" +
			"Press OK only if you understand and accept the risk."
		);
		if (!firstWarn) return;

		const finalConfirm = confirm(
			"Last warning.\n\n" +
			"This will save the game as a TIE. It will NOT credit either team with a win or loss, and the schedule slot will be marked as a tie.\n\n" +
			"Are you absolutely sure you want to save this tied game?"
		);
		if (!finalConfirm) return;
	} else {
		const winner = t1Score > t2Score ? game.team1.name : game.team2.name;
		const ok = confirm(
			`End this game now and save the current stats?\n\n${summary}\n\n${winner} will be credited with the win.`
		);
		if (!ok) return;
	}

	await finalizeCompletedGame({ allowTie: true });
	return true;
}

async function emergencyEndGameFromSetup() {
	if (!activeGameLock && !game && !hasValidLiveGameAutosave()) {
		alert("There is no active game to clear right now.");
		return;
	}

	if (!confirm("Emergency End Game will clear the current live-game lock and discard the active game. Use this only if a game got stuck. Continue?")) return;

	const lockId = game?._lockId || activeGameLock?.lockId || null;

	resetLiveGameSessionState();
	try { persistActiveGameLock(null); } catch (e) {}
	try { localStorage.removeItem(ACTIVE_GAME_LOCK_KEY); } catch (e) {}

	refreshGameLockUI();
	showMainMenu();
	showNotification("Stuck game cleared locally. Clearing server lock in the background…", 1800);

	const released = await releaseGameLockWithTimeout(lockId, { quiet: true, timeoutMs: 2500 });
	if (!released) {
		alert("The stuck game was cleared on this device. If the server still shows a lock, sync/reload and press Emergency End Game once more.");
		return false;
	}

	alert("The stuck live game was cleared. You can start a new game now.");
	return true;
}

function undoLastAction() {
	return runLiveGameAction("undo", () => applyUndoLastAction());
}

function applyUndoLastAction() {
  if (gameHistory.length > 0) {
    let previousState = gameHistory.pop();
    restoreGameState(previousState);

    // Keep undo simple with the new auto-clean batting flow
   pendingBattingResult = null;
document.getElementById("errorPicker")?.classList.add("hidden");
document.getElementById("outPicker")?.classList.add("hidden");
keepLiveGameSectionsEnabled();
updatePitcherSelect();
    updateGameScreen();

    if (gameHistory.length === 0) {
      document.getElementById("undoButton").disabled = true;
    }
  }
}

function executeManualRunnerMove() {
	return runLiveGameAction("manual runner move", () => applyExecuteManualRunnerMove());
}

function applyExecuteManualRunnerMove() {
	if (!game) return;

	const fromBase = document.getElementById("manualRunnerSelect")?.value;
	const toBase = document.getElementById("manualTargetBaseSelect")?.value;

	if (!fromBase) {
		showNotification("No runner available to move", 1200);
		return;
	}

	if (toBase === "home") {
		if (fromBase !== "third") {
			showNotification("Only a runner on 3rd can be scored manually", 1500);
			return;
		}
		manualScoreFromThird();
		return;
	}

	if (fromBase === toBase) {
		showNotification("Runner is already on that base", 1200);
		return;
	}

	manualMove(fromBase, toBase);
}

function manualMove(fromBase, toBase) {
// fromBase/toBase are: "first","second","third"
if (!game) return;

if (!game.bases[fromBase]) {
showNotification("No runner on " + fromBase, 1200);
return;
}
if (game.bases[toBase]) {
showNotification(toBase + " is already occupied", 1200);
return;
}

// Save for undo (optional but recommended)
gameHistory.push(saveGameState());
document.getElementById("undoButton").disabled = false;

// Move runner object exactly as-is (keeps reachedOnError flag)
game.bases[toBase] = game.bases[fromBase];
game.bases[fromBase] = null;

updateGameScreen();
}

function manualScoreFromThird() {
	if (!game) return;

	if (!game.bases.third) {
		showNotification("No runner on 3rd", 1200);
		return;
	}

	gameHistory.push(saveGameState());
	document.getElementById("undoButton").disabled = false;

	const runner = normalizeBaseRunner(game.bases.third, game.batting);
	game.bases.third = null;

	const pitcherKey = getCurrentPitcherKey();
	const totals = { runs: 0, earnedRuns: 0, rbis: 0, pitcherCharges: {}, scoringEvents: [] };
	scoreExistingRunner(runner, totals, { creditRbi: false });
	applyHalfInningRuns(totals.runs, totals.scoringEvents || []);

	if (!isOvertimeActive() && game.inning <= 2 && game.halfInningRuns >= 6) {
	endHalfInning(pitcherKey, "Run rule reached (6). Switching sides.");
	updateGameScreen();
	return;
}

	showNotification("Run scored!", 1200);
	updateGameScreen();
}

function clearBases() {
	return runLiveGameAction("clear bases", () => applyClearBases());
}

function applyClearBases() {
	if (!game) return;

	gameHistory.push(saveGameState());
	document.getElementById("undoButton").disabled = false;

	game.bases.first = null;
	game.bases.second = null;
	game.bases.third = null;

	showNotification("Bases cleared", 1200);
	updateGameScreen();
}

function recordBattingResult(result) {
	return runLiveGameAction("play", () => {
		if (result === "doublePlay" && countBaseRunners() < 2) {
			showNotification("Need 2+ runners on base for a double play", 1500);
			return false;
		}

		const batterIndex = getCurrentBatterIndex();
		let currentBatter = game.batting.players[batterIndex];
		let batterKey = getGameStatsKey(game.batting, currentBatter);

		pendingBattingResult = {
			result: result,
			batter: currentBatter,
			batterKey: batterKey
		};

		lastPlay = {
			battingTeamName: game.batting.name,
			fieldingTeamName: game.fielding.name,
			pitcherIndex: parseInt(document.getElementById("pitcherSelect").value),
			batterKey: batterKey,
			batterName: currentBatter,
			result: result
		};

		recordPitchingResult("clean");
		return true;
	});
}

function confirmError() {
	return runLiveGameAction("error", () => applyConfirmError());
}

function applyConfirmError() {
	if (!lastPlay) return;

	const fielders = Array.isArray(lastPlay.fieldingPlayers) && lastPlay.fieldingPlayers.length
		? lastPlay.fieldingPlayers
		: (game?.fielding?.players || []);

	let idx = parseInt(document.getElementById("errorPlayerSelect").value, 10);
	if (!Number.isInteger(idx) || idx < 0) idx = 0;

	gameHistory.push(saveGameState());
	document.getElementById("undoButton").disabled = false;
	document.getElementById("errorPicker").classList.add("hidden");

	const fielderName = fielders[idx] || null;
	const fielderKey = fielderName
		? getGameStatsKey(lastPlay.fieldingTeamName || game?.fielding, fielderName)
		: null;

	if (fielderKey && game?.gameStats?.[fielderKey]) {
		game.gameStats[fielderKey].fieldingErrors++;
	}

	const battingTeamNameForPlay = lastPlay.battingTeamName || game?.batting?.name || "";
	const batterName = lastPlay.batterName;

	["first", "second", "third"].forEach(base => {
		const runner = game?.bases?.[base];
		if (runner && runner.player === batterName) {
			runner.reachedOnError = true;
			if (!runner.teamName) runner.teamName = battingTeamNameForPlay;
			if (!runner.statsKey) runner.statsKey = getGameStatsKey(runner.teamName || battingTeamNameForPlay, runner.player);
		}
	});

	const batterKey = lastPlay.batterKey;
const batterStats = batterKey && game?.gameStats?.[batterKey] ? game.gameStats[batterKey] : null;
const reversibleHit = ["single", "double", "triple"].includes(lastPlay.result);
const pitcherCharges = (lastPlay.pitcherCharges && typeof lastPlay.pitcherCharges === "object")
	? lastPlay.pitcherCharges
	: null;

	if (batterStats && reversibleHit) {
		if (lastPlay.result === "single") {
			batterStats.hits = Math.max(0, Number(batterStats.hits || 0) - 1);
			batterStats.singles = Math.max(0, Number(batterStats.singles || 0) - 1);
		} else if (lastPlay.result === "double") {
			batterStats.hits = Math.max(0, Number(batterStats.hits || 0) - 1);
			batterStats.doubles = Math.max(0, Number(batterStats.doubles || 0) - 1);
		} else if (lastPlay.result === "triple") {
			batterStats.hits = Math.max(0, Number(batterStats.hits || 0) - 1);
			batterStats.triples = Math.max(0, Number(batterStats.triples || 0) - 1);
		}

		batterStats.rbis = Math.max(
			0,
			Number(batterStats.rbis || 0) - Number(lastPlay.creditedRbis || 0)
		);
	}

	if (reversibleHit) {
	if (pitcherCharges) {
		Object.keys(pitcherCharges).forEach(chargePitcherKey => {
			const charge = pitcherCharges[chargePitcherKey] || {};
			const stats = game?.gameStats?.[chargePitcherKey];
			if (!stats) return;

			stats.earnedRunsAllowed = Math.max(
				0,
				Number(stats.earnedRunsAllowed || 0) - Number(charge.earnedRuns || 0)
			);
		});
	} else {
		const pitcherKey = lastPlay.pitcherKey;
		const pitcherStats = pitcherKey && game?.gameStats?.[pitcherKey] ? game.gameStats[pitcherKey] : null;

		if (pitcherStats) {
			pitcherStats.earnedRunsAllowed = Math.max(
				0,
				Number(pitcherStats.earnedRunsAllowed || 0) - Number(lastPlay.creditedEarnedRuns || 0)
			);
		}
	}
}

	showNotification("Error charged to " + (fielderName || "selected fielder"), 1500);
	lastPlay = null;
	updateGameScreen();
}

function recordPitchingResult(pitchResult, errorFielderIndex = null) {
	if (!pendingBattingResult) return;

	const reachedOnError = (pitchResult === "error");

	gameHistory.push(saveGameState());
	document.getElementById("undoButton").disabled = false;

	let pitcherIndex = parseInt(document.getElementById("pitcherSelect").value, 10);
	if (!Number.isInteger(pitcherIndex) || pitcherIndex < 0) pitcherIndex = 0;

	const pitcher = game.fielding.players[pitcherIndex];
	const pitcherKey = getGameStatsKey(game.fielding, pitcher);
	const pitcherStats = ensureExtendedStatFields(game.gameStats[pitcherKey]);

	const playPitcherResponsibility = {
		pitcherKey,
		pitcherName: pitcher,
		teamName: game.fielding?.name || ""
	};

	const halfInningKey = game.inning + "-" + game.halfInning;
	game.currentInningPitchers[halfInningKey] = pitcherIndex;

	const result = pendingBattingResult.result;
	const batterKey = pendingBattingResult.batterKey;
	const currentBatter = pendingBattingResult.batter;
	const batterStats = ensureExtendedStatFields(game.gameStats[batterKey]);
	const fieldingPlayersSnapshot = Array.isArray(game.fielding?.players) ? game.fielding.players.slice() : [];

	let runs = 0;
let earnedRuns = 0;
let rbis = 0;
let pitcherCharges = {};
let scoringEvents = [];

	if (result !== "walk" && result !== "HBP") {
		batterStats.atBats++;
	}

	if (result === "out" || result === "K") {
		game.outs++;

		if (result === "K") {
			batterStats.strikeouts++;
			pitcherStats.pitchStrikeouts++;
		} else {
			batterStats.outs++;
		}

		pitcherStats.pitchOuts++;
		syncPitchingInnings(pitcherStats);

	} else if (result === "doublePlay") {
		const runnerCount = countBaseRunners();

		if (runnerCount < 2) {
			showNotification("Need 2+ runners for a double play", 1500);
				} else {
			const outsToRecord = Math.max(0, Math.min(2, 2 - Number(game.outs || 0)));

			if (outsToRecord <= 0) {
				showNotification("Side is already over.", 1200);
			} else {
				game.outs += outsToRecord;
				batterStats.outs++;
				pitcherStats.pitchOuts += outsToRecord;
				syncPitchingInnings(pitcherStats);

				const removedBase = game.bases.first ? "first" : (game.bases.second ? "second" : "third");
				const removedRunner = game.bases[removedBase];
				game.bases[removedBase] = null;

				showNotification(
					outsToRecord === 2
						? "Double play!" + (removedRunner?.player ? (" (" + removedRunner.player + " out)") : "")
						: "Inning-ending out!" + (removedRunner?.player ? (" (" + removedRunner.player + " out)") : ""),
					1500
				);
			}
		}

	} else if (result === "single") {
		const res = advanceRunnersOnContact(1, currentBatter, reachedOnError, playPitcherResponsibility);
		runs = res.runs;
		earnedRuns = res.earnedRuns;
		rbis = res.rbis;
		pitcherCharges = res.pitcherCharges || {};
		scoringEvents = res.scoringEvents || [];

		if (!reachedOnError) {
			batterStats.hits++;
			batterStats.singles++;
		}
		batterStats.rbis += rbis;

	} else if (result === "double") {
		const res = advanceRunnersOnContact(2, currentBatter, reachedOnError, playPitcherResponsibility);
		runs = res.runs;
		earnedRuns = res.earnedRuns;
		rbis = res.rbis;
		pitcherCharges = res.pitcherCharges || {};
		scoringEvents = res.scoringEvents || [];

		if (!reachedOnError) {
			batterStats.hits++;
			batterStats.doubles++;
		}
		batterStats.rbis += rbis;

	} else if (result === "triple") {
		const res = advanceRunnersOnContact(3, currentBatter, reachedOnError, playPitcherResponsibility);
		runs = res.runs;
		earnedRuns = res.earnedRuns;
		rbis = res.rbis;
		pitcherCharges = res.pitcherCharges || {};
		scoringEvents = res.scoringEvents || [];

		if (!reachedOnError) {
			batterStats.hits++;
			batterStats.triples++;
		}
		batterStats.rbis += rbis;

	} else if (result === "HR") {
		const res = advanceRunnersOnContact(4, currentBatter, false, playPitcherResponsibility);
		runs = res.runs;
		earnedRuns = res.earnedRuns;
		rbis = res.rbis;
		pitcherCharges = res.pitcherCharges || {};
		scoringEvents = res.scoringEvents || [];

		batterStats.hits++;
		batterStats.homeRuns++;
		batterStats.rbis += rbis;

	} else if (result === "walk") {
		const res = advanceRunnersOnAwardedFirst(currentBatter, playPitcherResponsibility);
		runs = res.runs;
		earnedRuns = res.earnedRuns;
		rbis = res.rbis;
		pitcherCharges = res.pitcherCharges || {};
		scoringEvents = res.scoringEvents || [];

		batterStats.walks++;
		batterStats.rbis += rbis;

	} else if (result === "HBP") {
		const res = advanceRunnersOnAwardedFirst(currentBatter, playPitcherResponsibility);
		runs = res.runs;
		earnedRuns = res.earnedRuns;
		rbis = res.rbis;
		pitcherCharges = res.pitcherCharges || {};
		scoringEvents = res.scoringEvents || [];

		batterStats.hitByPitch++;
		batterStats.rbis += rbis;
	}

	if (pitchResult === "error") {
		let fielderIdx = (errorFielderIndex !== null)
			? errorFielderIndex
			: parseInt(document.getElementById("pitcherSelect").value, 10);

		if (!Number.isInteger(fielderIdx) || fielderIdx < 0) fielderIdx = 0;

		const fielder = game.fielding.players[fielderIdx];
		const fielderKey = getGameStatsKey(game.fielding, fielder);
		if (game.gameStats[fielderKey]) game.gameStats[fielderKey].fieldingErrors++;
	}

	applyHalfInningRuns(runs, scoringEvents || []);
	syncPitchingInnings(pitcherStats);

	lastPlay = {
		battingTeamName: game.batting.name,
		fieldingTeamName: game.fielding.name,
		fieldingPlayers: fieldingPlayersSnapshot,
		pitcherIndex,
		pitcherKey,
		batterKey,
		batterName: currentBatter,
		result,
		creditedRbis: rbis,
		creditedRuns: runs,
		creditedEarnedRuns: earnedRuns,
		pitcherCharges: JSON.parse(JSON.stringify(pitcherCharges || {}))
	};

	const nextBatterIndex = setCurrentBatterIndex(getCurrentBatterIndex() + 1);
	checkAndConvertToGhostie(game.batting.players[nextBatterIndex]);

if (!isOvertimeActive() && game.inning <= 2 && game.halfInningRuns >= 6) {
	endHalfInning(pitcherKey, "Run rule reached (6). Switching sides.");
	pendingBattingResult = null;
	keepLiveGameSectionsEnabled();
	updateGameScreen();
	return;
}

	if (game.outs >= 2) {
		const transitionResult = endHalfInning(pitcherKey, null);
		pendingBattingResult = null;
		keepLiveGameSectionsEnabled();
		if (transitionResult !== "finalizing") updateGameScreen();
		return;
	}

	pendingBattingResult = null;
	keepLiveGameSectionsEnabled();
	updateGameScreen();
}
