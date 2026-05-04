// Wiffle Ball League - app.game.runners.js
// Split from the source-of-truth app.game.js. Load after app.core.js in the required order.
// Purpose: Runner/base normalization, scoring responsibility, pitcher charging, and runner advancement helpers.

function countBaseRunners() {
  if (!game || !game.bases) return 0;
  return ['first','second','third'].reduce((n,b)=> n + (game.bases[b] ? 1 : 0), 0);
}

function getCurrentPitcherKey() {
	// pitcher is always from the fielding team
	let pitcherIndex = parseInt(document.getElementById("pitcherSelect").value);
	let pitcher = game.fielding.players[pitcherIndex];
	return getGameStatsKey(game.fielding, pitcher);
}

function ensureExtendedStatFields(stats) {
	if (!stats) return null;
	if (!Number.isFinite(Number(stats.runsScored))) stats.runsScored = 0;
	if (!Number.isFinite(Number(stats.hitByPitch))) stats.hitByPitch = 0;
	if (!Number.isFinite(Number(stats.pitchOuts))) stats.pitchOuts = 0;
	if (!Number.isFinite(Number(stats.pitchStrikeouts))) stats.pitchStrikeouts = 0;
	if (!Number.isFinite(Number(stats.runsAllowed))) stats.runsAllowed = 0;
	if (!Number.isFinite(Number(stats.earnedRunsAllowed))) stats.earnedRunsAllowed = 0;
	syncPitchingInnings(stats);
	return stats;
}

function getPitchingInningsValue(stats) {
	const outs = Number(stats?.pitchOuts || 0);
	return outs / 2;
}

function syncPitchingInnings(stats) {
	if (!stats) return 0;
	stats.inningsPitched = getPitchingInningsValue(stats);
	return stats.inningsPitched;
}

function getCurrentPitcherResponsibility() {
	if (!game?.fielding?.players?.length) {
		return { pitcherKey: null, pitcherName: null, teamName: game?.fielding?.name || "" };
	}

	let pitcherIndex = parseInt(document.getElementById("pitcherSelect")?.value, 10);
	if (!Number.isInteger(pitcherIndex) || pitcherIndex < 0) pitcherIndex = 0;

	const pitcherName = game.fielding.players[pitcherIndex] || null;

	return {
		pitcherKey: pitcherName ? getGameStatsKey(game.fielding, pitcherName) : null,
		pitcherName,
		teamName: game.fielding?.name || ""
	};
}

function chargeRunToResponsiblePitcher(runner, chargeLog = null) {
	const normalized = normalizeBaseRunner(runner, game?.batting);
	if (!normalized) return;

	const pitcherKey = normalized.responsiblePitcherKey || null;
	if (!pitcherKey || !game?.gameStats?.[pitcherKey]) return;

	const pitcherStats = ensureExtendedStatFields(game.gameStats[pitcherKey]);
	pitcherStats.runsAllowed += 1;

	if (chargeLog) {
		chargeLog[pitcherKey] = chargeLog[pitcherKey] || { runs: 0, earnedRuns: 0 };
		chargeLog[pitcherKey].runs += 1;
	}

	const isEarnedRun = !normalized.reachedOnError && normalized.isAutomaticOvertimeRunner !== true;

if (isEarnedRun) {
	pitcherStats.earnedRunsAllowed += 1;
	if (chargeLog) chargeLog[pitcherKey].earnedRuns += 1;
}
}

function normalizeBaseRunner(runner, fallbackTeam = game?.batting) {
	if (!runner) return null;
	if (!runner.teamName) runner.teamName = fallbackTeam?.name || "";
	if (!runner.statsKey && runner.player) {
		runner.statsKey = getGameStatsKey(runner.teamName || fallbackTeam, runner.player);
	}
	if (runner.reachedOnError !== true) runner.reachedOnError = false;

	if (!runner.responsiblePitcherKey && runner.player) {
	const responsibility = getCurrentPitcherResponsibility();
	runner.responsiblePitcherKey = responsibility.pitcherKey || null;
	runner.responsiblePitcherName = responsibility.pitcherName || null;
}

if (runner.awaitingOvertimePitcherResponsibility && runner.responsiblePitcherKey) {
	runner.awaitingOvertimePitcherResponsibility = false;
}

	return runner;
}

