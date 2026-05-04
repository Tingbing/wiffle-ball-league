// Wiffle Ball League - app.game.autosave.js
// Split from the source-of-truth app.game.js. Load after app.core.js in the required order.
// Purpose: Live-game crash/reload autosave, resume, and UI-state restore helpers.

const LIVE_GAME_SAVE_KEY = "wiggleLiveGameStateV1";

let liveGameResumePromptShown = false;

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
		version: 1,
		savedAt: new Date().toISOString(),
		lockId: game._lockId || activeGameLock?.lockId || null,
		gameInstanceId: game._gameInstanceId || null,
		game: cloneJson(game),
		gameHistory: Array.isArray(gameHistory) ? gameHistory.slice() : [],
		pendingBattingResult: cloneJson(pendingBattingResult),
		lastPlay: cloneJson(lastPlay),
		uiState: getLiveGameUiState()
	};
}

function persistLiveGameAutosave() {
	const payload = buildLiveGameSavePayload();
	if (!payload) return false;
	try {
		localStorage.setItem(LIVE_GAME_SAVE_KEY, JSON.stringify(payload));
		return true;
	} catch (e) {
		console.warn("live game autosave failed:", e);
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

function clearLiveGameAutosave() {
	try { localStorage.removeItem(LIVE_GAME_SAVE_KEY); } catch (e) {}
}

function resumeLiveGameFromAutosave(snapshot) {
	if (!snapshot?.game) return false;

	game = cloneJson(snapshot.game);
	gameHistory = Array.isArray(snapshot.gameHistory) ? snapshot.gameHistory.slice() : [];
	pendingBattingResult = cloneJson(snapshot.pendingBattingResult) || null;
	lastPlay = cloneJson(snapshot.lastPlay) || null;
	playInputLock = false;

	game._lockId = game._lockId || snapshot.lockId || activeGameLock?.lockId || null;
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
	persistLiveGameAutosave();
	showNotification("Recovered saved live game", 1500);
	return true;
}

async function maybeOfferLiveGameResume() {
	if (game || isPublicViewOnlyMode()) return;

	const snapshot = readLiveGameAutosave();
	if (!snapshot?.game) return;

	const snapshotLockId =
		snapshot.lockId ||
		snapshot.game?._lockId ||
		snapshot.game?._lockInfo?.lockId ||
		null;

	if (!snapshotLockId) {
		clearLiveGameAutosave();
		return;
	}

	let resolvedLock = activeGameLock || null;

	// First try to recover the lock from the saved snapshot itself
	if ((!resolvedLock || resolvedLock.lockId !== snapshotLockId) && snapshot.game?._lockInfo?.lockId === snapshotLockId) {
		persistActiveGameLock(snapshot.game._lockInfo);
		resolvedLock = snapshot.game._lockInfo;
	}

	// Then try server state if needed
	if ((!resolvedLock || resolvedLock.lockId !== snapshotLockId) && typeof fetchSeasonRowFromServer === "function") {
		try {
			const row = await fetchSeasonRowFromServer({ quiet: true });
			const serverLock = row?.active_game_lock || null;
			if (serverLock?.lockId === snapshotLockId) {
				persistActiveGameLock(serverLock);
				resolvedLock = serverLock;
			}
		} catch (e) {
			console.warn("resume lock fetch failed:", e);
		}
	}

	// Last fallback: rebuild a local lock from the snapshot instead of deleting the autosave
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

		if (seriesGame?.result) {
			clearLiveGameAutosave();
			return;
		}
	}

	if (liveGameResumePromptShown) return;
	liveGameResumePromptShown = true;

	const label =
		getActiveGameLockLabel(resolvedLock) ||
		`${snapshot.game?.team1?.name || "Team 1"} vs ${snapshot.game?.team2?.name || "Team 2"}`;

	if (!confirm(`A live game save was found on this device.\n\n${label}\n\nResume this in-progress game?`)) {
		return;
	}

	resumeLiveGameFromAutosave(snapshot);
}
