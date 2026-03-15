// Wiffle Ball League - Core app logic
// Split from the current source-of-truth app.js. Load this BEFORE app.game.js.

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

let syncConflictState = null;
let syncConflictAlertShown = false;
let syncState = {
	tabId: APP_TAB_ID,
	serverUpdatedAt: null,
	serverSeasonRevision: 0,
	serverScheduleRevision: 0
};

function readJsonStorage(key, fallback = null) {
	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : fallback;
	} catch (e) {
		return fallback;
	}
}

function getSeasonRevisionFrom(obj = season) {
	return Math.max(0, Number(obj?._meta?.revision || 0) || 0);
}

function getScheduleRevisionFrom(obj = schedule) {
	return Math.max(0, Number(obj?._meta?.revision || 0) || 0);
}

function normalizeSnapshotMeta(target, kind) {
	if (!target || typeof target !== "object") return target;
	target._meta = target._meta || {};
	const currentRevision = Number(target._meta.revision || 0);
	target._meta.revision = Number.isFinite(currentRevision) && currentRevision > 0 ? Math.floor(currentRevision) : 0;
	if (!target._meta.updated_at && kind !== "server") {
		target._meta.updated_at = new Date().toISOString();
	}
	return target;
}

function readLocalSyncHead() {
	const head = readJsonStorage(SYNC_HEAD_KEY, null);
	if (!head || typeof head !== "object") return null;
	return {
		leagueCode: String(head.leagueCode || "").trim(),
		seasonRevision: Math.max(0, Number(head.seasonRevision || 0) || 0),
		scheduleRevision: Math.max(0, Number(head.scheduleRevision || 0) || 0),
		serverUpdatedAt: head.serverUpdatedAt || null,
		serverSeasonRevision: Math.max(0, Number(head.serverSeasonRevision || 0) || 0),
		serverScheduleRevision: Math.max(0, Number(head.serverScheduleRevision || 0) || 0),
		lastWriterTabId: head.lastWriterTabId || null,
		lastWriterAt: head.lastWriterAt || null
	};
}

function syncStateFromHead() {
	const head = readLocalSyncHead();
	if (!head) return;
	if (head.serverUpdatedAt) syncState.serverUpdatedAt = head.serverUpdatedAt;
	syncState.serverSeasonRevision = Math.max(syncState.serverSeasonRevision || 0, head.serverSeasonRevision || 0);
	syncState.serverScheduleRevision = Math.max(syncState.serverScheduleRevision || 0, head.serverScheduleRevision || 0);
}

function writeLocalSyncHead(extra = {}) {
	const nextHead = {
		leagueCode: String(typeof LEAGUE_CODE !== "undefined" ? LEAGUE_CODE : "").trim(),
		seasonRevision: getSeasonRevisionFrom(season),
		scheduleRevision: getScheduleRevisionFrom(schedule),
		serverUpdatedAt: syncState.serverUpdatedAt || null,
		serverSeasonRevision: Math.max(0, Number(syncState.serverSeasonRevision || 0) || 0),
		serverScheduleRevision: Math.max(0, Number(syncState.serverScheduleRevision || 0) || 0),
		lastWriterTabId: APP_TAB_ID,
		lastWriterAt: new Date().toISOString(),
		...extra
	};
	try { localStorage.setItem(SYNC_HEAD_KEY, JSON.stringify(nextHead)); } catch (e) {}
	return nextHead;
}

function hasUnsyncedLocalChanges() {
	return getSeasonRevisionFrom(season) > (syncState.serverSeasonRevision || 0)
		|| getScheduleRevisionFrom(schedule) > (syncState.serverScheduleRevision || 0);
}

function clearSyncConflictState() {
	syncConflictState = null;
	if (autoSyncEnabled || postUnlockSetupPromise) setSyncButtonEnabled(true);
}

function refreshAfterSnapshotChange() {
	try { update(); } catch (e) {}
	try { if (!document.getElementById("seasonStatsScreen")?.classList.contains("hidden")) displaySeasonStats(); } catch (e) {}
	try { if (!document.getElementById("scheduleScreen")?.classList.contains("hidden")) renderScheduleUI(); } catch (e) {}
	try {
		if (!document.getElementById("gameSetupScreen")?.classList.contains("hidden")) {
			const info = ensureScheduleUpToDateForSelection();
			if (info.ok) populateScheduleDaySelect();
			else updateGameSetupSelects();
			refreshGameLockUI();
		}
	} catch (e) {}
}

async function resolveSyncConflictByReloadingLatest({ quiet = false } = {}) {
	const localSeason = ensureSeasonShape(readJsonStorage(SEASON_STORAGE_KEY, season));
	const localSchedule = ensureScheduleShape(readJsonStorage(SCHEDULE_STORAGE_KEY, schedule));
	normalizeSnapshotMeta(localSeason, "season");
	normalizeSnapshotMeta(localSchedule, "schedule");
	const head = readLocalSyncHead();

	let row = null;
	try {
		if (typeof supabaseClient !== "undefined" && supabaseClient && !isPublicViewOnlyMode()) {
			row = await fetchSeasonRowFromServer({ quiet: true });
		}
	} catch (e) {}

	let shouldUseServer = false;
	if (row) {
		const rowSeason = ensureSeasonShape(deepCloneJson(row.season_json));
		const rowSchedule = ensureScheduleShape(deepCloneJson(row.schedule_json));
		normalizeSnapshotMeta(rowSeason, "season");
		normalizeSnapshotMeta(rowSchedule, "schedule");

		const rowSeasonRev = getSeasonRevisionFrom(rowSeason);
		const rowScheduleRev = getScheduleRevisionFrom(rowSchedule);
		const headSeasonRev = Math.max(getSeasonRevisionFrom(localSeason), Number(head?.serverSeasonRevision || 0) || 0);
		const headScheduleRev = Math.max(getScheduleRevisionFrom(localSchedule), Number(head?.serverScheduleRevision || 0) || 0);
		const rowMs = Date.parse(row.updated_at || "") || 0;
		const headMs = Date.parse(head?.serverUpdatedAt || "") || 0;

		shouldUseServer = rowMs > headMs || rowSeasonRev > headSeasonRev || rowScheduleRev > headScheduleRev;
	}

	if (shouldUseServer && row) {
		applyServerSeasonRow(row, { force: true, source: "conflict-recovery" });
		clearSyncConflictState();
		if (!quiet) showNotification("⬇️ Loaded latest data after conflict", 1800);
		return true;
	}

	suppressAutoSync = true;
	season = ensureSeasonShape(localSeason);
	schedule = ensureScheduleShape(localSchedule);
	suppressAutoSync = false;

	syncState.serverUpdatedAt = head?.serverUpdatedAt || syncState.serverUpdatedAt || null;
	syncState.serverSeasonRevision = Math.max(0, Number(head?.serverSeasonRevision || 0) || 0);
	syncState.serverScheduleRevision = Math.max(0, Number(head?.serverScheduleRevision || 0) || 0);

	persistActiveGameLock(readJsonStorage(ACTIVE_GAME_LOCK_KEY, activeGameLock) || null);
	clearSyncConflictState();
	refreshAfterSnapshotChange();

	if (!quiet) showNotification("↺ Reloaded latest local snapshot", 1800);
	return true;
}

function scheduleConflictNotice(reason, detail = {}) {
	if (!syncConflictState) {
		syncConflictState = {
			reason,
			detail,
			detectedAt: new Date().toISOString(),
			tabId: APP_TAB_ID
		};
	}

	if (serverSyncTimer) {
		clearTimeout(serverSyncTimer);
		serverSyncTimer = null;
	}
	setSyncButtonEnabled(false);
	if (syncConflictAlertShown) return false;

	syncConflictAlertShown = true;
	setTimeout(async () => {
		try {
			const shouldRecover = confirm(
				"Data conflict detected.\n\n" +
				reason + "\n\n" +
				"This tab is blocked from saving so it cannot overwrite newer data.\n\n" +
				"Press OK to load the latest saved data now. Press Cancel to keep viewing this stale tab without saving."
			);
			if (shouldRecover) await resolveSyncConflictByReloadingLatest({ quiet: false });
		} catch (e) {
			console.warn("conflict recovery prompt failed:", e);
		} finally {
			syncConflictAlertShown = false;
		}
	}, 0);

	return false;
}

function assertCanWriteLocalSnapshot(kind) {
	syncStateFromHead();
	if (syncConflictState) return false;

	const head = readLocalSyncHead();
	if (!head) return true;

	const staleSeason = head.lastWriterTabId !== APP_TAB_ID && head.seasonRevision > getSeasonRevisionFrom(season);
	const staleSchedule = head.lastWriterTabId !== APP_TAB_ID && head.scheduleRevision > getScheduleRevisionFrom(schedule);

	if ((kind === "season" && staleSeason) || (kind === "schedule" && staleSchedule)) {
		return scheduleConflictNotice("Another browser tab on this device already saved newer season data.", { kind, head });
	}

	return true;
}

function adoptServerSyncBaseline(row) {
	if (!row) return;

	const rowSeason = ensureSeasonShape(deepCloneJson(row.season_json));
	const rowSchedule = ensureScheduleShape(deepCloneJson(row.schedule_json));
	normalizeSnapshotMeta(rowSeason, "season");
	normalizeSnapshotMeta(rowSchedule, "schedule");

	syncState.serverUpdatedAt = row.updated_at || syncState.serverUpdatedAt || null;
	syncState.serverSeasonRevision = getSeasonRevisionFrom(rowSeason);
	syncState.serverScheduleRevision = getScheduleRevisionFrom(rowSchedule);

	writeLocalSyncHead({
		serverUpdatedAt: syncState.serverUpdatedAt,
		serverSeasonRevision: syncState.serverSeasonRevision,
		serverScheduleRevision: syncState.serverScheduleRevision
	});

	clearSyncConflictState();
}

function getRowRevisionInfo(row) {
	const rowSeason = ensureSeasonShape(deepCloneJson(row?.season_json));
	const rowSchedule = ensureScheduleShape(deepCloneJson(row?.schedule_json));
	normalizeSnapshotMeta(rowSeason, "season");
	normalizeSnapshotMeta(rowSchedule, "schedule");

	return {
		seasonJson: rowSeason,
		scheduleJson: rowSchedule,
		seasonRevision: getSeasonRevisionFrom(rowSeason),
		scheduleRevision: getScheduleRevisionFrom(rowSchedule),
		updatedAt: row?.updated_at || null
	};
}

window.addEventListener("storage", (event) => {
	if (event.key === ACTIVE_GAME_LOCK_KEY) {
		try {
			activeGameLock = event.newValue ? JSON.parse(event.newValue) : null;
		} catch (e) {
			activeGameLock = null;
		}
		try { refreshGameLockUI(); } catch (e) {}
		return;
	}

	if (event.key !== SYNC_HEAD_KEY || !event.newValue) return;

	let head = null;
	try { head = JSON.parse(event.newValue); } catch (e) { head = null; }
	if (!head || head.lastWriterTabId === APP_TAB_ID) return;

	if (Number(head.serverSeasonRevision || 0) > (syncState.serverSeasonRevision || 0)) {
		syncState.serverSeasonRevision = Number(head.serverSeasonRevision || 0) || 0;
	}
	if (Number(head.serverScheduleRevision || 0) > (syncState.serverScheduleRevision || 0)) {
		syncState.serverScheduleRevision = Number(head.serverScheduleRevision || 0) || 0;
	}
	if (head.serverUpdatedAt) syncState.serverUpdatedAt = head.serverUpdatedAt;

	if (
		Number(head.seasonRevision || 0) > getSeasonRevisionFrom(season) ||
		Number(head.scheduleRevision || 0) > getScheduleRevisionFrom(schedule)
	) {
		scheduleConflictNotice("Another tab on this browser saved newer data than the copy open in this tab.", { source: "storage", head });
	}
});

