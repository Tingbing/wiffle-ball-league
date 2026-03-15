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
	function getValidTeamsForSchedule() {
	return league.teams.filter(t => Array.isArray(t.players) && t.players.length > 0);
	}
	
	/* ================================
	✅ RANDOM HELPERS
	==================================*/
	function shuffleArray(arr) {
	for (let i = arr.length - 1; i > 0; i--) {
	const j = Math.floor(Math.random() * (i + 1));
	[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
	}
	
/* ==========================================================
	✅ BALANCED RANDOM SCHEDULE (4 teams, 6 days, 2 series/day)
	- Each pair plays exactly 2 best-of-3 series
==========================================================*/

/* ==========================================================
	✅ SCHEDULE HELPERS
	- 4 teams: double round robin (existing behavior)
	- 5 teams: single round robin with one bye each day
==========================================================*/

const SCHEDULE_FORMAT_DOUBLE_ROUND_ROBIN_4 = "double_round_robin_4";
const SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5 = "single_round_robin_5";

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
	let autoSyncEnabled = false;          // turns on after post-unlock setup
	let suppressAutoSync = false;         // prevents sync loops when applying server data
	let postUnlockSetupPromise = null;

	let realtimeChannel = null;
	let teamsReloadTimer = null;

	let serverSyncTimer = null;

	function setSyncButtonEnabled(enabled) {
		const btn = document.getElementById("resaveStatsBtn");
		if (!btn) return;
		btn.disabled = !enabled;
		btn.style.opacity = enabled ? "1" : "0.6";
		btn.style.pointerEvents = enabled ? "auto" : "none";
	}

	function getLocalUpdatedAtMs() {
		const s = Date.parse(season?._meta?.updated_at || "") || 0;
		const sch = Date.parse(schedule?._meta?.updated_at || "") || 0;
		return Math.max(s, sch);
	}

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
	if (!schedule?.days?.length) return;

	const applySeriesWinLoss = (seriesEntry) => {
		if (!seriesEntry || seriesEntry._seriesStandingsApplied || !seriesEntry.result) return;

		if (seriesEntry.result.type === "win") {
			getTeamRecord(seriesEntry.result.winner).wins += 1;
			getTeamRecord(seriesEntry.result.loser).losses += 1;
		}

		seriesEntry._seriesStandingsApplied = true;
	};

	// exact scheduled slot
	const ref = game?._scheduleRef;
	if (ref && Number.isInteger(ref.dayIndex) && Number.isInteger(ref.seriesIndex) && Number.isInteger(ref.seriesGameIndex)) {
		const day = schedule.days[ref.dayIndex];
		const seriesEntry = day?.games?.[ref.seriesIndex];
		const seriesGame = seriesEntry?.gamesInSeries?.[ref.seriesGameIndex];

		if (seriesEntry && seriesGame) {
			if (seriesGame.result) return; // already recorded

			seriesGame.result = resultObj;

			if (!seriesEntry.result) {
				seriesEntry.result = computeSeriesResult(seriesEntry);
				applySeriesWinLoss(seriesEntry);
			}

			saveSchedule();
			return;
		}
	}

	// fallback
	for (const day of schedule.days) {
		for (const seriesEntry of (day.games || [])) {
			const match =
				(seriesEntry.away === teamA && seriesEntry.home === teamB) ||
				(seriesEntry.away === teamB && seriesEntry.home === teamA);

			if (!match) continue;

			const openGame = (seriesEntry.gamesInSeries || []).find(seriesGame => !seriesGame.result);
			if (!openGame) continue;

			openGame.result = resultObj;

			if (!seriesEntry.result) {
				seriesEntry.result = computeSeriesResult(seriesEntry);
				applySeriesWinLoss(seriesEntry);
			}

			saveSchedule();
			return;
		}
	}
}

function applyGameOutcomeOnce() {
	if (!game || game._resultSaved) return;
	game._resultSaved = true;

	const t1 = game.team1?.name;
	const t2 = game.team2?.name;
	if (!t1 || !t2) return;

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

	// scheduled series game -> store game result, series result happens after all 3
	if (game?._scheduleRef &&
		Number.isInteger(game._scheduleRef.dayIndex) &&
		Number.isInteger(game._scheduleRef.seriesIndex)
	) {
		updateScheduleForCompletedGame(t1, t2, resultObj);
	}
	// manual game -> old single-game win/loss behavior
	else if (s1 !== s2) {
		const winner = s1 > s2 ? t1 : t2;
		const loser = s1 > s2 ? t2 : t1;
		getTeamRecord(winner).wins += 1;
		getTeamRecord(loser).losses += 1;
	}

	saveSeason();
}

const STATS_BACKUP_KIND = "wbl_stats_backup";
const STATS_BACKUP_VERSION = 1;

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

function createStatsBackupPayload() {
	return {
		kind: STATS_BACKUP_KIND,
		version: STATS_BACKUP_VERSION,
		exportedAt: new Date().toISOString(),
		leagueCode: String(typeof LEAGUE_CODE !== "undefined" ? LEAGUE_CODE : "").trim(),
		appBuild: String(typeof APP_BUILD !== "undefined" ? APP_BUILD : ""),
		leagueSnapshot: {
			teams: Array.isArray(league?.teams)
				? league.teams.map(team => ({
					name: team?.name || "",
					players: Array.isArray(team?.players) ? team.players.slice() : []
				}))
				: []
		},
		season: ensureSeasonShape(deepCloneJson(season)),
		schedule: ensureScheduleShape(deepCloneJson(schedule))
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
			const info = ensureScheduleUpToDateForSelection();

			if (info.ok) {
				schedCard.style.display = "block";
				manualCard.style.display = "none";
				populateScheduleDaySelect();
			} else {
				schedCard.style.display = "none";
				manualCard.style.display = "block";
				updateGameSetupSelects();
			}
		}
	} catch (e) {}
}

