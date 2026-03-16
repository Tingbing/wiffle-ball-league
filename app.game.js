// Wiffle Ball League - Live game engine + stats
// Split from the current source-of-truth app.js. Load this AFTER app.core.js.

// RUNNER OUT PICKER (kept with gameplay helpers)

function showOutPicker() {
	if (!game) return;

	if (!game.bases.first && !game.bases.second && !game.bases.third) {
		showNotification("No runners on base", 1200);
		return;
	}

	const sel = document.getElementById("outBaseSelect");
	sel.innerHTML = "";

	const options = [
		{ base: "first", label: "Runner on 1st" },
		{ base: "second", label: "Runner on 2nd" },
		{ base: "third", label: "Runner on 3rd" }
	];

	options.forEach(o => {
		if (game.bases[o.base]) {
			const opt = document.createElement("option");
			opt.value = o.base;
			opt.text = o.label + " (" + game.bases[o.base].player + ")";
			sel.appendChild(opt);
		}
	});

	document.getElementById("outPicker").classList.remove("hidden");
	persistLiveGameAutosave();
}

function cancelRunnerOut() {
	document.getElementById("outPicker").classList.add("hidden");
	persistLiveGameAutosave();
}

function keepLiveGameSectionsEnabled() {
	const battingSection = document.getElementById("battingSection");
	const pitchingSection = document.getElementById("pitchingSection");

	if (battingSection) battingSection.classList.remove("disabled");
	if (pitchingSection) pitchingSection.classList.remove("disabled");
}

function confirmRunnerOut() {
if (!game) return;

const base = document.getElementById("outBaseSelect").value;
if (!base || !game.bases[base]) {
showNotification("No runner there", 1200);
cancelRunnerOut();
return;
}

// Save for undo
gameHistory.push(saveGameState());
document.getElementById("undoButton").disabled = false;

// Remove runner + add out
const removed = game.bases[base];
game.bases[base] = null;
game.outs++;

cancelRunnerOut();
showNotification(removed.player + " thrown out!", 1200);

// If that makes 2 outs, end the half-inning using the SAME logic as normal outs
if (game.outs >= 2) {
const pitcherKey = getCurrentPitcherKey();
endHalfInning(pitcherKey, "Runner thrown out — side over!");
updateGameScreen();
return;
}

updateGameScreen();
}

// LIVE GAME ENGINE

const LIVE_GAME_SAVE_KEY = "wiggleLiveGameStateV1";
let liveGameResumePromptShown = false;

