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
	if (typeof hasLocalLiveGameToProtect === "function" && hasLocalLiveGameToProtect()) {
		try { saveLiveGameForLifecycle("lifecycle"); } catch (e) {}
		try { refreshLiveGameStatusDisplay(); } catch (e) {}
		return;
	}

	try { update(); } catch (e) {}
	try { if (!document.getElementById("seasonStatsScreen")?.classList.contains("hidden")) displaySeasonStats(); } catch (e) {}
	try { if (!document.getElementById("scheduleScreen")?.classList.contains("hidden")) renderScheduleUI(); } catch (e) {}
	try {
		if (!document.getElementById("gameSetupScreen")?.classList.contains("hidden")) {
			refreshGameSetupScheduleCards();
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

function shouldIgnoreSameBrowserConflictDuringLiveGame(detail = {}) {
	if (!(typeof hasLocalLiveGameToProtect === "function" && hasLocalLiveGameToProtect())) return false;

	const source = detail?.source || "";
	const kind = detail?.kind || "";

	// During a live game, defer all automatically-triggered conflict sources.
	// Storage-event conflicts are same-browser (harmless). Server-preflight and
	// sync-race conflicts are transient write races — they must not block live game
	// saves. Only genuine manual multi-device conflicts (confirmed by user action)
	// should ever interrupt a live game, and those go through manualResaveAllStats.
	return (
		source === "storage" ||
		source === "server-preflight" ||
		source === "server-race" ||
		source === "sync-race" ||
		kind === "season" ||
		kind === "schedule"
	);
}

function scheduleConflictNotice(reason, detail = {}) {
	const source = detail?.source || "";

	// Same-browser storage events are not dangerous. They happen during normal
	// iPhone/Safari background/restore and multi-tab localStorage wakeups.
	// They must never block local saves or permanently disable Sync.
	if (source === "storage") {
		syncStateFromHead();
		try { markLiveGameServerSyncPending("local changes"); } catch (e) {}
		try { setSyncButtonEnabled(true); } catch (e) {}
		return false;
	}

	if (shouldIgnoreSameBrowserConflictDuringLiveGame(detail)) {
		syncStateFromHead();
		try { markLiveGameServerSyncPending("Live Game Protected"); } catch (e) {}
		try { setSyncButtonEnabled(true); } catch (e) {}
		return false;
	}

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

	try { setSyncButtonEnabled(true); } catch (e) {}
	try { showNotification("⚠️ Real server conflict — tap Sync to review", 3500); } catch (e) {}
	return false;
}

function assertCanWriteLocalSnapshot(kind) {
	// Local saves are always allowed. Server/device conflict checks belong in
	// syncSeasonToServer(), not in localStorage writes.
	if (syncConflictState?.detail?.source === "storage") clearSyncConflictState();
	try { syncStateFromHead(); } catch (e) {}
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

	// Do not create a hard conflict from same-browser localStorage events.
	// Manual Sync/server preflight still handles real device/server conflicts.
	try { setSyncButtonEnabled(true); } catch (e) {}

	if (
		Number(head.seasonRevision || 0) > getSeasonRevisionFrom(season) ||
		Number(head.scheduleRevision || 0) > getScheduleRevisionFrom(schedule)
	) {
		try { markLiveGameServerSyncPending("local storage updated"); } catch (e) {}
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
	if (typeof shouldProtectLiveGameFromServerApply === "function" && shouldProtectLiveGameFromServerApply("public-view")) {
		try { markLiveGameServerSyncPending("Live Game Protected"); } catch (e) {}
		return null;
	}

	const row = await fetchSeasonRowFromServer({ quiet, publicView: true });
	if (row) applyServerSeasonRow(row, { force: true, source: "public-view" });
	return row;
}


/* ================================
   SYNC / REALTIME RUNTIME STATE
================================== */
	let autoSyncEnabled = false;          // turns on after post-unlock setup
	let suppressAutoSync = false;         // prevents sync loops when applying server data
	let postUnlockSetupPromise = null;

	let realtimeChannel = null;
	let teamsReloadTimer = null;

	let serverSyncTimer = null;
let manualSyncInProgress = false;
let orphanLockCleanupPromise = null;

function ensureSyncSpinnerStyles() {
	if (document.getElementById("wbl-sync-spinner-style")) return;

	const style = document.createElement("style");
	style.id = "wbl-sync-spinner-style";
	style.textContent = `
		@keyframes wblSyncSpin {
			from { transform: rotate(0deg); }
			to { transform: rotate(360deg); }
		}

		.wbl-sync-spinner {
			display: inline-block;
			width: 14px;
			height: 14px;
			border: 2px solid rgba(255,255,255,0.35);
			border-top-color: white;
			border-radius: 50%;
			animation: wblSyncSpin 0.75s linear infinite;
			vertical-align: middle;
		}

		.wbl-syncing {
			cursor: wait !important;
			opacity: 0.8 !important;
		}
	`;
	document.head.appendChild(style);
}

function setSyncButtonBusy(isBusy, label = "Syncing data...") {
	if (isBusy) {
		setSyncButtonResult("syncing", label);
		return;
	}

	const btn = document.getElementById("resaveStatsBtn");
	if (!btn) return;

	btn.classList.remove("wbl-syncing");
	btn.disabled = false;
	btn.style.pointerEvents = "auto";
	btn.style.opacity = "1";
	btn.removeAttribute("aria-busy");
}

function setSyncButtonEnabled(enabled) {
	const btn = document.getElementById("resaveStatsBtn");
	if (!btn) return;

	if (btn.classList.contains("wbl-syncing")) return;

	const canUse = !!enabled && !manualSyncInProgress;

	btn.disabled = !canUse;
	btn.style.opacity = canUse ? "1" : "0.6";
	btn.style.pointerEvents = canUse ? "auto" : "none";
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

function withTimeout(promise, timeoutMs = 2500, fallbackValue = false) {
	let settled = false;
	return new Promise(resolve => {
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			resolve(fallbackValue);
		}, timeoutMs);

		Promise.resolve(promise)
			.then(value => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(value);
			})
			.catch(error => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				console.warn("Timed async action failed:", error);
				resolve(fallbackValue);
			});
	});
}

