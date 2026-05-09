// Wiffle Ball League - Sync, realtime, and active game locks
// Outbox-based rewrite. Keeps the public function names the rest of the app calls,
// but the internal model is much simpler:
//   - localStorage is the source of truth for the user
//   - every change marks "dirty"; a single worker pushes the latest snapshot to Supabase
//   - if push fails, we retry; we never overwrite newer local data with older server data
//   - one in-flight push at a time

/* ================================
   STATE
================================== */

// Kept around because other files reference it. We keep it as a no-op shell
// (it never blocks saves any more); existing checks against it become harmless.
let syncConflictState = null;
let syncConflictAlertShown = false;

let syncState = {
	tabId: APP_TAB_ID,
	serverUpdatedAt: null,
	serverSeasonRevision: 0,
	serverScheduleRevision: 0
};

let manualSyncInProgress = false;
let orphanLockCleanupPromise = null;
let lastSyncFailureDetail = null;

let autoSyncEnabled = false;
let suppressAutoSync = false;
let postUnlockSetupPromise = null;

let realtimeChannel = null;
let teamsReloadTimer = null;

// Outbox: any local change sets dirty=true. The worker pushes the latest snapshot.
let outboxDirty = false;
let outboxPushPromise = null;
let outboxRetryTimer = null;
let outboxRetryAttempt = 0;
const OUTBOX_RETRY_DELAYS_MS = [1000, 2500, 6000, 15000, 30000];

/* ================================
   REVISION / META HELPERS
================================== */

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
	return outboxDirty
		|| getSeasonRevisionFrom(season) > (syncState.serverSeasonRevision || 0)
		|| getScheduleRevisionFrom(schedule) > (syncState.serverScheduleRevision || 0);
}

// Kept as no-ops for compatibility. The new sync layer doesn't use a global
// "conflict state" any more — every push is a single attempt with optimistic
// concurrency at the row level, and conflicts are resolved per-push.
function clearSyncConflictState() {
	syncConflictState = null;
	if (autoSyncEnabled || postUnlockSetupPromise) setSyncButtonEnabled(true);
}

function scheduleConflictNotice(_reason, _detail = {}) {
	// Intentional no-op. Old code path; left so existing callers don't error.
	return false;
}

function shouldIgnoreSameBrowserConflictDuringLiveGame(_detail = {}) {
	return true;
}

async function resolveSyncConflictByReloadingLatest({ quiet = false } = {}) {
	clearSyncConflictState();
	return true;
}

function assertCanWriteLocalSnapshot(_kind) {
	// Local saves are always allowed.
	return true;
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
	try { if (!document.getElementById("gameSetupScreen")?.classList.contains("hidden")) refreshGameSetupScheduleCards(); } catch (e) {}
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
}

function getRowRevisionInfo(row) {
	if (!row) return null;
	const rowSeason = ensureSeasonShape(deepCloneJson(row.season_json));
	const rowSchedule = ensureScheduleShape(deepCloneJson(row.schedule_json));
	normalizeSnapshotMeta(rowSeason, "season");
	normalizeSnapshotMeta(rowSchedule, "schedule");
	return {
		seasonJson: rowSeason,
		scheduleJson: rowSchedule,
		seasonRevision: getSeasonRevisionFrom(rowSeason),
		scheduleRevision: getScheduleRevisionFrom(rowSchedule),
		updatedAt: row.updated_at || null
	};
}

/* ================================
   STORAGE EVENT WAKE-UPS
================================== */

window.addEventListener("storage", (event) => {
	if (event.key !== SYNC_HEAD_KEY || !event.newValue) return;
	syncStateFromHead();
});

syncStateFromHead();
try {
	activeGameLock = JSON.parse(localStorage.getItem(ACTIVE_GAME_LOCK_KEY) || "null");
} catch (e) {
	activeGameLock = null;
}

/* ================================
   PUBLIC VIEW REFRESH
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
   UTIL: timeout wrapper
================================== */

