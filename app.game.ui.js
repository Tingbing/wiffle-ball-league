// Wiffle Ball League - app.game.ui.js
// Split from the source-of-truth app.game.js. Load after app.core.js in the required order.
// Purpose: Live recording screen DOM updates, bases display, pitcher display, runner-out UI, and error picker UI.

function showOutPicker() {
	if (!game) return;

	if (!game.bases.first && !game.bases.second && !game.bases.third) {
		showNotification("No runners on base", 1200);
		return;
	}

	const sel = document.getElementById("outBaseSelect");
	sel.innerHTML = "";

	const options = [
		{ base: "first", label: "Runner on 1st" },
		{ base: "second", label: "Runner on 2nd" },
		{ base: "third", label: "Runner on 3rd" }
	];

	options.forEach(o => {
		if (game.bases[o.base]) {
			const opt = document.createElement("option");
			opt.value = o.base;
			opt.text = o.label + " (" + game.bases[o.base].player + ")";
			sel.appendChild(opt);
		}
	});

	document.getElementById("outPicker").classList.remove("hidden");
	persistLiveGameAutosave();
}

function cancelRunnerOut() {
	document.getElementById("outPicker").classList.add("hidden");
	persistLiveGameAutosave();
}

function keepLiveGameSectionsEnabled() {
	const battingSection = document.getElementById("battingSection");
	const pitchingSection = document.getElementById("pitchingSection");

	if (battingSection) battingSection.classList.remove("disabled");
	if (pitchingSection) pitchingSection.classList.remove("disabled");
}

function confirmRunnerOut() {
	return runLiveGameAction("runner out", () => applyConfirmRunnerOut());
}

function applyConfirmRunnerOut() {
	if (!game) return;

	const base = document.getElementById("outBaseSelect").value;
	if (!base || !game.bases[base]) {
		showNotification("No runner there", 1200);
		cancelRunnerOut();
		return;
	}

	gameHistory.push(saveGameState());
	document.getElementById("undoButton").disabled = false;

	const removed = normalizeBaseRunner(game.bases[base], game.batting);
	game.bases[base] = null;
	game.outs++;

	const pitcherKey = getCurrentPitcherKey();
	const pitcherStats = ensureExtendedStatFields(game?.gameStats?.[pitcherKey]);
	if (pitcherStats) {
		pitcherStats.pitchOuts += 1;
		syncPitchingInnings(pitcherStats);
	}

	cancelRunnerOut();
	showNotification(removed.player + " thrown out!", 1200);

	if (game.outs >= 2) {
		const transitionResult = endHalfInning(pitcherKey, "Runner thrown out — side over!");
		if (transitionResult !== "finalizing") updateGameScreen();
		return;
	}

	updateGameScreen();
}

function getSelectedPitcherIndex() {
	const select = document.getElementById("pitcherSelect");
	const pitcherIndex = parseInt(select?.value, 10);
	if (!Number.isInteger(pitcherIndex) || pitcherIndex < 0) return -1;
	if (!Array.isArray(game?.fielding?.players) || !game.fielding.players[pitcherIndex]) return -1;
	return pitcherIndex;
}

function hasValidSelectedPitcher() {
	return getSelectedPitcherIndex() >= 0;
}

function isPitcherSelectionBlockingPlayInput() {
	if (!game || game._finalizeInProgress || game._gameCompletePendingSave) return false;
	ensurePitcherSelectionRequirementForCurrentHalfInning("check", { silent: true });
	return game?.pitcherSelectionRequired === true || !hasValidSelectedPitcher();
}

function requirePitcherSelectionForCurrentHalfInning(reason = "", options = {}) {
	if (!game || game._finalizeInProgress || game._gameCompletePendingSave) return false;
	game.pitcherSelectionRequired = true;
	game.pitcherSelectionRequiredHalfInningKey = getCurrentHalfInningKey();
	document.getElementById("errorPicker")?.classList.add("hidden");
	document.getElementById("outPicker")?.classList.add("hidden");
	applyPitcherSelectionLockState();
	if (!options.silent) {
		showNotification("Select/confirm the pitcher before recording plays.", 1800);
	}
	try { persistLiveGameAutosave(reason || "pitcher-required"); } catch (e) {}
	return true;
}