async function releaseGameLockWithTimeout(lockId, { quiet = true, timeoutMs = 2500 } = {}) {
	if (!lockId) {
		persistActiveGameLock(null);
		return true;
	}
	return await withTimeout(releaseGameLock(lockId, { quiet }), timeoutMs, false);
}

async function releaseGameLockReliably(lockId, { quiet = true } = {}) {
	if (!lockId) {
		persistActiveGameLock(null);
		return true;
	}

	for (let attempt = 1; attempt <= 3; attempt++) {
		const released = await withTimeout(
			releaseGameLock(lockId, { quiet }),
			8000,
			false
		);

		if (released) {
			persistActiveGameLock(null);
			return true;
		}

		try {
			const row = await withTimeout(fetchSeasonRowFromServer({ quiet: true }), 5000, null);
			const serverLockId = row?.active_game_lock_id || row?.active_game_lock?.lockId || null;

			if (!serverLockId || serverLockId !== lockId) {
				persistActiveGameLock(null);
				return true;
			}
		} catch (e) {}

		await new Promise(resolve => setTimeout(resolve, 600 * attempt));
	}

	return false;
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
			applyServerSeasonRow(latestRow, { source: "lock-acquire" });
			if (latestRow.active_game_lock) {
				return { ok: false, reason: "locked", lock: latestRow.active_game_lock, row: latestRow };
			}
		}

		await ensureSeasonRowExistsForLocking();
	}

	if (!row) {
		const latestRow = await fetchSeasonRowFromServer({ quiet: true });
				if (latestRow) applyServerSeasonRow(latestRow, { source: "lock-acquire" });
		return { ok: false, reason: "locked", lock: latestRow?.active_game_lock || activeGameLock, row: latestRow || null };
	}

		applyServerSeasonRow(row, { source: "lock-acquire" });
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

	const { data: updatedRow, error } = await supabaseClient
		.from("season_data")
		.update({
			active_game_lock: null,
			active_game_lock_id: null,
			updated_by: userId
		})
		.eq("league_code", String(LEAGUE_CODE))
		.eq("active_game_lock_id", lockId)
		.select("active_game_lock,active_game_lock_id")
		.maybeSingle();

	if (error) {
		if (!quiet) console.log("release game lock failed:", error);
		return false;
	}

	if (updatedRow) {
		persistActiveGameLock(null);
		return true;
	}

	let latestRow = null;
	try {
		latestRow = await fetchSeasonRowFromServer({ quiet: true });
	} catch (e) {
		if (!quiet) console.log("could not verify game lock release:", e);
		return false;
	}

	if (!latestRow) {
		if (!quiet) console.log("could not verify game lock release: no season row found");
		return false;
	}

	if (latestRow.active_game_lock || latestRow.active_game_lock_id) {
		persistActiveGameLock(latestRow.active_game_lock || null);
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

		const result = await withTimeout(
			supabaseClient
				.from(tableName)
				.select(selectCols)
				.eq("league_code", String(LEAGUE_CODE))
				.maybeSingle(),
			8000,
			null
		);

		if (!result) {
			if (!quiet) console.warn(`[wbl] fetch ${tableName} timed out`);
			return null;
		}

		const { data, error } = result;
		if (error) throw error;
		return data || null;
	} catch (e) {
		if (!quiet) console.log(`fetch ${publicView ? "season_data_public" : "season_data"} failed:`, e);
		return null;
	}
}