syncStateFromHead();
try {
	activeGameLock = JSON.parse(localStorage.getItem(ACTIVE_GAME_LOCK_KEY) || "null");
} catch (e) {
	activeGameLock = null;
}

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

async function refreshPublicViewData({ quiet = true } = {}) {
	const row = await fetchSeasonRowFromServer({ quiet, publicView: true });
	if (row) applyServerSeasonRow(row, { force: true, source: "public-view" });
	return row;
}

	/* ================================
	✅ SCHEDULE DATA (persisted)
	==================================*/
	let schedule = { days: [], teamNames: [] };
	
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

function getScheduleConfigForTeamCount(teamCount) {
	if (Number(teamCount) === 4) {
		return {
			id: SCHEDULE_FORMAT_DOUBLE_ROUND_ROBIN_4,
			teamCount: 4,
			totalDays: 6,
			seriesPerDay: 2,
			description: "6 game days • 4 teams • everyone plays each other twice"
		};
	}

	if (Number(teamCount) === 5) {
		return {
			id: SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5,
			teamCount: 5,
			totalDays: 5,
			seriesPerDay: 2,
			description: "5 game days • 5 teams • everyone plays each other once • 1 bye each day"
		};
	}

	return null;
}

function getScheduleConfigForTeams(teamsOrNames) {
	const count = Array.isArray(teamsOrNames) ? teamsOrNames.length : Number(teamsOrNames || 0);
	return getScheduleConfigForTeamCount(count);
}

function normalizeMatchupKey(teamA, teamB) {
	return [teamA, teamB].map(v => String(v || "").trim()).sort().join("||");
}

function createSeriesGameSlot(gameNumber, result = null) {
	return { gameNumber, result, subAssignments: [] };
}

function createSeriesEntry(away, home, seriesNumber) {
	return {
		gameNumber: seriesNumber, // keeps the schedule screen looking the same
		away,
		home,
		gamesInSeries: [
			createSeriesGameSlot(1),
			createSeriesGameSlot(2),
			createSeriesGameSlot(3)
		],
		subAssignments: [],
		result: null // final series result only
	};
}

function createDayEntryFromLayout(layout, dayNumber) {
	return {
		day: dayNumber,
		byeTeam: layout?.byeTeam || "",
		games: (layout?.pairings || []).map((pairing, idx) =>
			createSeriesEntry(pairing[0], pairing[1], idx + 1)
		)
	};
}

function countCompletedSeriesGames(seriesEntry) {
	return (seriesEntry?.gamesInSeries || []).filter(g => g?.result).length;
}

function computeSeriesResult(seriesEntry) {
	if (!seriesEntry || !Array.isArray(seriesEntry.gamesInSeries)) return null;

	const playedGames = seriesEntry.gamesInSeries.filter(g => g && g.result);
	if (playedGames.length < 3) return null;

	let awayWins = 0;
	let homeWins = 0;
	let tieGames = 0;

	playedGames.forEach(g => {
		const r = g.result;
		if (!r) return;

		if (r.type === "tie") {
			tieGames += 1;
			return;
		}

		if (r.winner === seriesEntry.away) awayWins += 1;
		if (r.winner === seriesEntry.home) homeWins += 1;
	});

	if (awayWins === homeWins) {
		return {
			type: "tie",
			away: seriesEntry.away,
			home: seriesEntry.home,
			awayWins,
			homeWins,
			tieGames,
			playedAt: Date.now()
		};
	}

	const winner = awayWins > homeWins ? seriesEntry.away : seriesEntry.home;
	const loser = winner === seriesEntry.away ? seriesEntry.home : seriesEntry.away;

	return {
		type: "win",
		winner,
		loser,
		winnerGames: Math.max(awayWins, homeWins),
		loserGames: Math.min(awayWins, homeWins),
		tieGames,
		playedAt: Date.now()
	};
}

function getDayTeamNames(dayObj) {
	return Array.from(new Set((dayObj?.games || []).flatMap(seriesEntry => [seriesEntry?.away, seriesEntry?.home]).filter(Boolean)));
}

function getByeTeamForDay(dayObj, teamNames = schedule?.teamNames || []) {
	if (dayObj?.byeTeam && teamNames.includes(dayObj.byeTeam)) return dayObj.byeTeam;
	const usedTeams = new Set(getDayTeamNames(dayObj));
	return (teamNames || []).find(teamName => !usedTeams.has(teamName)) || "";
}

function getSeriesMatchupKey(seriesEntry) {
	return normalizeMatchupKey(seriesEntry?.away || "", seriesEntry?.home || "");
}

function getScheduleMatchupKeys(scheduleObj, { endBeforeDayIndex = null } = {}) {
	const keys = [];
	(scheduleObj?.days || []).forEach((dayObj, dayIndex) => {
		if (Number.isInteger(endBeforeDayIndex) && dayIndex >= endBeforeDayIndex) return;
		(dayObj?.games || []).forEach(seriesEntry => {
			const key = getSeriesMatchupKey(seriesEntry);
			if (key) keys.push(key);
		});
	});
	return keys;
}

function getFiveTeamDayLayouts(teamNames) {
	if (!Array.isArray(teamNames) || teamNames.length !== 5) return [];

	const layouts = [];

	teamNames.forEach(byeTeam => {
		const remaining = teamNames.filter(teamName => teamName !== byeTeam);
		const [a, b, c, d] = remaining;
		const pairingSets = [
			[[a, b], [c, d]],
			[[a, c], [b, d]],
			[[a, d], [b, c]]
		];

		pairingSets.forEach(pairings => {
			const matchupKeys = pairings.map(pairing => normalizeMatchupKey(pairing[0], pairing[1])).sort();
			layouts.push({
				byeTeam,
				pairings,
				matchupKeys,
				key: `${byeTeam}__${matchupKeys.join("__")}`,
				label: `Bye: ${byeTeam} — ${pairings[0][0]} vs ${pairings[0][1]} • ${pairings[1][0]} vs ${pairings[1][1]}`
			});
		});
	});

	return layouts;
}

function buildFiveTeamSchedulePlan(teamNames, usedBefore = new Set(), daysNeeded = 5, { firstLayoutKey = "", preferredLayoutKeys = [] } = {}) {
	const layouts = getFiveTeamDayLayouts(teamNames);
	if (!layouts.length) return null;

	const used = new Set(Array.from(usedBefore || []));

	function backtrack(dayOffset) {
		if (dayOffset >= daysNeeded) return [];

		let candidates = layouts.filter(layout => layout.matchupKeys.every(key => !used.has(key)));
		if (dayOffset === 0 && firstLayoutKey) {
			candidates = candidates.filter(layout => layout.key === firstLayoutKey);
		}
		if (!candidates.length) return null;

		const preferredKey = preferredLayoutKeys[dayOffset] || "";
		const shuffled = shuffleArray(candidates.slice());
		shuffled.sort((a, b) => {
			const aPreferred = preferredKey && a.key === preferredKey ? 1 : 0;
			const bPreferred = preferredKey && b.key === preferredKey ? 1 : 0;
			return bPreferred - aPreferred;
		});

		for (const layout of shuffled) {
			layout.matchupKeys.forEach(key => used.add(key));
			const rest = backtrack(dayOffset + 1);
			if (rest) return [layout, ...rest];
			layout.matchupKeys.forEach(key => used.delete(key));
		}

		return null;
	}

	return backtrack(0);
}

function getFiveTeamLayoutKeyForDay(dayObj, teamNames = schedule?.teamNames || []) {
	const byeTeam = getByeTeamForDay(dayObj, teamNames);
	const matchupKeys = (dayObj?.games || []).map(getSeriesMatchupKey).filter(Boolean).sort();
	return `${byeTeam}__${matchupKeys.join("__")}`;
}

function canEditFiveTeamScheduleFromDay(dayIndex) {
	if (!Number.isInteger(dayIndex)) return false;
	return !(schedule?.days || []).slice(dayIndex).some(dayObj =>
		(dayObj?.games || []).some(seriesEntry =>
			(seriesEntry?.gamesInSeries || []).some(seriesGame => !!seriesGame?.result)
		)
	);
}

function getEditableFiveTeamDayOptions(dayIndex) {
	const teamNames = Array.isArray(schedule?.teamNames) ? schedule.teamNames.filter(Boolean) : [];
	if (teamNames.length !== 5) return [];
	if (!canEditFiveTeamScheduleFromDay(dayIndex)) return [];

	const usedBefore = new Set(getScheduleMatchupKeys(schedule, { endBeforeDayIndex: dayIndex }));
	const preferredLayoutKeys = (schedule?.days || []).slice(dayIndex).map(dayObj => getFiveTeamLayoutKeyForDay(dayObj, teamNames));
	const remainingDayCount = (schedule?.days || []).length - dayIndex;

	return getFiveTeamDayLayouts(teamNames)
		.map(layout => {
			const plan = buildFiveTeamSchedulePlan(teamNames, usedBefore, remainingDayCount, {
				firstLayoutKey: layout.key,
				preferredLayoutKeys
			});
			if (!plan) return null;
			return { ...layout, plan };
		})
		.filter(Boolean)
		.sort((a, b) => a.label.localeCompare(b.label));
}

function getAllowedByeTeamsForFiveTeamDay(dayIndex) {
	return Array.from(new Set(
		getEditableFiveTeamDayOptions(dayIndex).map(option => option?.byeTeam).filter(Boolean)
	)).sort();
}

function getBestFiveTeamByeEditOption(dayIndex, byeTeam) {
	const currentDay = schedule?.days?.[dayIndex];
	const currentMatchupKeys = (currentDay?.games || []).map(getSeriesMatchupKey).filter(Boolean).sort();
	const currentByeTeam = getByeTeamForDay(currentDay, schedule?.teamNames || []);

	const candidates = getEditableFiveTeamDayOptions(dayIndex)
		.filter(option => option?.byeTeam === byeTeam)
		.sort((a, b) => {
			const aCurrentByeScore = a.byeTeam === currentByeTeam ? 1 : 0;
			const bCurrentByeScore = b.byeTeam === currentByeTeam ? 1 : 0;
			if (bCurrentByeScore !== aCurrentByeScore) return bCurrentByeScore - aCurrentByeScore;

			const aKeys = (a?.matchupKeys || []).slice().sort();
			const bKeys = (b?.matchupKeys || []).slice().sort();
			const aMatchScore = aKeys.filter(key => currentMatchupKeys.includes(key)).length;
			const bMatchScore = bKeys.filter(key => currentMatchupKeys.includes(key)).length;
			if (bMatchScore !== aMatchScore) return bMatchScore - aMatchScore;

			return a.label.localeCompare(b.label);
		});

	return candidates[0] || null;
}

function rebuildFiveTeamScheduleFromDay(dayIndex, rebuiltPlan, teamNames) {
	const newDays = (schedule.days || []).slice(0, dayIndex).map((dayObj, idx) => ({
		...dayObj,
		day: Number(dayObj?.day || (idx + 1)),
		byeTeam: getByeTeamForDay(dayObj, teamNames)
	}));

	rebuiltPlan.forEach((layout, offset) => {
		const originalDay = schedule.days?.[dayIndex + offset] || {};
		newDays.push(createDayEntryFromLayout(layout, Number(originalDay?.day || (dayIndex + offset + 1))));
	});

	schedule = ensureScheduleShape({
		...schedule,
		format: SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5,
		teamNames,
		days: newDays
	});
}