function cloneJson(value) {
	return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getCompletedGameEntryId(gameLike = game) {
	if (!gameLike) return null;
	const scheduleRef = gameLike._scheduleRef;
	if (scheduleRef && Number.isInteger(scheduleRef.dayIndex) && Number.isInteger(scheduleRef.seriesIndex) && Number.isInteger(scheduleRef.seriesGameIndex)) {
		return `scheduled-${scheduleRef.dayIndex}-${scheduleRef.seriesIndex}-${scheduleRef.seriesGameIndex}`;
	}
	if (gameLike._gameInstanceId) return gameLike._gameInstanceId;
	if (gameLike._lockId) return `manual-${gameLike._lockId}`;
	return null;
}

function findCompletedGameLogEntry(entryId) {
	if (!entryId) return null;
	season.games = Array.isArray(season.games) ? season.games : [];
	return season.games.find(entry => entry && entry.id === entryId) || null;
}

function markCompletedGameOutcomeApplied(entryId) {
	const entry = findCompletedGameLogEntry(entryId);
	if (entry) entry.outcomeApplied = true;
}

function getCurrentHalfInningKey() {
	if (!game) return "";
	return `${game.inning}-${game.halfInning}`;
}

function captureSelectedPitcherState() {
	if (!game) return;
	const select = document.getElementById("pitcherSelect");
	let pitcherIndex = parseInt(select?.value, 10);
	if (!Number.isInteger(pitcherIndex) || pitcherIndex < 0) pitcherIndex = 0;
	const halfInningKey = getCurrentHalfInningKey();
	if (halfInningKey) {
		game.currentInningPitchers = game.currentInningPitchers || {};
		game.currentInningPitchers[halfInningKey] = pitcherIndex;
	}
	game.currentPitcher = {
		halfInningKey,
		pitcherIndex,
		pitcherName: game.fielding?.players?.[pitcherIndex] || null,
		teamName: game.fielding?.name || null
	};
}

function getLiveGameUiState() {
	return {
		errorPickerOpen: !document.getElementById("errorPicker")?.classList.contains("hidden"),
		errorPlayerIndex: parseInt(document.getElementById("errorPlayerSelect")?.value, 10),
		outPickerOpen: !document.getElementById("outPicker")?.classList.contains("hidden"),
		outBase: document.getElementById("outBaseSelect")?.value || "",
		manualRunnerBase: document.getElementById("manualRunnerSelect")?.value || "",
		manualTargetBase: document.getElementById("manualTargetBaseSelect")?.value || "first"
	};
}

function applyLiveGameUiState(uiState = {}) {
	const manualRunner = document.getElementById("manualRunnerSelect");
	const manualTarget = document.getElementById("manualTargetBaseSelect");
	if (manualRunner && uiState.manualRunnerBase) manualRunner.value = uiState.manualRunnerBase;
	if (manualTarget && uiState.manualTargetBase) manualTarget.value = uiState.manualTargetBase;

	if (uiState.outPickerOpen) {
		showOutPicker();
		const outBaseSelect = document.getElementById("outBaseSelect");
		if (outBaseSelect && uiState.outBase) outBaseSelect.value = uiState.outBase;
	} else {
		document.getElementById("outPicker")?.classList.add("hidden");
	}

	if (uiState.errorPickerOpen && lastPlay) {
		showErrorPicker();
		const errorPlayerSelect = document.getElementById("errorPlayerSelect");
		if (errorPlayerSelect && Number.isInteger(uiState.errorPlayerIndex)) {
			errorPlayerSelect.value = String(uiState.errorPlayerIndex);
		}
	} else {
		document.getElementById("errorPicker")?.classList.add("hidden");
	}
}

function buildLiveGameSavePayload() {
	if (!game) return null;
	captureSelectedPitcherState();
	return {
		version: 1,
		savedAt: new Date().toISOString(),
		lockId: game._lockId || activeGameLock?.lockId || null,
		gameInstanceId: game._gameInstanceId || null,
		game: cloneJson(game),
		gameHistory: Array.isArray(gameHistory) ? gameHistory.slice() : [],
		pendingBattingResult: cloneJson(pendingBattingResult),
		lastPlay: cloneJson(lastPlay),
		uiState: getLiveGameUiState()
	};
}

function persistLiveGameAutosave() {
	const payload = buildLiveGameSavePayload();
	if (!payload) return false;
	try {
		localStorage.setItem(LIVE_GAME_SAVE_KEY, JSON.stringify(payload));
		return true;
	} catch (e) {
		console.warn("live game autosave failed:", e);
		return false;
	}
}

function readLiveGameAutosave() {
	try {
		const raw = localStorage.getItem(LIVE_GAME_SAVE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		return parsed && parsed.game ? parsed : null;
	} catch (e) {
		return null;
	}
}

function clearLiveGameAutosave() {
	try { localStorage.removeItem(LIVE_GAME_SAVE_KEY); } catch (e) {}
}

function resumeLiveGameFromAutosave(snapshot) {
	if (!snapshot?.game) return false;

	game = cloneJson(snapshot.game);
	gameHistory = Array.isArray(snapshot.gameHistory) ? snapshot.gameHistory.slice() : [];
	pendingBattingResult = cloneJson(snapshot.pendingBattingResult) || null;
	lastPlay = cloneJson(snapshot.lastPlay) || null;
	playInputLock = false;

	game._lockId = game._lockId || snapshot.lockId || activeGameLock?.lockId || null;
	game.bases = game.bases || { first: null, second: null, third: null };
	game.gameStats = game.gameStats || {};
	game.currentInningPitchers = game.currentInningPitchers || {};
	game.batterIndexByTeam = game.batterIndexByTeam || {
		[game.team1?.name || "Team 1"]: 0,
		[game.team2?.name || "Team 2"]: 0
	};

	keepLiveGameSectionsEnabled();
	showGame();
	updatePitcherSelect();
	updateGameScreen();
	applyLiveGameUiState(snapshot.uiState || {});
	document.getElementById("undoButton").disabled = gameHistory.length === 0;
	persistLiveGameAutosave();
	showNotification("Recovered saved live game", 1500);
	return true;
}

async function maybeOfferLiveGameResume() {
	if (game || isPublicViewOnlyMode()) return;

	const snapshot = readLiveGameAutosave();
	if (!snapshot?.game) return;

	const snapshotLockId =
		snapshot.lockId ||
		snapshot.game?._lockId ||
		snapshot.game?._lockInfo?.lockId ||
		null;

	if (!snapshotLockId) {
		clearLiveGameAutosave();
		return;
	}

	let resolvedLock = activeGameLock || null;

	// First try to recover the lock from the saved snapshot itself
	if ((!resolvedLock || resolvedLock.lockId !== snapshotLockId) && snapshot.game?._lockInfo?.lockId === snapshotLockId) {
		persistActiveGameLock(snapshot.game._lockInfo);
		resolvedLock = snapshot.game._lockInfo;
	}

	// Then try server state if needed
	if ((!resolvedLock || resolvedLock.lockId !== snapshotLockId) && typeof fetchSeasonRowFromServer === "function") {
		try {
			const row = await fetchSeasonRowFromServer({ quiet: true });
			const serverLock = row?.active_game_lock || null;
			if (serverLock?.lockId === snapshotLockId) {
				persistActiveGameLock(serverLock);
				resolvedLock = serverLock;
			}
		} catch (e) {
			console.warn("resume lock fetch failed:", e);
		}
	}

	// Last fallback: rebuild a local lock from the snapshot instead of deleting the autosave
	if (!resolvedLock || resolvedLock.lockId !== snapshotLockId) {
		const scheduleRef = snapshot.game?._scheduleRef || null;
		const fallbackLock = snapshot.game?._lockInfo || {
			lockId: snapshotLockId,
			type: scheduleRef ? "scheduled" : "manual",
			team1: snapshot.game?.team1?.name || "",
			team2: snapshot.game?.team2?.name || "",
			dayNumber: Number.isInteger(scheduleRef?.dayIndex) ? scheduleRef.dayIndex + 1 : undefined,
			seriesNumber: Number.isInteger(scheduleRef?.seriesIndex) ? scheduleRef.seriesIndex + 1 : undefined,
			seriesGameNumber: Number.isInteger(scheduleRef?.seriesGameIndex) ? scheduleRef.seriesGameIndex + 1 : undefined,
			startedAt: snapshot.savedAt || new Date().toISOString(),
			startedByName: (typeof getStoredName === "function" ? getStoredName() : "") || CURRENT_EMAIL || "This device"
		};
		persistActiveGameLock(fallbackLock);
		resolvedLock = fallbackLock;
	}

	const scheduleRef = snapshot.game?._scheduleRef;
	if (
		scheduleRef &&
		Number.isInteger(scheduleRef.dayIndex) &&
		Number.isInteger(scheduleRef.seriesIndex) &&
		Number.isInteger(scheduleRef.seriesGameIndex)
	) {
		const seriesGame =
			schedule?.days?.[scheduleRef.dayIndex]?.games?.[scheduleRef.seriesIndex]?.gamesInSeries?.[scheduleRef.seriesGameIndex];

		if (seriesGame?.result) {
			clearLiveGameAutosave();
			return;
		}
	}

	if (liveGameResumePromptShown) return;
	liveGameResumePromptShown = true;

	const label =
		getActiveGameLockLabel(resolvedLock) ||
		`${snapshot.game?.team1?.name || "Team 1"} vs ${snapshot.game?.team2?.name || "Team 2"}`;

	if (!confirm(`A live game save was found on this device.\n\n${label}\n\nResume this in-progress game?`)) {
		return;
	}

	resumeLiveGameFromAutosave(snapshot);
}

function startGameWithTeams(t1, t2, scheduleRef = null, lockInfo = null) {
	const activeTeam1 = buildActiveTeamForGame(t1, scheduleRef);
	const activeTeam2 = buildActiveTeamForGame(t2, scheduleRef);

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
		_scheduleRef: scheduleRef,
		_lockId: lockInfo?.lockId || null,
		_lockInfo: lockInfo || null,
		_gameInstanceId: scheduleRef
			? `scheduled-${scheduleRef.dayIndex}-${scheduleRef.seriesIndex}-${scheduleRef.seriesGameIndex}`
			: (lockInfo?.lockId ? `manual-${lockInfo.lockId}` : `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
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

async function beginLockedGame(t1, t2, scheduleRef = null, extraLockDetails = {}) {
	const attempt = await acquireGameLock({
		type: scheduleRef ? "scheduled" : "manual",
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
		const freshSeriesGame = serverSchedule?.days?.[scheduleRef.dayIndex]?.games?.[scheduleRef.seriesIndex]?.gamesInSeries?.[scheduleRef.seriesGameIndex];
		if (freshSeriesGame?.result) {
			await releaseGameLock(attempt.lockId, { quiet: true });
			applyServerSeasonRow(attempt.row);
			alert("That game was already recorded on another device.");
			return false;
		}
	}

	startGameWithTeams(t1, t2, scheduleRef, attempt.lock);
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

function resetLiveGameSessionState() {
	game = null;
	gameHistory = [];
	lastPlay = null;
	pendingBattingResult = null;
	playInputLock = false;
	clearLiveGameAutosave();

	document.getElementById("errorPicker")?.classList.add("hidden");
	document.getElementById("outPicker")?.classList.add("hidden");
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

function saveGameState() {
	return JSON.stringify({
		team1Score: game.team1Score,
		team2Score: game.team2Score,
		outs: game.outs,
		halfInningRuns: game.halfInningRuns,
		inning: game.inning,
		halfInning: game.halfInning,
		batterIndex: game.batterIndex,
		batterIndexByTeam: JSON.parse(JSON.stringify(game.batterIndexByTeam || {})),
		currentPitcher: game.currentPitcher,
		bases: {
			first: game.bases.first ? { ...game.bases.first } : null,
			second: game.bases.second ? { ...game.bases.second } : null,
			third: game.bases.third ? { ...game.bases.third } : null
		},
		gameStats: JSON.parse(JSON.stringify(game.gameStats)),
		batting: game.batting,
		fielding: game.fielding,
		currentInningPitchers: { ...game.currentInningPitchers },
		pendingBattingResult: pendingBattingResult ? JSON.parse(JSON.stringify(pendingBattingResult)) : null,
		lastPlay: lastPlay ? JSON.parse(JSON.stringify(lastPlay)) : null
	});
}

function restoreGameState(stateString) {
	let state = JSON.parse(stateString);
	game.team1Score = state.team1Score;
	game.team2Score = state.team2Score;
	game.halfInningRuns = state.halfInningRuns ?? 0;
	game.outs = state.outs;
	game.inning = state.inning;
	game.halfInning = state.halfInning;
	game.batterIndex = state.batterIndex;
	game.batterIndexByTeam = state.batterIndexByTeam || {
		[game.team1.name]: 0,
		[game.team2.name]: 0
	};
	game.currentPitcher = state.currentPitcher;
	game.bases = state.bases;
	game.gameStats = state.gameStats;
	game.batting = state.batting;
	game.fielding = state.fielding;
	game.currentInningPitchers = state.currentInningPitchers || {};
	pendingBattingResult = state.pendingBattingResult || null;
	lastPlay = state.lastPlay || null;
	game.batterIndex = getCurrentBatterIndex();
}

function getCurrentBatterIndex() {
	if (!game?.batting?.name) return 0;
	if (!game.batterIndexByTeam || typeof game.batterIndexByTeam !== "object") {
		game.batterIndexByTeam = {};
	}
	let index = Number(game.batterIndexByTeam[game.batting.name]);
	if (!Number.isInteger(index) || index < 0) index = 0;
	return index;
}

function setCurrentBatterIndex(nextIndex) {
	if (!game?.batting?.name) return 0;
	if (!game.batterIndexByTeam || typeof game.batterIndexByTeam !== "object") {
		game.batterIndexByTeam = {};
	}
	const playerCount = Math.max(1, Number(game.batting?.players?.length) || 1);
	let normalized = Number(nextIndex);
	if (!Number.isFinite(normalized)) normalized = 0;
	normalized = ((Math.trunc(normalized) % playerCount) + playerCount) % playerCount;
	game.batterIndexByTeam[game.batting.name] = normalized;
	game.batterIndex = normalized;
	return normalized;
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
	function updatePitcherSelect() {
		let select = document.getElementById("pitcherSelect");
		select.innerHTML = "";

		game.fielding.players.forEach((player, i) => {
			let opt = document.createElement("option");
			opt.value = i;
			opt.text = player;
			select.appendChild(opt);
		});

		let halfInningKey = game.inning + "-" + game.halfInning;
		if (game.currentInningPitchers[halfInningKey] !== undefined) {
			select.selectedIndex = game.currentInningPitchers[halfInningKey];
		}

		updatePitcherDisplay();
	}

	function updatePitcherDisplay() {
	let select = document.getElementById("pitcherSelect");
	let pitcherIndex = parseInt(select.value);
	let pitcher = game.fielding.players[pitcherIndex];
	document.getElementById("pitcherText").innerText = "Pitching: " + pitcher;
	captureSelectedPitcherState();
	persistLiveGameAutosave();
}

function updateGameScreen() {
	document.getElementById("team1Name").innerText = game.team1.name;
	document.getElementById("team2Name").innerText = game.team2.name;
	document.getElementById("team1Score").innerText = game.team1Score;
	document.getElementById("team2Score").innerText = game.team2Score;

	let halfText = game.halfInning === "top" ? "Top" : "Bottom";
	document.getElementById("inningText").innerText =
		halfText + " of Inning " + game.inning + " | " + game.batting.name + " Batting";

	document.getElementById("outsText").innerText = "Outs: " + game.outs + "/2";

	const batterIndex = getCurrentBatterIndex();
	let player = game.batting.players[batterIndex] || "No Player";
	document.getElementById("batterText").innerText = player;

	updateBasesDisplay();
	updateManualRunnerControls();
	persistLiveGameAutosave();
}

	function updateBasesDisplay() {
		let base1 = document.getElementById("base1");
		let base2 = document.getElementById("base2");
		let base3 = document.getElementById("base3");

		base1.className = "base first";
		base2.className = "base second";
		base3.className = "base third";
		base1.innerText = "1st";
		base2.innerText = "2nd";
		base3.innerText = "3rd";

		if (game.bases.first) {
			if (game.bases.first.type === "ghostie") {
				base1.classList.add("ghostie");
				base1.innerText = "1st\n👻";
			} else {
				base1.classList.add("occupied");
				base1.innerText = "1st\n" + game.bases.first.player;
			}
		}

		if (game.bases.second) {
			if (game.bases.second.type === "ghostie") {
				base2.classList.add("ghostie");
				base2.innerText = "2nd\n👻";
			} else {
				base2.classList.add("occupied");
				base2.innerText = "2nd\n" + game.bases.second.player;
			}
		}

		if (game.bases.third) {
			if (game.bases.third.type === "ghostie") {
				base3.classList.add("ghostie");
				base3.innerText = "3rd\n👻";
			} else {
				base3.classList.add("occupied");
				base3.innerText = "3rd\n" + game.bases.third.player;
			}
		}
	}


function countBaseRunners() {
  if (!game || !game.bases) return 0;
  return ['first','second','third'].reduce((n,b)=> n + (game.bases[b] ? 1 : 0), 0);
}

function updateManualRunnerControls() {
	const runnerSelect = document.getElementById("manualRunnerSelect");
	const targetSelect = document.getElementById("manualTargetBaseSelect");
	if (!runnerSelect || !targetSelect) return;

	runnerSelect.innerHTML = "";

	const runnerOptions = [
		{ base: "first", label: "Runner on 1st" },
		{ base: "second", label: "Runner on 2nd" },
		{ base: "third", label: "Runner on 3rd" }
	];

	let hasRunner = false;
	runnerOptions.forEach(option => {
		if (game?.bases?.[option.base]) {
			const opt = document.createElement("option");
			opt.value = option.base;
			opt.text = option.label + " (" + game.bases[option.base].player + ")";
			runnerSelect.appendChild(opt);
			hasRunner = true;
		}
	});

	if (!hasRunner) {
		const emptyOpt = document.createElement("option");
		emptyOpt.value = "";
		emptyOpt.text = "No runners on base";
		runnerSelect.appendChild(emptyOpt);
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

function getCurrentPitcherKey() {
	// pitcher is always from the fielding team
	let pitcherIndex = parseInt(document.getElementById("pitcherSelect").value);
	let pitcher = game.fielding.players[pitcherIndex];
	return getGameStatsKey(game.fielding, pitcher);
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
	const totals = { runs: 0, earnedRuns: 0, rbis: 0 };
	scoreExistingRunner(runner, totals, { creditRbi: false });
	applyHalfInningRuns(totals.runs);

	if (game.gameStats[pitcherKey]) {
		game.gameStats[pitcherKey].runsAllowed += totals.runs;
		game.gameStats[pitcherKey].earnedRunsAllowed += totals.earnedRuns;
	}

	if (game.inning <= 2 && game.halfInningRuns >= 6) {
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

function ensureExtendedStatFields(stats) {
	if (!stats) return null;
	if (!Number.isFinite(Number(stats.runsScored))) stats.runsScored = 0;
	if (!Number.isFinite(Number(stats.hitByPitch))) stats.hitByPitch = 0;
	return stats;
}

function normalizeBaseRunner(runner, fallbackTeam = game?.batting) {
	if (!runner) return null;
	if (!runner.teamName) runner.teamName = fallbackTeam?.name || "";
	if (!runner.statsKey && runner.player) {
		runner.statsKey = getGameStatsKey(runner.teamName || fallbackTeam, runner.player);
	}
	if (runner.reachedOnError !== true) runner.reachedOnError = false;
	return runner;
}

function createBaseRunner(playerName, reachedOnError = false, teamObj = game?.batting) {
	const runner = {
		player: playerName,
		teamName: teamObj?.name || "",
		statsKey: getGameStatsKey(teamObj, playerName),
		reachedOnError: !!reachedOnError
	};
	return normalizeBaseRunner(runner, teamObj);
}

function getRunnerGameStats(runner, fallbackTeam = game?.batting) {
	const normalized = normalizeBaseRunner(runner, fallbackTeam);
	if (!normalized?.statsKey || !game?.gameStats) return null;

	if (!game.gameStats[normalized.statsKey]) {
		game.gameStats[normalized.statsKey] = createEmptyStats(
			normalized.teamName || fallbackTeam?.name || "",
			normalized.player,
			{ isSub: isSubKey(normalized.statsKey) }
		);
	}
	return ensureExtendedStatFields(game.gameStats[normalized.statsKey]);
}

function scoreExistingRunner(runner, totals, options = {}) {
	const normalized = normalizeBaseRunner(runner, game?.batting);
	if (!normalized) return;

	const runnerStats = getRunnerGameStats(normalized, game?.batting);
	if (runnerStats) runnerStats.runsScored += 1;

	totals.runs += 1;
	if (!normalized.reachedOnError) totals.earnedRuns += 1;
	if (options.creditRbi !== false) totals.rbis += 1;
}

function applyHalfInningRuns(runs) {
	const runCount = Number(runs || 0);
	if (runCount <= 0 || !game) return;

	if (game.batting === game.team1) game.team1Score += runCount;
	else game.team2Score += runCount;

	game.halfInningRuns += runCount;
}

function advanceRunnersOnContact(bases, currentBatter, reachedOnError = false) {
	const totals = { runs: 0, earnedRuns: 0, rbis: 0 };

	const r1 = normalizeBaseRunner(game.bases.first, game.batting);
	const r2 = normalizeBaseRunner(game.bases.second, game.batting);
	const r3 = normalizeBaseRunner(game.bases.third, game.batting);

	game.bases.first = null;
	game.bases.second = null;
	game.bases.third = null;

	function place(baseNum, runner) {
		const normalized = normalizeBaseRunner(runner, game.batting);
		if (!normalized) return;
		if (baseNum === 1) game.bases.first = normalized;
		if (baseNum === 2) game.bases.second = normalized;
		if (baseNum === 3) game.bases.third = normalized;
	}

	function advanceExistingRunner(startBase, runner) {
		if (!runner) return;
		const endBase = startBase + bases;
		if (endBase >= 4) scoreExistingRunner(runner, totals, { creditRbi: true });
		else place(endBase, runner);
	}

	advanceExistingRunner(3, r3);
	advanceExistingRunner(2, r2);
	advanceExistingRunner(1, r1);

	if (bases >= 4) {
		scoreExistingRunner(createBaseRunner(currentBatter, reachedOnError), totals, { creditRbi: true });
	} else {
		place(bases, createBaseRunner(currentBatter, reachedOnError));
	}

	return totals;
}

function advanceRunnersOnAwardedFirst(currentBatter) {
	const totals = { runs: 0, earnedRuns: 0, rbis: 0 };

	const r1 = normalizeBaseRunner(game.bases.first, game.batting);
	const r2 = normalizeBaseRunner(game.bases.second, game.batting);
	const r3 = normalizeBaseRunner(game.bases.third, game.batting);

	const firstOccupied = !!r1;
	const secondOccupied = !!r2;
	const thirdOccupied = !!r3;

	game.bases.first = null;
	game.bases.second = null;
	game.bases.third = null;

	if (firstOccupied && secondOccupied && thirdOccupied) {
		scoreExistingRunner(r3, totals, { creditRbi: true });
	} else if (thirdOccupied) {
		game.bases.third = r3;
	}

	if (firstOccupied && secondOccupied) {
		game.bases.third = r2;
	} else if (secondOccupied) {
		game.bases.second = r2;
	}

	if (firstOccupied) {
		game.bases.second = r1;
	}

	game.bases.first = createBaseRunner(currentBatter, false);
	return totals;
}

	function checkAndConvertToGhostie(currentBatter) {
		let batterOnBase = false;
		let otherPlayerOnBase = false;

		if (game.bases.first && game.bases.first.player === currentBatter) batterOnBase = true;
		if (game.bases.second && game.bases.second.player === currentBatter) batterOnBase = true;
		if (game.bases.third && game.bases.third.player === currentBatter) batterOnBase = true;

		let partner = game.batting.players.find(p => p !== currentBatter);
		if (game.bases.first && game.bases.first.player === partner) otherPlayerOnBase = true;
		if (game.bases.second && game.bases.second.player === partner) otherPlayerOnBase = true;
		if (game.bases.third && game.bases.third.player === partner) otherPlayerOnBase = true;

		if (batterOnBase && otherPlayerOnBase) {
			if (game.bases.first && game.bases.first.player === currentBatter) {
				game.bases.first.type = "ghostie";
			}
			if (game.bases.second && game.bases.second.player === currentBatter) {
				game.bases.second.type = "ghostie";
			}
			if (game.bases.third && game.bases.third.player === currentBatter) {
				game.bases.third.type = "ghostie";
			}
		}
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

function showErrorPicker() {
	if (!lastPlay) {
		alert("No play to assign an error to yet.");
		return;
	}

	const fielders = Array.isArray(lastPlay.fieldingPlayers) && lastPlay.fieldingPlayers.length
		? lastPlay.fieldingPlayers
		: (game?.fielding?.players || []);

	if (!fielders.length) {
		alert("No fielders available for that play.");
		return;
	}

	let sel = document.getElementById("errorPlayerSelect");
	sel.innerHTML = "";

	fielders.forEach((p, i) => {
		let opt = document.createElement("option");
		opt.value = i;
		opt.text = p;
		sel.appendChild(opt);
	});

	document.getElementById("errorPicker").classList.remove("hidden");
	persistLiveGameAutosave();
}

function cancelError() {
	document.getElementById("errorPicker").classList.add("hidden");
	persistLiveGameAutosave();
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
	const pitcherKey = lastPlay.pitcherKey;
	const batterStats = batterKey && game?.gameStats?.[batterKey] ? game.gameStats[batterKey] : null;
	const pitcherStats = pitcherKey && game?.gameStats?.[pitcherKey] ? game.gameStats[pitcherKey] : null;
	const reversibleHit = ["single", "double", "triple"].includes(lastPlay.result);

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

	if (pitcherStats && reversibleHit) {
		pitcherStats.earnedRunsAllowed = Math.max(
			0,
			Number(pitcherStats.earnedRunsAllowed || 0) - Number(lastPlay.creditedEarnedRuns || 0)
		);
	}

	showNotification("Error charged to " + (fielderName || "selected fielder"), 1500);
	lastPlay = null;
	updateGameScreen();
}

async function finalizeCompletedGame() {
	const lockReleased = await saveGameStats();
	if (!lockReleased) {
		alert("Game stats were saved, but the live-game lock could not be cleared. Please sync again before anyone starts another game.");
	}
	displayGameOver();
}

function endHalfInning(pitcherKey, reasonText) {
// credit pitcher with 1 inning pitched for this completed half-inning
if (pitcherKey && game?.gameStats?.[pitcherKey]) {
game.gameStats[pitcherKey].inningsPitched += 1;
}

// clear inning state
game.bases.first = null;
game.bases.second = null;
game.bases.third = null;
game.outs = 0;
game.halfInningRuns = 0; // ✅ reset for next half

// switch sides / inning
if (game.halfInning === "top") {
game.halfInning = "bottom";
let temp = game.batting;
game.batting = game.fielding;
game.fielding = temp;
setCurrentBatterIndex(getCurrentBatterIndex());

updatePitcherSelect();
showNotification(reasonText || ("Side change! " + game.batting.name + " now batting."), 1500);
} else {
game.halfInning = "top";
let temp = game.batting;
game.batting = game.fielding;
game.fielding = temp;
setCurrentBatterIndex(getCurrentBatterIndex());

game.inning++;

// ✅ your game ends after bottom of 3rd
if (game.inning > 3) {
finalizeCompletedGame();
return;
}

updatePitcherSelect();
showNotification(reasonText || ("Inning " + game.inning + " starting! " + game.batting.name + " batting."), 1500);
}
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
	} else if (result === "doublePlay") {
		const runnerCount = countBaseRunners();
		if (runnerCount < 2) {
			showNotification("Need 2+ runners for a double play", 1500);
		} else {
			game.outs += 2;
			batterStats.outs++;
			pitcherStats.pitchOuts += 2;

			const removedBase = game.bases.first ? "first" : (game.bases.second ? "second" : "third");
			const removedRunner = game.bases[removedBase];
			game.bases[removedBase] = null;

			showNotification("Double play!" + (removedRunner?.player ? (" (" + removedRunner.player + " out)") : ""), 1500);
		}
	} else if (result === "single") {
		const res = advanceRunnersOnContact(1, currentBatter, reachedOnError);
		runs = res.runs;
		earnedRuns = res.earnedRuns;
		rbis = res.rbis;

		if (!reachedOnError) {
			batterStats.hits++;
			batterStats.singles++;
		}
		batterStats.rbis += rbis;
	} else if (result === "double") {
		const res = advanceRunnersOnContact(2, currentBatter, reachedOnError);
		runs = res.runs;
		earnedRuns = res.earnedRuns;
		rbis = res.rbis;

		if (!reachedOnError) {
			batterStats.hits++;
			batterStats.doubles++;
		}
		batterStats.rbis += rbis;
	} else if (result === "triple") {
		const res = advanceRunnersOnContact(3, currentBatter, reachedOnError);
		runs = res.runs;
		earnedRuns = res.earnedRuns;
		rbis = res.rbis;

		if (!reachedOnError) {
			batterStats.hits++;
			batterStats.triples++;
		}
		batterStats.rbis += rbis;
	} else if (result === "HR") {
		const res = advanceRunnersOnContact(4, currentBatter, false);
		runs = res.runs;
		earnedRuns = res.earnedRuns;
		rbis = res.rbis;

		batterStats.hits++;
		batterStats.homeRuns++;
		batterStats.rbis += rbis;
	} else if (result === "walk") {
		const res = advanceRunnersOnAwardedFirst(currentBatter);
		runs = res.runs;
		earnedRuns = res.earnedRuns;
		rbis = res.rbis;

		batterStats.walks++;
		batterStats.rbis += rbis;
	} else if (result === "HBP") {
		const res = advanceRunnersOnAwardedFirst(currentBatter);
		runs = res.runs;
		earnedRuns = res.earnedRuns;
		rbis = res.rbis;

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

	applyHalfInningRuns(runs);
	pitcherStats.runsAllowed += runs;
	pitcherStats.earnedRunsAllowed += earnedRuns;

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
		creditedEarnedRuns: earnedRuns
	};

	const nextBatterIndex = setCurrentBatterIndex(getCurrentBatterIndex() + 1);
	checkAndConvertToGhostie(game.batting.players[nextBatterIndex]);

	if (game.inning <= 2 && game.halfInningRuns >= 6) {
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

function buildCompletedGameLogEntry() {
	if (!game?.team1?.name || !game?.team2?.name) return null;

	const playedAt = Date.now();
	const scheduleRef = game?._scheduleRef &&
		Number.isInteger(game._scheduleRef.dayIndex) &&
		Number.isInteger(game._scheduleRef.seriesIndex) &&
		Number.isInteger(game._scheduleRef.seriesGameIndex)
		? {
			dayIndex: game._scheduleRef.dayIndex,
			seriesIndex: game._scheduleRef.seriesIndex,
			seriesGameIndex: game._scheduleRef.seriesGameIndex
		}
		: null;

	const id = getCompletedGameEntryId(game)
		|| (scheduleRef
			? `scheduled-${scheduleRef.dayIndex}-${scheduleRef.seriesIndex}-${scheduleRef.seriesGameIndex}`
			: `manual-${game._lockId || playedAt}-${game.team1.name}-${game.team2.name}`);

	return {
		id,
		playedAt,
		team1Name: game.team1.name,
		team2Name: game.team2.name,
		team1Score: Number(game.team1Score || 0),
		team2Score: Number(game.team2Score || 0),
		scheduleRef,
		lineups: {
			[game.team1.name]: Array.isArray(game.team1.players) ? game.team1.players.slice() : [],
			[game.team2.name]: Array.isArray(game.team2.players) ? game.team2.players.slice() : []
		},
		lockId: game._lockId || null,
		gameInstanceId: game._gameInstanceId || null,
		playerStats: Object.values(game.gameStats || {}).map(stats => ({ ...stats })),
		outcomeApplied: false
	};
}

function saveCompletedGameLog(extraFields = {}) {
	const entry = buildCompletedGameLogEntry();
	if (!entry) return null;

	const nextEntry = { ...entry, ...extraFields };
	season.games = Array.isArray(season.games) ? season.games : [];

	const existingIndex = season.games.findIndex(gameEntry => gameEntry && gameEntry.id === nextEntry.id);
	if (existingIndex >= 0) {
		season.games[existingIndex] = { ...season.games[existingIndex], ...nextEntry };
	} else {
		season.games.unshift(nextEntry);
	}

	return nextEntry;
}

async function saveGameStats() {
	const completedEntry = buildCompletedGameLogEntry();
	const completedEntryId = completedEntry?.id || null;
	const existingEntry = findCompletedGameLogEntry(completedEntryId);

	if (existingEntry) {
		if (!existingEntry.outcomeApplied) {
			applyGameOutcomeOnce();
			markCompletedGameOutcomeApplied(completedEntryId);
			saveSeason();
		}
		clearLiveGameAutosave();
		queueServerSync("game", { immediate: true });
		return await releaseGameLock(game?._lockId || activeGameLock?.lockId || null, { quiet: true });
	}

for (let key in game.gameStats) {
	const gameStats = ensureExtendedStatFields(game.gameStats[key]);
	const seasonStats = ensureExtendedStatFields(
		getOrCreateSeasonStatsByKey(key, gameStats.teamName, gameStats.playerName)
	);

	seasonStats.atBats = Number(seasonStats.atBats || 0) + Number(gameStats.atBats || 0);
	seasonStats.hits = Number(seasonStats.hits || 0) + Number(gameStats.hits || 0);
	seasonStats.singles = Number(seasonStats.singles || 0) + Number(gameStats.singles || 0);
	seasonStats.doubles = Number(seasonStats.doubles || 0) + Number(gameStats.doubles || 0);
	seasonStats.triples = Number(seasonStats.triples || 0) + Number(gameStats.triples || 0);
	seasonStats.homeRuns = Number(seasonStats.homeRuns || 0) + Number(gameStats.homeRuns || 0);
	seasonStats.walks = Number(seasonStats.walks || 0) + Number(gameStats.walks || 0);
	seasonStats.hitByPitch = Number(seasonStats.hitByPitch || 0) + Number(gameStats.hitByPitch || 0);
	seasonStats.strikeouts = Number(seasonStats.strikeouts || 0) + Number(gameStats.strikeouts || 0);
	seasonStats.outs = Number(seasonStats.outs || 0) + Number(gameStats.outs || 0);
	seasonStats.rbis = Number(seasonStats.rbis || 0) + Number(gameStats.rbis || 0);
	seasonStats.runsScored = Number(seasonStats.runsScored || 0) + Number(gameStats.runsScored || 0);
	seasonStats.pitchOuts = Number(seasonStats.pitchOuts || 0) + Number(gameStats.pitchOuts || 0);
	seasonStats.pitchStrikeouts = Number(seasonStats.pitchStrikeouts || 0) + Number(gameStats.pitchStrikeouts || 0);
	seasonStats.fieldingErrors = Number(seasonStats.fieldingErrors || 0) + Number(gameStats.fieldingErrors || 0);
	seasonStats.inningsPitched = Number(seasonStats.inningsPitched || 0) + Number(gameStats.inningsPitched || 0);
	seasonStats.runsAllowed = Number(seasonStats.runsAllowed || 0) + Number(gameStats.runsAllowed || 0);
	seasonStats.earnedRunsAllowed = Number(seasonStats.earnedRunsAllowed || 0) + Number(gameStats.earnedRunsAllowed || 0);
}

	saveCompletedGameLog({ outcomeApplied: false });
	saveSeason({ skipServerSync: true });
	applyGameOutcomeOnce();
	markCompletedGameOutcomeApplied(completedEntryId);
	saveSeason();
	clearLiveGameAutosave();
	queueServerSync("game", { immediate: true });
	return await releaseGameLock(game?._lockId || activeGameLock?.lockId || null, { quiet: true });
}

	function displayGameOver() {
		showGameOver();

		let winner = game.team1Score > game.team2Score ? game.team1.name : 
		             game.team2Score > game.team1Score ? game.team2.name : null;

		let banner = document.getElementById("winnerBanner");
		if (winner) {
			banner.innerText = "🏆 " + winner + " Wins! 🏆";
			banner.style.background = "#4a4";
		} else {
			banner.innerText = "It's a Tie!";
			banner.style.background = "#888";
		}

		document.getElementById("finalTeam1Name").innerText = game.team1.name;
		document.getElementById("finalTeam2Name").innerText = game.team2.name;
		document.getElementById("finalTeam1Score").innerText = game.team1Score;
		document.getElementById("finalTeam2Score").innerText = game.team2Score;

		let container = document.getElementById("statsContainer");
		container.innerHTML = "";

		let team1BattingCard = document.createElement("div");
		team1BattingCard.className = "card";
		team1BattingCard.innerHTML = `<h3>${game.team1.name} - Batting Statistics</h3>`;
		let team1BattingTable = createBattingStatsTable(game.team1, false);
		team1BattingCard.appendChild(team1BattingTable);
		container.appendChild(team1BattingCard);

		let team1PitchingCard = document.createElement("div");
		team1PitchingCard.className = "card";
		team1PitchingCard.innerHTML = `<h3>${game.team1.name} - Pitching Statistics</h3>`;
		let team1PitchingTable = createPitchingStatsTable(game.team1, false);
		team1PitchingCard.appendChild(team1PitchingTable);
		container.appendChild(team1PitchingCard);

		let team2BattingCard = document.createElement("div");
		team2BattingCard.className = "card";
		team2BattingCard.innerHTML = `<h3>${game.team2.name} - Batting Statistics</h3>`;
		let team2BattingTable = createBattingStatsTable(game.team2, false);
		team2BattingCard.appendChild(team2BattingTable);
		container.appendChild(team2BattingCard);

		let team2PitchingCard = document.createElement("div");
		team2PitchingCard.className = "card";
		team2PitchingCard.innerHTML = `<h3>${game.team2.name} - Pitching Statistics</h3>`;
		let team2PitchingTable = createPitchingStatsTable(game.team2, false);
		team2PitchingCard.appendChild(team2PitchingTable);
		container.appendChild(team2PitchingCard);
	}

function createBattingStatsTable(team, isSeason) {
	const table = document.createElement("table");
	table.className = "stats-table responsive";

	const headers = ["Player", "AVG", "H", "1B", "2B", "3B", "HR", "RBI"];
	if (isSeason) headers.push("AB");

	const thead = document.createElement("thead");
	const trh = document.createElement("tr");
	headers.forEach(h => {
		const th = document.createElement("th");
		th.textContent = h;
		trh.appendChild(th);
	});
	thead.appendChild(trh);
	table.appendChild(thead);

	const tbody = document.createElement("tbody");

	(team.players || []).forEach(player => {
		const key = isSeason ? getPlayerKey(team.name, player) : getGameStatsKey(team, player);
		let stats = isSeason ? season.playerStats[key] : game?.gameStats?.[key];

		if (!stats) {
			stats = createEmptyStats(team.name, player, { isSub: false });
			if (!isSeason && game?.gameStats) game.gameStats[key] = stats;
		}

		const avg = stats.atBats > 0 ? (stats.hits / stats.atBats).toFixed(3) : ".000";

		const values = [
			getDisplayNameForPlayer(team, player, isSeason),
			avg,
			stats.hits,
			stats.singles,
			stats.doubles,
			stats.triples,
			stats.homeRuns,
			stats.rbis
		];

		if (isSeason) values.push(stats.atBats);

		const tr = document.createElement("tr");
		values.forEach((v, i) => {
			const td = document.createElement("td");
			td.setAttribute("data-label", headers[i]);
			td.textContent = String(v);
			tr.appendChild(td);
		});
		tbody.appendChild(tr);
	});

	table.appendChild(tbody);
	return table;
}

function createPitchingStatsTable(team, isSeason) {
	const table = document.createElement("table");
	table.className = "stats-table responsive";

	const headers = ["Player", "IP", "K's", "K/3", "Outs", "R", "ER", "ERA", "Errors"];

	const thead = document.createElement("thead");
	const trh = document.createElement("tr");
	headers.forEach(h => {
		const th = document.createElement("th");
		th.textContent = h;
		trh.appendChild(th);
	});
	thead.appendChild(trh);
	table.appendChild(thead);

	const tbody = document.createElement("tbody");

	(team.players || []).forEach(player => {
		const key = isSeason ? getPlayerKey(team.name, player) : getGameStatsKey(team, player);
		let stats = isSeason ? season.playerStats[key] : game?.gameStats?.[key];

		if (!stats) {
			stats = createEmptyStats(team.name, player, { isSub: false });
			if (!isSeason && game?.gameStats) game.gameStats[key] = stats;
		}

		const era = stats.inningsPitched > 0
			? ((stats.earnedRunsAllowed / stats.inningsPitched) * 3).toFixed(2)
			: "-";

		const kPer3 = stats.inningsPitched > 0
			? ((stats.pitchStrikeouts / stats.inningsPitched) * 3).toFixed(2)
			: "-";

		const values = [
			getDisplayNameForPlayer(team, player, isSeason),
			Number(stats.inningsPitched).toFixed(1),
			stats.pitchStrikeouts,
			kPer3,
			stats.pitchOuts,
			stats.runsAllowed,
			stats.earnedRunsAllowed,
			era,
			stats.fieldingErrors
		];

		const tr = document.createElement("tr");
		values.forEach((v, i) => {
			const td = document.createElement("td");
			td.setAttribute("data-label", headers[i]);
			td.textContent = String(v);
			tr.appendChild(td);
		});
		tbody.appendChild(tr);
	});

	table.appendChild(tbody);
	return table;
}

function createSubBattingStatsTable(subEntries) {
	const table = document.createElement("table");
	table.className = "stats-table responsive";

	const headers = ["Player", "AVG", "H", "1B", "2B", "3B", "HR", "RBI", "AB"];
	const thead = document.createElement("thead");
	const trh = document.createElement("tr");
	headers.forEach(h => {
		const th = document.createElement("th");
		th.textContent = h;
		trh.appendChild(th);
	});
	thead.appendChild(trh);
	table.appendChild(thead);

	const tbody = document.createElement("tbody");
	(subEntries || []).forEach(stats => {
		const avg = stats.atBats > 0 ? (stats.hits / stats.atBats).toFixed(3) : ".000";
		const values = [stats.playerName, avg, stats.hits, stats.singles, stats.doubles, stats.triples, stats.homeRuns, stats.rbis, stats.atBats];

		const tr = document.createElement("tr");
		values.forEach((v, i) => {
			const td = document.createElement("td");
			td.setAttribute("data-label", headers[i]);
			td.textContent = String(v);
			tr.appendChild(td);
		});
		tbody.appendChild(tr);
	});

	table.appendChild(tbody);
	return table;
}

function createSubPitchingStatsTable(subEntries) {
	const table = document.createElement("table");
	table.className = "stats-table responsive";

	const headers = ["Player", "IP", "K's", "K/3", "Outs", "R", "ER", "ERA", "Errors"];
	const thead = document.createElement("thead");
	const trh = document.createElement("tr");
	headers.forEach(h => {
		const th = document.createElement("th");
		th.textContent = h;
		trh.appendChild(th);
	});
	thead.appendChild(trh);
	table.appendChild(thead);

	const tbody = document.createElement("tbody");
	(subEntries || []).forEach(stats => {
		const era = stats.inningsPitched > 0 ? ((stats.earnedRunsAllowed / stats.inningsPitched) * 3).toFixed(2) : "-";
		const kPer3 = stats.inningsPitched > 0 ? ((stats.pitchStrikeouts / stats.inningsPitched) * 3).toFixed(2) : "-";

		const values = [
			stats.playerName,
			Number(stats.inningsPitched).toFixed(1),
			stats.pitchStrikeouts,
			kPer3,
			stats.pitchOuts,
			stats.runsAllowed,
			stats.earnedRunsAllowed,
			era,
			stats.fieldingErrors
		];

		const tr = document.createElement("tr");
		values.forEach((v, i) => {
			const td = document.createElement("td");
			td.setAttribute("data-label", headers[i]);
			td.textContent = String(v);
			tr.appendChild(td);
		});
		tbody.appendChild(tr);
	});

	table.appendChild(tbody);
	return table;
}

function getSeasonTeamsForDisplay() {
	if (Array.isArray(league?.teams) && league.teams.length) {
		return league.teams;
	}

	const grouped = new Map();
	Object.values(season.playerStats || {}).forEach(stats => {
		const teamName = String(stats?.teamName || "").trim();
		const playerName = String(stats?.playerName || "").trim();
		if (!teamName || !playerName) return;
		if (!grouped.has(teamName)) grouped.set(teamName, new Set());
		grouped.get(teamName).add(playerName);
	});

	const orderedNames = (Array.isArray(schedule?.teamNames) && schedule.teamNames.length
		? schedule.teamNames.slice()
		: Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b))
	).filter(name => grouped.has(name));

	return orderedNames.map(teamName => ({
		name: teamName,
		players: Array.from(grouped.get(teamName) || []).sort((a, b) => a.localeCompare(b))
	}));
}

function buildSeasonStatsMetricGrid(metrics) {
	const grid = document.createElement("div");
	grid.className = "season-stats-metric-grid";

	(metrics || []).forEach(metric => {
		const item = document.createElement("div");
		item.className = "season-stats-metric";
		item.innerHTML = `
			<div class="season-stats-metric-label">${metric.label}</div>
			<div class="season-stats-metric-value">${metric.value}</div>
		`;
		grid.appendChild(item);
	});

	return grid;
}

function getSeasonPlayerOptions(teamsForDisplay) {
	const options = [];
	const seen = new Set();

	(teamsForDisplay || []).forEach(team => {
		(team.players || []).forEach(player => {
			const value = `REG|${team.name}|${player}`;
			if (seen.has(value)) return;
			seen.add(value);
			options.push({
				value,
				teamName: team.name,
				playerName: player,
				isSub: false,
				label: `${player} — ${team.name}`
			});
		});
	});

	Object.values(season.subStats || {})
		.sort((a, b) => String(a.playerName || "").localeCompare(String(b.playerName || "")))
		.forEach(stats => {
			const value = `SUB|${stats.playerName}`;
			if (seen.has(value)) return;
			seen.add(value);
			options.push({
				value,
				teamName: "SUB",
				playerName: stats.playerName,
				isSub: true,
				label: `${stats.playerName} — Sub`
			});
		});

	return options;
}

function getSeasonPlayerStatsForOption(option) {
	if (!option) return null;
	if (option.isSub) {
		return season.subStats?.[getSubKey(option.playerName)] || createEmptyStats("SUB", option.playerName, { isSub: true });
	}
	return season.playerStats?.[getPlayerKey(option.teamName, option.playerName)] || createEmptyStats(option.teamName, option.playerName, { isSub: false });
}

function getSeasonTeamRankings(teamsForDisplay) {
	const sorted = (teamsForDisplay || [])
		.map(team => {
			const record = getTeamRecord(team.name);
			const wins = Number(record.wins || 0);
			const losses = Number(record.losses || 0);
			const gameLog = getTeamGameLogForStats(team.name);
			const avgMargin = gameLog.length
				? gameLog.reduce((sum, gameRow) => sum + Number(gameRow.margin || 0), 0) / gameLog.length
				: 0;

			return {
				teamName: team.name,
				wins,
				losses,
				avgMargin
			};
		})
		.sort((a, b) => {
			if (b.wins !== a.wins) return b.wins - a.wins;
			if (a.losses !== b.losses) return a.losses - b.losses;
			if (b.avgMargin !== a.avgMargin) return b.avgMargin - a.avgMargin;
			return a.teamName.localeCompare(b.teamName);
		});

	let lastRank = 0;
	let lastRankKey = "";
	return sorted.map((entry, index) => {
		const rankKey = `${entry.wins}-${entry.losses}-${Number(entry.avgMargin || 0).toFixed(3)}`;
		if (rankKey !== lastRankKey) {
			lastRank = index + 1;
			lastRankKey = rankKey;
		}
		return { ...entry, rank: lastRank };
	});
}

function getTeamGameLogForStats(teamName) {
	const logs = [];
	(schedule?.days || []).forEach(day => {
		(day.games || []).forEach(seriesEntry => {
			(seriesEntry.gamesInSeries || []).forEach(seriesGame => {
				const result = seriesGame?.result;
				if (!result) return;

				if (result.type === "win") {
					if (result.winner === teamName) {
						logs.push({
							scored: Number(result.winnerScore || 0),
							allowed: Number(result.loserScore || 0),
							margin: Number(result.winnerScore || 0) - Number(result.loserScore || 0)
						});
					} else if (result.loser === teamName) {
						logs.push({
							scored: Number(result.loserScore || 0),
							allowed: Number(result.winnerScore || 0),
							margin: Number(result.loserScore || 0) - Number(result.winnerScore || 0)
						});
					}
				} else if (result.type === "tie") {
					if (result.team1 === teamName) {
						logs.push({
							scored: Number(result.score1 || 0),
							allowed: Number(result.score2 || 0),
							margin: Number(result.score1 || 0) - Number(result.score2 || 0)
						});
					} else if (result.team2 === teamName) {
						logs.push({
							scored: Number(result.score2 || 0),
							allowed: Number(result.score1 || 0),
							margin: Number(result.score2 || 0) - Number(result.score1 || 0)
						});
					}
				}
			});
		});
	});
	return logs;
}

function formatSeasonStatsPercent(value) {
	return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function formatSeasonStatsSignedNumber(value, digits = 1) {
	const num = Number(value || 0);
	if (!Number.isFinite(num)) return "-";
	if (num > 0) return `+${num.toFixed(digits)}`;
	if (num < 0) return num.toFixed(digits);
	return num.toFixed(digits);
}

function createSeasonPlayerDetails(option) {
	const wrap = document.createElement("div");
	wrap.className = "season-stats-stack";

	if (!option) {
		wrap.innerHTML = '<p class="season-stats-empty">No players available yet.</p>';
		return wrap;
	}

	const stats = getSeasonPlayerStatsForOption(option);
	const battingAvg = stats.atBats > 0 ? (stats.hits / stats.atBats).toFixed(3) : ".000";
	const era = stats.inningsPitched > 0 ? ((stats.earnedRunsAllowed / stats.inningsPitched) * 3).toFixed(2) : "-";
	const kPer3 = stats.inningsPitched > 0 ? ((stats.pitchStrikeouts / stats.inningsPitched) * 3).toFixed(2) : "-";

	const header = document.createElement("div");
	header.className = "season-stats-selection-header";
	header.innerHTML = `
		<h4>${option.playerName}</h4>
		<p>${option.isSub ? "Substitute Player" : option.teamName}</p>
	`;
	wrap.appendChild(header);

	const battingCard = document.createElement("div");
	battingCard.className = "card";
	battingCard.innerHTML = '<h4>Batting Stats</h4>';
	battingCard.appendChild(buildSeasonStatsMetricGrid([
		{ label: "AVG", value: battingAvg },
		{ label: "AB", value: stats.atBats },
		{ label: "H", value: stats.hits },
		{ label: "1B", value: stats.singles },
		{ label: "2B", value: stats.doubles },
		{ label: "3B", value: stats.triples },
		{ label: "HR", value: stats.homeRuns },
		{ label: "RBI", value: stats.rbis },
		{ label: "BB", value: stats.walks },
		{ label: "K", value: stats.strikeouts }
	]));
	wrap.appendChild(battingCard);

	const pitchingCard = document.createElement("div");
	pitchingCard.className = "card";
	pitchingCard.innerHTML = '<h4>Pitching Stats</h4>';
	pitchingCard.appendChild(buildSeasonStatsMetricGrid([
		{ label: "IP", value: Number(stats.inningsPitched || 0).toFixed(1) },
		{ label: "Outs", value: stats.pitchOuts },
		{ label: "K's", value: stats.pitchStrikeouts },
		{ label: "K/3", value: kPer3 },
		{ label: "R", value: stats.runsAllowed },
		{ label: "ER", value: stats.earnedRunsAllowed },
		{ label: "ERA", value: era },
		{ label: "Errors", value: stats.fieldingErrors }
	]));
	wrap.appendChild(pitchingCard);

	return wrap;
}

function createSeasonTeamDetails(team, rankings) {
	const wrap = document.createElement("div");
	wrap.className = "season-stats-stack";

	if (!team) {
		wrap.innerHTML = '<p class="season-stats-empty">No teams available yet.</p>';
		return wrap;
	}

	const record = getTeamRecord(team.name);
	const wins = Number(record.wins || 0);
	const losses = Number(record.losses || 0);
	const totalGames = wins + losses;
	const winRate = totalGames > 0 ? wins / totalGames : 0;
	const rankedTeam = (rankings || []).find(entry => entry.teamName === team.name) || null;
	const teamRank = rankedTeam?.rank || "-";
	const avgMargin = rankedTeam ? rankedTeam.avgMargin : 0;

	const header = document.createElement("div");
	header.className = "season-stats-selection-header";
	header.innerHTML = `
		<h4>${team.name}</h4>
		<p>Team-only season summary</p>
	`;
	wrap.appendChild(header);

	const summaryCard = document.createElement("div");
	summaryCard.className = "card";
	summaryCard.innerHTML = '<h4>Team Summary</h4>';
	summaryCard.appendChild(buildSeasonStatsMetricGrid([
		{ label: "Record", value: `${wins}-${losses}` },
		{ label: "Win Rate", value: formatSeasonStatsPercent(winRate) },
		{ label: "Avg Margin", value: totalGames > 0 ? formatSeasonStatsSignedNumber(avgMargin, 1) : "-" },
		{ label: "League Rank", value: `#${teamRank}` }
	]));

	const summaryNote = document.createElement("p");
	summaryNote.className = "season-stats-note";
	summaryNote.textContent = "Rank is based on record first, then average win/loss margin as the tiebreaker.";
	summaryCard.appendChild(summaryNote);
	wrap.appendChild(summaryCard);

	const futureCard = document.createElement("div");
	futureCard.className = "card";
	futureCard.innerHTML = `
		<h4>More Team Stats</h4>
		<p class="season-stats-note">This section is reserved so more team-level stats can be added later without bringing player stat tables back into this view.</p>
	`;
	wrap.appendChild(futureCard);

	return wrap;
}

