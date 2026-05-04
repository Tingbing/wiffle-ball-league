// Wiffle Ball League - app.game.autosave.js
// Split from the source-of-truth app.game.js. Load after app.core.js in the required order.
// Purpose: Live-game crash/reload autosave, resume, lifecycle protection, and UI-state restore helpers.

const LIVE_GAME_SAVE_KEY = "wiggleLiveGameStateV1";
const LIVE_GAME_STATUS_KEY = "wiggleLiveGameStatusV1";

let liveGameResumePromptShown = false;
let liveGameRestoreInProgress = false;
let liveGameLocalAuthoritative = false;
let liveGameLifecycleWired = false;
let lastLiveGameLocalSaveAt = null;
let lastLiveGameServerSyncAt = null;
let liveGameStatusState = "idle";

function getLiveStatusDefaultMessage(state) {
	if (state === "ok") return "Local Save OK";
	if (state === "pending") return "Local Save OK • Sync Pending";
	if (state === "synced") return "Synced";
	if (state === "restored") return "Restored Saved Game";
	if (state === "error") return "Server Sync Delayed";
	if (state === "stale") return "Viewing Stale Read-Only Data";
	return "";
}

function setLiveGameStatus(state, message = "", options = {}) {
	liveGameStatusState = state || "idle";
	const text = message || getLiveStatusDefaultMessage(liveGameStatusState);
	const shouldShow = !!text && liveGameStatusState !== "idle";
	const ids = ["syncDataTag", "liveSyncStatusTag"];

	ids.forEach(id => {
		const el = document.getElementById(id);
		if (!el) return;
		el.innerText = text;
		el.classList.toggle("hidden", !shouldShow);
		el.classList.remove("status-ok", "status-pending", "status-synced", "status-restored", "status-error", "status-stale");
		if (shouldShow) el.classList.add("status-" + liveGameStatusState);
	});

	try {
		localStorage.setItem(LIVE_GAME_STATUS_KEY, JSON.stringify({
			state: liveGameStatusState,
			message: text,
			updatedAt: new Date().toISOString(),
			lastLocalSaveAt: lastLiveGameLocalSaveAt,
			lastServerSyncAt: lastLiveGameServerSyncAt
		}));
	} catch (e) {}

	if (options.notify && text) {
		try { showNotification(text, options.duration || 1600); } catch (e) {}
	}
}

function refreshLiveGameStatusDisplay() {
	if (game || hasValidLiveGameAutosave()) {
		setLiveGameStatus(liveGameStatusState === "idle" ? "pending" : liveGameStatusState);
		return;
	}

	try {
		const raw = localStorage.getItem(LIVE_GAME_STATUS_KEY);
		const saved = raw ? JSON.parse(raw) : null;
		if (saved?.state && saved?.message) {
			setLiveGameStatus(saved.state, saved.message);
		}
	} catch (e) {}
}

function markLiveGameServerSyncPending(reason = "") {
	if (game || hasValidLiveGameAutosave()) {
		setLiveGameStatus("pending", reason ? `Local Save OK • Sync Pending (${reason})` : "Local Save OK • Sync Pending");
	}
}

function markLiveGameServerSyncSuccess() {
	lastLiveGameServerSyncAt = new Date().toISOString();
	if (game || hasValidLiveGameAutosave()) {
		setLiveGameStatus("pending", "Local Save OK • Server Backup Pending");
	} else {
		setLiveGameStatus("synced", "Synced");
	}
}

function markLiveGameServerSyncDelayed() {
	if (game || hasValidLiveGameAutosave()) {
		setLiveGameStatus("error", "Server Sync Delayed • Local Save OK");
	} else {
		setLiveGameStatus("error", "Server Sync Delayed");
	}
}

function markReadOnlyDataStale() {
	setLiveGameStatus("stale", "Viewing Stale Read-Only Data");
}

function captureSelectedPitcherState() {
	if (!game) return;
	const select = document.getElementById("pitcherSelect");
	let pitcherIndex = parseInt(select?.value, 10);
	if (!Number.isInteger(pitcherIndex) || pitcherIndex < 0) pitcherIndex = 0;
	const halfInningKey = getCurrentHalfInningKey();
	if (halfInningKey) {
		game.currentInningPitchers = game.currentInningPitchers || {};
		game.currentInningPitchers[halfInningKey] = pitcherIndex;
	}
	game.currentPitcher = {
		halfInningKey,
		pitcherIndex,
		pitcherName: game.fielding?.players?.[pitcherIndex] || null,
		teamName: game.fielding?.name || null
	};
}