function refreshChangeScheduleControls() {
	const panel = document.getElementById("changeSchedulePanel");
	if (!panel) return;

	const daySelect = document.getElementById("changeScheduleDaySelect");
	const byeSelect = document.getElementById("changeScheduleByeSelect");
	const status = document.getElementById("changeScheduleStatus");
	const applyBtn = document.getElementById("applyScheduleChangeBtn");
	if (!daySelect || !byeSelect || !status || !applyBtn) return;

	const teamNames = Array.isArray(schedule?.teamNames) ? schedule.teamNames.filter(Boolean) : [];
	const config = getScheduleConfigForTeams(teamNames);
	if (!config || config.id !== SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5 || !hasFullAppAccess()) {
		panel.classList.add("hidden");
		return;
	}
	panel.classList.remove("hidden");

	const editableDayIndexes = (schedule.days || [])
		.map((dayObj, idx) => canEditFiveTeamScheduleFromDay(idx) ? idx : null)
		.filter(idx => Number.isInteger(idx));

	if (!editableDayIndexes.length) {
		daySelect.innerHTML = `<option value="">No editable days</option>`;
		byeSelect.innerHTML = `<option value="">Bye Team Locked</option>`;
		status.innerText = "Schedule changes lock once the selected day or later days already have recorded games.";
		applyBtn.disabled = true;
		return;
	}

	const previousDayValue = daySelect.value;
	daySelect.innerHTML = editableDayIndexes.map(dayIndex => {
		const dayNumber = Number(schedule?.days?.[dayIndex]?.day || (dayIndex + 1));
		return `<option value="${dayIndex}">Day ${dayNumber}</option>`;
	}).join("");
	daySelect.value = editableDayIndexes.includes(Number(previousDayValue)) ? previousDayValue : String(editableDayIndexes[0]);

	const dayIndex = Number(daySelect.value);
	const dayObj = schedule?.days?.[dayIndex];
	const currentByeTeam = getByeTeamForDay(dayObj, teamNames);
	const allowedByeTeams = getAllowedByeTeamsForFiveTeamDay(dayIndex);
	const previousByeValue = byeSelect.value;

	byeSelect.innerHTML = allowedByeTeams.map(teamName => `<option value="${teamName}">${teamName}</option>`).join("");
	byeSelect.value = allowedByeTeams.includes(previousByeValue) ? previousByeValue : (allowedByeTeams.includes(currentByeTeam) ? currentByeTeam : (allowedByeTeams[0] || ""));

	const selectedOption = getBestFiveTeamByeEditOption(dayIndex, byeSelect.value);
	if (selectedOption) {
		const pairingsText = (selectedOption.pairings || []).map((pair, idx) => `Series ${idx + 1}: ${pair[0]} vs ${pair[1]}`).join(" • ");
		status.innerText = `Day ${Number(dayObj?.day || (dayIndex + 1))} bye: ${selectedOption.byeTeam}. ${pairingsText}. Later unplayed days will auto-adjust only if needed to keep the round robin valid.`;
	} else {
		status.innerText = "That bye team is not valid for this round robin setup.";
	}
	applyBtn.disabled = !selectedOption;
}

function applySelectedScheduleChange() {
	const config = getScheduleConfigForTeams(schedule?.teamNames || []);
	if (!config || config.id !== SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5) {
		alert("Schedule editing is only available for the 5-team single round robin schedule.");
		return;
	}

	const dayIndex = Number(document.getElementById("changeScheduleDaySelect")?.value);
	const byeTeam = document.getElementById("changeScheduleByeSelect")?.value || "";

	if (!Number.isInteger(dayIndex)) {
		alert("Pick a valid day first.");
		return;
	}
	if (!byeTeam) {
		alert("Pick a valid bye team.");
		return;
	}
	if (!canEditFiveTeamScheduleFromDay(dayIndex)) {
		alert("You can only change a day when that day and all later days are still unplayed.");
		return;
	}

	const selectedOption = getBestFiveTeamByeEditOption(dayIndex, byeTeam);
	if (!selectedOption) {
		alert("That bye team is not valid. Choose a different team.");
		return;
	}

	const teamNames = schedule.teamNames.slice();
	rebuildFiveTeamScheduleFromDay(dayIndex, selectedOption.plan, teamNames);
	saveSchedule();
	renderScheduleUI();
	showNotification(`✅ Day ${Number(schedule.days?.[dayIndex]?.day || (dayIndex + 1))} bye updated to ${byeTeam}`, 1600);
}

function applyFiveTeamDayEdit(dayIndex) {
	const config = getScheduleConfigForTeams(schedule?.teamNames || []);
	if (!config || config.id !== SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5) {
		alert("Day editing is only available for the 5-team single round robin schedule.");
		return;
	}

	if (!canEditFiveTeamScheduleFromDay(dayIndex)) {
		alert("You can only edit a day before that day and the days after it have any recorded games.");
		return;
	}

	const select = document.getElementById(`dayEditSelect-${dayIndex}`);
	const selectedLayoutKey = select?.value || "";
	if (!selectedLayoutKey) {
		alert("Pick a valid day layout first.");
		return;
	}

	const teamNames = schedule.teamNames.slice();
	const usedBefore = new Set(getScheduleMatchupKeys(schedule, { endBeforeDayIndex: dayIndex }));
	const preferredLayoutKeys = (schedule?.days || []).slice(dayIndex).map(dayObj => getFiveTeamLayoutKeyForDay(dayObj, teamNames));
	const remainingDayCount = (schedule?.days || []).length - dayIndex;
	const rebuiltPlan = buildFiveTeamSchedulePlan(teamNames, usedBefore, remainingDayCount, {
		firstLayoutKey: selectedLayoutKey,
		preferredLayoutKeys
	});

	if (!rebuiltPlan) {
		alert("That change would break the round robin. Pick a different option.");
		return;
	}

	rebuildFiveTeamScheduleFromDay(dayIndex, rebuiltPlan, teamNames);
	saveSchedule();
	renderScheduleUI();
	showNotification(`✅ Day ${Number(schedule.days?.[dayIndex]?.day || (dayIndex + 1))} updated`, 1600);
}

function validateDoubleRoundRobin4(scheduleObj, teamNames) {
	const matchupCounts = {};
	const appearanceCounts = Object.fromEntries(teamNames.map(teamName => [teamName, 0]));

	for (const dayObj of (scheduleObj?.days || [])) {
		if (!Array.isArray(dayObj?.games) || dayObj.games.length !== 2) return false;
		const dayTeams = getDayTeamNames(dayObj);
		if (dayTeams.length !== 4) return false;
		for (const seriesEntry of dayObj.games) {
			if (!Array.isArray(seriesEntry?.gamesInSeries) || seriesEntry.gamesInSeries.length !== 3) return false;
			if (!teamNames.includes(seriesEntry.away) || !teamNames.includes(seriesEntry.home)) return false;
			if (seriesEntry.away === seriesEntry.home) return false;
			const key = normalizeMatchupKey(seriesEntry.away, seriesEntry.home);
			matchupCounts[key] = (matchupCounts[key] || 0) + 1;
			appearanceCounts[seriesEntry.away] += 1;
			appearanceCounts[seriesEntry.home] += 1;
		}
	}

	const expectedPairCount = (teamNames.length * (teamNames.length - 1)) / 2;
	if (Object.keys(matchupCounts).length !== expectedPairCount) return false;
	if (Object.values(matchupCounts).some(count => count !== 2)) return false;
	if (Object.values(appearanceCounts).some(count => count !== 6)) return false;
	return true;
}

function validateSingleRoundRobin5(scheduleObj, teamNames) {
	const matchupCounts = {};
	const appearanceCounts = Object.fromEntries(teamNames.map(teamName => [teamName, 0]));
	const byeCounts = Object.fromEntries(teamNames.map(teamName => [teamName, 0]));

	for (const dayObj of (scheduleObj?.days || [])) {
		if (!Array.isArray(dayObj?.games) || dayObj.games.length !== 2) return false;
		const dayTeams = getDayTeamNames(dayObj);
		if (dayTeams.length !== 4) return false;
		const byeTeam = getByeTeamForDay(dayObj, teamNames);
		if (!byeTeam) return false;
		if (dayTeams.includes(byeTeam)) return false;
		byeCounts[byeTeam] += 1;

		for (const seriesEntry of dayObj.games) {
			if (!Array.isArray(seriesEntry?.gamesInSeries) || seriesEntry.gamesInSeries.length !== 3) return false;
			if (!teamNames.includes(seriesEntry.away) || !teamNames.includes(seriesEntry.home)) return false;
			if (seriesEntry.away === seriesEntry.home) return false;
			const key = normalizeMatchupKey(seriesEntry.away, seriesEntry.home);
			matchupCounts[key] = (matchupCounts[key] || 0) + 1;
			appearanceCounts[seriesEntry.away] += 1;
			appearanceCounts[seriesEntry.home] += 1;
		}
	}

	const expectedPairCount = (teamNames.length * (teamNames.length - 1)) / 2;
	if (Object.keys(matchupCounts).length !== expectedPairCount) return false;
	if (Object.values(matchupCounts).some(count => count !== 1)) return false;
	if (Object.values(appearanceCounts).some(count => count !== 4)) return false;
	if (Object.values(byeCounts).some(count => count !== 1)) return false;
	return true;
}

function isScheduleCurrentFormat(scheduleObj, teamNames) {
	if (!Array.isArray(teamNames) || !teamNames.length) return false;
	const config = getScheduleConfigForTeams(teamNames);
	if (!config) return false;
	if (!scheduleObj?.days?.length) return false;
	if (scheduleObj.days.length !== config.totalDays) return false;

	const scheduleNames = (scheduleObj?.teamNames || []).slice().sort();
	const normalizedTeamNames = teamNames.slice().sort();
	if (scheduleNames.join("|") !== normalizedTeamNames.join("|")) return false;

	if (config.id === SCHEDULE_FORMAT_DOUBLE_ROUND_ROBIN_4) {
		return validateDoubleRoundRobin4(scheduleObj, normalizedTeamNames);
	}

	if (config.id === SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5) {
		return validateSingleRoundRobin5(scheduleObj, normalizedTeamNames);
	}

	return false;
}

function generateBalancedSchedule4(teams) {
	const names = teams.map(t => t.name);

	// randomize initial order
	shuffleArray(names);

	let a = names[0], b = names[1], c = names[2], d = names[3];

	const rounds = [
		[[a, d], [b, c]],
		[[a, c], [d, b]],
		[[a, b], [c, d]]
	];

	// each pair gets a second series with flipped home/away
	const doubleRounds = [
		...rounds,
		...rounds.map(r => r.map(g => [g[1], g[0]]))
	];

	shuffleArray(doubleRounds);

	return ensureScheduleShape({
		format: SCHEDULE_FORMAT_DOUBLE_ROUND_ROBIN_4,
		teamNames: teams.map(t => t.name),
		days: doubleRounds.map((seriesList, i) => ({
			day: i + 1,
			games: seriesList.map((seriesTeams, idx) =>
				createSeriesEntry(seriesTeams[0], seriesTeams[1], idx + 1)
			)
		}))
	});
}

