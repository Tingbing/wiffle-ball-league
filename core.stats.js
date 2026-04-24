// Wiffle Ball League - Season/schedule persistence, stats math, and backup/restore
// Split from app.core.js. Load this AFTER core.schedule.js and BEFORE core.ui.js, app.game.js, and app.auth.js.

/* ================================
   PERSISTED SEASON / SCHEDULE SNAPSHOTS
================================== */
function saveSchedule({ skipServerSync = false, touchMeta = true, bumpRevision = touchMeta, allowConflictBypass = false } = {}) {
	try {
		if (!schedule || typeof schedule !== "object") schedule = { days: [], teamNames: [] };
		schedule = ensureScheduleShape(schedule);
		normalizeSnapshotMeta(schedule, "schedule");

		if (!allowConflictBypass && !assertCanWriteLocalSnapshot("schedule")) return false;

		if (bumpRevision) {
			const head = readLocalSyncHead();
			schedule._meta.revision = Math.max(getScheduleRevisionFrom(schedule), Number(head?.scheduleRevision || 0) || 0) + 1;
		} else {
			schedule._meta.revision = getScheduleRevisionFrom(schedule);
		}

		if (touchMeta) schedule._meta.updated_at = new Date().toISOString();
	} catch (e) {}

	try { localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(schedule)); } catch (e) {}

	writeLocalSyncHead({
		seasonRevision: getSeasonRevisionFrom(season),
		scheduleRevision: getScheduleRevisionFrom(schedule)
	});

	if (!skipServerSync) queueServerSync("schedule");
	return true;
}

function loadSchedule() {
	const data = readJsonStorage(SCHEDULE_STORAGE_KEY, null);
	if (data) schedule = data;
	schedule = ensureScheduleShape(schedule);
	normalizeSnapshotMeta(schedule, "schedule");
	syncStateFromHead();
}

	/* ==========================================
	✅ TEAM SOURCE: pulls from Configure Teams
	- uses only teams that have players
	==========================================*/


function saveSeason({ skipServerSync = false, touchMeta = true, bumpRevision = touchMeta, allowConflictBypass = false } = {}) {
	try {
		if (!season || typeof season !== "object") {
			season = { playerStats: {}, teamRecords: {}, seasonSubs: [], subStats: {}, games: [] };
		}
		season = ensureSeasonShape(season);
		normalizeSnapshotMeta(season, "season");

		if (!allowConflictBypass && !assertCanWriteLocalSnapshot("season")) return false;

		if (bumpRevision) {
			const head = readLocalSyncHead();
			season._meta.revision = Math.max(getSeasonRevisionFrom(season), Number(head?.seasonRevision || 0) || 0) + 1;
		} else {
			season._meta.revision = getSeasonRevisionFrom(season);
		}

		if (touchMeta) season._meta.updated_at = new Date().toISOString();
	} catch (e) {}

	try { localStorage.setItem(SEASON_STORAGE_KEY, JSON.stringify(season)); } catch (e) {}

	writeLocalSyncHead({
		seasonRevision: getSeasonRevisionFrom(season),
		scheduleRevision: getScheduleRevisionFrom(schedule)
	});

	if (!skipServerSync) queueServerSync("season");
	return true;
}

function loadSeason() {
	let data = readJsonStorage(SEASON_STORAGE_KEY, null);
	if (data) season = data;
	season = ensureSeasonShape(season);
	normalizeSnapshotMeta(season, "season");
	syncStateFromHead();
}

	/* ================================
	✅ SYNC + REALTIME (teams + season data)
	- Auto-sync season/schedule to Supabase (if season_data table exists)
	- Realtime subscribe so all devices see updates quickly
	==================================*/

/* ================================
   TEAM RECORD HELPERS
================================== */
	function getTeamRecord(teamName) {
		if (!season.teamRecords) season.teamRecords = {};
		if (!season.teamRecords[teamName]) {
			season.teamRecords[teamName] = { wins: 0, losses: 0 };
		}
		return season.teamRecords[teamName];
	}

	function formatTeamRecord(teamName) {
		const r = getTeamRecord(teamName);
		return `${r.wins}-${r.losses}`;
	}

	function syncTeamRecordsWithLeague() {
		// Make sure every current team has a record row
		(league.teams || []).forEach(t => getTeamRecord(t.name));
		try { saveSeason({ skipServerSync: true, touchMeta: false }); } catch (e) {}

	}

function updateScheduleForCompletedGame(teamA, teamB, resultObj) {
	if (!schedule?.days?.length) return false;

	const applySeriesWinLoss = (seriesEntry) => {
		if (!seriesEntry || seriesEntry._seriesStandingsApplied || !seriesEntry.result) return;

		if (seriesEntry.result.type === "win") {
			getTeamRecord(seriesEntry.result.winner).wins += 1;
			getTeamRecord(seriesEntry.result.loser).losses += 1;
		}

		seriesEntry._seriesStandingsApplied = true;
	};

	const ref = game?._scheduleRef;
	const hasExactRef =
		ref &&
		Number.isInteger(ref.dayIndex) &&
		Number.isInteger(ref.seriesIndex) &&
		Number.isInteger(ref.seriesGameIndex);

	if (!hasExactRef) return false;

	const day = schedule.days[ref.dayIndex];
	const seriesEntry = day?.games?.[ref.seriesIndex];
	const seriesGame = seriesEntry?.gamesInSeries?.[ref.seriesGameIndex];

	if (!seriesEntry || !seriesGame) return false;

	const teamsMatch =
		(seriesEntry.away === teamA && seriesEntry.home === teamB) ||
		(seriesEntry.away === teamB && seriesEntry.home === teamA);

	if (!teamsMatch) return false;
	if (seriesGame.result) return true; // idempotent retry; do not double-apply

	seriesGame.result = resultObj;
	seriesEntry.result = computeSeriesResult(seriesEntry);
	applySeriesWinLoss(seriesEntry);
	saveSchedule();
	return true;
}

function applyGameOutcomeOnce() {
	if (!game) return false;
	if (game._resultSaved) return true;

	const t1 = game.team1?.name;
	const t2 = game.team2?.name;
	if (!t1 || !t2) return false;

	const s1 = Number(game.team1Score || 0);
	const s2 = Number(game.team2Score || 0);

	// make sure record objects exist
	getTeamRecord(t1);
	getTeamRecord(t2);

	let resultObj;

	if (s1 === s2) {
		resultObj = {
			type: "tie",
			team1: t1,
			team2: t2,
			score1: s1,
			score2: s2,
			playedAt: Date.now()
		};
	} else {
		const winner = s1 > s2 ? t1 : t2;
		const loser = s1 > s2 ? t2 : t1;

		resultObj = {
			type: "win",
			winner,
			loser,
			winnerScore: Math.max(s1, s2),
			loserScore: Math.min(s1, s2),
			playedAt: Date.now()
		};
	}

	let outcomeApplied = true;

	// scheduled series game -> store exact game result, then series result after all 3
	if (
		game?._scheduleRef &&
		Number.isInteger(game._scheduleRef.dayIndex) &&
		Number.isInteger(game._scheduleRef.seriesIndex) &&
		Number.isInteger(game._scheduleRef.seriesGameIndex)
	) {
		outcomeApplied = updateScheduleForCompletedGame(t1, t2, resultObj);
	}
	// manual game -> old single-game win/loss behavior
	else if (s1 !== s2) {
		const winner = s1 > s2 ? t1 : t2;
		const loser = s1 > s2 ? t2 : t1;
		getTeamRecord(winner).wins += 1;
		getTeamRecord(loser).losses += 1;
	}

	if (!outcomeApplied) return false;

	game._resultSaved = true;
	saveSeason();
	return true;
}