function withTimeout(promise, timeoutMs = 2500, fallbackValue = false) {
	return new Promise(resolve => {
		let settled = false;
		const t = setTimeout(() => {
			if (!settled) { settled = true; resolve(fallbackValue); }
		}, timeoutMs);
		Promise.resolve(promise).then(v => {
			if (!settled) { settled = true; clearTimeout(t); resolve(v); }
		}, () => {
			if (!settled) { settled = true; clearTimeout(t); resolve(fallbackValue); }
		});
	});
}

/* ================================
   SYNC BUTTON UI
================================== */

function ensureSyncSpinnerStyles() {
	if (document.getElementById("wbl-sync-spinner-style")) return;
	const style = document.createElement("style");
	style.id = "wbl-sync-spinner-style";
	style.textContent = `
		@keyframes wblSyncSpin { 0% { transform: rotate(0); } 100% { transform: rotate(360deg); } }
		.wbl-sync-spinner {
			display: inline-block; width: 1em; height: 1em;
			border: 2px solid currentColor; border-right-color: transparent;
			border-radius: 50%; vertical-align: -2px;
			animation: wblSyncSpin 0.7s linear infinite;
			margin-right: 4px;
		}
	`;
	document.head.appendChild(style);
}

function setSyncButtonBusy(isBusy, label = "Syncing data...") {
	if (isBusy) { setSyncButtonResult("syncing", label); return; }
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
	if (state === "success") { btn.title = "Data synced"; btn.innerHTML = "✓ Synced"; return; }
	if (state === "failed") { btn.title = detail ? `Sync failed at: ${detail}. Tap to retry.` : "Sync failed. Tap to retry."; btn.innerHTML = "⚠ Sync failed — tap again"; return; }
	if (state === "needed") { btn.title = "Sync needed. Tap to retry."; btn.innerHTML = "↻ Sync Needed"; return; }
	btn.title = "Sync data";
	btn.innerHTML = "↻ Sync";
}

function getLocalUpdatedAtMs() {
	const s = Date.parse(season?._meta?.updated_at || "") || 0;
	const sch = Date.parse(schedule?._meta?.updated_at || "") || 0;
	return Math.max(s, sch);
}