function createBaseRunner(playerName, reachedOnError = false, teamObj = game?.batting, pitcherResponsibility = null) {
	const responsibility = pitcherResponsibility || getCurrentPitcherResponsibility();

	const runner = {
		player: playerName,
		teamName: teamObj?.name || "",
		statsKey: getGameStatsKey(teamObj, playerName),
		reachedOnError: !!reachedOnError,
		responsiblePitcherKey: responsibility.pitcherKey || null,
		responsiblePitcherName: responsibility.pitcherName || null
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

const isEarnedRun = !normalized.reachedOnError && normalized.isAutomaticOvertimeRunner !== true;

totals.runs += 1;
if (isEarnedRun) totals.earnedRuns += 1;
if (options.creditRbi !== false) totals.rbis += 1;

	totals.pitcherCharges = totals.pitcherCharges || {};
	chargeRunToResponsiblePitcher(normalized, totals.pitcherCharges);
	totals.scoringEvents = Array.isArray(totals.scoringEvents) ? totals.scoringEvents : [];
totals.scoringEvents.push({
	runnerName: normalized.player || "",
	responsiblePitcherKey: normalized.responsiblePitcherKey || null,
	responsiblePitcherName: normalized.responsiblePitcherName || null,
	wasEarnedRun: isEarnedRun,
	isAutomaticOvertimeRunner: normalized.isAutomaticOvertimeRunner === true
});
}

function getCurrentScoreForTeam(teamName) {
	if (!game) return 0;
	if (teamName === game.team1?.name) return Number(game.team1Score || 0);
	if (teamName === game.team2?.name) return Number(game.team2Score || 0);
	return 0;
}

function rememberPitcherOfRecordForFieldingTeam() {
	if (!game?.fielding?.name) return;
	const pitcherKey = getCurrentPitcherKey();
	const rawIndex = parseInt(document.getElementById("pitcherSelect")?.value, 10);
	const pitcherIndex = Number.isInteger(rawIndex) && rawIndex >= 0 ? rawIndex : 0;
	const pitcherName = String(game.fielding.players?.[pitcherIndex] || "").trim();
	if (!pitcherKey || !pitcherName) return;

	game.pitcherDecisions = game.pitcherDecisions || {
		winningPitcher: null,
		losingPitcher: null,
		pendingWinningPitcherTeamName: null,
		pitcherOfRecordByTeam: {}
	};
	game.pitcherDecisions.pitcherOfRecordByTeam = game.pitcherDecisions.pitcherOfRecordByTeam || {};
	game.pitcherDecisions.pitcherOfRecordByTeam[game.fielding.name] = { pitcherKey, pitcherName, teamName: game.fielding.name };

	if (game.pitcherDecisions.pendingWinningPitcherTeamName === game.fielding.name) {
		game.pitcherDecisions.winningPitcher = { pitcherKey, pitcherName, teamName: game.fielding.name };
		game.pitcherDecisions.pendingWinningPitcherTeamName = null;
	}
}

function updatePitcherDecisionsFromScoringEvents(scoringEvents = []) {
	if (!game || !Array.isArray(scoringEvents) || !scoringEvents.length) return;

	game.pitcherDecisions = game.pitcherDecisions || {
		winningPitcher: null,
		losingPitcher: null,
		pendingWinningPitcherTeamName: null,
		pitcherOfRecordByTeam: {}
	};
	game.pitcherDecisions.pitcherOfRecordByTeam = game.pitcherDecisions.pitcherOfRecordByTeam || {};

	scoringEvents.forEach(event => {
		const battingTeamName = String(event?.battingTeamName || game.batting?.name || "").trim();
		if (!battingTeamName) return;

		const otherTeamName = battingTeamName === game.team1?.name ? game.team2?.name : game.team1?.name;
		const beforeBatting = Number(event?.beforeBattingScore ?? getCurrentScoreForTeam(battingTeamName));
		const beforeOther = Number(event?.beforeOtherScore ?? getCurrentScoreForTeam(otherTeamName));
		const afterBatting = beforeBatting + 1;
		const tookLead = afterBatting > beforeOther && beforeBatting <= beforeOther;

		if (!tookLead) return;

		const pitcherOfRecord = game.pitcherDecisions.pitcherOfRecordByTeam[battingTeamName] || null;
		if (pitcherOfRecord?.pitcherKey && pitcherOfRecord?.pitcherName) {
			game.pitcherDecisions.winningPitcher = { ...pitcherOfRecord };
			game.pitcherDecisions.pendingWinningPitcherTeamName = null;
		} else {
			game.pitcherDecisions.winningPitcher = null;
			game.pitcherDecisions.pendingWinningPitcherTeamName = battingTeamName;
		}

		if (event?.responsiblePitcherKey || event?.responsiblePitcherName) {
			game.pitcherDecisions.losingPitcher = {
				pitcherKey: event.responsiblePitcherKey || null,
				pitcherName: event.responsiblePitcherName || "-",
				teamName: otherTeamName || ""
			};
		}
	});
}

function applyHalfInningRuns(runs, scoringEvents = []) {
	const runCount = Number(runs || 0);
	if (runCount <= 0 || !game) return;

	const battingTeamName = game.batting?.name || "";
	const inningIndex = Math.max(0, Number(game.inning || 1) - 1);
	game.lineScore = game.lineScore || { [game.team1?.name || "Team 1"]: [], [game.team2?.name || "Team 2"]: [] };
	game.lineScore[battingTeamName] = Array.isArray(game.lineScore[battingTeamName]) ? game.lineScore[battingTeamName] : [];
	game.lineScore[battingTeamName][inningIndex] = Number(game.lineScore[battingTeamName][inningIndex] || 0) + runCount;

	const otherTeamName = battingTeamName === game.team1?.name ? game.team2?.name : game.team1?.name;
	const runningBattingScore = getCurrentScoreForTeam(battingTeamName);
	const runningOtherScore = getCurrentScoreForTeam(otherTeamName);
	const normalizedEvents = Array.isArray(scoringEvents)
		? scoringEvents.map((event, index) => ({
			...event,
			battingTeamName,
			beforeBattingScore: runningBattingScore + index,
			beforeOtherScore: runningOtherScore
		}))
		: [];

	if (battingTeamName === game.team1?.name) {
	game.team1Score += runCount;
} else if (battingTeamName === game.team2?.name) {
	game.team2Score += runCount;
} else {
	console.warn("Could not match batting team to score bucket:", battingTeamName);
}

	game.halfInningRuns += runCount;
	updatePitcherDecisionsFromScoringEvents(normalizedEvents);
}

function advanceRunnersOnContact(bases, currentBatter, reachedOnError = false, pitcherResponsibility = null) {
	const totals = { runs: 0, earnedRuns: 0, rbis: 0, pitcherCharges: {}, scoringEvents: [] };

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
		scoreExistingRunner(
			createBaseRunner(currentBatter, reachedOnError, game.batting, pitcherResponsibility),
			totals,
			{ creditRbi: true }
		);
	} else {
		place(bases, createBaseRunner(currentBatter, reachedOnError, game.batting, pitcherResponsibility));
	}

	return totals;
}

function advanceRunnersOnAwardedFirst(currentBatter, pitcherResponsibility = null) {
	const totals = { runs: 0, earnedRuns: 0, rbis: 0, pitcherCharges: {}, scoringEvents: [] };

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

	game.bases.first = createBaseRunner(currentBatter, false, game.batting, pitcherResponsibility);
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