function displaySeasonStats() {
	const container = document.getElementById("seasonStatsContainer");
	if (!container) return;

	const previousPlayerValue = document.getElementById("seasonPlayerSelect")?.value || "";
	const previousTeamValue = document.getElementById("seasonTeamSelect")?.value || "";
	container.innerHTML = "";

	const hasRegularStats = Object.keys(season.playerStats || {}).length > 0;
	const hasSubStats = Object.keys(season.subStats || {}).length > 0;
	const teamsForDisplay = getSeasonTeamsForDisplay();

	if (!teamsForDisplay.length && !hasRegularStats && !hasSubStats) {
		container.innerHTML = "<div class='card'><p>No season statistics published yet.</p></div>";
		return;
	}

	const playerOptions = getSeasonPlayerOptions(teamsForDisplay);
	const teamRankings = getSeasonTeamRankings(teamsForDisplay);

	const introCard = document.createElement("div");
	introCard.className = "card";
	introCard.innerHTML = `
		<h3 style="margin-top:0;">Season Stats Hub</h3>
		<p class="season-stats-note">Use the dropdowns below to quickly switch between one player or one team at a time instead of scrolling through every stat table at once.</p>
	`;
	container.appendChild(introCard);

	const layout = document.createElement("div");
	layout.className = "season-stats-layout";
	container.appendChild(layout);

	const playerPanel = document.createElement("div");
	playerPanel.className = "card season-stats-panel";
	playerPanel.innerHTML = `
		<h3>Player Stats</h3>
		<p class="season-stats-note">Select one player to view that player’s batting and pitching stats together.</p>
	`;
	layout.appendChild(playerPanel);

	const playerSelect = document.createElement("select");
	playerSelect.id = "seasonPlayerSelect";
	playerSelect.className = "season-stats-select";
	if (!playerOptions.length) {
		const opt = document.createElement("option");
		opt.value = "";
		opt.textContent = "No players available";
		playerSelect.appendChild(opt);
		playerSelect.disabled = true;
	} else {
		playerOptions.forEach(option => {
			const opt = document.createElement("option");
			opt.value = option.value;
			opt.textContent = option.label;
			playerSelect.appendChild(opt);
		});
	}
	playerPanel.appendChild(playerSelect);

	const playerDetails = document.createElement("div");
	playerDetails.id = "seasonPlayerDetails";
	playerPanel.appendChild(playerDetails);

	const teamPanel = document.createElement("div");
	teamPanel.className = "card season-stats-panel";
	teamPanel.innerHTML = `
		<h3>Team Stats</h3>
		<p class="season-stats-note">Select one team to view its record summary plus full batting and pitching tables.</p>
	`;
	layout.appendChild(teamPanel);

	const teamSelect = document.createElement("select");
	teamSelect.id = "seasonTeamSelect";
	teamSelect.className = "season-stats-select";
	if (!teamsForDisplay.length) {
		const opt = document.createElement("option");
		opt.value = "";
		opt.textContent = "No teams available";
		teamSelect.appendChild(opt);
		teamSelect.disabled = true;
	} else {
		teamsForDisplay.forEach(team => {
			const opt = document.createElement("option");
			opt.value = team.name;
			opt.textContent = team.name;
			teamSelect.appendChild(opt);
		});
	}
	teamPanel.appendChild(teamSelect);

	const teamDetails = document.createElement("div");
	teamDetails.id = "seasonTeamDetails";
	teamPanel.appendChild(teamDetails);

	function renderSelectedPlayer() {
		const selected = playerOptions.find(option => option.value === playerSelect.value) || playerOptions[0] || null;
		playerDetails.innerHTML = "";
		playerDetails.appendChild(createSeasonPlayerDetails(selected));
	}

	function renderSelectedTeam() {
		const selected = teamsForDisplay.find(team => team.name === teamSelect.value) || teamsForDisplay[0] || null;
		teamDetails.innerHTML = "";
		teamDetails.appendChild(createSeasonTeamDetails(selected, teamRankings));
	}

	if (playerOptions.length) {
		playerSelect.value = playerOptions.some(option => option.value === previousPlayerValue)
			? previousPlayerValue
			: playerOptions[0].value;
	}

	if (teamsForDisplay.length) {
		teamSelect.value = teamsForDisplay.some(team => team.name === previousTeamValue)
			? previousTeamValue
			: teamsForDisplay[0].name;
	}

	playerSelect.addEventListener("change", renderSelectedPlayer);
	teamSelect.addEventListener("change", renderSelectedTeam);
	renderSelectedPlayer();
	renderSelectedTeam();

	const subEntries = Object.values(season.subStats || {}).sort((a, b) =>
		String(a.playerName).localeCompare(String(b.playerName))
	);

	if (subEntries.length) {
		const subWrap = document.createElement("details");
		subWrap.className = "season-substats-details";
		subWrap.innerHTML = '<summary>View Sub Stats</summary>';

		const subInner = document.createElement("div");
		subInner.className = "season-stats-stack";

		const subNote = document.createElement("div");
		subNote.className = "card";
		subNote.innerHTML = `<p class="season-stats-note">Season totals earned by substitute players stay separate from regular team rosters.</p>`;
		subInner.appendChild(subNote);

		const battingCard = document.createElement("div");
		battingCard.className = "card";
		battingCard.innerHTML = `<h3>Sub Stats - Batting</h3>`;
		battingCard.appendChild(createSubBattingStatsTable(subEntries));
		subInner.appendChild(battingCard);

		const pitchingCard = document.createElement("div");
		pitchingCard.className = "card";
		pitchingCard.innerHTML = `<h3>Sub Stats - Pitching</h3>`;
		pitchingCard.appendChild(createSubPitchingStatsTable(subEntries));
		subInner.appendChild(pitchingCard);

		subWrap.appendChild(subInner);
		container.appendChild(subWrap);
	}
}