/* ================================
   ACTIVE GAME LOCK STORAGE
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
	const who = lockObj.startedByName || "another device";
	const t1 = lockObj.team1 || "Team 1";
	const t2 = lockObj.team2 || "Team 2";
	if (lockObj.type === "scheduled") {
		const dn = lockObj.dayNumber ? `Day ${lockObj.dayNumber}` : "";
		const sn = lockObj.seriesNumber ? `Series ${lockObj.seriesNumber}` : "";
		const gn = lockObj.seriesGameNumber ? `Game ${lockObj.seriesGameNumber}` : "";
		const parts = [dn, sn, gn].filter(Boolean).join(" · ");
		return `${who} is recording ${t1} vs ${t2}${parts ? " (" + parts + ")" : ""}`;
	}
	if (lockObj.type === "postseason") return `${who} is recording postseason ${t1} vs ${t2}`;
	return `${who} is recording ${t1} vs ${t2}`;
}

function refreshGameLockUI() {
	const banner = document.getElementById("activeGameLockBanner");
	if (!banner) return;
	const showLockBanner = !!activeGameLock && !game;
	banner.classList.toggle("hidden", !showLockBanner);
	if (showLockBanner) banner.innerText = "🔒 " + getActiveGameLockLabel();
}

async function ensureSeasonRowExistsForLocking() {
	const existing = await withTimeout(fetchSeasonRowFromServer({ quiet: true }), 6000, null);
	if (existing) return existing;

	const payload = {
		league_code: String(LEAGUE_CODE),
		season_json: season,
		schedule_json: schedule,
		updated_at: new Date().toISOString(),
		updated_by: null
	};
	const result = await withTimeout(
		supabaseClient.from("season_data").upsert(payload, { onConflict: "league_code" })
			.select("season_json,schedule_json,updated_at,active_game_lock,active_game_lock_id"),
		8000, null
	);
	if (!result) return null;
	const { data, error } = result;
	if (error) { console.warn("[wbl] ensureSeasonRowExistsForLocking error:", error); return null; }
	const rows = Array.isArray(data) ? data : (data ? [data] : []);
	return rows[0] || null;
}

async function acquireGameLock(lockDetails) {
	if (!(await requireLogin())) return null;

	const row = await ensureSeasonRowExistsForLocking();
	if (!row) {
		alert("Could not reach the server to start a game. Check your connection and try again.");
		return null;
	}

	const existingLock = row.active_game_lock || null;
	const existingLockId = row.active_game_lock_id || existingLock?.lockId || null;
	if (existingLockId && existingLock) {
		const myLockId = activeGameLock?.lockId || null;
		if (existingLockId !== myLockId) {
			persistActiveGameLock(existingLock);
			alert("Another device is already recording a live game:\n\n" + getActiveGameLockLabel(existingLock) + "\n\nWait for them to finish, or use Emergency End Game on that device.");
			return null;
		}
	}

	const lockId = `lock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const lockPayload = {
		lockId,
		type: lockDetails?.type || "manual",
		team1: lockDetails?.team1 || "",
		team2: lockDetails?.team2 || "",
		dayNumber: lockDetails?.dayNumber,
		seriesNumber: lockDetails?.seriesNumber,
		seriesGameNumber: lockDetails?.seriesGameNumber,
		slotId: lockDetails?.slotId || null,
		startedAt: new Date().toISOString(),
		startedByName: (typeof getStoredName === "function" ? getStoredName() : "") || CURRENT_EMAIL || "This device"
	};

	// Use .select() (returns array) instead of .maybeSingle() to avoid PostgREST
	// returning HTTP 406 when zero rows match the conditional update filter.
	const result = await withTimeout(
		supabaseClient.from("season_data")
			.update({ active_game_lock: lockPayload, active_game_lock_id: lockId, updated_at: new Date().toISOString() })
			.eq("league_code", String(LEAGUE_CODE))
			.is("active_game_lock_id", null)
			.select("active_game_lock,active_game_lock_id"),
		8000, null
	);

	if (!result) {
		alert("Could not acquire the live-game lock (network timeout). Try again.");
		return null;
	}

	const { data, error } = result;
	if (error) {
		console.warn("[wbl] acquireGameLock error:", error);
		alert("Could not start the game (lock error). Try Sync, then try again.");
		return null;
	}

	const updatedRows = Array.isArray(data) ? data : (data ? [data] : []);
	if (updatedRows.length === 0) {
		// No row was updated. Either someone else holds the lock, OR our row
		// has a stale lock that was never cleaned up. Re-fetch and decide.
		const fresh = await fetchSeasonRowFromServer({ quiet: true });
		const freshLock = fresh?.active_game_lock || null;
		const freshLockId = fresh?.active_game_lock_id || freshLock?.lockId || null;

		if (!freshLockId) {
			// Server says no lock, but our update missed. Treat as transient and ask user to retry.
			alert("Could not start the game (lock check missed). Press Sync, then try again.");
			return null;
		}

		persistActiveGameLock(freshLock);
		alert(
			"Another device is already recording a live game:\n\n" +
			getActiveGameLockLabel(freshLock) +
			"\n\nWait for them to finish, or use Emergency End Game on that device."
		);
		return null;
	}

	persistActiveGameLock(updatedRows[0].active_game_lock || lockPayload);
	return lockPayload;
}

async function releaseGameLock(lockId, { quiet = false } = {}) {
	if (!lockId) return false;
	// Use .select() not .maybeSingle() — when zero rows match (lock already
	// cleared by another tab) PostgREST returns 406 with maybeSingle.
	const result = await withTimeout(
		supabaseClient.from("season_data")
			.update({ active_game_lock: null, active_game_lock_id: null, updated_at: new Date().toISOString() })
			.eq("league_code", String(LEAGUE_CODE))
			.eq("active_game_lock_id", lockId)
			.select("active_game_lock_id"),
		8000, null
	);
	if (!result) {
		if (!quiet) console.warn("[wbl] releaseGameLock timed out");
		return false;
	}
	const { data, error } = result;
	if (error) {
		if (!quiet) console.warn("[wbl] releaseGameLock error:", error);
		return false;
	}
	// Whether 0 or 1 rows updated, the lock is no longer this lockId on the server.
	// 0 rows means another tab/device already cleared it — that's fine.
	persistActiveGameLock(null);
	return true;
}

async function releaseGameLockReliably(lockId, { quiet = true } = {}) {
	if (!lockId) { persistActiveGameLock(null); return true; }
	for (let i = 0; i < 3; i++) {
		const ok = await releaseGameLock(lockId, { quiet: true });
		if (ok) return true;
		await new Promise(r => setTimeout(r, 500 + i * 500));
	}
	if (!quiet) console.warn("[wbl] could not release lock after retries:", lockId);
	return false;
}

async function releaseGameLockWithTimeout(lockId, { quiet = true, timeoutMs = 2500 } = {}) {
	return await withTimeout(releaseGameLockReliably(lockId, { quiet }), timeoutMs, false);
}

/* ================================
   FETCH + APPLY SERVER ROW
================================== */