function applyServerSeasonRow(row, { force = false, source = "server" } = {}) {
	if (!row) return false;

		if (!force && typeof shouldProtectLiveGameFromServerApply === "function" && shouldProtectLiveGameFromServerApply(source)) {
		try {
			if (Object.prototype.hasOwnProperty.call(row, "active_game_lock")) {
				const incomingLock = row.active_game_lock || null;
				const saved = typeof readLiveGameAutosave === "function" ? readLiveGameAutosave() : null;
				const savedLockId = saved?.lockId || saved?.game?._lockId || saved?.game?._lockInfo?.lockId || game?._lockId || null;
				if (incomingLock?.lockId && incomingLock.lockId === savedLockId) persistActiveGameLock(incomingLock);
			}
		} catch (e) {}
		try { markLiveGameServerSyncPending("Live Game Protected"); } catch (e) {}
		return false;
	}
	const info = getRowRevisionInfo(row);
	const localSeasonSnapshot = ensureSeasonShape(deepCloneJson(readJsonStorage(SEASON_STORAGE_KEY, season)));
	const localScheduleSnapshot = ensureScheduleShape(deepCloneJson(readJsonStorage(SCHEDULE_STORAGE_KEY, schedule)));
	normalizeSnapshotMeta(localSeasonSnapshot, "season");
	normalizeSnapshotMeta(localScheduleSnapshot, "schedule");

	const localSeasonRevision = getSeasonRevisionFrom(localSeasonSnapshot);
	const localScheduleRevision = getScheduleRevisionFrom(localScheduleSnapshot);
	const localDirty =
		localSeasonRevision > (syncState.serverSeasonRevision || 0) ||
		localScheduleRevision > (syncState.serverScheduleRevision || 0);

	const localSnapshotAheadOfIncoming =
		localSeasonRevision > info.seasonRevision ||
		localScheduleRevision > info.scheduleRevision;

	const localSnapshotMs = Math.max(
		Date.parse(localSeasonSnapshot?._meta?.updated_at || "") || 0,
		Date.parse(localScheduleSnapshot?._meta?.updated_at || "") || 0
	);
	const incomingSnapshotMs = Date.parse(info.updatedAt || "") || 0;
	const localSnapshotWinsTimestampTie =
		localSeasonRevision === info.seasonRevision &&
		localScheduleRevision === info.scheduleRevision &&
		localSnapshotMs > incomingSnapshotMs;

	const sameOrOlderData =
		info.seasonRevision <= (syncState.serverSeasonRevision || 0) &&
		info.scheduleRevision <= (syncState.serverScheduleRevision || 0);

		// Public/read-only refresh must never overwrite a newer dirty local editable snapshot.
	// Keep public refresh working normally in all safe cases, but silently refuse the apply
	// when the local saved snapshot is ahead.
	if (source === "public-view" && localDirty && (localSnapshotAheadOfIncoming || localSnapshotWinsTimestampTie)) {
		return false;
	}

	// Lock acquisition updates only lock fields on the server row.
	// If this tab has newer unsynced local season/schedule data, do not re-apply the
	// older/equal server snapshot just to pick up the lock. Keep the local snapshot and
	// only persist the lock state locally.
	if (
		source === "lock-acquire" &&
		localDirty &&
		(sameOrOlderData || localSnapshotAheadOfIncoming || localSnapshotWinsTimestampTie)
	) {
		persistActiveGameLock(row.active_game_lock || null);
		return false;
	}

	if (!force && localDirty) {
		// Newer server changes than our last-known baseline → real conflict.
		if (!sameOrOlderData) {
			if (source === "public-view" && !Object.prototype.hasOwnProperty.call(row, "active_game_lock")) {
				try { refreshGameLockUI(); } catch (e) {}
			} else {
				persistActiveGameLock(row.active_game_lock || null);
			}
			return scheduleConflictNotice(
				"A newer server snapshot was detected while this tab still had unsynced local changes.",
				{ source, row }
			);
		}

		// Local has unsynced edits but the server isn't actually newer than what
		// we already saw. Do NOT overwrite local with the older server snapshot —
		// that wipes out unsynced finalized games. Keep local; push it later.
		if (Object.prototype.hasOwnProperty.call(row, "active_game_lock")) {
			persistActiveGameLock(row.active_game_lock || null);
		}
		try { queueServerSync(`hydrate-keep-local-${source}`, { immediate: false }); } catch (e) {}
		return false;
	}

		suppressAutoSync = true;
	season = ensureSeasonShape(info.seasonJson);
	schedule = ensureScheduleShape(info.scheduleJson);

	if (source === "public-view" && !Object.prototype.hasOwnProperty.call(row, "active_game_lock")) {
		try { refreshGameLockUI(); } catch (e) {}
	} else {
		persistActiveGameLock(row.active_game_lock || null);
	}

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

let serverSyncRetryAttempt = 0;
let serverSyncRetryTimer = null;
const SERVER_SYNC_RETRY_DELAYS_MS = [1000, 2500, 6000, 15000];

function clearServerSyncRetry() {
	if (serverSyncRetryTimer) clearTimeout(serverSyncRetryTimer);
	serverSyncRetryTimer = null;
}

const MAX_SERVER_SYNC_RETRY_ATTEMPTS = 4;

function scheduleServerSyncRetry(reason) {
	if (syncConflictState) return;
	if (serverSyncRetryAttempt >= MAX_SERVER_SYNC_RETRY_ATTEMPTS) return;
	clearServerSyncRetry();

	const idx = Math.min(serverSyncRetryAttempt, SERVER_SYNC_RETRY_DELAYS_MS.length - 1);
	const delay = SERVER_SYNC_RETRY_DELAYS_MS[idx];
	serverSyncRetryAttempt++;

	serverSyncRetryTimer = setTimeout(async () => {
		serverSyncRetryTimer = null;
		await runServerSyncSilent(reason ? `${reason}-retry-${serverSyncRetryAttempt}` : "retry");
	}, delay);
}

async function runServerSyncSilent(reason) {
	if (!autoSyncEnabled) return false;
	if (suppressAutoSync) return false;
	if (syncConflictState) return false;
	if (!isLeagueUnlocked() || !getStoredName()) return false;

	try { markLiveGameServerSyncPending(reason || "retry"); } catch (e) {}

	let ok = false;
	try {
		ok = await syncSeasonToServer({ quiet: true });
	} catch (e) {
		ok = false;
	}

	try {
		if (ok) {
			serverSyncRetryAttempt = 0;
			markLiveGameServerSyncSuccess();
		} else {
			markLiveGameServerSyncDelayed();
			scheduleServerSyncRetry(reason);
		}
	} catch (e) {}

	return ok;
}

function queueServerSync(reason, { immediate = false } = {}) {
	if (!autoSyncEnabled) return Promise.resolve(false);
	if (suppressAutoSync) return Promise.resolve(false);
	if (syncConflictState) return Promise.resolve(false);
	if (!isLeagueUnlocked() || !getStoredName()) return Promise.resolve(false);

	try { markLiveGameServerSyncPending(reason || "changes"); } catch (e) {}

	if (serverSyncTimer) {
		clearTimeout(serverSyncTimer);
		serverSyncTimer = null;
	}
	clearServerSyncRetry();

	const run = async () => {
		serverSyncTimer = null;

		const ok = await withAppWorking("Syncing…", async () => {
			return await syncSeasonToServer({ quiet: true });
		});

		try {
			if (ok) {
				serverSyncRetryAttempt = 0;
				markLiveGameServerSyncSuccess();
			} else {
				markLiveGameServerSyncDelayed();
				scheduleServerSyncRetry(reason);
			}
		} catch (e) {}

		return ok;
	};

	if (immediate) return run();

	return new Promise(resolve => {
		serverSyncTimer = setTimeout(async () => {
			const result = await run();
			resolve(result);
		}, 1400);
	});
}

async function ensurePostUnlockSetup() {
	if (postUnlockSetupPromise) return postUnlockSetupPromise;

	postUnlockSetupPromise = (async () => {
		setSyncButtonEnabled(false);

				// Best effort: pull down newer server snapshot before enabling autosync.
		// Do not hydrate over a valid local live game; live-game local autosave is authoritative.
		if (!(typeof hasLocalLiveGameToProtect === "function" && hasLocalLiveGameToProtect())) {
			try { await hydrateFromServerIfNewer(); } catch (e) {}
		}

		// Start realtime listeners
		try { await startRealtime(); } catch (e) {}

		autoSyncEnabled = true;
		setSyncButtonEnabled(true);
		return true;
	})().catch((err) => {
		postUnlockSetupPromise = null;
		autoSyncEnabled = false;
		setSyncButtonEnabled(false);
		throw err;
	});

	return postUnlockSetupPromise;
}

	function scheduleTeamsReload() {
		if (typeof hasLocalLiveGameToProtect === "function" && hasLocalLiveGameToProtect()) {
			try { saveLiveGameForLifecycle("lifecycle"); } catch (e) {}
			try { markLiveGameServerSyncPending("Roster Refresh Delayed"); } catch (e) {}
			return;
		}

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
									// If deleted, clear locally too — unless a local live game is active/saved.
					if (payload.eventType === "DELETE") {
					if (typeof hasLocalLiveGameToProtect === "function" && hasLocalLiveGameToProtect()) {
						try { saveLiveGameForLifecycle("lifecycle"); } catch (e) {}
						try { markLiveGameServerSyncDelayed(); } catch (e) {}
						return;
					}

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
let lastSyncFailureDetail = null;

function getSyncDebugGameId() {
	try {
		return game?._gameInstanceId
			|| game?._lockId
			|| activeGameLock?.lockId
			|| "unknown-game";
	} catch (e) {
		return "unknown-game";
	}
}

function getSyncErrorText(error) {
	if (!error) return "No technical error provided.";
	if (typeof error === "string") return error;
	return error.message || error.details || error.hint || error.code || String(error);
}

function buildSyncFailureMessage(detail) {
	return [
		"Sync failed, but local data is still saved on this device.",
		"",
		`Step failed: ${detail.step}`,
		`Where: ${detail.where}`,
		`Game ID: ${detail.gameId}`,
		`Time: ${detail.time}`,
		`Error: ${detail.errorText}`,
		"",
		detail.safeLocal || "Your local stats/game data should still be safe on this device.",
		"",
		detail.nextAction || "Press Sync again. If it keeps failing, send this message to AI/developer."
	].join("\n");
}

function recordSyncFailure({ step, where, error, quiet = false, nextAction = "", safeLocal = "" }) {
	const detail = {
		step: step || "unknown sync step",
		where: where || "sync",
		gameId: getSyncDebugGameId(),
		time: new Date().toISOString(),
		errorText: getSyncErrorText(error),
		safeLocal,
		nextAction
	};

	lastSyncFailureDetail = detail;

	console.warn("[wbl] Sync failed detail:", detail, error || "");

	try { markLiveGameServerSyncDelayed(); } catch (e) {}
	try { setSyncButtonResult("failed", detail.step); } catch (e) {}

	if (!quiet) {
		alert(buildSyncFailureMessage(detail));
	}

	return false;
}

function setSyncButtonResult(state, detail = "") {
	const btn = document.getElementById("resaveStatsBtn");
	if (!btn) return;

	btn.classList.remove("wbl-syncing");
	btn.disabled = false;
	btn.style.pointerEvents = "auto";
	btn.style.opacity = "1";
	btn.removeAttribute("aria-busy");

	if (state === "syncing") {
		ensureSyncSpinnerStyles();
		btn.classList.add("wbl-syncing");
		btn.disabled = true;
		btn.style.pointerEvents = "none";
		btn.style.opacity = "0.8";
		btn.setAttribute("aria-busy", "true");
		btn.title = "Syncing data...";
		btn.innerHTML = `<span class="wbl-sync-spinner" aria-hidden="true"></span> Syncing...`;
		return;
	}

	if (state === "success") {
		btn.title = "Data synced";
		btn.innerHTML = "✓ Synced";
		return;
	}

	if (state === "failed") {
		btn.title = detail ? `Sync failed at: ${detail}. Tap to retry.` : "Sync failed. Tap to retry.";
		btn.innerHTML = "⚠ Sync failed — tap again";
		return;
	}

	if (state === "needed") {
		btn.title = "Sync needed. Tap to retry.";
		btn.innerHTML = "↻ Sync Needed";
		return;
	}

	btn.title = "Sync data";
	btn.innerHTML = "↻ Sync";
}

let inflightSyncPromise = null;

async function syncSeasonToServer({ quiet = false } = {}) {
	// Single-flight: if a sync is already running, every new caller joins it.
	// This prevents concurrent supabase update() calls from racing on the same row.
	if (inflightSyncPromise) {
		return inflightSyncPromise;
	}

	inflightSyncPromise = (async () => {
		try {
			return await withTimeout(runSyncSeasonToServerOnce({ quiet }), 30000, false);
		} finally {
			inflightSyncPromise = null;
		}
	})();

	return inflightSyncPromise;
}

async function runSyncSeasonToServerOnce({ quiet = false } = {}) {

	// During an active live game, clear any automatically-flagged conflict state
	// (storage event, server-preflight race, etc.) so the completed game can still
	// sync its stats to the server. All these sources are transient; the live game's
	// locally-saved completed data takes priority.
	if (syncConflictState && typeof hasLocalLiveGameToProtect === "function" && hasLocalLiveGameToProtect()) {
		clearSyncConflictState();
	}

	if (syncConflictState) {
		// Conflict state is still set with no live game — do not push stale data.
		// manualResaveAllStats() will resolve this when the user taps Sync.
		if (!quiet) {
			showNotification("⚠️ Sync conflict — tap Sync to resolve", 3000);
		}
		return false;
	}

	const liveGameConflictBypass = typeof hasLocalLiveGameToProtect === "function" && hasLocalLiveGameToProtect();
try { saveSeason({ skipServerSync: true, touchMeta: false, bumpRevision: false, allowConflictBypass: liveGameConflictBypass }); } catch (e) {}
try { saveSchedule({ skipServerSync: true, touchMeta: false, bumpRevision: false, allowConflictBypass: liveGameConflictBypass }); } catch (e) {}
	const ok = await requireLogin();
	if (!ok) return false;

try {
		const sessionResult = await withTimeout(supabaseClient.auth.getSession(), 5000, null);
		if (!sessionResult) {
			console.warn("[wbl] auth.getSession timed out");
			try { markLiveGameServerSyncDelayed(); } catch (e) {}
			return false;
		}
		const { data } = sessionResult;
		const userId = data?.session?.user?.id || null;


	const latestRow = await withTimeout(fetchSeasonRowFromServer({ quiet: true }), 8000, null);
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

	const updateResult = await withTimeout(
				query.select("season_json,schedule_json,updated_at,active_game_lock,active_game_lock_id").maybeSingle(),
				10000,
				null
			);

			if (!updateResult) {
				console.warn("[wbl] season_data update timed out");
				try { markLiveGameServerSyncDelayed(); } catch (e) {}
				return false;
			}

			const { data: updatedRow, error } = updateResult;
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
		const upsertResult = await withTimeout(
				supabaseClient
					.from("season_data")
					.upsert(payload, { onConflict: "league_code" })
					.select("season_json,schedule_json,updated_at,active_game_lock,active_game_lock_id")
					.maybeSingle(),
				10000,
				null
			);

			if (!upsertResult) {
				console.warn("[wbl] season_data upsert timed out");
				try { markLiveGameServerSyncDelayed(); } catch (e) {}
				return false;
			}

			const { data: insertedRow, error } = upsertResult;
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

		// If the server says the lock is null, do not revive the old local lock.
if (savedRow && Object.prototype.hasOwnProperty.call(savedRow, "active_game_lock")) {
	persistActiveGameLock(savedRow.active_game_lock || null);
} else {
	persistActiveGameLock(activeGameLock || null);
}

		if (!quiet) showNotification("✅ Season stats saved to server", 1800);
		return true;
} catch (e) {
	console.log("season_data sync failed:", e);
	try { markLiveGameServerSyncDelayed(); } catch (statusErr) {}
	if (!quiet) {
		alert(
			"Server sync failed, but local data is still saved on this device.\n\n" +
			"Step failed: Supabase sync\n" +
			`Time: ${new Date().toISOString()}\n` +
			"Where: manual sync / automatic sync\n" +
			`Error: ${e?.message || e?.details || e?.code || String(e)}\n\n` +
			"What to do next: press Sync again later. If this keeps happening, send this message to AI/developer."
		);
	}
	return false;
}
}

async function clearOrphanGameLockFromMainMenu() {
	const hasLiveAutosave = typeof hasValidLiveGameAutosave === "function" && hasValidLiveGameAutosave();

	// Exact stuck state:
	// no active game + no valid autosave + lock still exists.
	if (game || !activeGameLock?.lockId || hasLiveAutosave) {
		return null;
	}

	if (orphanLockCleanupPromise) {
		return await orphanLockCleanupPromise;
	}

	orphanLockCleanupPromise = (async () => {
		const lockId = activeGameLock.lockId;

		try { markLiveGameServerSyncPending("lock cleanup"); } catch (e) {}

		try {
			if (serverSyncTimer) {
				clearTimeout(serverSyncTimer);
				serverSyncTimer = null;
			}
		} catch (e) {}

		try { clearServerSyncRetry(); } catch (e) {}

		let released = false;

		try {
			released = await releaseGameLockReliably(lockId, { quiet: true });
		} catch (e) {
			console.warn("[wbl] orphan lock cleanup failed:", e);
			released = false;
		}

		if (released) {
			try { persistActiveGameLock(null); } catch (e) {}
			try { clearLiveGameAutosave(); } catch (e) {}
			try { refreshGameLockUI(); } catch (e) {}
			try { markLiveGameServerSyncSuccess(); } catch (e) {}
			return true;
		}

		try {
			const row = await withTimeout(fetchSeasonRowFromServer({ quiet: true }), 8000, null);
			const serverLockId = row?.active_game_lock_id || row?.active_game_lock?.lockId || null;

			if (!serverLockId || serverLockId !== lockId) {
				persistActiveGameLock(null);
				refreshGameLockUI();
				try { markLiveGameServerSyncSuccess(); } catch (e) {}
				return true;
			}

			persistActiveGameLock(row.active_game_lock || activeGameLock);
		} catch (e) {
			console.warn("[wbl] could not verify orphan lock cleanup:", e);
		}

		try { markLiveGameServerSyncDelayed(); } catch (e) {}
		return false;
	})();

	try {
		return await orphanLockCleanupPromise;
	} finally {
		orphanLockCleanupPromise = null;
	}
}

async function manualResaveAllStats() {
	if (manualSyncInProgress) {
		showNotification("Sync is already running…", 1200);
		return false;
	}

if (!(await requireLogin())) return false;

	// If a conflict was flagged (e.g. from a background/restore cycle on iPhone),
	// resolve it now before attempting to sync. Same-browser storage conflicts are
	// safe to clear directly. Real server conflicts are resolved by comparing server
	// vs local revisions and keeping whichever is genuinely newer.
	if (syncConflictState) {
		if (syncConflictState?.detail?.source === "storage") {
			// Same-browser, same-device — always safe to clear and proceed.
			clearSyncConflictState();
		} else {
			// Real conflict: pull server, compare, apply the newer snapshot,
			// then proceed to push if local is still ahead.
			try { await resolveSyncConflictByReloadingLatest({ quiet: true }); } catch (e) {}
		}
	}

	manualSyncInProgress = true;
	setSyncButtonBusy(true, "Syncing data...");
	showNotification("🔄 Syncing data…", 1200);

	try {
		const orphanLockResult = await clearOrphanGameLockFromMainMenu();

		if (orphanLockResult === true) {
			showNotification("✅ Game lock cleared", 1500);
			return true;
		}

		if (orphanLockResult === false) {
			alert(
				"The game stats are saved, but the game lock could not be cleared yet.\n\n" +
				"Check your connection and press Sync again. The app will not start another overlapping sync."
			);
			return false;
		}

		try { await load(); } catch (e) {}
		try { syncTeamRecordsWithLeague(); } catch (e) {}
		try { update(); } catch (e) {}

		const row = await withTimeout(fetchSeasonRowFromServer({ quiet: true }), 6000, null);
		const serverMs = row ? (Date.parse(row.updated_at || "") || 0) : 0;
		const localMs = getLocalUpdatedAtMs();

		if (row && serverMs > localMs + 1000) {
			applyServerSeasonRow(row);

			const cleanupAfterPull = await clearOrphanGameLockFromMainMenu();

			if (cleanupAfterPull === true) {
				showNotification("✅ Data synced and game lock cleared", 1600);
			} else {
				alert("✅ Data was synced.");
			}

			return true;
		}

const liveGameConflictBypass = typeof hasLocalLiveGameToProtect === "function" && hasLocalLiveGameToProtect();
try { saveSeason({ skipServerSync: true, allowConflictBypass: liveGameConflictBypass }); } catch (e) {}
try { saveSchedule({ skipServerSync: true, allowConflictBypass: liveGameConflictBypass }); } catch (e) {}

		const ok = await withAppWorking("Syncing…", async () => {
			return await syncSeasonToServer({ quiet: false });
		});

		if (ok) {
			const cleanupAfterSave = await clearOrphanGameLockFromMainMenu();

			if (cleanupAfterSave === true) {
				showNotification("✅ Data synced and game lock cleared", 1600);
			} else {
				alert("✅ Data was synced.");
			}

			return true;
		}

		return false;
} catch (error) {
	console.error("manualResaveAllStats failed:", error);
	alert(
		"Manual Sync failed, but local data is still saved on this device.\n\n" +
		"Step failed: manual Sync retry\n" +
		`Time: ${new Date().toISOString()}\n` +
		`Error: ${error?.message || error?.details || error?.code || String(error)}\n\n` +
		"What to do next: check your connection and press Sync again. If this keeps happening, send this message to AI/developer."
	);
	return false;
} finally {
		manualSyncInProgress = false;
		setSyncButtonBusy(false);
		setSyncButtonEnabled(true);
	}
}
