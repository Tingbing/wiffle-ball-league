// Full live-game snapshots; recording ownership and durable writes live in app.recording.js.
const LIVE_GAME_SAVE_KEY = "wiggleLiveGameStateV1"; // Retained for legacy recovery export only.
let liveGameRestoreInProgress = false;
function buildLiveGameSavePayload() {
  if (!game) return null;
  return {version:3, game:cloneJson(game), gameHistory:cloneJson(gameHistory),
    lastPlay:cloneJson(lastPlay), pendingBattingResult:cloneJson(pendingBattingResult), uiState:getLiveGameUiState()};
}
function persistLiveGameAutosave() {
  // Calls inside scoring functions are coalesced by runLiveGameAction, after the entire action.
  // Rendering a viewer must never enqueue a game write.
  return true;
}
function readLiveGameAutosave() { return recording.pending?.state || null; }
function hasValidLiveGameAutosave() { return !!recording.pending?.state; }
function clearLiveGameAutosave() { /* Only recordingConfirmed() clears acknowledged recovery. */ }
function hasLocalLiveGameToProtect() { return !!game || !!recording.pending; }
function isLiveGameRestoreInProgress() { return liveGameRestoreInProgress; }
function shouldProtectLiveGameFromServerApply() { return !!recording.pending; }
async function maybeOfferLiveGameResume() { return false; }
function saveLiveGameForLifecycle() { return persistRecordingRecovery(); }
function restoreLiveSnapshot(snapshot) {
  if (!snapshot?.game) return;
  liveGameRestoreInProgress = true;
  try {
    game = cloneJson(snapshot.game); gameHistory=cloneJson(snapshot.gameHistory || []);
    lastPlay=cloneJson(snapshot.lastPlay); pendingBattingResult=cloneJson(snapshot.pendingBattingResult);
    game._finalizeInProgress=false;
    playInputLock=false;
    showGame(); updatePitcherSelect(); updateGameScreen();
    applyLiveGameUiState(snapshot.uiState || {});
  } finally { liveGameRestoreInProgress=false; renderRecordingStatus(); }
}
function setLiveGameStatus(_state,message='') { if (message) setConnectionMessage(message); }
function markLiveGameServerSyncPending() { renderRecordingStatus(); }
function markLiveGameServerSyncSuccess() { renderRecordingStatus(); }
function markLiveGameServerSyncDelayed() { renderRecordingStatus(); }
function refreshLiveGameStatusDisplay() { renderRecordingStatus(); }
function setAppWorking(isWorking,message='Working…') { if(isWorking) setConnectionMessage(message); }
async function withAppWorking(message,fn) { setAppWorking(true,message); return await fn(); }
function getLiveGameUiState() {
	return {
		errorPickerOpen: !document.getElementById("errorPicker")?.classList.contains("hidden"),
		errorPlayerIndex: Number.isInteger(parseInt(document.getElementById("errorPlayerSelect")?.value, 10))
      ? parseInt(document.getElementById("errorPlayerSelect").value, 10) : null,
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