function ensurePitcherSelectionRequirementForCurrentHalfInning(reason = "", options = {}) {
	if (!game || game._finalizeInProgress || game._gameCompletePendingSave) {
		applyPitcherSelectionLockState();
		return false;
	}

	const halfInningKey = getCurrentHalfInningKey();
	const confirmedKey = game.pitcherSelectionConfirmedHalfInningKey || "";
	const currentPitcherKey = game.currentPitcher?.halfInningKey || "";
	const validPitcher = hasValidSelectedPitcher();

	if (game.pitcherSelectionRequired === true && game.pitcherSelectionRequiredHalfInningKey === halfInningKey) {
		applyPitcherSelectionLockState();
		return true;
	}

	if (!validPitcher || (confirmedKey !== halfInningKey && currentPitcherKey !== halfInningKey)) {
		return requirePitcherSelectionForCurrentHalfInning(reason || "pitcher-required", options);
	}

	game.pitcherSelectionRequired = false;
	applyPitcherSelectionLockState();
	return false;
}

function applyPitcherSelectionLockState() {
	if (game && (game._finalizeInProgress || game._gameCompletePendingSave)) return;

	const locked = !!(game && game.pitcherSelectionRequired === true);
	const selectors = [
		"#gameScreen .live-button-grid button",
		"#gameScreen .live-top-tools button",
		"#gameScreen .live-runner-out-card button",
		"#gameScreen .live-manual-controls button",
		"#gameScreen #manualRunnerSelect",
		"#gameScreen #manualTargetBaseSelect"
	].join(",");

	document.querySelectorAll(selectors).forEach(el => {
		if (!el) return;
		el.disabled = locked;
	});

	const undoButton = document.getElementById("undoButton");
	if (undoButton) undoButton.disabled = locked || gameHistory.length === 0;

	const pitcherSelect = document.getElementById("pitcherSelect");
	if (pitcherSelect) pitcherSelect.disabled = false;

	const confirmButton = document.getElementById("confirmPitcherButton");
	if (confirmButton) confirmButton.disabled = !game || !hasValidSelectedPitcher();

	const notice = document.getElementById("pitcherRequiredNotice");
	if (notice) notice.classList.toggle("hidden", !locked);

	const pitchingSection = document.getElementById("pitchingSection");
	if (pitchingSection) pitchingSection.classList.toggle("pitcher-required", locked);
}

function updatePitcherSelect() {
	let select = document.getElementById("pitcherSelect");
	if (!select || !game?.fielding?.players) return;
	select.innerHTML = "";

	game.fielding.players.forEach((player, i) => {
		let opt = document.createElement("option");
		opt.value = i;
		opt.text = player;
		select.appendChild(opt);
	});

	let halfInningKey = game.inning + "-" + game.halfInning;
	if (game.currentInningPitchers && game.currentInningPitchers[halfInningKey] !== undefined) {
		select.selectedIndex = game.currentInningPitchers[halfInningKey];
	} else {
		select.selectedIndex = 0;
	}

	updatePitcherDisplay({ renderOnly: true });
}

function updatePitcherDisplay(options = {}) {
	let select = document.getElementById("pitcherSelect");
	if (!select || !game?.fielding?.players) return;
	let pitcherIndex = getSelectedPitcherIndex();
	let pitcher = pitcherIndex >= 0 ? game.fielding.players[pitcherIndex] : null;
	document.getElementById("pitcherText").innerText = pitcher ? "Pitching: " + pitcher : "Pitching: Select pitcher";

	if (options.renderOnly) {
		applyPitcherSelectionLockState();
		return;
	}

	if (!pitcher) {
		requirePitcherSelectionForCurrentHalfInning("invalid-pitcher", { silent: true });
		return;
	}

	const halfInningKey = getCurrentHalfInningKey();
	game.currentInningPitchers = game.currentInningPitchers || {};
	game.currentInningPitchers[halfInningKey] = pitcherIndex;
	game.currentPitcher = {
		halfInningKey,
		pitcherIndex,
		pitcherName: pitcher,
		teamName: game.fielding?.name || null
	};
	game.pitcherSelectionRequired = false;
	game.pitcherSelectionRequiredHalfInningKey = "";
	game.pitcherSelectionConfirmedHalfInningKey = halfInningKey;
	rememberPitcherOfRecordForFieldingTeam();
	applyPitcherSelectionLockState();
	persistLiveGameAutosave("pitcher-selected");
}