const STATS_BACKUP_KIND = "wbl_stats_backup";
const STATS_BACKUP_VERSION = 2;
const STATS_BACKUP_ACCEPTED_VERSIONS = new Set([1, 2]);
const STATS_BACKUP_NUMERIC_FIELDS = [
	"atBats",
	"hits",
	"singles",
	"doubles",
	"triples",
	"homeRuns",
	"walks",
	"hitByPitch",
	"strikeouts",
	"outs",
	"rbis",
	"runsScored",
	"pitchOuts",
	"pitchStrikeouts",
	"fieldingErrors",
	"runsAllowed",
	"earnedRunsAllowed"
];

/* ================================
   BACKUP / RESTORE / RESET
================================== */
function stripScheduleResultsForStatsClear(scheduleObj) {
	const base = ensureScheduleShape(deepCloneJson(scheduleObj) || { days: [], teamNames: [] });
	const teamNames = Array.isArray(base.teamNames) ? base.teamNames.slice() : [];

	return ensureScheduleShape({
		...base,
		teamNames,
		days: (base.days || []).map((dayObj, dayIndex) => ({
			day: Number(dayObj?.day || (dayIndex + 1)),
			byeTeam: getByeTeamForDay(dayObj, teamNames),
			games: (dayObj?.games || []).map((seriesEntry, seriesIndex) => ({
				...createSeriesEntry(seriesEntry?.away || "", seriesEntry?.home || "", Number(seriesEntry?.gameNumber || (seriesIndex + 1))),
				result: null,
				subAssignments: [],
				gamesInSeries: [1, 2, 3].map(gameNumber => createSeriesGameSlot(gameNumber, null))
			}))
		}))
	});
}

function buildStatsBackupFilename(backup) {
	const rawLeagueCode = String(backup?.leagueCode || "league").trim() || "league";
	const safeLeagueCode = rawLeagueCode.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "league";
	const datePart = new Date().toISOString().slice(0, 10);
	return `wbl-stats-backup-${safeLeagueCode}-${datePart}.json`;
}

