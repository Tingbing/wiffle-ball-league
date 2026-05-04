// Wiffle Ball League - app.game.state.js
// Split from the source-of-truth app.game.js. Load after app.core.js in the required order.
// Purpose: Shared live-game state helpers, completed-game IDs, undo snapshots, and batter indexes.

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
		lineScore: JSON.parse(JSON.stringify(game.lineScore || {})),
pitcherDecisions: JSON.parse(JSON.stringify(game.pitcherDecisions || {})),
overtime: JSON.parse(JSON.stringify(game.overtime || null)),
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
	game.lineScore = state.lineScore || { [game.team1.name]: [], [game.team2.name]: [] };
	game.pitcherDecisions = state.pitcherDecisions || {
	winningPitcher: null,
	losingPitcher: null,
	pendingWinningPitcherTeamName: null,
	pitcherOfRecordByTeam: {}
};
game.overtime = normalizeOvertimeState(state.overtime || game.overtime);
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