function getLiveGameUiState() {
	return {
		errorPickerOpen: !document.getElementById("errorPicker")?.classList.contains("hidden"),
		errorPlayerIndex: parseInt(document.getElementById("errorPlayerSelect")?.value, 10),
		outPickerOpen: !document.getElementById("outPicker")?.classList.contains("hidden"),
		outBase: document.getElementById("outBaseSelect")?.value || "",
		manualRunnerBase: document.getElementById("manualRunnerSelect")?.value || "",
		manualTargetBase: document.getElementById("manualTargetBaseSelect")?.value || "first"
	};
}

function applyLiveGameUiState(uiState = {}) {
	const manualRunner = document.getElementById("manualRunnerSelect");
	const manualTarget = document.getElementById("manualTargetBaseSelect");
	if (manualRunner && uiState.manualRunnerBase) manualRunner.value = uiState.manualRunnerBase;
	if (manualTarget && uiState.manualTargetBase) manualTarget.value = uiState.manualTargetBase;

	if (uiState.outPickerOpen) {
		showOutPicker();
		const outBaseSelect = document.getElementById("outBaseSelect");
		if (outBaseSelect && uiState.outBase) outBaseSelect.value = uiState.outBase;
	} else {
		document.getElementById("outPicker")?.classList.add("hidden");
	}

	if (uiState.errorPickerOpen && lastPlay) {
		showErrorPicker();
		const errorPlayerSelect = document.getElementById("errorPlayerSelect");
		if (errorPlayerSelect && Number.isInteger(uiState.errorPlayerIndex)) {
			errorPlayerSelect.value = String(uiState.errorPlayerIndex);
		}
	} else {
		document.getElementById("errorPicker")?.classList.add("hidden");
	}
}

function buildLiveGameSavePayload() {
	if (!game) return null;
	captureSelectedPitcherState();
	return {
		version: 2,
		savedAt: new Date().toISOString(),
		localRevision: Date.now(),
		localAuthoritative: true,
		lockId: game._lockId || activeGameLock?.lockId || null,
		gameInstanceId: game._gameInstanceId || null,
		game: cloneJson(game),
		gameHistory: Array.isArray(gameHistory) ? gameHistory.slice() : [],
		pendingBattingResult: cloneJson(pendingBattingResult),
		lastPlay: cloneJson(lastPlay),
		uiState: getLiveGameUiState()
	};
}

function persistLiveGameAutosave(reason = "change") {
	if (game?._finalizeInProgress || game?._gameCompletePendingSave) {
		try { localStorage.removeItem(LIVE_GAME_SAVE_KEY); } catch (e) {}
		return false;
	}

	const payload = buildLiveGameSavePayload();
	if (!payload) return false;
	try {
		localStorage.setItem(LIVE_GAME_SAVE_KEY, JSON.stringify(payload));
		lastLiveGameLocalSaveAt = payload.savedAt;
		liveGameLocalAuthoritative = true;
		setLiveGameStatus("pending", reason === "lifecycle" ? "Local Save OK • Background Safe" : "Local Save OK • Sync Pending");
		return true;
	} catch (e) {
		console.warn("live game autosave failed:", e);
		setLiveGameStatus("error", "Local Save Failed", { notify: true, duration: 2200 });
		return false;
	}
}

