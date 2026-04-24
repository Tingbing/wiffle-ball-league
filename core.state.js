// Wiffle Ball League - Shared state + utilities
// Split from app.core.js. Load this BEFORE core.sync.js, core.schedule.js, core.stats.js, core.ui.js, app.game.js, and app.auth.js.

/* ================================
   SHARED APP STATE
================================== */
	let league = { teams: [] };
    let season = { playerStats: {}, teamRecords: {}, seasonSubs: [], subStats: {}, games: [] };
	let game = null;
	let gameHistory = [];
	let lastPlay = null;
	let pendingBattingResult = null;
    let playInputLock = false;
let activeGameLock = null;
const ACTIVE_GAME_LOCK_KEY = "wiggleActiveGameLock";
const SEASON_STORAGE_KEY = "wiggleSeason";
const SCHEDULE_STORAGE_KEY = "wiggleSchedule";
const SYNC_HEAD_KEY = "wiggleSyncHeadV1";
const APP_TAB_ID = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let schedule = { days: [], teamNames: [] };

/* ================================
   JSON / OBJECT HELPERS
================================== */
function readJsonStorage(key, fallback = null) {
	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : fallback;
	} catch (e) {
		return fallback;
	}
}

function deepCloneJson(value) {
	try {
		return JSON.parse(JSON.stringify(value ?? null));
	} catch (e) {
		return null;
	}
}

function createEmptyPostseasonState() {
	return {
		created: false,
		createdAt: null,
		seeds: [],
		games: {},
		champion: null,
		isComplete: false,
		needsResetGame: false
	};
}

function createEmptySeasonState() {
	return { playerStats: {}, teamRecords: {}, seasonSubs: [], subStats: {}, games: [], postseason: createEmptyPostseasonState() };
}

/* ================================
   ACCESS MODE HELPERS
================================== */

let publicViewOnlyMode = false;

function setPublicViewOnlyMode(v) {
	publicViewOnlyMode = !!v;
	try { updatePublicAccessUI(); } catch (e) {}
}

function isPublicViewOnlyMode() {
	return !!publicViewOnlyMode;
}

function hasFullAppAccess() {
	return !publicViewOnlyMode;
}

function updatePublicAccessUI() {
	const adminCard = document.getElementById("seasonStatsAdminCard");
	if (adminCard) adminCard.classList.toggle("hidden", publicViewOnlyMode);
}

/* ================================
   TEAM / LEAGUE STORAGE
================================== */
function save() {	
		localStorage.setItem("wiggleLeague", JSON.stringify(league));
	}

async function load() {
	// load teams + players from Supabase
	const { data: teams, error: teamErr } = await supabaseClient
		.from("teams")
		.select("id, name, players:players(id, name)")
		.order("name", { ascending: true });

	if (teamErr) {
		console.log(teamErr);
		// fallback to localStorage if you want:
		const local = localStorage.getItem("wiggleLeague");
		if (local) league = JSON.parse(local);
		return league;
	}

	league.teams = (teams || []).map(t => ({
		name: t.name,
		players: (t.players || []).map(p => p.name)
	}));

	return league;
}

/* ================================
   SEASON / SCHEDULE SHAPE HELPERS
================================== */
function ensurePostseasonShape(obj) {
	const base = createEmptyPostseasonState();
	if (!obj || typeof obj !== "object") obj = {};
	if (!Array.isArray(obj.seeds)) obj.seeds = [];
	if (!obj.games || typeof obj.games !== "object") obj.games = {};
	return {
		...base,
		...obj,
		seeds: Array.isArray(obj.seeds) ? obj.seeds.map(seed => ({ ...seed })) : [],
		games: obj.games && typeof obj.games === "object" ? { ...obj.games } : {},
		champion: obj.champion || null,
		created: !!obj.created,
		isComplete: !!obj.isComplete,
		needsResetGame: !!obj.needsResetGame
	};
}

function ensureSeasonShape(obj) {
	if (!obj || typeof obj !== "object") {
		obj = createEmptySeasonState();
	}
	if (!obj.playerStats) obj.playerStats = {};
	if (!obj.teamRecords) obj.teamRecords = {};
	if (!Array.isArray(obj.seasonSubs)) obj.seasonSubs = [];
	if (!obj.subStats || typeof obj.subStats !== "object") obj.subStats = {};
	if (!Array.isArray(obj.games)) obj.games = [];
	obj.postseason = ensurePostseasonShape(obj.postseason);
	return obj;
}

function ensureScheduleShape(obj) {
	if (!obj || typeof obj !== "object") obj = { days: [], teamNames: [] };
	if (!Array.isArray(obj.days)) obj.days = [];
	if (!Array.isArray(obj.teamNames)) obj.teamNames = [];

	obj.days = obj.days.map((dayObj, dayIndex) => {
		const nextDay = { ...dayObj, day: Number(dayObj?.day || (dayIndex + 1)) };
		const rawGames = Array.isArray(dayObj?.games) ? dayObj.games : [];

		nextDay.games = rawGames.map((entry, entryIndex) => {
			const seriesNumber = Number(entry?.gameNumber || (entryIndex + 1));
			const away = entry?.away || "";
			const home = entry?.home || "";

			if (Array.isArray(entry?.gamesInSeries)) {
				const gamesInSeries = entry.gamesInSeries.slice(0, 3).map((slot, slotIndex) => ({
					gameNumber: Number(slot?.gameNumber || (slotIndex + 1)),
					result: slot?.result || null,
					skipped: slot?.skipped && typeof slot.skipped === "object" ? { ...slot.skipped } : null,
					subAssignments: Array.isArray(slot?.subAssignments) ? slot.subAssignments.map(a => ({ ...a })) : []
				}));

				while (gamesInSeries.length < 3) {
					gamesInSeries.push(createSeriesGameSlot(gamesInSeries.length + 1));
				}

				const normalized = {
					...entry,
					gameNumber: seriesNumber,
					away,
					home,
					gamesInSeries,
					subAssignments: Array.isArray(entry?.subAssignments) ? entry.subAssignments.map(a => ({ ...a })) : [],
					result: entry?.result || null
				};

				if (!normalized.result) {
					normalized.result = computeSeriesResult(normalized);
				}

				return normalized;
			}

			const migrated = createSeriesEntry(away, home, seriesNumber);
			migrated.subAssignments = Array.isArray(entry?.subAssignments) ? entry.subAssignments.map(a => ({ ...a })) : [];

			if (entry?.result) {
				migrated.gamesInSeries[0].result = entry.result;
			}

			migrated.result = computeSeriesResult(migrated);
			return migrated;
		});

		return nextDay;
	});

	return obj;
}