function isPlainObject(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function uniqueTrimmedStrings(values) {
	const seen = new Set();
	const out = [];

	(values || []).forEach(value => {
		const next = String(value || "").trim();
		if (!next || seen.has(next)) return;
		seen.add(next);
		out.push(next);
	});

	return out;
}

function normalizeBackupTeamSnapshotTeams(teams) {
	return (Array.isArray(teams) ? teams : [])
		.map(team => ({
			name: String(team?.name || "").trim(),
			players: uniqueTrimmedStrings(Array.isArray(team?.players) ? team.players : [])
		}))
		.filter(team => team.name);
}

function buildNormalizedLeagueSnapshot() {
	return {
		teams: normalizeBackupTeamSnapshotTeams(league?.teams)
	};
}

function buildRosterSignatureFromTeams(teams) {
	return normalizeBackupTeamSnapshotTeams(teams)
		.map(team => ({
			name: team.name,
			players: team.players.slice().sort((a, b) => a.localeCompare(b))
		}))
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(team => `${team.name}::${team.players.join("|")}`)
		.join("||");
}

function buildRecordedScheduleGameIds(scheduleObj) {
	const ids = [];
	(ensureScheduleShape(deepCloneJson(scheduleObj) || { days: [], teamNames: [] }).days || []).forEach((dayObj, dayIndex) => {
		(dayObj.games || []).forEach((seriesEntry, seriesIndex) => {
			(seriesEntry.gamesInSeries || []).forEach((seriesGame, seriesGameIndex) => {
				if (!seriesGame?.result) return;
				ids.push(`scheduled-${dayIndex}-${seriesIndex}-${seriesGameIndex}`);
			});
		});
	});
	return ids;
}

function getDetailedSeasonGameLogEntries(seasonObj) {
	return (ensureSeasonShape(deepCloneJson(seasonObj) || createEmptySeasonState()).games || []).filter(entry =>
		Array.isArray(entry?.playerStats) && entry.playerStats.length > 0
	);
}

function countDetailedScheduledGameLogs(seasonObj) {
	return getDetailedSeasonGameLogEntries(seasonObj).filter(entry =>
		entry?.scheduleRef &&
		Number.isInteger(entry.scheduleRef.dayIndex) &&
		Number.isInteger(entry.scheduleRef.seriesIndex) &&
		Number.isInteger(entry.scheduleRef.seriesGameIndex)
	).length;
}

function canSeasonGameLogsFullyCoverRecordedSchedule(seasonObj, scheduleObj) {
	const recordedIds = new Set(buildRecordedScheduleGameIds(scheduleObj));
	if (!recordedIds.size) return false;

	const detailedIds = new Set(
		getDetailedSeasonGameLogEntries(seasonObj)
			.map(entry => String(entry?.id || "").trim())
			.filter(Boolean)
	);

	for (const id of recordedIds) {
		if (!detailedIds.has(id)) return false;
	}

	return true;
}

function buildStatsBackupSummary(seasonObj, scheduleObj, leagueSnapshot) {
	const safeSeason = ensureSeasonShape(deepCloneJson(seasonObj) || createEmptySeasonState());
	const safeSchedule = ensureScheduleShape(deepCloneJson(scheduleObj) || { days: [], teamNames: [] });
	const safeSnapshot = {
		teams: normalizeBackupTeamSnapshotTeams(leagueSnapshot?.teams)
	};
	const detailedLogs = getDetailedSeasonGameLogEntries(safeSeason);

	return {
		teamCount: safeSnapshot.teams.length,
		rosterPlayerCount: safeSnapshot.teams.reduce((sum, team) => sum + team.players.length, 0),
		scheduleDayCount: Array.isArray(safeSchedule.days) ? safeSchedule.days.length : 0,
		scheduledSeriesCount: (safeSchedule.days || []).reduce((sum, dayObj) => sum + ((dayObj?.games || []).length), 0),
		recordedScheduleGameCount: buildRecordedScheduleGameIds(safeSchedule).length,
		detailedGameLogCount: detailedLogs.length,
		detailedScheduledGameCount: countDetailedScheduledGameLogs(safeSeason),
		playerStatCount: Object.keys(safeSeason.playerStats || {}).length,
		subStatCount: Object.keys(safeSeason.subStats || {}).length,
		canRebuildPlayerTotals: canSeasonGameLogsFullyCoverRecordedSchedule(safeSeason, safeSchedule),
		rosterSignature: buildRosterSignatureFromTeams(safeSnapshot.teams)
	};
}

function createStatsBackupPayload() {
	const safeSeason = ensureSeasonShape(deepCloneJson(season));
	const safeSchedule = ensureScheduleShape(deepCloneJson(schedule));
	const leagueSnapshot = buildNormalizedLeagueSnapshot();

	return {
		kind: STATS_BACKUP_KIND,
		version: STATS_BACKUP_VERSION,
		exportedAt: new Date().toISOString(),
		leagueCode: String(typeof LEAGUE_CODE !== "undefined" ? LEAGUE_CODE : "").trim(),
		appBuild: String(typeof APP_BUILD !== "undefined" ? APP_BUILD : ""),
		leagueSnapshot,
		backupStats: buildStatsBackupSummary(safeSeason, safeSchedule, leagueSnapshot),
		season: safeSeason,
		schedule: safeSchedule
	};
}

function refreshStatsBackupViews() {
	try { syncTeamRecordsWithLeague(); } catch (e) {}
	try { update(); } catch (e) {}
	try { updatePublicAccessUI(); } catch (e) {}

	try {
		const statsScreen = document.getElementById("seasonStatsScreen");
		if (statsScreen && !statsScreen.classList.contains("hidden") && typeof displaySeasonStats === "function") {
			displaySeasonStats();
		}
	} catch (e) {}

	try {
		const rankingsScreen = document.getElementById("rankingsScreen");
		if (rankingsScreen && !rankingsScreen.classList.contains("hidden") && typeof displayRankings === "function") {
			displayRankings();
		}
	} catch (e) {}

	try {
		const pastGameLogScreen = document.getElementById("pastGameLogScreen");
		if (pastGameLogScreen && !pastGameLogScreen.classList.contains("hidden") && typeof displayPastGameLog === "function") {
			displayPastGameLog();
		}
	} catch (e) {}

	try {
		const scheduleScreen = document.getElementById("scheduleScreen");
		if (scheduleScreen && !scheduleScreen.classList.contains("hidden")) {
			renderScheduleUI();
		}
	} catch (e) {}

	try {
		const gameSetupScreen = document.getElementById("gameSetupScreen");
		const schedCard = document.getElementById("scheduledGameCard");
		const manualCard = document.getElementById("manualTeamCard");

		if (gameSetupScreen && !gameSetupScreen.classList.contains("hidden") && schedCard && manualCard) {
			refreshGameSetupScheduleCards();
		}
	} catch (e) {}

		try {
		const postseasonScreen = document.getElementById("postseasonScreen");
		if (postseasonScreen && !postseasonScreen.classList.contains("hidden") && typeof displayPostseason === "function") {
			displayPostseason();
		}
	} catch (e) {}
}

function createBackupRosterLookup(backup) {
	const snapshotTeams = normalizeBackupTeamSnapshotTeams(backup?.leagueSnapshot?.teams);
	const teamNames = uniqueTrimmedStrings(snapshotTeams.length
		? snapshotTeams.map(team => team.name)
		: (backup?.schedule?.teamNames || [])
	);

	return {
		teams: snapshotTeams,
		teamNames,
		teamSet: new Set(teamNames),
		playerMap: new Map(snapshotTeams.map(team => [team.name, new Set(team.players)])),
		hasSnapshotPlayers: snapshotTeams.some(team => team.players.length > 0)
	};
}

function isFiniteNonNegativeNumber(value) {
	const num = Number(value);
	return Number.isFinite(num) && num >= 0;
}

function normalizeNumericStatValue(value) {
	const num = Number(value || 0);
	return Number.isFinite(num) && num >= 0 ? num : 0;
}

function createComparableStatsLine(rawStats, fallback = {}) {
	const isSub = !!rawStats?.isSub || String(rawStats?.teamName || fallback.teamName || "").trim() === "SUB";
	const teamName = isSub ? "SUB" : String(rawStats?.teamName || fallback.teamName || "").trim();
	const playerName = String(rawStats?.playerName || fallback.playerName || "").trim();
	const normalized = {
		teamName,
		playerName,
		isSub
	};

	STATS_BACKUP_NUMERIC_FIELDS.forEach(field => {
		normalized[field] = normalizeNumericStatValue(rawStats?.[field]);
	});

	normalized.inningsPitched = normalized.pitchOuts / 2;
	return normalized;
}

function createComparableStatsBucketSignature(bucket) {
	const entries = Object.keys(bucket || {})
		.sort((a, b) => a.localeCompare(b))
		.map(key => [key, createComparableStatsLine(bucket[key])]);
	return JSON.stringify(entries);
}

function doComparableStatBucketsMatch(aBucket, bBucket) {
	return createComparableStatsBucketSignature(aBucket) === createComparableStatsBucketSignature(bBucket);
}

function formatBackupValidationMessage(errors, warnings = []) {
	const sections = [];
	if (errors.length) {
		sections.push(`Problems found:\n${errors.map(msg => `• ${msg}`).join("\n")}`);
	}
	if (warnings.length) {
		sections.push(`Warnings:\n${warnings.map(msg => `• ${msg}`).join("\n")}`);
	}
	return sections.join("\n\n");
}

function validateBackupStatLine(stats, { key = "", contextLabel = "stats", expectedSub = false, rosterLookup = null, allowedTeamNames = null, errors = [], warnings = [] } = {}) {
	if (!isPlainObject(stats)) {
		errors.push(`${contextLabel} contains a non-object stat row.`);
		return;
	}

	const normalized = createComparableStatsLine(stats);
	const expectedKey = expectedSub ? getSubKey(normalized.playerName) : getPlayerKey(normalized.teamName, normalized.playerName);

	if (!normalized.playerName) {
		errors.push(`${contextLabel} has a stat row with a missing player name.`);
	}

	if (expectedSub) {
		if (normalized.teamName !== "SUB") {
			errors.push(`${contextLabel} has sub stats for "${normalized.playerName || "Unknown"}" with an invalid team name.`);
		}
		if (key && key !== expectedKey) {
			errors.push(`${contextLabel} has a sub stat key mismatch for "${normalized.playerName || "Unknown"}".`);
		}
	} else {
		if (!normalized.teamName) {
			errors.push(`${contextLabel} has a stat row with a missing team name.`);
		}
		if (key && key !== expectedKey) {
			errors.push(`${contextLabel} has a player stat key mismatch for "${normalized.playerName || "Unknown"}".`);
		}
		if (allowedTeamNames && allowedTeamNames.size && normalized.teamName && !allowedTeamNames.has(normalized.teamName)) {
			errors.push(`${contextLabel} references team "${normalized.teamName}" which is not present in the backup roster/schedule snapshot.`);
		}
		if (rosterLookup?.hasSnapshotPlayers && rosterLookup.playerMap.has(normalized.teamName)) {
			const allowedPlayers = rosterLookup.playerMap.get(normalized.teamName);
			if (allowedPlayers.size && normalized.playerName && !allowedPlayers.has(normalized.playerName)) {
				errors.push(`${contextLabel} references player "${normalized.playerName}" on "${normalized.teamName}", but that player is missing from the backup roster snapshot.`);
			}
		}
	}

	STATS_BACKUP_NUMERIC_FIELDS.forEach(field => {
		if (!isFiniteNonNegativeNumber(stats?.[field] ?? 0)) {
			errors.push(`${contextLabel} has an invalid numeric value for ${field}${normalized.playerName ? ` (${normalized.playerName})` : ""}.`);
		}
	});

	const hitBreakdown = normalized.singles + normalized.doubles + normalized.triples + normalized.homeRuns;
	if (normalized.hits !== hitBreakdown) {
		errors.push(`${contextLabel} has mismatched hit totals for "${normalized.playerName || "Unknown"}".`);
	}
	if (normalized.hits > normalized.atBats) {
		errors.push(`${contextLabel} gives "${normalized.playerName || "Unknown"}" more hits than at-bats.`);
	}
	if (normalized.earnedRunsAllowed > normalized.runsAllowed) {
		errors.push(`${contextLabel} gives "${normalized.playerName || "Unknown"}" more earned runs than total runs allowed.`);
	}
	if (Number(stats?.inningsPitched || 0) && Math.abs(Number(stats.inningsPitched || 0) - normalized.inningsPitched) > 0.001) {
		warnings.push(`${contextLabel} had innings pitched values that did not match pitching outs. Innings will be rebuilt from outs during restore.`);
	}
}

function validateScheduleGameResult(result, { contextLabel = "schedule game", away = "", home = "", errors = [] } = {}) {
	if (result == null) return;
	if (!isPlainObject(result)) {
		errors.push(`${contextLabel} result is not a valid object.`);
		return;
	}

	if (result.type === "win") {
		const winner = String(result.winner || "").trim();
		const loser = String(result.loser || "").trim();
		if (!winner || !loser || winner === loser) {
			errors.push(`${contextLabel} has an invalid winner/loser result.`);
		}
		if (away && home && ![away, home].includes(winner)) {
			errors.push(`${contextLabel} winner does not match the scheduled teams.`);
		}
		if (away && home && ![away, home].includes(loser)) {
			errors.push(`${contextLabel} loser does not match the scheduled teams.`);
		}
		if (!isFiniteNonNegativeNumber(result.winnerScore) || !isFiniteNonNegativeNumber(result.loserScore)) {
			errors.push(`${contextLabel} has invalid win/loss scores.`);
		}
		if (Number(result.winnerScore) < Number(result.loserScore)) {
			errors.push(`${contextLabel} has a winner score lower than the loser score.`);
		}
		return;
	}

	if (result.type === "tie") {
		const team1 = String(result.team1 || "").trim();
		const team2 = String(result.team2 || "").trim();
		if (!team1 || !team2 || team1 === team2) {
			errors.push(`${contextLabel} has an invalid tie result.`);
		}
		if (away && home && ![away, home].includes(team1)) {
			errors.push(`${contextLabel} tie team names do not match the scheduled teams.`);
		}
		if (away && home && ![away, home].includes(team2)) {
			errors.push(`${contextLabel} tie team names do not match the scheduled teams.`);
		}
		if (!isFiniteNonNegativeNumber(result.score1) || !isFiniteNonNegativeNumber(result.score2)) {
			errors.push(`${contextLabel} has invalid tie scores.`);
		}
		if (Number(result.score1) !== Number(result.score2)) {
			errors.push(`${contextLabel} is marked as a tie but the saved scores are not equal.`);
		}
		return;
	}

	errors.push(`${contextLabel} has an unknown result type.`);
}

function buildComparableSeriesResult(result) {
	if (!result) return null;
	if (result.type === "win") {
		return {
			type: "win",
			winner: String(result.winner || "").trim(),
			loser: String(result.loser || "").trim(),
			winnerGames: Number(result.winnerGames || 0),
			loserGames: Number(result.loserGames || 0),
			tieGames: Number(result.tieGames || 0)
		};
	}
	if (result.type === "tie") {
		return {
			type: "tie",
			away: String(result.away || "").trim(),
			home: String(result.home || "").trim(),
			awayWins: Number(result.awayWins || 0),
			homeWins: Number(result.homeWins || 0),
			tieGames: Number(result.tieGames || 0)
		};
	}
	return null;
}

function doSeriesResultsMatch(storedResult, computedResult) {
	return JSON.stringify(buildComparableSeriesResult(storedResult)) === JSON.stringify(buildComparableSeriesResult(computedResult));
}

function validateScheduleStructure(scheduleObj, rosterLookup, errors, warnings) {
	if (!isPlainObject(scheduleObj)) {
		errors.push("Backup schedule is not a valid object.");
		return;
	}

	const originalTeamNames = Array.isArray(scheduleObj.teamNames) ? scheduleObj.teamNames : [];
	const normalizedTeamNames = uniqueTrimmedStrings(originalTeamNames);
	if (!normalizedTeamNames.length) {
		errors.push("Backup schedule is missing team names.");
	}
	if (normalizedTeamNames.length !== originalTeamNames.length) {
		errors.push("Backup schedule contains blank or duplicate team names.");
	}

	(scheduleObj.days || []).forEach((dayObj, dayIndex) => {
		if (!Array.isArray(dayObj?.games)) {
			errors.push(`Schedule day ${dayIndex + 1} is missing its games list.`);
			return;
		}

		const teamsSeenThisDay = new Set();
		(dayObj.games || []).forEach((seriesEntry, seriesIndex) => {
			const away = String(seriesEntry?.away || "").trim();
			const home = String(seriesEntry?.home || "").trim();
			const label = `Schedule day ${Number(dayObj?.day || (dayIndex + 1))}, series ${seriesIndex + 1}`;

			if (!away || !home || away === home) {
				errors.push(`${label} has an invalid away/home matchup.`);
			}
			if (normalizedTeamNames.length && !normalizedTeamNames.includes(away)) {
				errors.push(`${label} references away team "${away}" which is not listed in schedule.teamNames.`);
			}
			if (normalizedTeamNames.length && !normalizedTeamNames.includes(home)) {
				errors.push(`${label} references home team "${home}" which is not listed in schedule.teamNames.`);
			}
			if (teamsSeenThisDay.has(away) || teamsSeenThisDay.has(home)) {
				errors.push(`${label} makes a team appear more than once on the same day.`);
			}
			teamsSeenThisDay.add(away);
			teamsSeenThisDay.add(home);

			if (!Array.isArray(seriesEntry?.gamesInSeries) || seriesEntry.gamesInSeries.length !== 3) {
				errors.push(`${label} does not contain exactly 3 games in the series.`);
				return;
			}

			(seriesEntry.gamesInSeries || []).forEach((seriesGame, seriesGameIndex) => {
				validateScheduleGameResult(seriesGame?.result, {
					contextLabel: `${label}, game ${seriesGameIndex + 1}`,
					away,
					home,
					errors
				});
			});

			const computedResult = computeSeriesResult(seriesEntry);
			if (seriesEntry?.result && !computedResult) {
				errors.push(`${label} has a saved series result even though not all 3 games were recorded.`);
			} else if (seriesEntry?.result && computedResult && !doSeriesResultsMatch(seriesEntry.result, computedResult)) {
				errors.push(`${label} has a saved series result that does not match the 3 recorded game results.`);
			}
		});

		if (normalizedTeamNames.length === 5) {
			const byeTeam = getByeTeamForDay(dayObj, normalizedTeamNames);
			if (!byeTeam) {
				errors.push(`Schedule day ${Number(dayObj?.day || (dayIndex + 1))} is missing a valid bye team.`);
			}
		}
	});

	if (rosterLookup?.teams?.length) {
		const snapshotSignature = buildRosterSignatureFromTeams(rosterLookup.teams);
		const scheduleSignature = normalizedTeamNames.slice().sort((a, b) => a.localeCompare(b)).join("||");
		const snapshotTeamSignature = rosterLookup.teams.map(team => team.name).sort((a, b) => a.localeCompare(b)).join("||");
		if (scheduleSignature && snapshotTeamSignature && scheduleSignature !== snapshotTeamSignature) {
			errors.push("The backup roster snapshot team list does not match the saved schedule team list.");
		}
		if (!snapshotSignature && rosterLookup.hasSnapshotPlayers) {
			warnings.push("Backup roster snapshot could not be normalized cleanly.");
		}
	}

	const config = getScheduleConfigForTeams(normalizedTeamNames);
	if (!config) {
		errors.push("Backup schedule uses an unsupported team count. Saved schedules must be for exactly 4 or 5 teams.");
		return;
	}

	const normalizedSchedule = ensureScheduleShape(deepCloneJson(scheduleObj) || { days: [], teamNames: [] });
	normalizedSchedule.teamNames = normalizedTeamNames.slice();

	if (!isScheduleCurrentFormat(normalizedSchedule, normalizedTeamNames.slice())) {
		if (config.id === SCHEDULE_FORMAT_DOUBLE_ROUND_ROBIN_4) {
			errors.push("Backup schedule is not a valid 4-team double round robin.");
		} else if (config.id === SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5) {
			errors.push("Backup schedule is not a valid 5-team single round robin.");
		} else {
			errors.push("Backup schedule does not match a supported season format.");
		}
	}
}

function validateSeasonGameLogs(seasonObj, scheduleObj, rosterLookup, errors, warnings) {
	const ids = new Set();
	(seasonObj.games || []).forEach((entry, index) => {
		if (!isPlainObject(entry)) {
			errors.push(`Saved game log ${index + 1} is not a valid object.`);
			return;
		}

		const entryId = String(entry.id || "").trim();
		const team1Name = String(entry.team1Name || "").trim();
		const team2Name = String(entry.team2Name || "").trim();
		const label = `Saved game log ${index + 1}`;

		if (!entryId) {
			errors.push(`${label} is missing its game id.`);
		} else if (ids.has(entryId)) {
			errors.push(`${label} uses a duplicate game id (${entryId}).`);
		} else {
			ids.add(entryId);
		}

		if (!team1Name || !team2Name || team1Name === team2Name) {
			errors.push(`${label} has an invalid team matchup.`);
		}

		if (!Array.isArray(entry.playerStats)) {
			errors.push(`${label} is missing its playerStats array.`);
			return;
		}

		if (entry.scheduleRef != null) {
			const ref = entry.scheduleRef;
			const validRef =
				Number.isInteger(ref?.dayIndex) && ref.dayIndex >= 0 &&
				Number.isInteger(ref?.seriesIndex) && ref.seriesIndex >= 0 &&
				Number.isInteger(ref?.seriesGameIndex) && ref.seriesGameIndex >= 0;

			if (!validRef) {
				errors.push(`${label} has an invalid scheduleRef.`);
			} else {
				const seriesEntry = scheduleObj?.days?.[ref.dayIndex]?.games?.[ref.seriesIndex];
				const seriesGame = seriesEntry?.gamesInSeries?.[ref.seriesGameIndex];
				if (!seriesEntry || !seriesGame) {
					errors.push(`${label} points to a scheduled game that does not exist in the backup schedule.`);
				} else {
					const scheduledTeams = [String(seriesEntry.away || "").trim(), String(seriesEntry.home || "").trim()].sort();
					const loggedTeams = [team1Name, team2Name].sort();
					if (JSON.stringify(scheduledTeams) !== JSON.stringify(loggedTeams)) {
						errors.push(`${label} does not match the scheduled matchup stored in the backup schedule.`);
					}
					if (!seriesGame.result) {
						errors.push(`${label} has a detailed game log, but the matching schedule slot has no recorded result.`);
					}
				}
			}
		}

		(entry.playerStats || []).forEach((stats, statIndex) => {
			const statLabel = `${label}, player line ${statIndex + 1}`;
			const allowedTeams = new Set([team1Name, team2Name]);
			validateBackupStatLine(stats, {
				contextLabel: statLabel,
				expectedSub: !!stats?.isSub || String(stats?.teamName || "").trim() === "SUB",
				rosterLookup,
				allowedTeamNames: allowedTeams,
				errors,
				warnings
			});
		});
	});
}

function validateStatsBackupPayload(raw) {
	const errors = [];
	const warnings = [];

	if (!raw || typeof raw !== "object") {
		return { ok: false, message: "Backup file is empty or not a valid object." };
	}

	if (raw.kind !== STATS_BACKUP_KIND) {
		return { ok: false, message: "That file is not a Wiffle Ball stats backup created by this app." };
	}

	const version = Number(raw.version || 1);
	if (!STATS_BACKUP_ACCEPTED_VERSIONS.has(version)) {
		return { ok: false, message: `Backup version ${raw.version} is not supported by this app.` };
	}

	if (!raw.season || !raw.schedule) {
		return { ok: false, message: "Backup file is missing season or schedule data." };
	}

	const seasonData = ensureSeasonShape(deepCloneJson(raw.season));
	const scheduleData = ensureScheduleShape(deepCloneJson(raw.schedule));
	const backup = {
		...deepCloneJson(raw),
		version,
		season: seasonData,
		schedule: scheduleData,
		leagueSnapshot: {
			teams: normalizeBackupTeamSnapshotTeams(raw?.leagueSnapshot?.teams)
		}
	};

	const rosterLookup = createBackupRosterLookup(backup);

	validateScheduleStructure(scheduleData, rosterLookup, errors, warnings);

	if (!isPlainObject(seasonData.playerStats)) {
		errors.push("Backup season.playerStats is not a valid object.");
	}
	if (!isPlainObject(seasonData.subStats)) {
		errors.push("Backup season.subStats is not a valid object.");
	}
	if (!isPlainObject(seasonData.teamRecords)) {
		errors.push("Backup season.teamRecords is not a valid object.");
	}
	if (!Array.isArray(seasonData.seasonSubs)) {
		errors.push("Backup season.seasonSubs is not a valid array.");
	}
	if (!Array.isArray(seasonData.games)) {
		errors.push("Backup season.games is not a valid array.");
	}

	Object.entries(seasonData.playerStats || {}).forEach(([key, stats]) => {
		validateBackupStatLine(stats, {
			key,
			contextLabel: "season.playerStats",
			expectedSub: false,
			rosterLookup,
			allowedTeamNames: rosterLookup.teamSet,
			errors,
			warnings
		});
	});

	Object.entries(seasonData.subStats || {}).forEach(([key, stats]) => {
		validateBackupStatLine(stats, {
			key,
			contextLabel: "season.subStats",
			expectedSub: true,
			rosterLookup,
			allowedTeamNames: null,
			errors,
			warnings
		});
	});

	validateSeasonGameLogs(seasonData, scheduleData, rosterLookup, errors, warnings);

	const rawSummary = raw?.backupStats;
	const computedSummary = buildStatsBackupSummary(seasonData, scheduleData, backup.leagueSnapshot);
	if (version >= 2) {
		if (!isPlainObject(rawSummary)) {
			errors.push("Backup file is missing its v2 integrity summary.");
		} else {
			const summaryFields = [
				"teamCount",
				"rosterPlayerCount",
				"scheduleDayCount",
				"scheduledSeriesCount",
				"recordedScheduleGameCount",
				"detailedGameLogCount",
				"detailedScheduledGameCount",
				"playerStatCount",
				"subStatCount",
				"canRebuildPlayerTotals",
				"rosterSignature"
			];
			summaryFields.forEach(field => {
				if (JSON.stringify(rawSummary[field]) !== JSON.stringify(computedSummary[field])) {
					errors.push(`Backup integrity summary mismatch for ${field}. The file may be incomplete or edited.`);
				}
			});
		}
	}

	if (errors.length) {
		return {
			ok: false,
			message: formatBackupValidationMessage(errors, warnings)
		};
	}

	return {
		ok: true,
		backup,
		warnings,
		computedSummary
	};
}

function doesBackupRosterDiffer(backup) {
	const backupTeams = Array.isArray(backup?.leagueSnapshot?.teams)
		? backup.leagueSnapshot.teams.map(team => ({
			name: String(team?.name || "").trim(),
			players: Array.isArray(team?.players) ? team.players.map(player => String(player || "").trim()).sort() : []
		})).sort((a, b) => a.name.localeCompare(b.name))
		: [];

	const currentTeams = Array.isArray(league?.teams)
		? league.teams.map(team => ({
			name: String(team?.name || "").trim(),
			players: Array.isArray(team?.players) ? team.players.map(player => String(player || "").trim()).sort() : []
		})).sort((a, b) => a.name.localeCompare(b.name))
		: [];

	if (!backupTeams.length || !currentTeams.length) return false;
	return JSON.stringify(backupTeams) !== JSON.stringify(currentTeams);
}

function sanitizeImportedStatsBucket(bucket, { subBucket = false } = {}) {
	const nextBucket = {};
	Object.entries(bucket || {}).forEach(([key, rawStats]) => {
		const normalized = createComparableStatsLine(rawStats);
		const safeKey = subBucket ? getSubKey(normalized.playerName) : getPlayerKey(normalized.teamName, normalized.playerName);
		if (!normalized.playerName || (!subBucket && !normalized.teamName)) return;

		const base = createEmptyStats(subBucket ? "SUB" : normalized.teamName, normalized.playerName, { isSub: subBucket });
		STATS_BACKUP_NUMERIC_FIELDS.forEach(field => {
			base[field] = normalized[field];
		});
		syncPitchingInnings(base);
		nextBucket[safeKey] = base;
	});
	return nextBucket;
}

function sanitizeSeasonGameLogsForRestore(seasonObj) {
	return (seasonObj?.games || []).map(entry => ({
		...deepCloneJson(entry),
		id: String(entry?.id || "").trim(),
		playedAt: Number(entry?.playedAt || 0),
		team1Name: String(entry?.team1Name || "").trim(),
		team2Name: String(entry?.team2Name || "").trim(),
		team1Score: Number(entry?.team1Score || 0),
		team2Score: Number(entry?.team2Score || 0),
		playerStats: Array.isArray(entry?.playerStats)
			? entry.playerStats.map(stats => ({ ...createComparableStatsLine(stats) }))
			: [],
		lineups: isPlainObject(entry?.lineups) ? deepCloneJson(entry.lineups) : {},
		lineScore: isPlainObject(entry?.lineScore) ? deepCloneJson(entry.lineScore) : null,
		winningPitcher: isPlainObject(entry?.winningPitcher) ? deepCloneJson(entry.winningPitcher) : null,
		losingPitcher: isPlainObject(entry?.losingPitcher) ? deepCloneJson(entry.losingPitcher) : null,
		subsUsed: Array.isArray(entry?.subsUsed) ? deepCloneJson(entry.subsUsed) : [],
		scheduleMeta: isPlainObject(entry?.scheduleMeta) ? deepCloneJson(entry.scheduleMeta) : null,
		postseasonRef: isPlainObject(entry?.postseasonRef) ? deepCloneJson(entry.postseasonRef) : null,
		seasonPhase: String(entry?.seasonPhase || "").trim() || (entry?.postseasonRef ? "postseason" : "regular"),
		scheduleRef: entry?.scheduleRef && typeof entry.scheduleRef === "object"
			? {
				dayIndex: Number(entry.scheduleRef.dayIndex),
				seriesIndex: Number(entry.scheduleRef.seriesIndex),
				seriesGameIndex: Number(entry.scheduleRef.seriesGameIndex)
			}
			: null,
		hasDetailedStats: Array.isArray(entry?.playerStats) && entry.playerStats.length > 0
	}));
}

function buildSanitizedScheduleForRestore(scheduleObj) {
	const nextSchedule = ensureScheduleShape(deepCloneJson(scheduleObj) || { days: [], teamNames: [] });
	nextSchedule.teamNames = uniqueTrimmedStrings(nextSchedule.teamNames || []);
	nextSchedule.days = (nextSchedule.days || []).map((dayObj, dayIndex) => ({
		day: Number(dayObj?.day || (dayIndex + 1)),
		byeTeam: getByeTeamForDay(dayObj, nextSchedule.teamNames),
		games: (dayObj?.games || []).map((seriesEntry, seriesIndex) => {
			const normalized = createSeriesEntry(
				String(seriesEntry?.away || "").trim(),
				String(seriesEntry?.home || "").trim(),
				Number(seriesEntry?.gameNumber || (seriesIndex + 1))
			);

			normalized.subAssignments = Array.isArray(seriesEntry?.subAssignments)
				? deepCloneJson(seriesEntry.subAssignments)
				: [];
			normalized.gamesInSeries = (Array.isArray(seriesEntry?.gamesInSeries) ? seriesEntry.gamesInSeries : []).slice(0, 3).map((seriesGame, seriesGameIndex) => ({
				gameNumber: Number(seriesGame?.gameNumber || (seriesGameIndex + 1)),
				result: seriesGame?.result ? deepCloneJson(seriesGame.result) : null,
				skipped: seriesGame?.skipped && typeof seriesGame.skipped === "object" ? deepCloneJson(seriesGame.skipped) : null,
				subAssignments: Array.isArray(seriesGame?.subAssignments) ? deepCloneJson(seriesGame.subAssignments) : []
			}));
			while (normalized.gamesInSeries.length < 3) {
				normalized.gamesInSeries.push(createSeriesGameSlot(normalized.gamesInSeries.length + 1));
			}

			normalized.result = computeSeriesResult(normalized);
			delete normalized._seriesStandingsApplied;
			return normalized;
		})
	}));

	return ensureScheduleShape(nextSchedule);
}

function rebuildTeamRecordsFromSchedule(scheduleObj, fallbackTeamNames = []) {
	const teamNames = uniqueTrimmedStrings([...(scheduleObj?.teamNames || []), ...fallbackTeamNames]);
	const records = {};
	teamNames.forEach(teamName => {
		records[teamName] = { wins: 0, losses: 0 };
	});

	(scheduleObj?.days || []).forEach(dayObj => {
		(dayObj?.games || []).forEach(seriesEntry => {
			const result = computeSeriesResult(seriesEntry);
			if (!result || result.type !== "win") return;
			if (!records[result.winner]) records[result.winner] = { wins: 0, losses: 0 };
			if (!records[result.loser]) records[result.loser] = { wins: 0, losses: 0 };
			records[result.winner].wins += 1;
			records[result.loser].losses += 1;
		});
	});

	return records;
}

function rebuildSeasonStatBucketsFromGameLogs(seasonObj) {
	const rebuiltPlayerStats = {};
	const rebuiltSubStats = {};
	const subNames = new Set();

	(seasonObj?.games || []).forEach(entry => {
		(entry?.playerStats || []).forEach(rawStats => {
			const normalized = createComparableStatsLine(rawStats);
			if (!normalized.playerName || (!normalized.isSub && !normalized.teamName)) return;

			const key = normalized.isSub
				? getSubKey(normalized.playerName)
				: getPlayerKey(normalized.teamName, normalized.playerName);
			const bucket = normalized.isSub ? rebuiltSubStats : rebuiltPlayerStats;

			if (!bucket[key]) {
				bucket[key] = createEmptyStats(normalized.isSub ? "SUB" : normalized.teamName, normalized.playerName, { isSub: normalized.isSub });
			}

			STATS_BACKUP_NUMERIC_FIELDS.forEach(field => {
				bucket[key][field] = Number(bucket[key][field] || 0) + normalized[field];
			});
			syncPitchingInnings(bucket[key]);

			if (normalized.isSub && normalized.playerName) subNames.add(normalized.playerName);
		});
	});

	return {
		playerStats: rebuiltPlayerStats,
		subStats: rebuiltSubStats,
		seasonSubs: Array.from(subNames).sort((a, b) => a.localeCompare(b))
	};
}

function evaluateBackupRebuildPlan(backup, seasonObj, scheduleObj) {
	const sanitizedImportedPlayerStats = sanitizeImportedStatsBucket(seasonObj.playerStats, { subBucket: false });
	const sanitizedImportedSubStats = sanitizeImportedStatsBucket(seasonObj.subStats, { subBucket: true });
	const detailedLogs = getDetailedSeasonGameLogEntries(seasonObj);
	const coverageComplete = canSeasonGameLogsFullyCoverRecordedSchedule(seasonObj, scheduleObj);

	if (!detailedLogs.length) {
		return {
			useRebuiltStats: false,
			reason: "no_detailed_logs"
		};
	}

	const rebuilt = rebuildSeasonStatBucketsFromGameLogs(seasonObj);
	const importedMatchesRebuilt =
		doComparableStatBucketsMatch(sanitizedImportedPlayerStats, rebuilt.playerStats) &&
		doComparableStatBucketsMatch(sanitizedImportedSubStats, rebuilt.subStats);

	if (Number(backup?.version || 1) >= 2 && backup?.backupStats?.canRebuildPlayerTotals) {
		if (!coverageComplete) {
			return {
				error: "This backup says detailed game logs can fully rebuild player totals, but one or more recorded schedule games are missing matching detailed log entries."
			};
		}
		if (!importedMatchesRebuilt) {
			return {
				error: "This backup's saved player totals do not match the detailed game logs inside the file. Restore was stopped to avoid loading inconsistent totals."
			};
		}
		return {
			useRebuiltStats: true,
			reason: "verified_game_log_rebuild",
			rebuilt
		};
	}

	if (coverageComplete && importedMatchesRebuilt) {
		return {
			useRebuiltStats: true,
			reason: "verified_game_log_rebuild",
			rebuilt
		};
	}

	return {
		useRebuiltStats: false,
		reason: coverageComplete ? "totals_mismatch" : "incomplete_game_log_coverage"
	};
}

function prepareStatsBackupRestore(raw) {
	const validation = validateStatsBackupPayload(raw);
	if (!validation.ok) return validation;

	const backup = validation.backup;
	const nextSchedule = buildSanitizedScheduleForRestore(backup.schedule);
	let nextSeason = ensureSeasonShape(deepCloneJson(backup.season));
	nextSeason.games = sanitizeSeasonGameLogsForRestore(nextSeason);
	nextSeason.teamRecords = rebuildTeamRecordsFromSchedule(nextSchedule, backup?.leagueSnapshot?.teams?.map(team => team.name) || []);

	const rebuildPlan = evaluateBackupRebuildPlan(backup, nextSeason, nextSchedule);
	if (rebuildPlan.error) {
		return {
			ok: false,
			message: rebuildPlan.error
		};
	}

	if (rebuildPlan.useRebuiltStats) {
		nextSeason.playerStats = rebuildPlan.rebuilt.playerStats;
		nextSeason.subStats = rebuildPlan.rebuilt.subStats;
		nextSeason.seasonSubs = uniqueTrimmedStrings([
			...rebuildPlan.rebuilt.seasonSubs,
			...(Array.isArray(backup?.season?.seasonSubs) ? backup.season.seasonSubs : [])
		]);
	} else {
		nextSeason.playerStats = sanitizeImportedStatsBucket(nextSeason.playerStats, { subBucket: false });
		nextSeason.subStats = sanitizeImportedStatsBucket(nextSeason.subStats, { subBucket: true });
		nextSeason.seasonSubs = uniqueTrimmedStrings([
			...(Array.isArray(nextSeason.seasonSubs) ? nextSeason.seasonSubs : []),
			...Object.values(nextSeason.subStats || {}).map(stats => stats.playerName)
		]);
	}

	nextSeason = ensureSeasonShape(nextSeason);
	Object.values(nextSeason.playerStats || {}).forEach(syncPitchingInnings);
	Object.values(nextSeason.subStats || {}).forEach(syncPitchingInnings);

	const warnings = [...(validation.warnings || [])];
	if (rebuildPlan.useRebuiltStats) {
		warnings.push("Player totals will be rebuilt from detailed game logs, and team records will be recalculated from the restored schedule.");
	} else {
		warnings.push("Team records will be recalculated from the restored schedule. Player totals passed validation, but this backup did not have a fully verified rebuild path from detailed game logs.");
	}

	return {
		ok: true,
		backup,
		nextSeason,
		nextSchedule,
		warnings,
		rebuildMode: rebuildPlan.useRebuiltStats ? "recalculated_from_game_logs" : "validated_imported_totals"
	};
}

function persistRestoredSeasonAndSchedule(nextSeason, nextSchedule) {
	const previousSeason = deepCloneJson(season);
	const previousSchedule = deepCloneJson(schedule);
	const previousSeasonRaw = localStorage.getItem(SEASON_STORAGE_KEY);
	const previousScheduleRaw = localStorage.getItem(SCHEDULE_STORAGE_KEY);
	const previousHeadRaw = localStorage.getItem(SYNC_HEAD_KEY);

	const stampedSeason = ensureSeasonShape(deepCloneJson(nextSeason));
	const stampedSchedule = ensureScheduleShape(deepCloneJson(nextSchedule));
	const head = readLocalSyncHead() || {};
	const now = new Date().toISOString();

	normalizeSnapshotMeta(stampedSeason, "season");
	normalizeSnapshotMeta(stampedSchedule, "schedule");

	stampedSeason._meta.revision = Math.max(
		getSeasonRevisionFrom(stampedSeason),
		getSeasonRevisionFrom(previousSeason),
		Number(head?.seasonRevision || 0) || 0,
		Number(syncState?.serverSeasonRevision || 0) || 0
	) + 1;
	stampedSchedule._meta.revision = Math.max(
		getScheduleRevisionFrom(stampedSchedule),
		getScheduleRevisionFrom(previousSchedule),
		Number(head?.scheduleRevision || 0) || 0,
		Number(syncState?.serverScheduleRevision || 0) || 0
	) + 1;
	stampedSeason._meta.updated_at = now;
	stampedSchedule._meta.updated_at = now;

	const nextHead = {
		leagueCode: String(typeof LEAGUE_CODE !== "undefined" ? LEAGUE_CODE : "").trim(),
		seasonRevision: stampedSeason._meta.revision,
		scheduleRevision: stampedSchedule._meta.revision,
		serverUpdatedAt: syncState?.serverUpdatedAt || null,
		serverSeasonRevision: Math.max(0, Number(syncState?.serverSeasonRevision || 0) || 0),
		serverScheduleRevision: Math.max(0, Number(syncState?.serverScheduleRevision || 0) || 0),
		lastWriterTabId: APP_TAB_ID,
		lastWriterAt: now
	};

	const seasonJson = JSON.stringify(stampedSeason);
	const scheduleJson = JSON.stringify(stampedSchedule);
	const headJson = JSON.stringify(nextHead);

	try {
		localStorage.setItem(SEASON_STORAGE_KEY, seasonJson);
		localStorage.setItem(SCHEDULE_STORAGE_KEY, scheduleJson);
		localStorage.setItem(SYNC_HEAD_KEY, headJson);
		season = stampedSeason;
		schedule = stampedSchedule;
		try { syncStateFromHead(); } catch (e) {}
		try { clearSyncConflictState(); } catch (e) {}
		return true;
	} catch (e) {
		season = ensureSeasonShape(previousSeason);
		schedule = ensureScheduleShape(previousSchedule);
		try {
			if (previousSeasonRaw == null) localStorage.removeItem(SEASON_STORAGE_KEY);
			else localStorage.setItem(SEASON_STORAGE_KEY, previousSeasonRaw);
			if (previousScheduleRaw == null) localStorage.removeItem(SCHEDULE_STORAGE_KEY);
			else localStorage.setItem(SCHEDULE_STORAGE_KEY, previousScheduleRaw);
			if (previousHeadRaw == null) localStorage.removeItem(SYNC_HEAD_KEY);
			else localStorage.setItem(SYNC_HEAD_KEY, previousHeadRaw);
		} catch (rollbackError) {}
		throw e;
	}
}

function downloadStatsBackupJson() {
	if (isPublicViewOnlyMode()) {
		alert("Sign in with full access before downloading a stats backup.");
		return;
	}

	const backup = createStatsBackupPayload();
	const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);

	const link = document.createElement("a");
	link.href = url;
	link.download = buildStatsBackupFilename(backup);
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);

	showNotification("⬇️ Stats backup downloaded", 1800);
}