function buildRankingsPlayerEntry(stats, isSub) {
	const playerName = String(stats?.playerName || "").trim();
	if (!playerName) return null;
	return {
		playerName,
		displayName: isSub ? `${playerName} (Sub)` : playerName,
		isSub: !!isSub,
		stats
	};
}

function getRankingsPlayerPool() {
	const players = [];

	Object.values(season.playerStats || {}).forEach(stats => {
		const entry = buildRankingsPlayerEntry(stats, false);
		if (entry) players.push(entry);
	});

	Object.values(season.subStats || {}).forEach(stats => {
		const entry = buildRankingsPlayerEntry(stats, true);
		if (entry) players.push(entry);
	});

	return players;
}

function getRankingsLeaders(players, config) {
	return (players || [])
		.map(player => {
			const value = config.getValue(player.stats);
			return {
				...player,
				value
			};
		})
		.filter(player => {
			if (!Number.isFinite(player.value)) return false;
			return typeof config.isEligible === "function"
				? config.isEligible(player.stats, player.value)
				: true;
		})
		.sort((a, b) => {
			if (a.value !== b.value) {
				return config.lowerIsBetter ? a.value - b.value : b.value - a.value;
			}
			return a.playerName.localeCompare(b.playerName);
		});
}

function createRankingsTable(title, players, config) {
	const card = document.createElement("div");
	card.className = "card rankings-table-card";
	card.innerHTML = `<h4>${title}</h4>`;

	const leaders = getRankingsLeaders(players, config);
	if (!leaders.length) {
		const empty = document.createElement("p");
		empty.className = "rankings-empty";
		empty.textContent = "No eligible players yet.";
		card.appendChild(empty);
		return card;
	}

	const tableWrap = document.createElement("div");
	tableWrap.className = "rankings-table-wrap";

	const table = document.createElement("table");
	table.className = "stats-table rankings-table";

	const colgroup = document.createElement("colgroup");
	colgroup.innerHTML = `
		<col class="rankings-col-rank">
		<col class="rankings-col-name">
		<col class="rankings-col-value">
	`;
	table.appendChild(colgroup);

	const thead = document.createElement("thead");
	thead.innerHTML = `
		<tr>
			<th>Rank</th>
			<th>Player Name</th>
			<th>Stat Value</th>
		</tr>
	`;
	table.appendChild(thead);

	const tbody = document.createElement("tbody");
	leaders.forEach((leader, index) => {
		const tr = document.createElement("tr");

		const rankTd = document.createElement("td");
		rankTd.textContent = String(index + 1);
		rankTd.className = "rankings-rank-cell";
		tr.appendChild(rankTd);

		const nameTd = document.createElement("td");
		nameTd.textContent = leader.displayName;
		nameTd.className = "rankings-name-cell";
		tr.appendChild(nameTd);

		const valueTd = document.createElement("td");
		valueTd.className = "rankings-value rankings-value-cell";
		valueTd.textContent = config.formatValue(leader.value, leader.stats);
		tr.appendChild(valueTd);

		tbody.appendChild(tr);
	});

	table.appendChild(tbody);
	tableWrap.appendChild(table);
	card.appendChild(tableWrap);
	return card;
}