function confirmCurrentPitcherSelection() {
	updatePitcherDisplay();
	if (!game?.pitcherSelectionRequired && hasValidSelectedPitcher()) {
		showNotification("Pitcher confirmed. Play buttons unlocked.", 1200);
	}
}

function updateGameScreen() {
	document.getElementById("team1Name").innerText = game.team1.name;
	document.getElementById("team2Name").innerText = game.team2.name;
	document.getElementById("team1Score").innerText = game.team1Score;
	document.getElementById("team2Score").innerText = game.team2Score;

document.getElementById("inningText").innerText = getLiveInningLabel();

	document.getElementById("outsText").innerText = "Outs: " + game.outs + "/2";

	const batterIndex = getCurrentBatterIndex();
	let player = game.batting.players[batterIndex] || "No Player";
	document.getElementById("batterText").innerText = player;

updateBasesDisplay();
updateManualRunnerControls();
ensurePitcherSelectionRequirementForCurrentHalfInning("screen-update", { silent: true });
applyPitcherSelectionLockState();
persistLiveGameAutosave();
}

	function updateBasesDisplay() {
		let base1 = document.getElementById("base1");
		let base2 = document.getElementById("base2");
		let base3 = document.getElementById("base3");

		base1.className = "base first";
		base2.className = "base second";
		base3.className = "base third";
		base1.innerText = "1st";
		base2.innerText = "2nd";
		base3.innerText = "3rd";

		if (game.bases.first) {
			if (game.bases.first.type === "ghostie") {
				base1.classList.add("ghostie");
				base1.innerText = "1st\n👻";
			} else {
				base1.classList.add("occupied");
				base1.innerText = "1st\n" + game.bases.first.player;
			}
		}

		if (game.bases.second) {
			if (game.bases.second.type === "ghostie") {
				base2.classList.add("ghostie");
				base2.innerText = "2nd\n👻";
			} else {
				base2.classList.add("occupied");
				base2.innerText = "2nd\n" + game.bases.second.player;
			}
		}

		if (game.bases.third) {
			if (game.bases.third.type === "ghostie") {
				base3.classList.add("ghostie");
				base3.innerText = "3rd\n👻";
			} else {
				base3.classList.add("occupied");
				base3.innerText = "3rd\n" + game.bases.third.player;
			}
		}
	}

function updateManualRunnerControls() {
	const runnerSelect = document.getElementById("manualRunnerSelect");
	const targetSelect = document.getElementById("manualTargetBaseSelect");
	if (!runnerSelect || !targetSelect) return;

	runnerSelect.innerHTML = "";

	const runnerOptions = [
		{ base: "first", label: "Runner on 1st" },
		{ base: "second", label: "Runner on 2nd" },
		{ base: "third", label: "Runner on 3rd" }
	];

	let hasRunner = false;
	runnerOptions.forEach(option => {
		if (game?.bases?.[option.base]) {
			const opt = document.createElement("option");
			opt.value = option.base;
			opt.text = option.label + " (" + game.bases[option.base].player + ")";
			runnerSelect.appendChild(opt);
			hasRunner = true;
		}
	});

	if (!hasRunner) {
		const emptyOpt = document.createElement("option");
		emptyOpt.value = "";
		emptyOpt.text = "No runners on base";
		runnerSelect.appendChild(emptyOpt);
	}
}

function showErrorPicker() {
	if (!lastPlay) {
		alert("No play to assign an error to yet.");
		return;
	}

	const fielders = Array.isArray(lastPlay.fieldingPlayers) && lastPlay.fieldingPlayers.length
		? lastPlay.fieldingPlayers
		: (game?.fielding?.players || []);

	if (!fielders.length) {
		alert("No fielders available for that play.");
		return;
	}

	let sel = document.getElementById("errorPlayerSelect");
	sel.innerHTML = "";

	fielders.forEach((p, i) => {
		let opt = document.createElement("option");
		opt.value = i;
		opt.text = p;
		sel.appendChild(opt);
	});

	document.getElementById("errorPicker").classList.remove("hidden");
	persistLiveGameAutosave();
}

function cancelError() {
	document.getElementById("errorPicker").classList.add("hidden");
	persistLiveGameAutosave();
}