async function clearCurrentStatsOnly({ skipConfirm = false, quiet = false, syncToServer = true } = {}) {
	if (isPublicViewOnlyMode()) {
		alert("Sign in with full access before clearing season stats.");
		return false;
	}

	if (!skipConfirm) {
		const confirmed = confirm(
			"Clear current season stats?\n\n" +
			"This will remove:\n" +
			"• Player stats\n" +
			"• Team records\n" +
			"• Sub stats\n" +
			"• Saved past game log entries\n" +
			"• Recorded schedule game results\n\n" +
			"Your teams and schedule structure will stay in place."
		);
		if (!confirmed) return false;
	}

	season = ensureSeasonShape(createEmptySeasonState());
	schedule = stripScheduleResultsForStatsClear(schedule);

	try { syncTeamRecordsWithLeague(); } catch (e) {}
	try { saveSeason({ skipServerSync: true }); } catch (e) {}
	try { saveSchedule({ skipServerSync: true }); } catch (e) {}

	refreshStatsBackupViews();

	if (syncToServer) {
		try { await syncSeasonToServer({ quiet: true }); } catch (e) {}
	}

	if (!quiet) showNotification("🧹 Current stats cleared", 1800);
	return true;
}

function openStatsRestorePicker() {
	if (isPublicViewOnlyMode()) {
		alert("Sign in with full access before restoring a stats backup.");
		return;
	}

	const input = document.getElementById("statsRestoreFileInput");
	if (!input) {
		alert("Restore file input not found.");
		return;
	}

	input.value = "";
	input.click();
}