async function fetchSeasonRowFromServer({ quiet = true, publicView = false } = {}) {
	try {
		const tableName = publicView ? "season_data_public" : "season_data";
		const selectCols = publicView
			? "season_json,schedule_json,updated_at"
			: "season_json,schedule_json,updated_at,active_game_lock,active_game_lock_id";

		const result = await withTimeout(
			supabaseClient.from(tableName).select(selectCols).eq("league_code", String(LEAGUE_CODE)).maybeSingle(),
			8000, null
		);
		if (!result) { if (!quiet) console.warn(`[wbl] fetch ${tableName} timed out`); return null; }
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
	const localSeasonRev = getSeasonRevisionFrom(season);
	const localScheduleRev = getScheduleRevisionFrom(schedule);

	// Critical safety: never overwrite local with an OLDER snapshot. The outbox
	// will push our newer local up the next time it pushes.
	if (!force) {
		if (localSeasonRev > info.seasonRevision || localScheduleRev > info.scheduleRevision) {
			if (Object.prototype.hasOwnProperty.call(row, "active_game_lock")) persistActiveGameLock(row.active_game_lock || null);
			outboxDirty = true;
			scheduleOutboxPush();
			return false;
		}
		// Same revisions, same content — just adopt baseline.
		if (localSeasonRev === info.seasonRevision && localScheduleRev === info.scheduleRevision) {
			adoptServerSyncBaseline(row);
			if (Object.prototype.hasOwnProperty.call(row, "active_game_lock")) persistActiveGameLock(row.active_game_lock || null);
			return true;
		}
	}

	suppressAutoSync = true;
	season = ensureSeasonShape(info.seasonJson);
	schedule = ensureScheduleShape(info.scheduleJson);

	if (Object.prototype.hasOwnProperty.call(row, "active_game_lock")) persistActiveGameLock(row.active_game_lock || null);

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
	adoptServerSyncBaseline({ season_json: season, schedule_json: schedule, updated_at: row.updated_at || null });
	refreshAfterSnapshotChange();
	return true;
}

async function hydrateFromServerIfNewer() {
	if (!(await requireLogin())) return;
	const row = await fetchSeasonRowFromServer({ quiet: true });
	if (!row) return;
	applyServerSeasonRow(row, { source: "hydrate" });
}

/* ================================
   OUTBOX-BASED SYNC (the new core)
================================== */

function scheduleOutboxPush({ delayMs = 500 } = {}) {
	if (!autoSyncEnabled || suppressAutoSync) return;
	if (!isLeagueUnlocked() || !getStoredName()) return;
	if (outboxRetryTimer) clearTimeout(outboxRetryTimer);
	outboxRetryTimer = setTimeout(() => {
		outboxRetryTimer = null;
		runOutboxPush().catch(() => {});
	}, delayMs);
}

async function runOutboxPush() {
	if (outboxPushPromise) return outboxPushPromise;
	if (!outboxDirty) return false;

	outboxPushPromise = (async () => {
		try {
			try { markLiveGameServerSyncPending("outbox"); } catch (e) {}
			const ok = await pushSnapshotOnce();
			if (ok) {
				outboxRetryAttempt = 0;
				// If anything got dirty WHILE we were pushing, leave dirty=true and re-schedule.
				if (!outboxDirty) {
					try { markLiveGameServerSyncSuccess(); } catch (e) {}
				} else {
					scheduleOutboxPush({ delayMs: 250 });
				}
				return true;
			}
			// Failure: mark delayed and schedule retry with backoff.
			try { markLiveGameServerSyncDelayed(); } catch (e) {}
			outboxRetryAttempt++;
			const idx = Math.min(outboxRetryAttempt - 1, OUTBOX_RETRY_DELAYS_MS.length - 1);
			scheduleOutboxPush({ delayMs: OUTBOX_RETRY_DELAYS_MS[idx] });
			return false;
		} finally {
			outboxPushPromise = null;
		}
	})();

	return outboxPushPromise;
}

async function pushSnapshotOnce() {
	if (!(await withTimeout(requireLogin(), 5000, false))) {
		lastSyncFailureDetail = { step: "login/session", time: new Date().toISOString(), errorText: "not signed in" };
		return false;
	}

	const sessionResult = await withTimeout(supabaseClient.auth.getSession(), 5000, null);
	if (!sessionResult) {
		lastSyncFailureDetail = { step: "auth.getSession", time: new Date().toISOString(), errorText: "auth.getSession timed out" };
		return false;
	}
	const userId = sessionResult.data?.session?.user?.id || null;

	// Snapshot what we're about to push so concurrent local edits don't lose us.
	outboxDirty = false;
	const snapshotSeasonRev = getSeasonRevisionFrom(season);
	const snapshotScheduleRev = getScheduleRevisionFrom(schedule);

	const payload = {
		league_code: String(LEAGUE_CODE),
		season_json: season,
		schedule_json: schedule,
		updated_at: new Date().toISOString(),
		updated_by: userId
	};

	try {
const result = await withTimeout(
			supabaseClient.from("season_data").upsert(payload, { onConflict: "league_code" })
				.select("season_json,schedule_json,updated_at,active_game_lock,active_game_lock_id"),
			12000, null
		);
		if (!result) {
			outboxDirty = true; // we didn't confirm — keep dirty
			lastSyncFailureDetail = { step: "Supabase upsert", time: new Date().toISOString(), errorText: "upsert timed out (12s)" };
			return false;
		}
		const { data, error } = result;
		const savedRows = Array.isArray(data) ? data : (data ? [data] : []);
		const savedRow = savedRows[0] || null;
		if (error) {
			outboxDirty = true;
			lastSyncFailureDetail = { step: "Supabase upsert", time: new Date().toISOString(), errorText: error.message || String(error) };
			console.warn("[wbl] outbox push error:", error);
			return false;
		}

		// Adopt baseline for what we just confirmed got written.
		if (savedRow?.updated_at) {
			season._meta = season._meta || {};
			schedule._meta = schedule._meta || {};
			season._meta.updated_at = savedRow.updated_at;
			schedule._meta.updated_at = savedRow.updated_at;
			try { saveSeason({ skipServerSync: true, touchMeta: false, bumpRevision: false, allowConflictBypass: true }); } catch (e) {}
			try { saveSchedule({ skipServerSync: true, touchMeta: false, bumpRevision: false, allowConflictBypass: true }); } catch (e) {}
		}
		adoptServerSyncBaseline(savedRow || { season_json: season, schedule_json: schedule, updated_at: payload.updated_at });

		if (savedRow && Object.prototype.hasOwnProperty.call(savedRow, "active_game_lock")) {
			persistActiveGameLock(savedRow.active_game_lock || null);
		}
		return true;
	} catch (e) {
		outboxDirty = true;
		lastSyncFailureDetail = { step: "Supabase upsert exception", time: new Date().toISOString(), errorText: e?.message || String(e) };
		console.warn("[wbl] outbox push exception:", e);
		return false;
	}
}

// Public API: existing callers use this. Returns Promise<boolean>.
async function syncSeasonToServer({ quiet = false } = {}) {
	outboxDirty = true;
	const ok = await runOutboxPush();
	if (!quiet && ok) showNotification("✅ Season stats saved to server", 1500);
	return ok;
}

// Public API: existing callers (saveSeason/saveSchedule) use this.
function queueServerSync(_reason, _opts = {}) {
	outboxDirty = true;
	scheduleOutboxPush({ delayMs: 600 });
	return Promise.resolve(true);
}

/* ================================
   POST-UNLOCK SETUP + REALTIME
================================== */

async function ensurePostUnlockSetup() {
	if (postUnlockSetupPromise) return postUnlockSetupPromise;

	postUnlockSetupPromise = (async () => {
		setSyncButtonEnabled(false);

		// On startup we always pull the server row to set the baseline.
		// applyServerSeasonRow will refuse to overwrite if our local is newer.
		try {
			const row = await withTimeout(fetchSeasonRowFromServer({ quiet: true }), 8000, null);
			if (row) {
				if (typeof hasLocalLiveGameToProtect === "function" && hasLocalLiveGameToProtect()) {
					adoptServerSyncBaseline(row);
				} else {
					applyServerSeasonRow(row, { source: "hydrate" });
				}
			}
		} catch (e) { console.warn("[wbl] startup hydrate warning:", e); }

		try { await startRealtime(); } catch (e) {}
		autoSyncEnabled = true;
		setSyncButtonEnabled(true);

		// If we already have unsynced local changes, push them now.
		if (hasUnsyncedLocalChanges()) {
			outboxDirty = true;
			scheduleOutboxPush({ delayMs: 100 });
		}

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
		try { await withTimeout(load(), 8000, null); } catch (e) {}
		try { syncTeamRecordsWithLeague(); } catch (e) {}
		try { update(); } catch (e) {}
	}, 400);
}

async function startRealtime() {
	if (realtimeChannel) return;
	realtimeChannel = supabaseClient.channel("wbl-realtime-" + String(LEAGUE_CODE));

	realtimeChannel.on("postgres_changes", { event: "*", schema: "public", table: "teams" }, () => scheduleTeamsReload());
	realtimeChannel.on("postgres_changes", { event: "*", schema: "public", table: "players" }, () => scheduleTeamsReload());

	realtimeChannel.on(
		"postgres_changes",
		{ event: "*", schema: "public", table: "season_data", filter: "league_code=eq." + String(LEAGUE_CODE) },
		async (payload) => {
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
				suppressAutoSync = false;
				try { update(); } catch (e) {}
				return;
			}
			const row = await fetchSeasonRowFromServer({ quiet: true });
			if (row) applyServerSeasonRow(row, { source: "realtime" });
		}
	);
	await realtimeChannel.subscribe();
}