function validateStatsBackupPayload(raw) {
	if (!raw || typeof raw !== "object") {
		return { ok: false, message: "Backup file is empty or not a valid object." };
	}

	if (raw.kind !== STATS_BACKUP_KIND) {
		return { ok: false, message: "That file is not a Wiffle Ball stats backup created by this app." };
	}

	if (!raw.season || !raw.schedule) {
		return { ok: false, message: "Backup file is missing season or schedule data." };
	}

	const seasonData = ensureSeasonShape(deepCloneJson(raw.season));
	const scheduleData = ensureScheduleShape(deepCloneJson(raw.schedule));

	if (!seasonData || !scheduleData) {
		return { ok: false, message: "Backup file could not be normalized safely." };
	}

	return {
		ok: true,
		backup: {
			...raw,
			season: seasonData,
			schedule: scheduleData,
			leagueSnapshot: raw.leagueSnapshot || { teams: [] }
		}
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
	const validation = validateStatsBackupPayload(raw);
	if (!validation.ok) {
		alert(`Restore failed.\n\n${validation.message}`);
		return false;
	}

	const backup = validation.backup;
	const currentLeagueCode = String(typeof LEAGUE_CODE !== "undefined" ? LEAGUE_CODE : "").trim();
	const backupLeagueCode = String(backup?.leagueCode || "").trim();

	if (backupLeagueCode && currentLeagueCode && backupLeagueCode !== currentLeagueCode) {
		alert(`Restore cancelled.\n\nThis backup belongs to league code "${backupLeagueCode}", but the current league is "${currentLeagueCode}".`);
		return false;
	}

	if (doesBackupRosterDiffer(backup)) {
		const continueRestore = confirm(
			"This backup was created with a different team/player setup than the one currently loaded.\n\n" +
			"You can still restore the stats, but some stat views may not line up perfectly until the current teams match the backup again.\n\n" +
			"Restore anyway?"
		);
		if (!continueRestore) return false;
	}

	const restoreConfirmed = confirm(
		"Restore this stats backup?\n\n" +
		"This will replace the current season stats and recorded schedule results with the uploaded backup."
	);
	if (!restoreConfirmed) return false;

	season = ensureSeasonShape(deepCloneJson(backup.season));
	schedule = ensureScheduleShape(deepCloneJson(backup.schedule));

	try { syncTeamRecordsWithLeague(); } catch (e) {}
	try { saveSeason({ skipServerSync: true }); } catch (e) {}
	try { saveSchedule({ skipServerSync: true }); } catch (e) {}

	refreshStatsBackupViews();

	try { await syncSeasonToServer({ quiet: true }); } catch (e) {}

	showNotification("✅ Stats backup restored", 2000);
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
		await clearCurrentStatsOnly({ skipConfirm: true, quiet: true, syncToServer: false });

		if (typeof supabaseClient !== "undefined") {
			const { data: { user } = {} } = await supabaseClient.auth.getUser();
			const leagueCode = (typeof LEAGUE_CODE !== "undefined" ? String(LEAGUE_CODE) : "").trim();

			if (user && leagueCode) {
				const { error } = await supabaseClient
					.from("season_data")
					.delete()
					.eq("league_code", leagueCode);

				if (error) {
					console.warn("Season reset: server delete failed:", error);
				}
			}
		}

		refreshStatsBackupViews();
		showNotification("✅ Season reset complete.", 1800);
	} catch (err) {
		console.error(err);
		alert("❌ Reset failed. Check console for details.");
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
		strikeouts: 0,
		outs: 0,
		rbis: 0,
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