async function restoreStatsBackupFromPayload(raw) {
	const prepared = prepareStatsBackupRestore(raw);
	if (!prepared.ok) {
		alert(`Restore failed.\n\n${prepared.message}`);
		return false;
	}

	const { backup, nextSeason, nextSchedule, warnings, rebuildMode } = prepared;
	const currentLeagueCode = String(typeof LEAGUE_CODE !== "undefined" ? LEAGUE_CODE : "").trim();
	const backupLeagueCode = String(backup?.leagueCode || "").trim();

	if (backupLeagueCode && currentLeagueCode && backupLeagueCode !== currentLeagueCode) {
		alert(`Restore cancelled.\n\nThis backup belongs to league code "${backupLeagueCode}", but the current league is "${currentLeagueCode}".`);
		return false;
	}

	if (doesBackupRosterDiffer(backup)) {
		const continueRestore = confirm(
			"This backup was created with a different team/player setup than the one currently loaded.\n\n" +
			"The restore can still continue, but the live roster should be changed back to match the backup snapshot if this is the same season.\n\n" +
			"Restore anyway?"
		);
		if (!continueRestore) return false;
	}

	let confirmMessage =
		"Restore this stats backup?\n\n" +
		"This will replace the current season stats and recorded schedule results with the uploaded backup.\n\n" +
		(rebuildMode === "recalculated_from_game_logs"
			? "Player totals will be rebuilt from saved game logs, and team records will be recalculated from the restored schedule."
			: "Team records will be recalculated from the restored schedule after validation.");

	if (warnings.length) {
		confirmMessage += `\n\nReview before restoring:\n${warnings.map(msg => `• ${msg}`).join("\n")}`;
	}

	const restoreConfirmed = confirm(confirmMessage);
	if (!restoreConfirmed) return false;

	try {
		persistRestoredSeasonAndSchedule(nextSeason, nextSchedule);
	} catch (e) {
		console.error("stats restore persist failed:", e);
		alert("Restore failed.\n\nThe app could not safely save both the season and schedule snapshots, so the restore was rolled back.");
		return false;
	}

	refreshStatsBackupViews();

	try { await syncSeasonToServer({ quiet: true }); } catch (e) {
		console.warn("stats restore server sync failed:", e);
	}

	showNotification("✅ Stats backup restored", 2200);
	return true;
}