function stopRealtime() {
	try { if (realtimeChannel) realtimeChannel.unsubscribe(); } catch (e) {}
	realtimeChannel = null;
	postUnlockSetupPromise = null;
	autoSyncEnabled = false;
}

/* ================================
   FAILURE REPORTING (debug aid)
================================== */

function getSyncDebugGameId() {
	if (typeof game !== "undefined" && game?._lockId) return game._lockId;
	if (typeof activeGameLock !== "undefined" && activeGameLock?.lockId) return activeGameLock.lockId;
	return "no-active-game";
}

function getSyncErrorText(error) {
	if (!error) return "No error provided.";
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
		detail.safeLocal || "Your local stats/game data should still be safe.",
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
	if (!quiet) alert(buildSyncFailureMessage(detail));
	return false;
}

/* ================================
   ORPHAN LOCK CLEANUP
================================== */

async function clearOrphanGameLockFromMainMenu() {
	const hasLiveAutosave = typeof hasValidLiveGameAutosave === "function" && hasValidLiveGameAutosave();
	if (game || !activeGameLock?.lockId || hasLiveAutosave) return null;

	if (orphanLockCleanupPromise) return await orphanLockCleanupPromise;

	orphanLockCleanupPromise = (async () => {
		const lockId = activeGameLock.lockId;
		try { markLiveGameServerSyncPending("lock cleanup"); } catch (e) {}
		const released = await releaseGameLockReliably(lockId, { quiet: true });
		if (released) {
			persistActiveGameLock(null);
			refreshGameLockUI();
			try { markLiveGameServerSyncSuccess(); } catch (e) {}
			return true;
		}
		try { markLiveGameServerSyncDelayed(); } catch (e) {}
		return false;
	})();

	try { return await orphanLockCleanupPromise; }
	finally { orphanLockCleanupPromise = null; }
}

