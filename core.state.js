function validateSafeTextTree(value,depth=0) {
  if(depth>40)throw new Error('Data nesting is too deep.');
  if(typeof value==='string' && /[<>"\x00-\x08]/.test(value))throw new Error('Text must not contain HTML markup, double quotes, or control characters.');
  if(value && typeof value==='object')for(const [key,item] of Object.entries(value)) {
    if(/[<>"]/.test(key) || ['__proto__','constructor','prototype'].includes(key))throw new Error('Disallowed data field.');
    validateSafeTextTree(item,depth+1);
  }
}
function escapeHtml(value) {return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
// Wiffle Ball League - Shared state + utilities
// Split from app.core.js. Load this BEFORE core.sync.js, core.schedule.js, core.stats.js, core.ui.js, app.game.js, and app.boot.js.

/* ================================
   SHARED APP STATE
================================== */
	let league = { teams: [] };
const MAX_TEAMS = 8;
let LEAGUE_CODE = null;
let activeAccess = null;
let leagueName = "";
let leagueSettings = {weeks:6,innings:3,outs:2};
let accessGeneration = 0;
function currentRules() { return game?.rules || season?.rules || leagueSettings; }
function regulationInnings() { return Number(currentRules().innings || 3); }
function outsPerHalf() { return Number(currentRules().outs || 2); }
function leagueKey(kind) { return `wbl-v4:${LEAGUE_CODE}:${kind}`; }
function rosterLimit() { return Number(leagueSettings.maxPlayers ?? 2); }
function configuredSeriesLength() { return Number(season?.rules?.seriesLength ?? leagueSettings.seriesLength ?? 3); }
    let season = { playerStats: {}, teamRecords: {}, seasonSubs: [], subStats: {}, games: [] };
	let game = null;
	let gameHistory = [];
	let lastPlay = null;
	let pendingBattingResult = null;
    let playInputLock = false;
let activeGameLock = null;
let ACTIVE_GAME_LOCK_KEY = "unselected";
let SEASON_STORAGE_KEY = "unselected";
let SCHEDULE_STORAGE_KEY = "unselected";
let SYNC_HEAD_KEY = "unselected";
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
	return !!activeAccess && !publicViewOnlyMode;
}

function updatePublicAccessUI() {
	const adminCard = document.getElementById("seasonStatsAdminCard");
	if (adminCard) adminCard.classList.toggle("hidden", publicViewOnlyMode);

	const manualEditorMenuBtn = document.getElementById("manualGameStatEditorMenuBtn");
	if (manualEditorMenuBtn) manualEditorMenuBtn.classList.toggle("hidden", publicViewOnlyMode);

	const manualEditorHubBtn = document.getElementById("manualGameStatEditorHubBtn");
	if (manualEditorHubBtn) manualEditorHubBtn.classList.toggle("hidden", publicViewOnlyMode);
}

/* ================================
   TEAM / LEAGUE STORAGE
================================== */
function save() {	
		localStorage.setItem(leagueKey("teams"), JSON.stringify(league));
	}

async function load() {
  if (!leagueEditActive && !game) await refreshLeagueFromServer();
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
	if (activeAccess && !obj.rules) obj.rules = deepCloneJson(leagueSettings);
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
				const gamesInSeries = entry.gamesInSeries.slice(0, Number(entry.bestOf || 3)).map((slot, slotIndex) => ({
					gameNumber: Number(slot?.gameNumber || (slotIndex + 1)),
					result: slot?.result || null,
					skipped: slot?.skipped && typeof slot.skipped === "object" ? { ...slot.skipped } : null,
					subAssignments: Array.isArray(slot?.subAssignments) ? slot.subAssignments.map(a => ({ ...a })) : []
				}));

				while (gamesInSeries.length < Number(entry.bestOf || 3)) {
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

			const migrated = createSeriesEntry(away, home, seriesNumber, 3);
			delete migrated.bestOf; // Keep legacy schedule completion semantics.
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
