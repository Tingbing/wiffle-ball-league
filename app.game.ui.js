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
		endHalfInning(pitcherKey, "Runner thrown out — side over!");
		updateGameScreen();
		return;
	}

	updateGameScreen();
}

function updatePitcherSelect() {
	let select = document.getElementById("pitcherSelect");
	select.innerHTML = "";

	game.fielding.players.forEach((player, i) => {
		let opt = document.createElement("option");
		opt.value = i;
		opt.text = player;
		select.appendChild(opt);
	});

	let halfInningKey = game.inning + "-" + game.halfInning;
	if (game.currentInningPitchers[halfInningKey] !== undefined) {
		select.selectedIndex = game.currentInningPitchers[halfInningKey];
	}

	updatePitcherDisplay();
}

function updatePitcherDisplay() {
	let select = document.getElementById("pitcherSelect");
	let pitcherIndex = parseInt(select.value);
	let pitcher = game.fielding.players[pitcherIndex];
	document.getElementById("pitcherText").innerText = "Pitching: " + pitcher;
	rememberPitcherOfRecordForFieldingTeam();
	captureSelectedPitcherState();
	persistLiveGameAutosave();
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
