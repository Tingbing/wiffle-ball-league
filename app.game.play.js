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

async function beginLockedGame(t1, t2, scheduleRef = null, extraLockDetails = {}, gameContext = null) {
	const attempt = await acquireGameLock({
		type: extraLockDetails?.type || (scheduleRef ? "scheduled" : (gameContext?.postseasonRef ? "postseason" : "manual")),
		team1: t1?.name || "",
		team2: t2?.name || "",
		...extraLockDetails
	});

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
		await releaseGameLock(attempt.lockId, { quiet: true });
		applyServerSeasonRow(attempt.row, { source: "lock-acquire" });
		alert("That scheduled slot changed on another device. The game was not started. Sync the schedule and pick the game again.");
		return false;
	}

	if (freshSeriesGame?.result) {
		await releaseGameLock(attempt.lockId, { quiet: true });
		applyServerSeasonRow(attempt.row, { source: "lock-acquire" });
		alert("That game was already recorded on another device.");
		return false;
	}

	if (freshSeriesGame?.skipped) {
		await releaseGameLock(attempt.lockId, { quiet: true });
		applyServerSeasonRow(attempt.row, { source: "lock-acquire" });
		alert("That game was marked not played because the series ended early.");
		return false;
	}
}

	startGameWithTeams(t1, t2, scheduleRef, attempt.lock, gameContext);
	return true;
}

async function startGame() {
	let validTeams = league.teams.filter(t => t.players.length > 0);

	let team1Index = parseInt(document.getElementById("team1Select").value);
	let team2Index = parseInt(document.getElementById("team2Select").value);

	if (team1Index === team2Index) {
		alert("Please select two different teams!");
		return;
	}

	let t1 = validTeams[team1Index];
	let t2 = validTeams[team2Index];

	await beginLockedGame(t1, t2, null, { type: "manual" });
}

async function endGameEarly() {
	if (!game) return;
	if (!confirm("End this game early? All progress for this game will be discarded.")) return;

	const released = await releaseGameLock(game._lockId || activeGameLock?.lockId || null, { quiet: true });
	if (!released) {
		alert("Could not clear the live-game lock yet. Stay in the game and try End Game Early again.");
		return;
	}

	resetLiveGameSessionState();
	showMainMenu();
	alert("Game ended early. No stats, schedule results, or standings were saved.");
}

async function emergencyEndGameFromSetup() {
	if (!activeGameLock && !game) {
		alert("There is no active game to clear right now.");
		return;
	}

	if (!confirm("Emergency End Game will clear the current live-game lock and discard the active game. Use this only if a game got stuck. Continue?")) return;

	const released = await releaseGameLock(game?._lockId || activeGameLock?.lockId || null, { quiet: true });
	if (!released) {
		alert("Could not clear the live-game lock. Try again while signed in.");
		return;
	}

	resetLiveGameSessionState();
	refreshGameLockUI();
	alert("The stuck live game was cleared. You can start a new game now.");
}

function undoLastAction() {
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
  if (!game || playInputLock) return;

  if (result === "doublePlay" && countBaseRunners() < 2) {
    showNotification("Need 2+ runners on base for a double play", 1500);
    return;
  }

  playInputLock = true;
  try {
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
  } finally {
    setTimeout(() => { playInputLock = false; }, 180);
  }
}

function confirmError() {
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
		endHalfInning(pitcherKey, null);
		pendingBattingResult = null;
		keepLiveGameSectionsEnabled();
		updateGameScreen();
		return;
	}

	pendingBattingResult = null;
	keepLiveGameSectionsEnabled();
	updateGameScreen();
}