function displayRankings() {
	const container = document.getElementById("rankingsContainer");
	if (!container) return;
	container.innerHTML = "";

	const players = getRankingsPlayerPool();
	if (!players.length) {
		container.innerHTML = "<div class='card'><p>No season rankings published yet.</p></div>";
		return;
	}

	const introCard = document.createElement("div");
	introCard.className = "card";
	introCard.innerHTML = `
		<h3 style="margin-top:0;">Rankings Hub</h3>
	<p class="season-stats-note">
	This page shows the full player leaderboard in each category using the current saved season stats.
	Substitute players are labeled with <strong>(Sub)</strong>.
</p>
	`;
	container.appendChild(introCard);

	const layout = document.createElement("div");
	layout.className = "rankings-layout";
	container.appendChild(layout);

	const battingSection = document.createElement("div");
	battingSection.className = "rankings-section";
	battingSection.innerHTML = `
		<div class="card rankings-section-header">
			<div>
				<h3>Batting Rankings</h3>
				<p class="season-stats-note">
					Highest values rank first for batting average, RBIs, home runs, and total hits.
				</p>
			</div>
		</div>
	`;

	const battingGrid = document.createElement("div");
	battingGrid.className = "rankings-grid";

	battingGrid.appendChild(createRankingsTable("Batting Average", players, {
		getValue: stats => stats.atBats > 0 ? stats.hits / stats.atBats : NaN,
		isEligible: stats => Number(stats.atBats || 0) > 0,
		formatValue: value => value.toFixed(3)
	}));

	battingGrid.appendChild(createRankingsTable("RBIs", players, {
		getValue: stats => Number(stats.rbis || 0),
		formatValue: value => String(value)
	}));

	battingGrid.appendChild(createRankingsTable("Home Runs", players, {
		getValue: stats => Number(stats.homeRuns || 0),
		formatValue: value => String(value)
	}));

	battingGrid.appendChild(createRankingsTable("Total Hits", players, {
		getValue: stats => Number(stats.hits || 0),
		formatValue: value => String(value)
	}));

	battingSection.appendChild(battingGrid);
	layout.appendChild(battingSection);

	const pitchingSection = document.createElement("div");
	pitchingSection.className = "rankings-section";
	pitchingSection.innerHTML = `
		<div class="card rankings-section-header">
			<div>
				<h3>Pitching Rankings</h3>
				<p class="season-stats-note">
					K/3 and innings pitched rank highest first. ERA and errors made rank lowest first.
				</p>
			</div>
		</div>
	`;

	const pitchingGrid = document.createElement("div");
	pitchingGrid.className = "rankings-grid";

	pitchingGrid.appendChild(createRankingsTable("K/3", players, {
		getValue: stats => stats.inningsPitched > 0 ? (stats.pitchStrikeouts / stats.inningsPitched) * 3 : NaN,
		isEligible: stats => Number(stats.inningsPitched || 0) > 0,
		formatValue: value => value.toFixed(2)
	}));

	pitchingGrid.appendChild(createRankingsTable("ERA", players, {
		getValue: stats => stats.inningsPitched > 0 ? (stats.earnedRunsAllowed / stats.inningsPitched) * 3 : NaN,
		isEligible: stats => Number(stats.inningsPitched || 0) > 0,
		lowerIsBetter: true,
		formatValue: value => value.toFixed(2)
	}));

	pitchingGrid.appendChild(createRankingsTable("Errors Made", players, {
		getValue: stats => Number(stats.fieldingErrors || 0),
		isEligible: stats => Number(stats.inningsPitched || 0) > 0 || Number(stats.fieldingErrors || 0) > 0,
		lowerIsBetter: true,
		formatValue: value => String(value)
	}));

	pitchingGrid.appendChild(createRankingsTable("Total Innings Pitched", players, {
		getValue: stats => Number(stats.inningsPitched || 0),
		isEligible: stats => Number(stats.inningsPitched || 0) > 0,
		formatValue: value => value.toFixed(1)
	}));

	pitchingSection.appendChild(pitchingGrid);
	layout.appendChild(pitchingSection);
}