async function handleStatsRestoreFile(event) {
	const input = event?.target;
	const file = input?.files?.[0];
	if (!file) return;

	try {
		const text = await file.text();
		let parsed;

		try {
			parsed = JSON.parse(text);
		} catch (e) {
			alert("Restore failed.\n\nThat file is not valid JSON.");
			return;
		}

		await restoreStatsBackupFromPayload(parsed);
	} catch (e) {
		console.error("stats restore failed:", e);
		alert("Restore failed.\n\nCould not read that backup file.");
	} finally {
		if (input) input.value = "";
	}
}



async function resetSeason() {
	if (!(await requireLogin())) return;

	const msg =
		"⚠️ Reset Season?\n\n" +
		"This will permanently delete:\n" +
		"• All season stats\n" +
		"• All schedule game results\n" +
		"• Local saved season/schedule data\n" +
		"• Server backup (season_data) for this league\n\n" +
		"This cannot be undone.\n\n" +
		"Are you sure you want to continue?";

	if (!confirm(msg)) return;

	try {
		const leagueCode = (typeof LEAGUE_CODE !== "undefined" ? String(LEAGUE_CODE) : "").trim();
		if (!leagueCode) {
			throw new Error("Missing league code.");
		}

		if (typeof supabaseClient === "undefined" || !supabaseClient) {
			throw new Error("Supabase client is not available.");
		}

		const { data: { user } = {}, error: userErr } = await supabaseClient.auth.getUser();
		if (userErr) throw userErr;
		if (!user) {
			throw new Error("You must be signed in with full access before resetting the season.");
		}

		const { error: deleteErr } = await supabaseClient
			.from("season_data")
			.delete()
			.eq("league_code", leagueCode);

		if (deleteErr) throw deleteErr;

		const cleared = await clearCurrentStatsOnly({
			skipConfirm: true,
			quiet: true,
			syncToServer: false
		});

		if (!cleared) {
			throw new Error("Local reset step did not complete.");
		}

		refreshStatsBackupViews();
		showNotification("✅ Season reset complete.", 1800);
	} catch (err) {
		console.error("Season reset failed before completion:", err);
		alert(
			"❌ Reset failed.\n\n" +
			"The server backup could not be fully deleted, so the season was NOT cleared locally.\n\n" +
			"Your current local data was left unchanged."
		);
	}
}