function generateSingleRoundRobinSchedule5(teams) {
	const teamNames = teams.map(t => t.name);
	const plan = buildFiveTeamSchedulePlan(teamNames, new Set(), 5);
	if (!plan) throw new Error("Could not build a valid 5-team single round robin schedule.");

	return ensureScheduleShape({
		format: SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5,
		teamNames: teamNames.slice(),
		days: plan.map((layout, i) => createDayEntryFromLayout(layout, i + 1))
	});
}

function generateScheduleForTeams(validTeams) {
	const config = getScheduleConfigForTeams(validTeams);
	if (!config) return null;
	if (config.id === SCHEDULE_FORMAT_DOUBLE_ROUND_ROBIN_4) return generateBalancedSchedule4(validTeams);
	if (config.id === SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5) return generateSingleRoundRobinSchedule5(validTeams);
	return null;
}

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
    return;
  }

  league.teams = (teams || []).map(t => ({
    name: t.name,
    players: (t.players || []).map(p => p.name)
  }));
}

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

function ensureSeasonShape(obj) {
	if (!obj || typeof obj !== "object") {
		obj = { playerStats: {}, teamRecords: {}, seasonSubs: [], subStats: {}, games: [] };
	}
	if (!obj.playerStats) obj.playerStats = {};
	if (!obj.teamRecords) obj.teamRecords = {};
	if (!Array.isArray(obj.seasonSubs)) obj.seasonSubs = [];
	if (!obj.subStats || typeof obj.subStats !== "object") obj.subStats = {};
	if (!Array.isArray(obj.games)) obj.games = [];
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

			// already in new series format
			if (Array.isArray(entry?.gamesInSeries)) {
				
			const gamesInSeries = entry.gamesInSeries.slice(0, 3).map((slot, slotIndex) => ({
	gameNumber: Number(slot?.gameNumber || (slotIndex + 1)),
	result: slot?.result || null,
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

			// old format -> convert single game row into new series row
			const migrated = createSeriesEntry(away, home, seriesNumber);

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

function snapshotHasData(seasonObj, scheduleObj) {
  try {
    const ps = seasonObj?.playerStats || {};
    if (ps && Object.keys(ps).length) return true;

    const subStats = seasonObj?.subStats || {};
    if (subStats && Object.keys(subStats).length) return true;

    if (Array.isArray(seasonObj?.seasonSubs) && seasonObj.seasonSubs.length) return true;
  } catch (e) {}

  try {
    const days = scheduleObj?.days || [];
    for (const d of days) {
      for (const seriesEntry of (d.games || [])) {
        if (seriesEntry && seriesEntry.result) return true;
        if (Array.isArray(seriesEntry?.subAssignments) && seriesEntry.subAssignments.length) return true;

        for (const sg of (seriesEntry?.gamesInSeries || [])) {
          if (sg && sg.result) return true;
          if (Array.isArray(sg?.subAssignments) && sg.subAssignments.length) return true;
        }
      }
    }
  } catch (e) {}

  return false;
}

function persistActiveGameLock(lockObj) {
	activeGameLock = lockObj || null;
	try {
		if (activeGameLock) localStorage.setItem(ACTIVE_GAME_LOCK_KEY, JSON.stringify(activeGameLock));
		else localStorage.removeItem(ACTIVE_GAME_LOCK_KEY);
	} catch (e) {}
	try { refreshGameLockUI(); } catch (e) {}
}

function getActiveGameLockLabel(lockObj = activeGameLock) {
	if (!lockObj) return "";
	if (lockObj.type === "scheduled") {
		const parts = [];
		if (Number.isInteger(lockObj.dayNumber)) parts.push(`Day ${lockObj.dayNumber}`);
		if (Number.isInteger(lockObj.seriesNumber)) parts.push(`Series ${lockObj.seriesNumber}`);
		if (Number.isInteger(lockObj.seriesGameNumber)) parts.push(`Game ${lockObj.seriesGameNumber}`);
		const slot = parts.join(" • ");
		const matchup = (lockObj.team1 && lockObj.team2) ? `${lockObj.team1} vs ${lockObj.team2}` : "Scheduled game";
		return slot ? `${slot} — ${matchup}` : matchup;
	}
	return (lockObj.team1 && lockObj.team2)
		? `Manual game — ${lockObj.team1} vs ${lockObj.team2}`
		: "Manual game in progress";
}

function refreshGameLockUI() {
	const notice = document.getElementById("gameSetupLockNotice");
	const manualBtn = document.getElementById("manualStartGameBtn");
	const scheduledBtn = document.getElementById("startScheduledGameBtn");
	const addSubBtn = document.getElementById("openSubAssignBtn");
	const lockedByAnotherGame = !!activeGameLock && (!game?._lockId || game._lockId !== activeGameLock.lockId);

	if (notice) {
		if (lockedByAnotherGame) {
			const startedBy = activeGameLock.startedByName ? ` by ${activeGameLock.startedByName}` : "";
			notice.innerText = `🔒 Game recording is locked${startedBy}. ${getActiveGameLockLabel(activeGameLock)} is currently in progress.`;
			notice.classList.remove("hidden");
		} else {
			notice.innerText = "";
			notice.classList.add("hidden");
		}
	}

	if (manualBtn) manualBtn.disabled = lockedByAnotherGame;
	if (scheduledBtn) scheduledBtn.disabled = lockedByAnotherGame || !!scheduledBtn.disabled;
	if (addSubBtn) addSubBtn.disabled = lockedByAnotherGame;
}

async function ensureSeasonRowExistsForLocking() {
	const { data } = await supabaseClient.auth.getSession();
	const userId = data?.session?.user?.id || null;
	const payload = {
		league_code: String(LEAGUE_CODE),
		season_json: season,
		schedule_json: schedule,
		updated_at: new Date().toISOString(),
		updated_by: userId,
		active_game_lock: null,
		active_game_lock_id: null
	};
	const { error } = await supabaseClient
		.from("season_data")
		.upsert(payload, { onConflict: "league_code", ignoreDuplicates: true });
	if (error) throw error;
}

async function acquireGameLock(lockDetails) {
	if (!(await requireLogin())) return { ok: false, reason: "login" };

	if (activeGameLock && (!game?._lockId || game._lockId !== activeGameLock.lockId)) {
		return { ok: false, reason: "locked", lock: activeGameLock };
	}

	const { data } = await supabaseClient.auth.getSession();
	const user = data?.session?.user || null;
	const lockId = `lock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	const lockPayload = {
		...lockDetails,
		lockId,
		startedAt: new Date().toISOString(),
		startedByName: getStoredName() || user?.email || "Unknown user",
		startedByUserId: user?.id || null
	};

	let row = null;
	for (let attempt = 0; attempt < 2; attempt++) {
		const { data: updatedRow, error } = await supabaseClient
			.from("season_data")
		.update({
	active_game_lock: lockPayload,
	active_game_lock_id: lockId,
	updated_by: user?.id || null
})
			.eq("league_code", String(LEAGUE_CODE))
			.is("active_game_lock_id", null)
			.select("season_json,schedule_json,updated_at,active_game_lock,active_game_lock_id")
			.maybeSingle();

		if (error) throw error;
		if (updatedRow) {
			row = updatedRow;
			break;
		}

		const latestRow = await fetchSeasonRowFromServer({ quiet: true });
		if (latestRow) {
			applyServerSeasonRow(latestRow);
			if (latestRow.active_game_lock) {
				return { ok: false, reason: "locked", lock: latestRow.active_game_lock, row: latestRow };
			}
		}

		await ensureSeasonRowExistsForLocking();
	}

	if (!row) {
		const latestRow = await fetchSeasonRowFromServer({ quiet: true });
		if (latestRow) applyServerSeasonRow(latestRow);
		return { ok: false, reason: "locked", lock: latestRow?.active_game_lock || activeGameLock, row: latestRow || null };
	}

	applyServerSeasonRow(row);
	return { ok: true, lock: row.active_game_lock || lockPayload, lockId, row };
}

async function releaseGameLock(lockId, { quiet = false } = {}) {
	if (!lockId) {
		persistActiveGameLock(null);
		return true;
	}

	if (!(await requireLogin())) return false;

	const { data } = await supabaseClient.auth.getSession();
	const userId = data?.session?.user?.id || null;
	const { error } = await supabaseClient
		.from("season_data")
		.update({
	active_game_lock: null,
	active_game_lock_id: null,
	updated_by: userId
})
		.eq("league_code", String(LEAGUE_CODE))
		.eq("active_game_lock_id", lockId);

	if (error) {
		if (!quiet) console.log("release game lock failed:", error);
		return false;
	}

	persistActiveGameLock(null);
	return true;
}

async function fetchSeasonRowFromServer({ quiet = true, publicView = false } = {}) {
	try {
		const tableName = publicView ? "season_data_public" : "season_data";
		const selectCols = publicView
			? "season_json,schedule_json,updated_at"
			: "season_json,schedule_json,updated_at,active_game_lock,active_game_lock_id";

		const { data, error } = await supabaseClient
			.from(tableName)
			.select(selectCols)
			.eq("league_code", String(LEAGUE_CODE))
			.maybeSingle();

		if (error) throw error;
		return data || null;
	} catch (e) {
		if (!quiet) console.log(`fetch ${publicView ? "season_data_public" : "season_data"} failed:`, e);
		return null;
	}
}

function applyServerSeasonRow(row, { force = false, source = "server" } = {}) {
	if (!row) return false;

	const info = getRowRevisionInfo(row);
	const localDirty = hasUnsyncedLocalChanges();
	const sameOrOlderData =
		info.seasonRevision <= (syncState.serverSeasonRevision || 0) &&
		info.scheduleRevision <= (syncState.serverScheduleRevision || 0);

	if (!force && localDirty && !sameOrOlderData) {
		persistActiveGameLock(row.active_game_lock || null);
		return scheduleConflictNotice(
			"A newer server snapshot was detected while this tab still had unsynced local changes.",
			{ source, row }
		);
	}

	suppressAutoSync = true;
	season = ensureSeasonShape(info.seasonJson);
	schedule = ensureScheduleShape(info.scheduleJson);
	persistActiveGameLock(row.active_game_lock || null);

	try {
		const serverIso = row.updated_at || new Date().toISOString();
		season._meta = season._meta || {};
		schedule._meta = schedule._meta || {};
		season._meta.updated_at = serverIso;
		schedule._meta.updated_at = serverIso;
	} catch (e) {}

	try { saveSeason({ skipServerSync: true, touchMeta: false, bumpRevision: false, allowConflictBypass: true }); } catch (e) {}
	try { saveSchedule({ skipServerSync: true, touchMeta: false, bumpRevision: false, allowConflictBypass: true }); } catch (e) {}

	suppressAutoSync = false;

	adoptServerSyncBaseline({
		season_json: season,
		schedule_json: schedule,
		updated_at: row.updated_at || null
	});

	refreshAfterSnapshotChange();
	return true;
}

async function hydrateFromServerIfNewer() {
	if (!(await requireLogin())) return;

	const row = await fetchSeasonRowFromServer({ quiet: true });
	if (!row) return;

	const previousToken = syncState.serverUpdatedAt || null;
	const applied = applyServerSeasonRow(row, { source: "hydrate" });

	if (applied && row.updated_at && row.updated_at !== previousToken) {
		showNotification("⬇️ Pulled latest stats from server", 1200);
	}
}

function queueServerSync(reason, { immediate = false } = {}) {
	if (!autoSyncEnabled) return;
	if (suppressAutoSync) return;
	if (syncConflictState) return;
	if (!isLeagueUnlocked() || !getStoredName()) return;

	if (serverSyncTimer) clearTimeout(serverSyncTimer);

	const run = async () => {
		serverSyncTimer = null;
		await syncSeasonToServer({ quiet: true });
	};

	if (immediate) run();
	else serverSyncTimer = setTimeout(run, 1400);
}

	async function ensurePostUnlockSetup() {
		if (postUnlockSetupPromise) return postUnlockSetupPromise;

		postUnlockSetupPromise = (async () => {
			setSyncButtonEnabled(false);

			// Best effort: pull down newer server snapshot before enabling autosync
			try { await hydrateFromServerIfNewer(); } catch (e) {}

			// Start realtime listeners
			try { await startRealtime(); } catch (e) {}

			autoSyncEnabled = true;
			setSyncButtonEnabled(true);
		})();

		return postUnlockSetupPromise;
	}

	function scheduleTeamsReload() {
		if (teamsReloadTimer) clearTimeout(teamsReloadTimer);
		teamsReloadTimer = setTimeout(async () => {
			teamsReloadTimer = null;
			try { await load(); } catch (e) {}
			try { syncTeamRecordsWithLeague(); } catch (e) {}
			try { update(); } catch (e) {}
		}, 400);
	}

	async function startRealtime() {
		if (realtimeChannel) return;

		// channel name must be unique-ish per league
		realtimeChannel = supabaseClient.channel("wbl-realtime-" + String(LEAGUE_CODE));

		// Teams + players updates
		realtimeChannel.on(
			"postgres_changes",
			{ event: "*", schema: "public", table: "teams" },
			() => scheduleTeamsReload()
		);

		realtimeChannel.on(
			"postgres_changes",
			{ event: "*", schema: "public", table: "players" },
			() => scheduleTeamsReload()
		);

		// Season snapshot updates (optional table)
		realtimeChannel.on(
			"postgres_changes",
			{ event: "*", schema: "public", table: "season_data", filter: "league_code=eq." + String(LEAGUE_CODE) },
			async (payload) => {
				// If deleted, clear locally too
				if (payload.eventType === "DELETE") {
				suppressAutoSync = true;
season = { playerStats: {}, teamRecords: {}, seasonSubs: [], subStats: {}, games: [] };
schedule = { days: [], teamNames: [] };
persistActiveGameLock(null);

try { localStorage.removeItem(SEASON_STORAGE_KEY); } catch (e) {}
try { localStorage.removeItem(SCHEDULE_STORAGE_KEY); } catch (e) {}
try { localStorage.removeItem(SYNC_HEAD_KEY); } catch (e) {}

clearSyncConflictState();
suppressAutoSync = false;

try { update(); } catch (e) {}
try { if (!document.getElementById("seasonStatsScreen").classList.contains("hidden")) displaySeasonStats(); } catch (e) {}
try { if (!document.getElementById("scheduleScreen").classList.contains("hidden")) renderScheduleUI(); } catch (e) {}
return;
				}

				// For insert/update, pull latest
				const row = await fetchSeasonRowFromServer({ quiet: true });
				if (row) applyServerSeasonRow(row, { source: "realtime" });
			}
		);

		await realtimeChannel.subscribe();
	}

	function stopRealtime() {
		try {
			if (realtimeChannel) realtimeChannel.unsubscribe();
		} catch (e) {}
		realtimeChannel = null;
		postUnlockSetupPromise = null;
		autoSyncEnabled = false;
	}


	/* ================================
	✅ SERVER BACKUP (manual + automatic)
	- Optional Supabase table: season_data
	  Columns (recommended):
	    league_code (text, PK or unique)
	    season_json (jsonb)
	    schedule_json (jsonb)
	    updated_at (timestamptz)
	    updated_by (uuid)
	==================================*/

async function syncSeasonToServer({ quiet = false } = {}) {
	if (syncConflictState) {
		if (!quiet) {
			alert("This tab is blocked from saving because newer data was detected elsewhere. Load the latest data first.");
		}
		return false;
	}

	try { saveSeason({ skipServerSync: true, touchMeta: false, bumpRevision: false }); } catch (e) {}
	try { saveSchedule({ skipServerSync: true, touchMeta: false, bumpRevision: false }); } catch (e) {}

	const ok = await requireLogin();
	if (!ok) return false;

	try {
		const { data } = await supabaseClient.auth.getSession();
		const userId = data?.session?.user?.id || null;

		const latestRow = await fetchSeasonRowFromServer({ quiet: true });
		const latestInfo = latestRow ? getRowRevisionInfo(latestRow) : null;

		const currentSeasonRev = getSeasonRevisionFrom(season);
		const currentScheduleRev = getScheduleRevisionFrom(schedule);

		if (latestInfo) {
			const serverMoved =
				!!syncState.serverUpdatedAt &&
				!!latestInfo.updatedAt &&
				latestInfo.updatedAt !== syncState.serverUpdatedAt;

			const serverNewer =
				latestInfo.seasonRevision > (syncState.serverSeasonRevision || 0) ||
				latestInfo.scheduleRevision > (syncState.serverScheduleRevision || 0);

			const localBehind =
				latestInfo.seasonRevision > currentSeasonRev ||
				latestInfo.scheduleRevision > currentScheduleRev;

			if ((serverMoved && serverNewer) || localBehind) {
				scheduleConflictNotice(
					"The server already has newer season data than this tab, so this save was stopped.",
					{ source: "server-preflight", row: latestRow }
				);
				return false;
			}
		}

		const payload = {
			league_code: String(LEAGUE_CODE),
			season_json: season,
			schedule_json: schedule,
			updated_at: new Date().toISOString(),
			updated_by: userId
		};

		let savedRow = null;

		if (latestRow) {
			let query = supabaseClient
				.from("season_data")
				.update(payload)
				.eq("league_code", String(LEAGUE_CODE));

			if (latestInfo?.updatedAt) {
				query = query.eq("updated_at", latestInfo.updatedAt);
			}

			const { data: updatedRow, error } = await query
				.select("season_json,schedule_json,updated_at,active_game_lock,active_game_lock_id")
				.maybeSingle();

			if (error) throw error;

			if (!updatedRow) {
				const rowAfterMiss = await fetchSeasonRowFromServer({ quiet: true });
				if (rowAfterMiss) applyServerSeasonRow(rowAfterMiss, { source: "sync-race" });

				scheduleConflictNotice(
					"A newer save reached the server before this tab finished syncing, so this write was cancelled.",
					{ source: "server-race" }
				);
				return false;
			}

			savedRow = updatedRow;
		} else {
			const { data: insertedRow, error } = await supabaseClient
				.from("season_data")
				.upsert(payload, { onConflict: "league_code" })
				.select("season_json,schedule_json,updated_at,active_game_lock,active_game_lock_id")
				.maybeSingle();

			if (error) throw error;
			savedRow = insertedRow;
		}

		if (savedRow?.updated_at) {
			season._meta = season._meta || {};
			schedule._meta = schedule._meta || {};
			season._meta.updated_at = savedRow.updated_at;
			schedule._meta.updated_at = savedRow.updated_at;

			try { saveSeason({ skipServerSync: true, touchMeta: false, bumpRevision: false, allowConflictBypass: true }); } catch (e) {}
			try { saveSchedule({ skipServerSync: true, touchMeta: false, bumpRevision: false, allowConflictBypass: true }); } catch (e) {}
		}

		adoptServerSyncBaseline(savedRow || {
			season_json: season,
			schedule_json: schedule,
			updated_at: payload.updated_at
		});

		persistActiveGameLock(savedRow?.active_game_lock || activeGameLock || null);

		if (!quiet) showNotification("✅ Season stats saved to server", 1800);
		return true;
	} catch (e) {
		console.log("season_data sync failed:", e);
		if (!quiet) {
			alert(
				"Could not save to server.\n\n" +
				"Local season stats are still saved on this device.\n" +
				"This tab did not overwrite newer server data."
			);
		}
		return false;
	}
}

	async function manualResaveAllStats() {
  if (!(await requireLogin())) return;

  setSyncButtonEnabled(false);
  showNotification("🔄 Syncing data…", 1200);

  // Always refresh teams from Supabase so you see latest adds/deletes
  try { await load(); } catch (e) {}
  try { syncTeamRecordsWithLeague(); } catch (e) {}
  try { update(); } catch (e) {}

  // If server has a newer snapshot, pull it down instead of overwriting
  const row = await fetchSeasonRowFromServer({ quiet: true });
  const serverMs = row ? (Date.parse(row.updated_at || "") || 0) : 0;
  const localMs = getLocalUpdatedAtMs();

  if (row && serverMs > localMs + 1000) {
    applyServerSeasonRow(row);
    setSyncButtonEnabled(true);
    alert("✅ Data was synced.");
    return;
  }

  // Otherwise push local snapshot up
  try { saveSeason({ skipServerSync: true }); } catch (e) {}
  try { saveSchedule({ skipServerSync: true }); } catch (e) {}

  const ok = await syncSeasonToServer({ quiet: false });
  setSyncButtonEnabled(true);
  if (ok) alert("✅ Data was synced.");
}




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

function deepCloneJson(value) {
	try {
		return JSON.parse(JSON.stringify(value ?? null));
	} catch (e) {
		return null;
	}
}

function createEmptySeasonState() {
	return { playerStats: {}, teamRecords: {}, seasonSubs: [], subStats: {}, games: [] };
}

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

function getSelectedScheduleContext() {
	const daySelect = document.getElementById("scheduleDaySelect");
	const seriesSelect = document.getElementById("scheduleSeriesSelect");
	const gameSelect = document.getElementById("scheduleGameSelect");

	if (!daySelect || !seriesSelect) return null;
	if (!seriesSelect.value) return null;

	const [dayIndexStr, seriesIndexStr] = seriesSelect.value.split("|");
	const dayIndex = parseInt(dayIndexStr, 10);
	const seriesIndex = parseInt(seriesIndexStr, 10);
	let seriesGameIndex = null;

	if (gameSelect && gameSelect.value) {
		const parts = gameSelect.value.split("|");
		if (parts.length === 3) seriesGameIndex = parseInt(parts[2], 10);
	}

	const dayObj = schedule?.days?.[dayIndex];
	const seriesEntry = dayObj?.games?.[seriesIndex];
	const seriesGame = Number.isInteger(seriesGameIndex) ? seriesEntry?.gamesInSeries?.[seriesGameIndex] : null;
	if (!dayObj || !seriesEntry) return null;

	return { dayIndex, seriesIndex, seriesGameIndex, dayObj, seriesEntry, seriesGame };
}

function getSeriesAssignmentStore(dayIndex, seriesIndex) {
	const seriesEntry = schedule?.days?.[dayIndex]?.games?.[seriesIndex];
	if (!seriesEntry) return [];
	if (!Array.isArray(seriesEntry.subAssignments)) seriesEntry.subAssignments = [];
	return seriesEntry.subAssignments;
}

function getGameAssignmentStore(dayIndex, seriesIndex, seriesGameIndex) {
	const seriesGame = schedule?.days?.[dayIndex]?.games?.[seriesIndex]?.gamesInSeries?.[seriesGameIndex];
	if (!seriesGame) return [];
	if (!Array.isArray(seriesGame.subAssignments)) seriesGame.subAssignments = [];
	return seriesGame.subAssignments;
}

function getEffectiveSubAssignmentsForGame(scheduleRef, teamName = null) {
	if (!scheduleRef || !Number.isInteger(scheduleRef.dayIndex) || !Number.isInteger(scheduleRef.seriesIndex)) return [];

	const seriesAssignments = getSeriesAssignmentStore(scheduleRef.dayIndex, scheduleRef.seriesIndex).map(a => ({ ...a, scope: "series" }));
	const gameAssignments = Number.isInteger(scheduleRef.seriesGameIndex)
		? getGameAssignmentStore(scheduleRef.dayIndex, scheduleRef.seriesIndex, scheduleRef.seriesGameIndex).map(a => ({ ...a, scope: "game" }))
		: [];

	const merged = new Map();
	seriesAssignments.forEach(a => merged.set(`${a.teamName}|${a.replacedPlayer}`, a));
	gameAssignments.forEach(a => merged.set(`${a.teamName}|${a.replacedPlayer}`, a));

	const out = Array.from(merged.values());
	return teamName ? out.filter(a => a.teamName === teamName) : out;
}

function buildActiveTeamForGame(teamObj, scheduleRef = null) {
	const basePlayers = Array.isArray(teamObj?.players) ? teamObj.players.slice() : [];
	const activePlayers = basePlayers.slice();
	const playerMeta = {};

	basePlayers.forEach(playerName => {
		playerMeta[playerName] = {
			displayName: playerName,
			originalPlayer: playerName,
			statsKey: getPlayerKey(teamObj.name, playerName),
			isSub: false
		};
	});

	const assignments = getEffectiveSubAssignmentsForGame(scheduleRef, teamObj?.name);
	assignments.forEach(assign => {
		const idx = activePlayers.indexOf(assign.replacedPlayer);
		if (idx === -1 || !assign.subName || activePlayers.includes(assign.subName)) return;

		activePlayers[idx] = assign.subName;
		playerMeta[assign.subName] = {
			displayName: assign.subName,
			originalPlayer: assign.replacedPlayer,
			statsKey: getSubKey(assign.subName),
			isSub: true
		};
	});

	return {
		name: teamObj.name,
		players: activePlayers,
		_basePlayers: basePlayers,
		_playerMeta: playerMeta
	};
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

	function showNotification(message, duration = 2000) {
		let notif = document.getElementById("notification");
		if (notif) {
			notif.innerText = message;
			notif.classList.remove("hidden");
			setTimeout(() => {
				notif.classList.add("hidden");
			}, duration);
		}
	}

// GAME SETUP + SCHEDULE / MENU FLOW

function forceRegenerateSchedule() {
	const validTeams = getValidTeamsForSchedule();
	const config = getScheduleConfigForTeams(validTeams);
	if (!config) {
		alert("You need either 4 or 5 teams with players to generate a schedule.");
		return;
	}
	schedule = generateScheduleForTeams(validTeams);
	saveSchedule();
	renderScheduleUI();
}

function renderScheduleUI() {
	const container = document.getElementById("scheduleContainer");
	const summaryText = document.getElementById("scheduleSummaryText");
	container.innerHTML = "";

	const validTeams = getValidTeamsForSchedule();
	const liveConfig = getScheduleConfigForTeams(validTeams);
	const snapshotTeamNames = Array.isArray(schedule?.teamNames) ? schedule.teamNames.filter(Boolean) : [];
	const canRenderSnapshot = Array.isArray(schedule?.days) && schedule.days.length > 0 && snapshotTeamNames.length > 0 && isScheduleCurrentFormat(schedule, snapshotTeamNames.slice().sort());

	if (!canRenderSnapshot && liveConfig) {
		schedule = generateScheduleForTeams(validTeams);
		saveSchedule();
	}

	const activeTeamNames = Array.isArray(schedule?.teamNames) ? schedule.teamNames.filter(Boolean) : [];
	const activeConfig = getScheduleConfigForTeams(activeTeamNames) || liveConfig;
	if (summaryText) {
		summaryText.innerText = activeConfig?.description || "Season schedule will appear here once teams are ready.";
	}

	if (!Array.isArray(schedule?.days) || schedule.days.length === 0) {
		container.innerHTML = liveConfig
			? `
			<div class="card">
				<h3>No schedule yet</h3>
				<p style="color:#aaa;">Generate or sync a season schedule first.</p>
			</div>
			`
			: `
			<div class="card">
				<h3>No public schedule available yet</h3>
				<p style="color:#aaa;">The season schedule has not been published yet.</p>
			</div>
			`;
		return;
	}

	const activeConfigId = activeConfig?.id || "";

if (activeConfigId === SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5 && hasFullAppAccess()) {
	const editCard = document.createElement("div");
	editCard.className = "card";
	editCard.innerHTML = `
		<div class="section-header">Change Schedule</div>
		<div id="changeSchedulePanel">
			<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:10px; align-items:end;">
				<div>
					<div style="font-size:13px; color:#aaa; margin-bottom:6px;">Day</div>
					<select id="changeScheduleDaySelect" onchange="refreshChangeScheduleControls()"></select>
				</div>
				<div>
					<div style="font-size:13px; color:#aaa; margin-bottom:6px;">Bye Team</div>
					<select id="changeScheduleByeSelect" onchange="refreshChangeScheduleControls()"></select>
				</div>
			</div>
			<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:12px;">
				<button id="applyScheduleChangeBtn" type="button" onclick="applySelectedScheduleChange()">Update Schedule</button>
				<span id="changeScheduleStatus" style="color:#aaa; font-size:13px;"></span>
			</div>
		</div>
	`;
	container.appendChild(editCard);
	setTimeout(refreshChangeScheduleControls, 0);
}

	schedule.days.forEach((dayObj, dayIndex) => {
		const dayCard = document.createElement("div");
		dayCard.className = "card";

		const rows = (dayObj.games || []).map(seriesEntry => {
			const awayRec = formatTeamRecord(seriesEntry.away);
			const homeRec = formatTeamRecord(seriesEntry.home);

			let awayTag = "";
			let homeTag = "";
			let scoreTag = "";

			if (seriesEntry.result) {
				if (seriesEntry.result.type === "tie") {
					awayTag = " 🤝 T";
					homeTag = " 🤝 T";
					const tieText = `${seriesEntry.result.awayWins}-${seriesEntry.result.homeWins}`;
					scoreTag = ` — Series tied (${tieText})`;
				} else {
					awayTag = (seriesEntry.result.winner === seriesEntry.away) ? " ✅ W" : " ❌ L";
					homeTag = (seriesEntry.result.winner === seriesEntry.home) ? " ✅ W" : " ❌ L";
					scoreTag = ` — Series ${seriesEntry.result.winnerGames}-${seriesEntry.result.loserGames}`;
				}
			}

			return `
			<tr>
				<td>Series ${seriesEntry.gameNumber}</td>
				<td>
					<b>${seriesEntry.away}</b> <span style="color:#aaa;">(${awayRec})</span>${awayTag}
					&nbsp;vs&nbsp;
					<b>${seriesEntry.home}</b> <span style="color:#aaa;">(${homeRec})</span>${homeTag}
					<span style="color:#aaa;">${scoreTag}</span>
				</td>
			</tr>
			`;
		}).join("");

		const byeTeam = activeConfigId === SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5
			? getByeTeamForDay(dayObj, activeTeamNames)
			: "";

		const dayLockedNote = activeConfigId === SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5 && hasFullAppAccess() && !canEditFiveTeamScheduleFromDay(dayIndex)
			? `<div style="margin:6px 0 12px; color:#aaa; font-size:13px;">Schedule editing is locked for this day because this day or a later day already has recorded games.</div>`
			: "";

		dayCard.innerHTML = `
		<div class="section-header">Day ${dayObj.day}</div>
		${byeTeam ? `<div style="margin:6px 0 12px; color:#aaa;"><b style="color:white;">Bye:</b> ${byeTeam}</div>` : ""}
		${dayLockedNote}
		<table class="stats-table">
			<tr>
				<th>Series</th>
				<th>Matchup</th>
			</tr>
			${rows}
		</table>
		`;

		container.appendChild(dayCard);
	});
}

	// NAVIGATION FUNCTIONS

function showPublicMenu() {
	hideAllScreens();
	try { document.getElementById("accessGate").classList.add("hidden"); } catch (e) {}
	document.getElementById("publicMenu").classList.remove("hidden");
	updatePublicAccessUI();
}

function showMainMenu() {
	if (isPublicViewOnlyMode()) {
		showPublicMenu();
		return;
	}
	hideAllScreens();
	document.getElementById("mainMenu").classList.remove("hidden");
	updatePublicAccessUI();
}

function showTeamConfig() {
	if (isPublicViewOnlyMode()) {
		alert("Sign in and enter the league code to configure teams.");
		showPublicMenu();
		return;
	}
	hideAllScreens();
	document.getElementById("teamConfigScreen").classList.remove("hidden");
	update();
}

async function showGameSetup() {
	if (isPublicViewOnlyMode()) {
		alert("Sign in and enter the league code to record games.");
		showPublicMenu();
		return;
	}
	hideAllScreens();
	
	if (league.teams.length < 2) {
		alert("You need at least 2 teams! Please configure teams first.");
		showTeamConfig();
		return;
	}

	let validTeams = league.teams.filter(t => t.players.length > 0);
	if (validTeams.length < 2) {
		alert("You need at least 2 teams with players! Please add players first.");
		showTeamConfig();
		return;
	}

	document.getElementById("gameSetupScreen").classList.remove("hidden");

	const schedCard = document.getElementById("scheduledGameCard");
	const manualCard = document.getElementById("manualTeamCard");

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

	refreshGameLockUI();
}

async function showSeasonStats() {
	hideAllScreens();
	if (isPublicViewOnlyMode()) {
		try { await refreshPublicViewData({ quiet: true }); } catch (e) {}
	}
	document.getElementById("seasonStatsScreen").classList.remove("hidden");
	updatePublicAccessUI();
	displaySeasonStats();
}

async function showRankings() {
	hideAllScreens();
	if (isPublicViewOnlyMode()) {
		try { await refreshPublicViewData({ quiet: true }); } catch (e) {}
	}
	document.getElementById("rankingsScreen").classList.remove("hidden");
	updatePublicAccessUI();
	displayRankings();
}

async function showPastGameLog() {
	hideAllScreens();
	if (isPublicViewOnlyMode()) {
		try { await refreshPublicViewData({ quiet: true }); } catch (e) {}
	}
	document.getElementById("pastGameLogScreen").classList.remove("hidden");
	updatePublicAccessUI();
	displayPastGameLog();
}

function hideAllScreens() {
	document.getElementById("publicMenu").classList.add("hidden");
	document.getElementById("mainMenu").classList.add("hidden");
	document.getElementById("teamConfigScreen").classList.add("hidden");
	document.getElementById("gameSetupScreen").classList.add("hidden");
	document.getElementById("gameScreen").classList.add("hidden");
	document.getElementById("gameOverScreen").classList.add("hidden");
	document.getElementById("seasonStatsScreen").classList.add("hidden");
	document.getElementById("rankingsScreen").classList.add("hidden");
	document.getElementById("pastGameLogScreen").classList.add("hidden");
	document.getElementById("scheduleScreen").classList.add("hidden");
	document.getElementById("activeUsersScreen").classList.add("hidden");
}

	function showGame() {
		hideAllScreens();
		document.getElementById("gameScreen").classList.remove("hidden");
	}

	function showGameOver() {
		hideAllScreens();
		document.getElementById("gameOverScreen").classList.remove("hidden");
	}

	// TEAM MANAGEMENT FUNCTIONS
async function addTeam() {
  if (!(await requireLogin())) return;

  // ✅ Make sure we’re checking the latest team list before enforcing limit
  try { await load(); } catch (e) {}

  const name = (document.getElementById("teamName")?.value || "").trim();
  if (!name) return;

	const normalizedTeamName = name.toLowerCase();

const duplicateTeamExists = (league?.teams || []).some(team =>
  String(team.name).trim().toLowerCase() === normalizedTeamName
);

if (duplicateTeamExists) {
  alert("⚠️ That team name already exists.\nEach team must have a different name.");
  return;
}

  if ((league?.teams?.length || 0) >= MAX_TEAMS) {
    alert(`⚠️ Max ${MAX_TEAMS} teams reached.\nRemove a team before adding another.`);
    return;
  }

  const { error } = await supabaseClient.from("teams").insert([{ name }]);
  if (error) return alert(error.message);

  document.getElementById("teamName").value = "";
  await load();
  syncTeamRecordsWithLeague();
  update();
}

	async function addPlayer() {
  if (!(await requireLogin())) return;

  const teamIndexStr = document.getElementById("teamSelect")?.value;
  if (teamIndexStr === "" || teamIndexStr == null) return alert("Select a team");

  const teamIndex = Number(teamIndexStr);

  const playerInput = (document.getElementById("playerName")?.value || "");
  const player = playerInput
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!player) return;

  const normalizedPlayer = player.toLowerCase();

  // Keep the exact team the user selected before refreshing
  const selectedTeamName = league?.teams?.[teamIndex]?.name;
  if (!selectedTeamName) return alert("Select a team");

// ✅ Check the real Supabase players table directly
const { data: allPlayers, error: dupErr } = await supabaseClient
  .from("players")
  .select("name");

if (dupErr) {
  console.log("Duplicate player check failed:", dupErr);
  alert("Could not check existing players. Please try again.");
  return;
}

const duplicateExists = (allPlayers || []).some(row => {
  const existingNorm = String(row.name || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return existingNorm === normalizedPlayer;
});

if (duplicateExists) {
  alert("⚠️ That player name is already in this league.\nEach player must have a different name.");
  return;
}

// Refresh latest teams after duplicate check
try { await load(); } catch (e) {}

  const teamObj = (league?.teams || []).find(t => t.name === selectedTeamName);
  const currentPlayers = (teamObj?.players || []).length;

  if (currentPlayers >= MAX_PLAYERS_PER_TEAM) {
    alert(`⚠️ ${selectedTeamName} already has ${MAX_PLAYERS_PER_TEAM} players.\nRemove a player before adding another.`);
    return;
  }

  const { data: teamRow, error: tErr } = await supabaseClient
    .from("teams")
    .select("id")
    .eq("name", selectedTeamName)
    .single();

  if (tErr) return alert(tErr.message);

  const { error } = await supabaseClient.from("players").insert([{
    team_id: teamRow.id,
    name: player
  }]);

  if (error) return alert(error.message);

  document.getElementById("playerName").value = "";
  await load();
  syncTeamRecordsWithLeague();
  update();
}



	async function removeTeam(teamIndex) {
		if (!(await requireLogin())) return;

		const teamName = league.teams?.[teamIndex]?.name;
		if (!teamName) return;

		if (!confirm("Remove this team? This will delete it for everyone.")) return;

		try {
			// Look up team id
			const { data: teamRow, error: tErr } = await supabaseClient
				.from("teams")
				.select("id")
				.eq("name", teamName)
				.single();

			if (tErr) throw tErr;

			// Delete players first (safe even if FK cascade exists)
			await supabaseClient.from("players").delete().eq("team_id", teamRow.id);
			const { error: delErr } = await supabaseClient.from("teams").delete().eq("id", teamRow.id);
			if (delErr) throw delErr;

			// Remove that team's season stats locally too (prevents ghost rows)
			try {
				if (season?.playerStats) {
					Object.keys(season.playerStats).forEach(k => {
						if (k.startsWith(teamName + "|")) delete season.playerStats[k];
					});
				}
				if (season?.teamRecords) delete season.teamRecords[teamName];
				saveSeason();
			} catch (e) {}

			await load();
			syncTeamRecordsWithLeague();
			update();
			showNotification("✅ Team deleted", 1400);
		} catch (e) {
			console.log(e);
			alert(e.message || "Could not delete team.");
		}
	}

	async function removePlayer(teamIndex, playerIndex) {
		if (!(await requireLogin())) return;

		const teamName = league.teams?.[teamIndex]?.name;
		const playerName = league.teams?.[teamIndex]?.players?.[playerIndex];
		if (!teamName || !playerName) return;

		if (!confirm("Remove this player? This will delete them for everyone.")) return;

		try {
			const { data: teamRow, error: tErr } = await supabaseClient
				.from("teams")
				.select("id")
				.eq("name", teamName)
				.single();
			if (tErr) throw tErr;

			const { error: pErr } = await supabaseClient
				.from("players")
				.delete()
				.eq("team_id", teamRow.id)
				.eq("name", playerName);

			if (pErr) throw pErr;

			// Remove player's season stats locally too
			try {
				const key = getPlayerKey(teamName, playerName);
				if (season?.playerStats) delete season.playerStats[key];
				saveSeason();
			} catch (e) {}

			await load();
			syncTeamRecordsWithLeague();
			update();
			showNotification("✅ Player deleted", 1400);
		} catch (e) {
			console.log(e);
			alert(e.message || "Could not delete player.");
		}
	}

function update() {
	let select = document.getElementById("teamSelect");
	select.innerHTML = "";

	if (league.teams.length === 0) {
		select.innerHTML = "<option>Add a team first</option>";
	}

	league.teams.forEach((t, i) => {
		let opt = document.createElement("option");
		opt.value = i;
		opt.text = t.name;
		select.appendChild(opt);
	});

	let list = document.getElementById("teamList");
	list.innerHTML = "";

	if (league.teams.length === 0) {
		list.innerHTML = "<p>No teams yet. Add a team above!</p>";
	}

	league.teams.forEach((team, teamIndex) => {
		let div = document.createElement("div");
		div.className = "card";

		let playersHTML = "";
		team.players.forEach((player, playerIndex) => {
			playersHTML += `<div>${player} <button onclick="removePlayer(${teamIndex},${playerIndex})">Remove</button></div>`;
		});
		if (playersHTML === "") playersHTML = "No players yet";

		div.innerHTML = `<b>${team.name}</b> <button onclick="removeTeam(${teamIndex})">Remove Team</button><br>Players:<br>${playersHTML}`;
		list.appendChild(div);
	});

	const subsList = document.getElementById("seasonSubsList");
	if (subsList) {
		subsList.innerHTML = "";
		const subs = Array.isArray(season?.seasonSubs) ? season.seasonSubs : [];

		if (!subs.length) {
			subsList.innerHTML = "<p>No season subs yet.</p>";
		} else {
			subs.forEach((subName, subIndex) => {
				const row = document.createElement("div");
				row.innerHTML = `${subName} <button onclick="removeSeasonSub(${subIndex})">Remove</button>`;
				subsList.appendChild(row);
			});
		}
	}

	save();
}

function addSeasonSub() {
	season = ensureSeasonShape(season);
	const input = document.getElementById("seasonSubName");
	if (!input) return;

	const subName = String(input.value || "").trim();
	if (!subName) return alert("Enter a substitute name first.");

	if ((season.seasonSubs || []).some(name => String(name).toLowerCase() === subName.toLowerCase())) {
		return alert("That substitute name already exists.");
	}

	if (getAllPlayerNames().some(name => String(name).toLowerCase() === subName.toLowerCase())) {
		return alert("That name is already being used by a roster player. Pick a different sub name.");
	}

	season.seasonSubs.push(subName);
	initSubStats(subName);
	input.value = "";
	saveSeason();
	update();
}

function removeSeasonSub(subIndex) {
	season = ensureSeasonShape(season);
	const subs = season.seasonSubs || [];
	const subName = subs[subIndex];
	if (!subName) return;

	if (!confirm(`Remove ${subName} from the Season Subs list? Existing sub stats and old assignments will stay saved.`)) return;

	subs.splice(subIndex, 1);
	saveSeason();
	update();
	renderSubAssignmentSummary();
}

function toggleSubAssignCard(forceOpen = null) {
	const card = document.getElementById("subAssignCard");
	if (!card) return;

	const shouldOpen = forceOpen === null ? card.classList.contains("hidden") : !!forceOpen;
	if (shouldOpen) {
		const ctx = getSelectedScheduleContext();
		if (!ctx) return alert("Select a day and series first.");
		card.classList.remove("hidden");
		populateSubTeamSelect();
		return;
	}

	card.classList.add("hidden");
}

function populateSubTeamSelect() {
	const ctx = getSelectedScheduleContext();
	const teamSelect = document.getElementById("subTeamSelect");
	if (!teamSelect) return;

	teamSelect.innerHTML = "";
	if (!ctx) return;

	[ctx.seriesEntry.away, ctx.seriesEntry.home].forEach(teamName => {
		const opt = document.createElement("option");
		opt.value = teamName;
		opt.text = teamName;
		teamSelect.appendChild(opt);
	});

	populateSubReplacePlayerSelect();
}

function populateSubReplacePlayerSelect() {
	const teamSelect = document.getElementById("subTeamSelect");
	const replaceSelect = document.getElementById("subReplacePlayerSelect");
	if (!teamSelect || !replaceSelect) return;

	replaceSelect.innerHTML = "";
	const teamObj = league.teams.find(t => t.name === teamSelect.value);

	(teamObj?.players || []).forEach(playerName => {
		const opt = document.createElement("option");
		opt.value = playerName;
		opt.text = playerName;
		replaceSelect.appendChild(opt);
	});

	populateSeasonSubSelect();
}

function populateSeasonSubSelect() {
	const select = document.getElementById("seasonSubSelect");
	const msg = document.getElementById("subAssignHint");
	if (!select) return;

	select.innerHTML = "";
	const subs = Array.isArray(season?.seasonSubs) ? season.seasonSubs : [];

	if (!subs.length) {
		const opt = document.createElement("option");
		opt.value = "";
		opt.text = "No Season Subs added yet";
		select.appendChild(opt);
		select.disabled = true;
		if (msg) msg.innerText = "Add season subs in Configure Teams before assigning one here.";
		return;
	}

	select.disabled = false;
	subs.forEach(subName => {
		const opt = document.createElement("option");
		opt.value = subName;
		opt.text = subName;
		select.appendChild(opt);
	});

	if (msg) msg.innerText = "";
}

function renderSubAssignmentSummary() {
	const box = document.getElementById("subAssignmentSummary");
	if (!box) return;

	box.innerHTML = "";
	const ctx = getSelectedScheduleContext();
	if (!ctx) return;

	const seriesAssignments = getSeriesAssignmentStore(ctx.dayIndex, ctx.seriesIndex);
	const gameAssignments = Number.isInteger(ctx.seriesGameIndex)
		? getGameAssignmentStore(ctx.dayIndex, ctx.seriesIndex, ctx.seriesGameIndex)
		: [];

	if (!seriesAssignments.length && !gameAssignments.length) {
		box.innerHTML = '<p style="color:#aaa; margin:8px 0 0 0;">No substitutes assigned for this selection yet.</p>';
		return;
	}

	const card = document.createElement("div");
	card.className = "card";

	let html = '<h3 style="margin-top:0;">Current Sub Assignments</h3>';

	if (seriesAssignments.length) {
		html += '<div style="margin-bottom:8px;"><b>Entire Series</b>';
		seriesAssignments.forEach((assignment, idx) => {
			html += `<div style="margin-top:6px;">${assignment.teamName}: ${assignment.subName} for ${assignment.replacedPlayer} <button onclick="removeSubAssignment('series', ${ctx.dayIndex}, ${ctx.seriesIndex}, ${idx})">Remove</button></div>`;
		});
		html += '</div>';
	}

	if (gameAssignments.length && Number.isInteger(ctx.seriesGameIndex)) {
		html += `<div><b>Game ${ctx.seriesGameIndex + 1} Only</b>`;
		gameAssignments.forEach((assignment, idx) => {
			html += `<div style="margin-top:6px;">${assignment.teamName}: ${assignment.subName} for ${assignment.replacedPlayer} <button onclick="removeSubAssignment('game', ${ctx.dayIndex}, ${ctx.seriesIndex}, ${ctx.seriesGameIndex}, ${idx})">Remove</button></div>`;
		});
		html += '</div>';
	}

	card.innerHTML = html;
	box.appendChild(card);
}

function removeSubAssignment(scope, dayIndex, seriesIndex, a, b) {
	let store = [];
	let removeIndex = -1;

	if (scope === "series") {
		store = getSeriesAssignmentStore(dayIndex, seriesIndex);
		removeIndex = a;
	} else {
		store = getGameAssignmentStore(dayIndex, seriesIndex, a);
		removeIndex = b;
	}

	if (!Array.isArray(store) || removeIndex < 0 || removeIndex >= store.length) return;

	store.splice(removeIndex, 1);
	saveSchedule();
	renderSubAssignmentSummary();
	populateSubTeamSelect();
}

function confirmSubAssignment() {
	const ctx = getSelectedScheduleContext();
	if (!ctx) return alert("Select a day and series first.");

	const scope = document.getElementById("subScopeSelect")?.value || "series";
	const teamName = document.getElementById("subTeamSelect")?.value || "";
	const replacedPlayer = document.getElementById("subReplacePlayerSelect")?.value || "";
	const subName = document.getElementById("seasonSubSelect")?.value || "";

	if (!teamName || !replacedPlayer || !subName) {
		return alert("Choose a team, the player being replaced, and the substitute.");
	}

	if (scope === "game" && !Number.isInteger(ctx.seriesGameIndex)) {
		return alert("Select a game number before adding a game-only substitute.");
	}

	const teamObj = league.teams.find(t => t.name === teamName);
	if (!teamObj || !(teamObj.players || []).includes(replacedPlayer)) {
		return alert("That roster player could not be found on the selected team.");
	}

	const allSeriesAssignments = [
		...getSeriesAssignmentStore(ctx.dayIndex, ctx.seriesIndex),
		...ctx.seriesEntry.gamesInSeries.flatMap(g => Array.isArray(g.subAssignments) ? g.subAssignments : [])
	];

	if (allSeriesAssignments.some(a => a.subName === subName && !(a.teamName === teamName && a.replacedPlayer === replacedPlayer))) {
		return alert("That substitute is already assigned somewhere in this series. Remove the old assignment first if you want to switch them.");
	}

	const targetStore = scope === "series"
		? getSeriesAssignmentStore(ctx.dayIndex, ctx.seriesIndex)
		: getGameAssignmentStore(ctx.dayIndex, ctx.seriesIndex, ctx.seriesGameIndex);

	const existingIndex = targetStore.findIndex(a => a.teamName === teamName && a.replacedPlayer === replacedPlayer);
	const payload = {
		teamName,
		replacedPlayer,
		subName,
		createdAt: Date.now()
	};

	if (existingIndex >= 0) targetStore[existingIndex] = payload;
	else targetStore.push(payload);

	initSubStats(subName);
	saveSeason();
	saveSchedule();
	renderSubAssignmentSummary();
	showNotification(`${subName} will sub for ${replacedPlayer}.`, 1500);
}

	// GAME SETUP FUNCTIONS

function updateGameSetupSelects() {
	let validTeams = league.teams.filter(t => t.players.length > 0);
	
	let team1Select = document.getElementById("team1Select");
	let team2Select = document.getElementById("team2Select");
	
	team1Select.innerHTML = "";
	team2Select.innerHTML = "";

	validTeams.forEach((t, i) => {
		let opt1 = document.createElement("option");
		opt1.value = i;
		opt1.text = t.name;
		team1Select.appendChild(opt1);

		let opt2 = document.createElement("option");
		opt2.value = i;
		opt2.text = t.name;
		team2Select.appendChild(opt2);
	});

	if (validTeams.length > 1) {
		team2Select.selectedIndex = 1;
	}

	refreshGameLockUI();
}

function ensureScheduleUpToDateForSelection() {
	const validTeams = getValidTeamsForSchedule();
	const config = getScheduleConfigForTeams(validTeams);
	if (!config) {
		return { ok: false, reason: "Schedule requires either 4 or 5 teams with players." };
	}

	const teamNames = validTeams.map(t => t.name).sort();

	if (!isScheduleCurrentFormat(schedule, teamNames)) {
		schedule = generateScheduleForTeams(validTeams);
		saveSchedule();
	}

	return { ok: true, validTeams };
}

function populateScheduleDaySelect() {
	const daySelect = document.getElementById("scheduleDaySelect");
	if (!daySelect) return;

	daySelect.innerHTML = "";

	(schedule.days || []).forEach((dayObj, idx) => {
		const openGames = (dayObj.games || []).reduce((count, seriesEntry) => {
			return count + (seriesEntry.gamesInSeries || []).filter(g => !g.result).length;
		}, 0);

		const opt = document.createElement("option");
		opt.value = String(idx);
		opt.text = `Day ${dayObj.day}` + (openGames === 0 ? " (all recorded)" : "");
		daySelect.appendChild(opt);
	});

	const firstOpen = (schedule.days || []).findIndex(dayObj =>
		(dayObj.games || []).some(seriesEntry =>
			(seriesEntry.gamesInSeries || []).some(g => !g.result)
		)
	);

	daySelect.value = String(firstOpen >= 0 ? firstOpen : 0);
	toggleSubAssignCard(false);
	populateScheduleSeriesSelect();
}

function populateScheduleSeriesSelect() {
	const daySelect = document.getElementById("scheduleDaySelect");
	const seriesSelect = document.getElementById("scheduleSeriesSelect");
	if (!daySelect || !seriesSelect) return;

	const dayIndex = parseInt(daySelect.value, 10);
	const dayObj = schedule?.days?.[dayIndex];

	seriesSelect.innerHTML = "";

	if (!dayObj || !Array.isArray(dayObj.games)) {
		populateScheduleGameSelect();
		return;
	}

	let added = 0;

	dayObj.games.forEach((seriesEntry, seriesIndex) => {
		const openGames = (seriesEntry.gamesInSeries || []).filter(g => !g.result).length;
		if (openGames === 0) return;

		const opt = document.createElement("option");
		opt.value = `${dayIndex}|${seriesIndex}`;
		opt.text = `Series ${seriesEntry.gameNumber}: ${seriesEntry.away} vs ${seriesEntry.home}`;
		seriesSelect.appendChild(opt);
		added += 1;
	});

	if (added === 0) {
		const opt = document.createElement("option");
		opt.value = "";
		opt.text = "No available series (already recorded)";
		seriesSelect.appendChild(opt);
		seriesSelect.disabled = true;
	} else {
		seriesSelect.disabled = false;
	}

	toggleSubAssignCard(false);
	populateScheduleGameSelect();
}

function populateScheduleGameSelect() {
	const seriesSelect = document.getElementById("scheduleSeriesSelect");
	const gameSelect = document.getElementById("scheduleGameSelect");
	const hint = document.getElementById("schedulePickHint");
	const btn = document.getElementById("startScheduledGameBtn");

	if (!seriesSelect || !gameSelect) return;

	gameSelect.innerHTML = "";

	if (!seriesSelect.value) {
		const opt = document.createElement("option");
		opt.value = "";
		opt.text = "No available games (already recorded)";
		gameSelect.appendChild(opt);
		gameSelect.disabled = true;
		if (btn) btn.disabled = true;
		if (hint) hint.innerText = "All series for this day are already recorded.";
		renderSubAssignmentSummary();
		return;
	}

	const [dayIndexStr, seriesIndexStr] = seriesSelect.value.split("|");
	const dayIndex = parseInt(dayIndexStr, 10);
	const seriesIndex = parseInt(seriesIndexStr, 10);
	const seriesEntry = schedule?.days?.[dayIndex]?.games?.[seriesIndex];

	if (!seriesEntry || !Array.isArray(seriesEntry.gamesInSeries)) {
		if (hint) hint.innerText = "No series found.";
		if (btn) btn.disabled = true;
		gameSelect.disabled = true;
		renderSubAssignmentSummary();
		return;
	}

	let added = 0;

	seriesEntry.gamesInSeries.forEach((seriesGame, seriesGameIndex) => {
		if (seriesGame.result) return;

		const opt = document.createElement("option");
		opt.value = `${dayIndex}|${seriesIndex}|${seriesGameIndex}`;
		opt.text = `Game ${seriesGame.gameNumber}`;
		gameSelect.appendChild(opt);
		added += 1;
	});

	if (added === 0) {
		const opt = document.createElement("option");
		opt.value = "";
		opt.text = "No available games (already recorded)";
		gameSelect.appendChild(opt);
		gameSelect.disabled = true;
		if (btn) btn.disabled = true;
		if (hint) hint.innerText = "All 3 games in that series are already recorded.";
	} else {
		gameSelect.disabled = false;
		if (btn) btn.disabled = false;

		const completedCount = countCompletedSeriesGames(seriesEntry);
		if (hint) {
			hint.innerText = completedCount > 0
				? `${completedCount} of 3 games already recorded for this series.`
				: "";
		}
	}

	renderSubAssignmentSummary();
refreshGameLockUI();
}

async function startSelectedScheduledGame() {
	const gameSelect = document.getElementById("scheduleGameSelect");
	if (!gameSelect || !gameSelect.value) return;

	const [dayIndexStr, seriesIndexStr, seriesGameIndexStr] = gameSelect.value.split("|");
	const dayIndex = parseInt(dayIndexStr, 10);
	const seriesIndex = parseInt(seriesIndexStr, 10);
	const seriesGameIndex = parseInt(seriesGameIndexStr, 10);

	const dayObj = schedule?.days?.[dayIndex];
	const seriesEntry = dayObj?.games?.[seriesIndex];
	const seriesGame = seriesEntry?.gamesInSeries?.[seriesGameIndex];

	if (!seriesEntry || !seriesGame) return alert("Could not find that scheduled series game.");

	if (seriesGame.result) {
		alert("That game was already recorded.");
		populateScheduleGameSelect();
		return;
	}

	const validTeams = league.teams.filter(t => t.players.length > 0);
	const t1 = validTeams.find(t => t.name === seriesEntry.away);
	const t2 = validTeams.find(t => t.name === seriesEntry.home);

	if (!t1 || !t2) {
		alert("Could not match schedule teams to your team list.");
		return;
	}

	await beginLockedGame(t1, t2, { dayIndex, seriesIndex, seriesGameIndex }, {
		type: "scheduled",
		dayNumber: Number(dayObj?.day || (dayIndex + 1)),
		seriesNumber: Number(seriesEntry?.gameNumber || (seriesIndex + 1)),
		seriesGameNumber: Number(seriesGame?.gameNumber || (seriesGameIndex + 1))
	});
}

async function showSchedule() {
  hideAllScreens();
  if (isPublicViewOnlyMode()) {
	  try { await refreshPublicViewData({ quiet: true }); } catch (e) {}
  }
  document.getElementById("scheduleScreen").classList.remove("hidden");
  renderScheduleUI();
}