function readLiveGameAutosave() {
	try {
		const raw = localStorage.getItem(LIVE_GAME_SAVE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		return parsed && parsed.game ? parsed : null;
	} catch (e) {
		return null;
	}
}

function hasValidLiveGameAutosave(snapshot = null) {
	const saved = snapshot || readLiveGameAutosave();
	if (!saved?.game) return false;
	const savedGame = saved.game;
		if (savedGame._finalizeInProgress || savedGame._gameCompletePendingSave) return false;
	const hasTeams = !!savedGame.team1?.name && !!savedGame.team2?.name;
	const hasGameState = Number.isInteger(Number(savedGame.inning)) && (savedGame.halfInning === "top" || savedGame.halfInning === "bottom");
	const hasLock = !!(saved.lockId || savedGame._lockId || savedGame._lockInfo?.lockId);
	return hasTeams && hasGameState && hasLock;
}

function hasLocalLiveGameToProtect() {
	return !!game || hasValidLiveGameAutosave();
}

function isLiveGameRestoreInProgress() {
	return !!liveGameRestoreInProgress;
}

function shouldProtectLiveGameFromServerApply(source = "") {
	if (isLiveGameRestoreInProgress()) return true;
	if (game) return true;
	if (!hasValidLiveGameAutosave()) return false;
	return ["public-view", "hydrate", "realtime", "sync-race", "conflict-recovery", "startup", "menu-refresh"].includes(source);
}

function clearLiveGameAutosave() {
	try { localStorage.removeItem(LIVE_GAME_SAVE_KEY); } catch (e) {}
	liveGameLocalAuthoritative = false;
	if (!game) setLiveGameStatus("synced", "Synced");
}

function resumeLiveGameFromAutosave(snapshot, options = {}) {
	if (!snapshot?.game) return false;

	liveGameRestoreInProgress = true;
	try {
		try { setPublicViewOnlyMode(false); } catch (e) {}
		try { setLeagueUnlocked(true); } catch (e) {}
		try { document.getElementById("accessGate")?.classList.add("hidden"); } catch (e) {}

		game = cloneJson(snapshot.game);
		gameHistory = Array.isArray(snapshot.gameHistory) ? snapshot.gameHistory.slice() : [];
		pendingBattingResult = cloneJson(snapshot.pendingBattingResult) || null;
		lastPlay = cloneJson(snapshot.lastPlay) || null;
		playInputLock = false;

		game._lockId = game._lockId || snapshot.lockId || activeGameLock?.lockId || null;
		if (game._lockInfo?.lockId) persistActiveGameLock(game._lockInfo);
		game.bases = game.bases || { first: null, second: null, third: null };
		game.gameStats = game.gameStats || {};
		game.currentInningPitchers = game.currentInningPitchers || {};
		game.batterIndexByTeam = game.batterIndexByTeam || {
			[game.team1?.name || "Team 1"]: 0,
			[game.team2?.name || "Team 2"]: 0
		};
		game.overtime = normalizeOvertimeState(game.overtime);

		keepLiveGameSectionsEnabled();
		showGame();
		updatePitcherSelect();
		ensureOvertimeHalfSetupAfterResume();
		updateGameScreen();
		applyLiveGameUiState(snapshot.uiState || {});
		document.getElementById("undoButton").disabled = gameHistory.length === 0;
		persistLiveGameAutosave("restore");
		setLiveGameStatus("restored", "Restored Saved Game", { notify: true, duration: 1800 });
		return true;
	} finally {
		liveGameRestoreInProgress = false;
	}
}

async function maybeOfferLiveGameResume(options = {}) {
	const { force = false, auto = false, source = "resume" } = options;
	if (game) {
		refreshLiveGameStatusDisplay();
		return true;
	}

	const snapshot = readLiveGameAutosave();
	if (!hasValidLiveGameAutosave(snapshot)) return false;
	if (isPublicViewOnlyMode() && !force && !auto) return false;

	const snapshotLockId =
		snapshot.lockId ||
		snapshot.game?._lockId ||
		snapshot.game?._lockInfo?.lockId ||
		null;

	if (!snapshotLockId) {
		clearLiveGameAutosave();
		return false;
	}

	let resolvedLock = activeGameLock || null;

	if ((!resolvedLock || resolvedLock.lockId !== snapshotLockId) && snapshot.game?._lockInfo?.lockId === snapshotLockId) {
		persistActiveGameLock(snapshot.game._lockInfo);
		resolvedLock = snapshot.game._lockInfo;
	}

	if (!resolvedLock || resolvedLock.lockId !== snapshotLockId) {
		const scheduleRef = snapshot.game?._scheduleRef || null;
		const fallbackLock = snapshot.game?._lockInfo || {
			lockId: snapshotLockId,
			type: scheduleRef ? "scheduled" : "manual",
			team1: snapshot.game?.team1?.name || "",
			team2: snapshot.game?.team2?.name || "",
			dayNumber: Number.isInteger(scheduleRef?.dayIndex) ? scheduleRef.dayIndex + 1 : undefined,
			seriesNumber: Number.isInteger(scheduleRef?.seriesIndex) ? scheduleRef.seriesIndex + 1 : undefined,
			seriesGameNumber: Number.isInteger(scheduleRef?.seriesGameIndex) ? scheduleRef.seriesGameIndex + 1 : undefined,
			startedAt: snapshot.savedAt || new Date().toISOString(),
			startedByName: (typeof getStoredName === "function" ? getStoredName() : "") || CURRENT_EMAIL || "This device"
		};
		persistActiveGameLock(fallbackLock);
		resolvedLock = fallbackLock;
	}

	const scheduleRef = snapshot.game?._scheduleRef;
	if (
		scheduleRef &&
		Number.isInteger(scheduleRef.dayIndex) &&
		Number.isInteger(scheduleRef.seriesIndex) &&
		Number.isInteger(scheduleRef.seriesGameIndex)
	) {
		const seriesGame =
			schedule?.days?.[scheduleRef.dayIndex]?.games?.[scheduleRef.seriesIndex]?.gamesInSeries?.[scheduleRef.seriesGameIndex];

		if (seriesGame?.result || seriesGame?.skipped) {
			clearLiveGameAutosave();
			return false;
		}
	}

	if (!auto) {
		if (liveGameResumePromptShown) return false;
		liveGameResumePromptShown = true;

		const label =
			getActiveGameLockLabel(resolvedLock) ||
			`${snapshot.game?.team1?.name || "Team 1"} vs ${snapshot.game?.team2?.name || "Team 2"}`;

		if (!confirm(`A live game save was found on this device.\n\n${label}\n\nResume this in-progress game?`)) {
			return false;
		}
	}

	const restored = resumeLiveGameFromAutosave(snapshot, { source });
	if (restored && typeof verifyRestoredLiveGameAgainstServer === "function") {
		setTimeout(() => verifyRestoredLiveGameAgainstServer(snapshot), 0);
	}
	return restored;
}

async function verifyRestoredLiveGameAgainstServer(snapshot) {
	const scheduleRef = snapshot?.game?._scheduleRef;
	if (!scheduleRef || typeof fetchSeasonRowFromServer !== "function") return true;
	if (!Number.isInteger(scheduleRef.dayIndex) || !Number.isInteger(scheduleRef.seriesIndex) || !Number.isInteger(scheduleRef.seriesGameIndex)) return true;

	try {
		const row = await fetchSeasonRowFromServer({ quiet: true });
		const serverSchedule = row?.schedule_json ? ensureScheduleShape(deepCloneJson(row.schedule_json)) : null;
		const serverGame = serverSchedule?.days?.[scheduleRef.dayIndex]?.games?.[scheduleRef.seriesIndex]?.gamesInSeries?.[scheduleRef.seriesGameIndex];
		if (serverGame?.result || serverGame?.skipped) {
			setLiveGameStatus("error", "Server already has this game finalized");
			alert("This scheduled game appears to already be finalized on the server. Do not finalize this restored copy unless you are sure the server result is wrong.");
			return false;
		}
	} catch (e) {
		markLiveGameServerSyncDelayed();
	}
	return true;
}

function saveLiveGameForLifecycle(reason = "lifecycle") {
	if (!game) return false;
	return persistLiveGameAutosave(reason);
}

function restoreLiveGameAfterReturn(reason = "return") {
	refreshLiveGameStatusDisplay();
	if (game) {
		persistLiveGameAutosave("lifecycle");
		setLiveGameStatus("restored", "Returned to Saved Game", { notify: true, duration: 1400 });
		return true;
	}
	return maybeOfferLiveGameResume({ force: true, auto: true, source: reason });
}

function installLiveGameLifecycleAutosave() {
	if (liveGameLifecycleWired) return;
	liveGameLifecycleWired = true;

	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") {
			saveLiveGameForLifecycle("lifecycle");
		} else if (document.visibilityState === "visible") {
			restoreLiveGameAfterReturn("visibility-return");
		}
	});

	window.addEventListener("pagehide", () => saveLiveGameForLifecycle("lifecycle"));
	window.addEventListener("beforeunload", () => saveLiveGameForLifecycle("lifecycle"));
	window.addEventListener("pageshow", () => restoreLiveGameAfterReturn("pageshow"));
	window.addEventListener("focus", () => {
		if (hasValidLiveGameAutosave() || game) restoreLiveGameAfterReturn("focus-return");
	});

	try {
		document.addEventListener("freeze", () => saveLiveGameForLifecycle("lifecycle"));
	} catch (e) {}
}

installLiveGameLifecycleAutosave();