/* ================================
   PLAYER / STAT HELPERS
================================== */
function getPlayerKey(teamName, playerName) {
	return teamName + "|" + playerName;
}

function getSubKey(subName) {
	return "SUB|" + subName;
}

function isSubKey(key) {
	return String(key || "").startsWith("SUB|");
}

function createEmptyStats(teamName, playerName, extra = {}) {
	return {
		teamName: teamName,
		playerName: playerName,
		atBats: 0,
		hits: 0,
		singles: 0,
		doubles: 0,
		triples: 0,
		homeRuns: 0,
		walks: 0,
		hitByPitch: 0,
		strikeouts: 0,
		outs: 0,
		rbis: 0,
		runsScored: 0,
		pitchOuts: 0,
		pitchStrikeouts: 0,
		fieldingErrors: 0,
		inningsPitched: 0,
		runsAllowed: 0,
		earnedRunsAllowed: 0,
		...extra
	};
}

function initPlayerStats(teamName, playerName) {
	let key = getPlayerKey(teamName, playerName);
	if (!season.playerStats[key]) {
		season.playerStats[key] = createEmptyStats(teamName, playerName, { isSub: false });
	}
	return season.playerStats[key];
}

function initSubStats(subName) {
	season.subStats = season.subStats || {};
	const key = getSubKey(subName);
	if (!season.subStats[key]) {
		season.subStats[key] = createEmptyStats("SUB", subName, { isSub: true });
	}
	return season.subStats[key];
}

