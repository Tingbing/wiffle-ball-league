// Wiffle Ball League - Sync, conflict protection, realtime, and active game locks
// Split from app.core.js. Load this AFTER core.state.js and BEFORE core.schedule.js, core.stats.js, core.ui.js, app.game.js, and app.auth.js.

/* ================================
   REVISION / CONFLICT STATE
================================== */

let syncConflictState = null;
let syncConflictAlertShown = false;
let syncState = {
	tabId: APP_TAB_ID,
	serverUpdatedAt: null,
	serverSeasonRevision: 0,
	serverScheduleRevision: 0
};

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

/* ================================
   STORAGE EVENT LISTENERS
================================== */
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

/* ================================
   PUBLIC VIEW SERVER REFRESH
================================== */
async function refreshPublicViewData({ quiet = true } = {}) {
	const row = await fetchSeasonRowFromServer({ quiet, publicView: true });
	if (row) applyServerSeasonRow(row, { force: true, source: "public-view" });
	return row;
}

	/* ================================
	✅ SCHEDULE DATA (persisted)
	==================================*/
	let schedule = { days: [], teamNames: [] };

/* ================================
   SYNC / REALTIME RUNTIME STATE
================================== */
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
   ACTIVE GAME LOCKS + SERVER SNAPSHOTS
================================== */
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

/* ================================
   MANUAL + AUTOMATIC SERVER SAVE
================================== */
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