function formatPastGameDate(value) {
	if (!value) return "Unknown date";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "Unknown date";
	return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function formatPastGameTime(value) {
	if (!value) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function getPastGameDayKey(value) {
	const date = new Date(value || 0);
	if (Number.isNaN(date.getTime())) return "unknown";
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildLegacyPastGameEntry(dayObj, seriesEntry, seriesGame, dayIndex, seriesIndex, seriesGameIndex) {
	const result = seriesGame?.result;
	if (!result) return null;

	const team1Name = seriesEntry?.away || result.team1 || result.winner || "Team 1";
	const team2Name = seriesEntry?.home || result.team2 || result.loser || "Team 2";

	let team1Score = 0;
	let team2Score = 0;

	if (result.type === "tie") {
		team1Score = Number(result.score1 || 0);
		team2Score = Number(result.score2 || 0);
	} else {
		team1Score = result.winner === team1Name ? Number(result.winnerScore || 0) : Number(result.loserScore || 0);
		team2Score = result.winner === team2Name ? Number(result.winnerScore || 0) : Number(result.loserScore || 0);
	}

	return {
		id: `scheduled-${dayIndex}-${seriesIndex}-${seriesGameIndex}`,
		playedAt: Number(result.playedAt || 0),
		team1Name,
		team2Name,
		team1Score,
		team2Score,
		hasDetailedStats: false,
		playerStats: [],
		lineups: {},
		scheduleRef: { dayIndex, seriesIndex, seriesGameIndex },
		scheduleLabel: `Game Day ${Number(dayObj?.day || (dayIndex + 1))}`
	};
}

function normalizePastGameEntry(entry) {
	if (!entry) return null;
	return {
		...entry,
		playedAt: Number(entry.playedAt || 0),
		playerStats: Array.isArray(entry.playerStats) ? entry.playerStats.map(stats => ({ ...stats })) : [],
		lineups: entry.lineups && typeof entry.lineups === "object" ? { ...entry.lineups } : {},
		hasDetailedStats: Array.isArray(entry.playerStats) && entry.playerStats.length > 0
	};
}

function getPastGameLogEntries() {
	const entriesById = new Map();

	(season.games || []).forEach(entry => {
		const normalized = normalizePastGameEntry(entry);
		if (normalized?.id) entriesById.set(normalized.id, normalized);
	});

	(schedule?.days || []).forEach((dayObj, dayIndex) => {
		(dayObj.games || []).forEach((seriesEntry, seriesIndex) => {
			(seriesEntry.gamesInSeries || []).forEach((seriesGame, seriesGameIndex) => {
				if (!seriesGame?.result) return;
				const legacyEntry = buildLegacyPastGameEntry(dayObj, seriesEntry, seriesGame, dayIndex, seriesIndex, seriesGameIndex);
				if (!legacyEntry?.id || entriesById.has(legacyEntry.id)) return;
				entriesById.set(legacyEntry.id, legacyEntry);
			});
		});
	});

	return Array.from(entriesById.values()).sort((a, b) => Number(b.playedAt || 0) - Number(a.playedAt || 0));
}

function getPastGameBrowserMeta(entry) {
	const ref = entry?.scheduleRef;
	if (
		ref &&
		Number.isInteger(ref.dayIndex) &&
		Number.isInteger(ref.seriesIndex) &&
		Number.isInteger(ref.seriesGameIndex) &&
		schedule?.days?.[ref.dayIndex]
	) {
		const dayObj = schedule.days[ref.dayIndex];
		const seriesEntry = dayObj?.games?.[ref.seriesIndex] || {};
		const dayNumber = Number(dayObj?.day || (ref.dayIndex + 1));
		const away = seriesEntry?.away || entry.team1Name || "Team 1";
		const home = seriesEntry?.home || entry.team2Name || "Team 2";

		return {
			dayKey: `day-${ref.dayIndex}`,
			dayLabel: `Day ${dayNumber}`,
			seriesKey: `day-${ref.dayIndex}-series-${ref.seriesIndex}`,
			seriesLabel: `${away} vs ${home}`,
			gameKey: entry.id,
			gameLabel: `Game ${Number(ref.seriesGameIndex) + 1}`,
			sortDay: ref.dayIndex,
			sortSeries: ref.seriesIndex,
			sortGame: ref.seriesGameIndex
		};
	}

	return {
		dayKey: "other-games",
		dayLabel: "Other Games",
		seriesKey: `other-series-${entry?.team1Name || "team1"}-${entry?.team2Name || "team2"}`,
		seriesLabel: `${entry?.team1Name || "Team 1"} vs ${entry?.team2Name || "Team 2"}`,
		gameKey: entry?.id || "",
		gameLabel: formatPastGameDate(entry?.playedAt),
		sortDay: 999,
		sortSeries: 999,
		sortGame: Number(entry?.playedAt || 0)
	};
}

function getPastGameDayOptions(games) {
	const map = new Map();

	(games || []).forEach(entry => {
		const meta = getPastGameBrowserMeta(entry);
		if (!map.has(meta.dayKey)) {
			map.set(meta.dayKey, {
				key: meta.dayKey,
				label: meta.dayLabel,
				sortDay: meta.sortDay
			});
		}
	});

	return Array.from(map.values()).sort((a, b) => a.sortDay - b.sortDay);
}

function getPastGameSeriesOptions(games, selectedDayKey) {
	const map = new Map();

	(games || []).forEach(entry => {
		const meta = getPastGameBrowserMeta(entry);
		if (meta.dayKey !== selectedDayKey) return;

		if (!map.has(meta.seriesKey)) {
			map.set(meta.seriesKey, {
				key: meta.seriesKey,
				label: meta.seriesLabel,
				sortDay: meta.sortDay,
				sortSeries: meta.sortSeries
			});
		}
	});

	return Array.from(map.values()).sort((a, b) => {
		if (a.sortDay !== b.sortDay) return a.sortDay - b.sortDay;
		if (a.sortSeries !== b.sortSeries) return a.sortSeries - b.sortSeries;
		return a.label.localeCompare(b.label);
	});
}

function getPastGameOptionsForSeries(games, selectedSeriesKey) {
	return (games || [])
		.map(entry => {
			const meta = getPastGameBrowserMeta(entry);
			return { entry, meta };
		})
		.filter(item => item.meta.seriesKey === selectedSeriesKey)
		.sort((a, b) => {
			if (a.meta.sortGame !== b.meta.sortGame) return a.meta.sortGame - b.meta.sortGame;
			return Number(a.entry.playedAt || 0) - Number(b.entry.playedAt || 0);
		});
}

function getPastGamePlayerDisplayName(stats) {
	const playerName = String(stats?.playerName || "");
	return stats?.isSub ? `${playerName} (Sub)` : playerName;
}

function getPastGameStatsForTeam(entry, teamName) {
	const allStats = (entry?.playerStats || []).filter(stats => stats.teamName === teamName);
	const order = Array.isArray(entry?.lineups?.[teamName]) ? entry.lineups[teamName] : [];

	return allStats.sort((a, b) => {
		const aIndex = order.indexOf(a.playerName);
		const bIndex = order.indexOf(b.playerName);

		if (aIndex !== bIndex) {
			if (aIndex === -1) return 1;
			if (bIndex === -1) return -1;
			return aIndex - bIndex;
		}

		return String(a.playerName || "").localeCompare(String(b.playerName || ""));
	});
}

function createPastGameStatsTable(headers, rows) {
	const table = document.createElement("table");
	table.className = "stats-table responsive";

	const thead = document.createElement("thead");
	const headerRow = document.createElement("tr");
	headers.forEach(header => {
		const th = document.createElement("th");
		th.textContent = header;
		headerRow.appendChild(th);
	});
	thead.appendChild(headerRow);
	table.appendChild(thead);

	const tbody = document.createElement("tbody");
	rows.forEach(values => {
		const tr = document.createElement("tr");
		values.forEach((value, index) => {
			const td = document.createElement("td");
			td.setAttribute("data-label", headers[index]);
			td.textContent = String(value);
			tr.appendChild(td);
		});
		tbody.appendChild(tr);
	});
	table.appendChild(tbody);

	return table;
}

function createPastGameBattingTable(entry, teamName) {
	const teamStats = getPastGameStatsForTeam(entry, teamName);
	const headers = ["Player", "AVG", "AB", "H", "1B", "2B", "3B", "HR", "RBI", "BB", "K"];

	const rows = teamStats.map(stats => {
		const avg = Number(stats.atBats || 0) > 0 ? (Number(stats.hits || 0) / Number(stats.atBats || 0)).toFixed(3) : ".000";
		return [
			getPastGamePlayerDisplayName(stats),
			avg,
			stats.atBats,
			stats.hits,
			stats.singles,
			stats.doubles,
			stats.triples,
			stats.homeRuns,
			stats.rbis,
			stats.walks,
			stats.strikeouts
		];
	});

	return createPastGameStatsTable(headers, rows);
}

function createPastGamePitchingTable(entry, teamName) {
	const teamStats = getPastGameStatsForTeam(entry, teamName);
	const headers = ["Player", "IP", "K's", "K/3", "R", "ER", "ERA", "Errors"];

	const rows = teamStats.map(stats => {
		const innings = Number(stats.inningsPitched || 0);
		const kPer3 = innings > 0 ? ((Number(stats.pitchStrikeouts || 0) / innings) * 3).toFixed(2) : "-";
		const era = innings > 0 ? ((Number(stats.earnedRunsAllowed || 0) / innings) * 3).toFixed(2) : "-";

		return [
			getPastGamePlayerDisplayName(stats),
			innings.toFixed(1),
			stats.pitchStrikeouts,
			kPer3,
			stats.runsAllowed,
			stats.earnedRunsAllowed,
			era,
			stats.fieldingErrors
		];
	});

	return createPastGameStatsTable(headers, rows);
}

function createPastGameTeamCard(entry, teamName, score) {
	const wrap = document.createElement("div");
	wrap.className = "season-stats-stack";

	const header = document.createElement("div");
	header.className = "season-stats-selection-header";
	header.innerHTML = `
		<h4>${teamName}</h4>
		<p>Final Score: ${score}</p>
	`;
	wrap.appendChild(header);

	const battingCard = document.createElement("div");
	battingCard.className = "card";
	battingCard.innerHTML = `<h4>${teamName} Batting</h4>`;
	battingCard.appendChild(createPastGameBattingTable(entry, teamName));
	wrap.appendChild(battingCard);

	const pitchingCard = document.createElement("div");
	pitchingCard.className = "card";
	pitchingCard.innerHTML = `<h4>${teamName} Pitching</h4>`;
	pitchingCard.appendChild(createPastGamePitchingTable(entry, teamName));
	wrap.appendChild(pitchingCard);

	return wrap;
}

function createPastGameDetails(entry) {
	const wrap = document.createElement("div");
	wrap.className = "season-stats-stack";

	if (!entry) {
		wrap.innerHTML = '<div class="card"><p class="season-stats-empty">No past game selected.</p></div>';
		return wrap;
	}

	const summaryCard = document.createElement("div");
	summaryCard.className = "card";
	summaryCard.innerHTML = `
		<h3 style="margin-top:0;">${entry.team1Name} vs ${entry.team2Name}</h3>
		<div class="past-game-scoreboard">
			<div class="past-game-score-team">
				<div class="past-game-score-name">${entry.team1Name}</div>
				<div class="past-game-score-value">${entry.team1Score}</div>
			</div>
			<div class="past-game-score-divider">–</div>
			<div class="past-game-score-team">
				<div class="past-game-score-name">${entry.team2Name}</div>
				<div class="past-game-score-value">${entry.team2Score}</div>
			</div>
		</div>
	`;

	summaryCard.appendChild(buildSeasonStatsMetricGrid([
		{ label: "Date", value: formatPastGameDate(entry.playedAt) },
		{ label: "Time", value: formatPastGameTime(entry.playedAt) || "-" },
		{ label: "Type", value: entry.scheduleRef ? "Scheduled" : "Manual" },
		{ label: "Detail", value: entry.hasDetailedStats ? "Full box score" : "Score only" }
	]));

	if (entry.scheduleLabel) {
		const note = document.createElement("p");
		note.className = "season-stats-note";
		note.textContent = entry.hasDetailedStats
			? `${entry.scheduleLabel}. Batting and pitching lines below come from the saved game log.`
			: `${entry.scheduleLabel}. This older game was found from the saved schedule results, but detailed player lines were not stored yet.`;
		summaryCard.appendChild(note);
	}

	wrap.appendChild(summaryCard);

	if (!entry.hasDetailedStats) {
		const noDetailsCard = document.createElement("div");
		noDetailsCard.className = "card";
		noDetailsCard.innerHTML = `
			<h4>Player Performances</h4>
			<p class="season-stats-note">Detailed player game stats will appear here for games saved after this Past Game Log feature was added.</p>
		`;
		wrap.appendChild(noDetailsCard);
		return wrap;
	}

	const teamsGrid = document.createElement("div");
	teamsGrid.className = "past-game-team-grid";
	teamsGrid.appendChild(createPastGameTeamCard(entry, entry.team1Name, entry.team1Score));
	teamsGrid.appendChild(createPastGameTeamCard(entry, entry.team2Name, entry.team2Score));
	wrap.appendChild(teamsGrid);

	return wrap;
}

function displayPastGameLog() {
	const container = document.getElementById("pastGameLogContainer");
	if (!container) return;

	const previousDayValue = document.getElementById("pastGameDaySelect")?.value || "";
	const previousSeriesValue = document.getElementById("pastGameSeriesSelect")?.value || "";
	const previousGameValue = document.getElementById("pastGameSelect")?.value || "";
	container.innerHTML = "";

	const games = getPastGameLogEntries();
	if (!games.length) {
		container.innerHTML = "<div class='card'><p>No completed games have been logged yet.</p></div>";
		return;
	}

	const introCard = document.createElement("div");
	introCard.className = "card";
	introCard.innerHTML = `
		<h3 style="margin-top:0;">Past Game Log</h3>
		<p class="season-stats-note">Browse completed games by season day, then choose the series and game number to review the final score and saved player performances.</p>
	`;
	container.appendChild(introCard);

	const browserCard = document.createElement("div");
	browserCard.className = "card";
	browserCard.innerHTML = `<h3 style="margin-top:0;">Find a Game</h3>`;
	container.appendChild(browserCard);

	const browserGrid = document.createElement("div");
	browserGrid.className = "past-game-browser-grid";
	browserCard.appendChild(browserGrid);

	const dayGroup = document.createElement("div");
	dayGroup.className = "past-game-select-group";
	dayGroup.innerHTML = `<label for="pastGameDaySelect">Season Day</label>`;
	browserGrid.appendChild(dayGroup);

	const daySelect = document.createElement("select");
	daySelect.id = "pastGameDaySelect";
	daySelect.className = "season-stats-select";
	dayGroup.appendChild(daySelect);

	const seriesGroup = document.createElement("div");
	seriesGroup.className = "past-game-select-group";
	seriesGroup.innerHTML = `<label for="pastGameSeriesSelect">Series</label>`;
	browserGrid.appendChild(seriesGroup);

	const seriesSelect = document.createElement("select");
	seriesSelect.id = "pastGameSeriesSelect";
	seriesSelect.className = "season-stats-select";
	seriesGroup.appendChild(seriesSelect);

	const gameGroup = document.createElement("div");
	gameGroup.className = "past-game-select-group";
	gameGroup.innerHTML = `<label for="pastGameSelect">Game</label>`;
	browserGrid.appendChild(gameGroup);

	const gameSelect = document.createElement("select");
	gameSelect.id = "pastGameSelect";
	gameSelect.className = "season-stats-select";
	gameGroup.appendChild(gameSelect);

	const details = document.createElement("div");
	details.id = "pastGameDetails";
	container.appendChild(details);

	const dayOptions = getPastGameDayOptions(games);
	dayOptions.forEach(option => {
		const el = document.createElement("option");
		el.value = option.key;
		el.textContent = option.label;
		daySelect.appendChild(el);
	});

	function populateSeriesSelect() {
		const selectedDayKey = daySelect.value;
		const seriesOptions = getPastGameSeriesOptions(games, selectedDayKey);

		seriesSelect.innerHTML = "";
		seriesOptions.forEach(option => {
			const el = document.createElement("option");
			el.value = option.key;
			el.textContent = option.label;
			seriesSelect.appendChild(el);
		});

		if (seriesOptions.some(option => option.key === previousSeriesValue)) {
			seriesSelect.value = previousSeriesValue;
		} else if (seriesOptions[0]) {
			seriesSelect.value = seriesOptions[0].key;
		}
	}

	function populateGameSelect() {
		const selectedSeriesKey = seriesSelect.value;
		const gameOptions = getPastGameOptionsForSeries(games, selectedSeriesKey);

		gameSelect.innerHTML = "";
		gameOptions.forEach(item => {
			const option = document.createElement("option");
			option.value = item.entry.id;
			option.textContent = item.meta.gameLabel;
			gameSelect.appendChild(option);
		});

		if (gameOptions.some(item => item.entry.id === previousGameValue)) {
			gameSelect.value = previousGameValue;
		} else if (gameOptions[0]) {
			gameSelect.value = gameOptions[0].entry.id;
		}
	}

	function renderSelectedGame() {
		const selected = games.find(entry => entry.id === gameSelect.value) || null;
		details.innerHTML = "";
		details.appendChild(createPastGameDetails(selected));
	}

	daySelect.value = dayOptions.some(option => option.key === previousDayValue)
		? previousDayValue
		: (dayOptions[0]?.key || "");

	populateSeriesSelect();
	populateGameSelect();

	daySelect.addEventListener("change", () => {
		populateSeriesSelect();
		populateGameSelect();
		renderSelectedGame();
	});

	seriesSelect.addEventListener("change", () => {
		populateGameSelect();
		renderSelectedGame();
	});

	gameSelect.addEventListener("change", renderSelectedGame);
	renderSelectedGame();
}