function getSeasonStatsBucketForKey(key) {
	if (isSubKey(key)) {
		season.subStats = season.subStats || {};
		return season.subStats;
	}
	season.playerStats = season.playerStats || {};
	return season.playerStats;
}

function getOrCreateSeasonStatsByKey(key, teamName = "", playerName = "") {
	const bucket = getSeasonStatsBucketForKey(key);
	if (!bucket[key]) {
		if (isSubKey(key)) {
			bucket[key] = createEmptyStats("SUB", String(key).replace(/^SUB\|/, ""), { isSub: true });
		} else {
			bucket[key] = createEmptyStats(teamName, playerName, { isSub: false });
		}
	}
	return bucket[key];
}

function getGameStatsKey(teamOrName, playerName) {
	const teamObj = typeof teamOrName === "string"
		? [game?.team1, game?.team2].find(t => t?.name === teamOrName)
		: teamOrName;

	const statsKey = teamObj?._playerMeta?.[playerName]?.statsKey;
	return statsKey || getPlayerKey(teamObj?.name || teamOrName, playerName);
}

function getDisplayNameForPlayer(teamObj, playerName, isSeason) {
	if (isSeason) return playerName;
	const meta = teamObj?._playerMeta?.[playerName];
	if (meta?.isSub && meta?.originalPlayer) return `${playerName} (sub for ${meta.originalPlayer})`;
	return playerName;
}

function getAllPlayerNames() {
	const names = [];
	(league.teams || []).forEach(team => (team.players || []).forEach(player => names.push(player)));
	return names;
}