/* ================================
   MANUAL SYNC BUTTON
================================== */

async function manualResaveAllStats() {
	if (manualSyncInProgress) {
		showNotification("Sync is already running…", 1200);
		setSyncButtonResult("syncing", "already running");
		return false;
	}
	if (!(await requireLogin())) {
		setSyncButtonResult("failed", "not signed in");
		alert("You're not signed in. Sign in and try again.");
		return false;
	}

	manualSyncInProgress = true;
	setSyncButtonBusy(true, "Syncing data...");
	showNotification("🔄 Syncing data…", 1200);

	let succeeded = false;
	let detail = "";

	try {
		// 1. Pull latest server row first; use it if it's newer than local.
		const row = await withTimeout(fetchSeasonRowFromServer({ quiet: true }), 8000, null);
		if (row) {
			const info = getRowRevisionInfo(row);
			const localSeasonRev = getSeasonRevisionFrom(season);
			const localScheduleRev = getScheduleRevisionFrom(schedule);
			const serverIsNewer = info.seasonRevision > localSeasonRev || info.scheduleRevision > localScheduleRev;
			const localIsNewer = localSeasonRev > info.seasonRevision || localScheduleRev > info.scheduleRevision;

			if (serverIsNewer && !localIsNewer) {
				applyServerSeasonRow(row, { force: true, source: "manual-pull" });
				detail = "pulled latest server data";
			} else {
				adoptServerSyncBaseline(row);
				if (Object.prototype.hasOwnProperty.call(row, "active_game_lock")) {
					persistActiveGameLock(row.active_game_lock || null);
				}
			}
		}

		// 2. Push local up if we have anything unsynced.
		const needsPush = hasUnsyncedLocalChanges();
		let pushOk = true;
		if (needsPush) {
			outboxDirty = true;
			pushOk = await runOutboxPush();
			detail = pushOk ? "pushed local changes" : (lastSyncFailureDetail?.step || "push failed");
		} else if (!detail) {
			detail = "already in sync";
		}

		// 3. Clean up orphan lock if appropriate.
		const orphanResult = await clearOrphanGameLockFromMainMenu();
		if (orphanResult === true) detail = "synced and cleared lock";

		// 4. Refresh team list.
		try { await withTimeout(load(), 8000, null); } catch (e) {}
		try { syncTeamRecordsWithLeague(); } catch (e) {}
		try { update(); } catch (e) {}

		succeeded = pushOk;
		if (succeeded) {
			showNotification(`✅ ${detail}`, 1800);
		} else {
			alert(buildSyncFailureMessage({
				step: lastSyncFailureDetail?.step || "manual sync push",
				where: "manual Sync button",
				gameId: getSyncDebugGameId(),
				time: new Date().toISOString(),
				errorText: lastSyncFailureDetail?.errorText || "unknown push failure",
				safeLocal: "Local data is still saved on this device.",
				nextAction: "Check your connection and press Sync again."
			}));
		}
		return succeeded;
	} catch (error) {
		console.error("manualResaveAllStats failed:", error);
		recordSyncFailure({
			step: "manual Sync exception",
			where: "manual Sync button",
			error,
			quiet: false,
			safeLocal: "Local data is still saved on this device.",
			nextAction: "Check your connection and press Sync again."
		});
		return false;
	} finally {
		manualSyncInProgress = false;
		setSyncButtonBusy(false);
		setSyncButtonResult(succeeded ? "success" : "failed", detail);
		try { succeeded ? markLiveGameServerSyncSuccess() : markLiveGameServerSyncDelayed(); } catch (e) {}
	}
}
