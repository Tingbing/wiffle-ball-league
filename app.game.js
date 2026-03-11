// Wiffle Ball League - Live game engine + stats
// Split from the current source-of-truth app.js. Load this AFTER app.core.js.

// RUNNER OUT PICKER (kept with gameplay helpers)

function showOutPicker() {
if (!game) return;

// If no runners on, don't show
if (!game.bases.first && !game.bases.second && !game.bases.third) {
showNotification("No runners on base", 1200);
return;
}

// Build dropdown to only show bases that actually have runners
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
}

function cancelRunnerOut() {
document.getElementById("outPicker").classList.add("hidden");
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

// Save for undo
gameHistory.push(saveGameState());
document.getElementById("undoButton").disabled = false;

// Remove runner + add out
const removed = game.bases[base];
game.bases[base] = null;
game.outs++;

cancelRunnerOut();
showNotification(removed.player + " thrown out!", 1200);

// If that makes 2 outs, end the half-inning using the SAME logic as normal outs
if (game.outs >= 2) {
const pitcherKey = getCurrentPitcherKey();
endHalfInning(pitcherKey, "Runner thrown out — side over!");
updateGameScreen();
return;
}

updateGameScreen();
}

// LIVE GAME ENGINE

function startGameWithTeams(t1, t2, scheduleRef = null, lockInfo = null) {
	const activeTeam1 = buildActiveTeamForGame(t1, scheduleRef);
	const activeTeam2 = buildActiveTeamForGame(t2, scheduleRef);

	activeTeam1.players.forEach(playerName => {
		const statsKey = activeTeam1._playerMeta?.[playerName]?.statsKey;
		if (isSubKey(statsKey)) initSubStats(playerName);
		else initPlayerStats(activeTeam1.name, playerName);
	});

	activeTeam2.players.forEach(playerName => {
		const statsKey = activeTeam2._playerMeta?.[playerName]?.statsKey;
		if (isSubKey(statsKey)) initSubStats(playerName);
		else initPlayerStats(activeTeam2.name, playerName);
	});

	let batting = Math.random() > 0.5 ? activeTeam1 : activeTeam2;
	let fielding = batting === activeTeam1 ? activeTeam2 : activeTeam1;

	game = {
		team1: activeTeam1,
		team2: activeTeam2,
		team1Score: 0,
		team2Score: 0,
		batting: batting,
		fielding: fielding,
		outs: 0,
		inning: 1,
		halfInning: "top",
		batterIndex: 0,
		currentPitcher: null,
		bases: { first: null, second: null, third: null },
		gameStats: {},
		currentInningPitchers: {},
	halfInningRuns: 0,
_scheduleRef: scheduleRef,
_lockId: lockInfo?.lockId || null,
_lockInfo: lockInfo || null
	};

	[activeTeam1, activeTeam2].forEach(teamObj => {
		(teamObj.players || []).forEach(playerName => {
			const statsKey = getGameStatsKey(teamObj, playerName);
			game.gameStats[statsKey] = createEmptyStats(teamObj.name, playerName, {
				playerName,
				teamName: teamObj.name,
				isSub: isSubKey(statsKey),
				replacedPlayer: teamObj._playerMeta?.[playerName]?.originalPlayer || playerName
			});
		});
	});

	gameHistory = [];
	pendingBattingResult = null;
	lastPlay = null;
	playInputLock = false;
document.getElementById("undoButton").disabled = true;
	keepLiveGameSectionsEnabled();
	showGame();
	updatePitcherSelect();
	updateGameScreen();
}

async function beginLockedGame(t1, t2, scheduleRef = null, extraLockDetails = {}) {
	const attempt = await acquireGameLock({
		type: scheduleRef ? "scheduled" : "manual",
		team1: t1?.name || "",
		team2: t2?.name || "",
		...extraLockDetails
	});

	if (!attempt.ok) {
		refreshGameLockUI();
		const lockLabel = getActiveGameLockLabel(attempt.lock || activeGameLock);
		alert(lockLabel
			? `Another game is already being recorded.\n\n${lockLabel}\n\nWait until that game is finished or ended early.`
			: "Another game is already being recorded. Wait until it is finished or ended early.");
		return false;
	}

	if (scheduleRef && attempt.row) {
		const serverSchedule = ensureScheduleShape(attempt.row.schedule_json);
		const freshSeriesGame = serverSchedule?.days?.[scheduleRef.dayIndex]?.games?.[scheduleRef.seriesIndex]?.gamesInSeries?.[scheduleRef.seriesGameIndex];
		if (freshSeriesGame?.result) {
			await releaseGameLock(attempt.lockId, { quiet: true });
			applyServerSeasonRow(attempt.row);
			alert("That game was already recorded on another device.");
			return false;
		}
	}

	startGameWithTeams(t1, t2, scheduleRef, attempt.lock);
	return true;
}

async function startGame() {
	let validTeams = league.teams.filter(t => t.players.length > 0);

	let team1Index = parseInt(document.getElementById("team1Select").value);
	let team2Index = parseInt(document.getElementById("team2Select").value);

	if (team1Index === team2Index) {
		alert("Please select two different teams!");
		return;
	}

	let t1 = validTeams[team1Index];
	let t2 = validTeams[team2Index];

	await beginLockedGame(t1, t2, null, { type: "manual" });
}

function resetLiveGameSessionState() {
	game = null;
	gameHistory = [];
	lastPlay = null;
	pendingBattingResult = null;
	playInputLock = false;

	document.getElementById("errorPicker")?.classList.add("hidden");
	document.getElementById("outPicker")?.classList.add("hidden");
}

async function endGameEarly() {
	if (!game) return;
	if (!confirm("End this game early? All progress for this game will be discarded.")) return;

	const released = await releaseGameLock(game._lockId || activeGameLock?.lockId || null, { quiet: true });
	if (!released) {
		alert("Could not clear the live-game lock yet. Stay in the game and try End Game Early again.");
		return;
	}

	resetLiveGameSessionState();
	showMainMenu();
	alert("Game ended early. No stats, schedule results, or standings were saved.");
}

async function emergencyEndGameFromSetup() {
	if (!activeGameLock && !game) {
		alert("There is no active game to clear right now.");
		return;
	}

	if (!confirm("Emergency End Game will clear the current live-game lock and discard the active game. Use this only if a game got stuck. Continue?")) return;

	const released = await releaseGameLock(game?._lockId || activeGameLock?.lockId || null, { quiet: true });
	if (!released) {
		alert("Could not clear the live-game lock. Try again while signed in.");
		return;
	}

	resetLiveGameSessionState();
	refreshGameLockUI();
	alert("The stuck live game was cleared. You can start a new game now.");
}

	// GAME FUNCTIONS
	function saveGameState() {
		return JSON.stringify({
			team1Score: game.team1Score,
			team2Score: game.team2Score,
			outs: game.outs,
			halfInningRuns: game.halfInningRuns,
			inning: game.inning,
			halfInning: game.halfInning,
			batterIndex: game.batterIndex,
			currentPitcher: game.currentPitcher,
			bases: {
				first: game.bases.first ? {...game.bases.first} : null,
				second: game.bases.second ? {...game.bases.second} : null,
				third: game.bases.third ? {...game.bases.third} : null
			},
			gameStats: JSON.parse(JSON.stringify(game.gameStats)),
			batting: game.batting,
			fielding: game.fielding,
			currentInningPitchers: {...game.currentInningPitchers},
			pendingBattingResult: pendingBattingResult
		});
	}

	function restoreGameState(stateString) {
		let state = JSON.parse(stateString);
		game.team1Score = state.team1Score;
		game.team2Score = state.team2Score;
		game.halfInningRuns = state.halfInningRuns ?? 0;
		game.outs = state.outs;
		game.inning = state.inning;
		game.halfInning = state.halfInning;
		game.batterIndex = state.batterIndex;
		game.currentPitcher = state.currentPitcher;
		game.bases = state.bases;
		game.gameStats = state.gameStats;
		game.batting = state.batting;
		game.fielding = state.fielding;
		game.currentInningPitchers = state.currentInningPitchers;
		pendingBattingResult = state.pendingBattingResult;
	}

function undoLastAction() {
  if (gameHistory.length > 0) {
    let previousState = gameHistory.pop();
    restoreGameState(previousState);

    // Keep undo simple with the new auto-clean batting flow
    pendingBattingResult = null;
keepLiveGameSectionsEnabled();
    updatePitcherSelect();
    updateGameScreen();

    if (gameHistory.length === 0) {
      document.getElementById("undoButton").disabled = true;
    }
  }
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
	}

function updateGameScreen() {
	document.getElementById("team1Name").innerText = game.team1.name;
	document.getElementById("team2Name").innerText = game.team2.name;
	document.getElementById("team1Score").innerText = game.team1Score;
	document.getElementById("team2Score").innerText = game.team2Score;

	let halfText = game.halfInning === "top" ? "Top" : "Bottom";
	document.getElementById("inningText").innerText =
		halfText + " of Inning " + game.inning + " | " + game.batting.name + " Batting";

	document.getElementById("outsText").innerText = "Outs: " + game.outs + "/2";

	let player = game.batting.players[game.batterIndex] || "No Player";
	document.getElementById("batterText").innerText = player;

	updateBasesDisplay();
	updateManualRunnerControls();
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


function countBaseRunners() {
  if (!game || !game.bases) return 0;
  return ['first','second','third'].reduce((n,b)=> n + (game.bases[b] ? 1 : 0), 0);
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

function executeManualRunnerMove() {
	if (!game) return;

	const fromBase = document.getElementById("manualRunnerSelect")?.value;
	const toBase = document.getElementById("manualTargetBaseSelect")?.value;

	if (!fromBase) {
		showNotification("No runner available to move", 1200);
		return;
	}

	if (toBase === "home") {
		if (fromBase !== "third") {
			showNotification("Only a runner on 3rd can be scored manually", 1500);
			return;
		}
		manualScoreFromThird();
		return;
	}

	if (fromBase === toBase) {
		showNotification("Runner is already on that base", 1200);
		return;
	}

	manualMove(fromBase, toBase);
}

function getCurrentPitcherKey() {
	// pitcher is always from the fielding team
	let pitcherIndex = parseInt(document.getElementById("pitcherSelect").value);
	let pitcher = game.fielding.players[pitcherIndex];
	return getGameStatsKey(game.fielding, pitcher);
}

function manualMove(fromBase, toBase) {
// fromBase/toBase are: "first","second","third"
if (!game) return;

if (!game.bases[fromBase]) {
showNotification("No runner on " + fromBase, 1200);
return;
}
if (game.bases[toBase]) {
showNotification(toBase + " is already occupied", 1200);
return;
}

// Save for undo (optional but recommended)
gameHistory.push(saveGameState());
document.getElementById("undoButton").disabled = false;

// Move runner object exactly as-is (keeps reachedOnError flag)
game.bases[toBase] = game.bases[fromBase];
game.bases[fromBase] = null;

updateGameScreen();
}

function manualScoreFromThird() {
if (!game) return;

if (!game.bases.third) {
showNotification("No runner on 3rd", 1200);
return;
}

// Save for undo
gameHistory.push(saveGameState());
document.getElementById("undoButton").disabled = false;

const runner = game.bases.third;

// Remove runner from base
game.bases.third = null;

// Add run to batting team score
if (game.batting === game.team1) game.team1Score += 1;
else game.team2Score += 1;

// Pitcher stats (runs + earned runs)
const pitcherKey = getCurrentPitcherKey();
if (game.gameStats[pitcherKey]) {
game.gameStats[pitcherKey].runsAllowed += 1;

// earned if runner did NOT reach on error
if (!runner.reachedOnError) {
game.gameStats[pitcherKey].earnedRunsAllowed += 1;
}
}

showNotification("Run scored!", 1200);
updateGameScreen();
}

function clearBases() {
if (!game) return;

gameHistory.push(saveGameState());
document.getElementById("undoButton").disabled = false;

game.bases.first = null;
game.bases.second = null;
game.bases.third = null;

showNotification("Bases cleared", 1200);
updateGameScreen();
}

function advanceRunners(bases, currentBatter, reachedOnError = false) {
let runs = 0;
let earnedRuns = 0;
let rbis = 0;

function moveRunner(runner, n) {
if (!runner) return null;
return runner; 
}

function scoreRunner(runner) {
if (!runner) return;
runs++;
rbis++;
if (!runner.reachedOnError) earnedRuns++;
}

// Grab current base runners
let r1 = game.bases.first;
let r2 = game.bases.second;
let r3 = game.bases.third;

// Clear bases; we will rebuild them
game.bases.first = null;
game.bases.second = null;
game.bases.third = null;

// Helper: place runner on a base if not scoring
function place(baseNum, runner) {
if (!runner) return;
if (baseNum === 1) game.bases.first = runner;
if (baseNum === 2) game.bases.second = runner;
if (baseNum === 3) game.bases.third = runner;
}

// Advance existing runners:
// For each runner, compute where they end up after `bases` advancement.
// Starting base: 1 for r1, 2 for r2, 3 for r3.
function advanceExistingRunner(startBase, runner) {
if (!runner) return;

let end = startBase + bases; // e.g. start 2 + double(2) = 4 means scores
if (end >= 4) {
scoreRunner(runner);
} else {
place(end, runner);
}
}

advanceExistingRunner(3, r3);
advanceExistingRunner(2, r2);
advanceExistingRunner(1, r1);

// Put batter on correct base (unless HR)
if (bases >= 4) {
// Batter scores too
runs++;
rbis++;
if (!reachedOnError) earnedRuns++;
} else {
place(bases, { player: currentBatter, reachedOnError });
}

return { runs, earnedRuns, rbis };
}

	function checkAndConvertToGhostie(currentBatter) {
		let batterOnBase = false;
		let otherPlayerOnBase = false;

		if (game.bases.first && game.bases.first.player === currentBatter) batterOnBase = true;
		if (game.bases.second && game.bases.second.player === currentBatter) batterOnBase = true;
		if (game.bases.third && game.bases.third.player === currentBatter) batterOnBase = true;

		let partner = game.batting.players.find(p => p !== currentBatter);
		if (game.bases.first && game.bases.first.player === partner) otherPlayerOnBase = true;
		if (game.bases.second && game.bases.second.player === partner) otherPlayerOnBase = true;
		if (game.bases.third && game.bases.third.player === partner) otherPlayerOnBase = true;

		if (batterOnBase && otherPlayerOnBase) {
			if (game.bases.first && game.bases.first.player === currentBatter) {
				game.bases.first.type = "ghostie";
			}
			if (game.bases.second && game.bases.second.player === currentBatter) {
				game.bases.second.type = "ghostie";
			}
			if (game.bases.third && game.bases.third.player === currentBatter) {
				game.bases.third.type = "ghostie";
			}
		}
	}

function recordBattingResult(result) {
  if (!game || playInputLock) return;

  if (result === "doublePlay" && countBaseRunners() < 2) {
    showNotification("Need 2+ runners on base for a double play", 1500);
    return;
  }

  playInputLock = true;
  try {
    let currentBatter = game.batting.players[game.batterIndex];
    let batterKey = getGameStatsKey(game.batting, currentBatter);

    pendingBattingResult = {
      result: result,
      batter: currentBatter,
      batterKey: batterKey
    };

    lastPlay = {
      battingTeamName: game.batting.name,
      fieldingTeamName: game.fielding.name,
      pitcherIndex: parseInt(document.getElementById("pitcherSelect").value),
      batterKey: batterKey,
      batterName: currentBatter,
      result: result
    };

    recordPitchingResult("clean");
  } finally {
    setTimeout(() => { playInputLock = false; }, 180);
  }
}

function showErrorPicker() {
  if (!lastPlay) {
    alert("No play to assign an error to yet.");
    return;
  }

  let sel = document.getElementById("errorPlayerSelect");
  sel.innerHTML = "";

  (game.fielding?.players || []).forEach((p, i) => {
    let opt = document.createElement("option");
    opt.value = i;
    opt.text = p;
    sel.appendChild(opt);
  });

  document.getElementById("errorPicker").classList.remove("hidden");
}

function cancelError() {
  document.getElementById("errorPicker").classList.add("hidden");
}
  
function confirmError() {
  if (!lastPlay) return;

  let idx = parseInt(document.getElementById("errorPlayerSelect").value);
  document.getElementById("errorPicker").classList.add("hidden");

  let fieldingTeam = game?.fielding;
  let fielderName = fieldingTeam?.players?.[idx];
  let fielderKey = getGameStatsKey(fieldingTeam, fielderName);

  if (game?.gameStats?.[fielderKey]) game.gameStats[fielderKey].fieldingErrors++;

  const batterName = lastPlay.batterName;
  ["first", "second", "third"].forEach(base => {
    if (game.bases[base] && game.bases[base].player === batterName) {
      game.bases[base].reachedOnError = true;
    }
  });

  const batterKey = lastPlay.batterKey;
  if (game?.gameStats?.[batterKey]) {
    if (lastPlay.result === "single") {
      game.gameStats[batterKey].hits = Math.max(0, game.gameStats[batterKey].hits - 1);
      game.gameStats[batterKey].singles = Math.max(0, game.gameStats[batterKey].singles - 1);
    } else if (lastPlay.result === "double") {
      game.gameStats[batterKey].hits = Math.max(0, game.gameStats[batterKey].hits - 1);
      game.gameStats[batterKey].doubles = Math.max(0, game.gameStats[batterKey].doubles - 1);
    } else if (lastPlay.result === "triple") {
      game.gameStats[batterKey].hits = Math.max(0, game.gameStats[batterKey].hits - 1);
      game.gameStats[batterKey].triples = Math.max(0, game.gameStats[batterKey].triples - 1);
    }
  }

  showNotification("Error charged to " + fielderName, 1500);
  lastPlay = null;
  updateGameScreen();
}

async function finalizeCompletedGame() {
	const lockReleased = await saveGameStats();
	if (!lockReleased) {
		alert("Game stats were saved, but the live-game lock could not be cleared. Please sync again before anyone starts another game.");
	}
	displayGameOver();
}

function endHalfInning(pitcherKey, reasonText) {
// credit pitcher with 1 inning pitched for this completed half-inning
if (pitcherKey && game?.gameStats?.[pitcherKey]) {
game.gameStats[pitcherKey].inningsPitched += 1;
}

// clear inning state
game.bases.first = null;
game.bases.second = null;
game.bases.third = null;
game.outs = 0;
game.halfInningRuns = 0; // ✅ reset for next half

// switch sides / inning
if (game.halfInning === "top") {
game.halfInning = "bottom";
let temp = game.batting;
game.batting = game.fielding;
game.fielding = temp;
game.batterIndex = 0;

updatePitcherSelect();
showNotification(reasonText || ("Side change! " + game.batting.name + " now batting."), 1500);
} else {
game.halfInning = "top";
let temp = game.batting;
game.batting = game.fielding;
game.fielding = temp;
game.batterIndex = 0;

game.inning++;

// ✅ your game ends after bottom of 3rd
if (game.inning > 3) {
finalizeCompletedGame();
return;
}

updatePitcherSelect();
showNotification(reasonText || ("Inning " + game.inning + " starting! " + game.batting.name + " batting."), 1500);
}
}

function recordPitchingResult(pitchResult, errorFielderIndex = null) {
if (!pendingBattingResult) return;

const reachedOnError = (pitchResult === "error");

// Save state for undo BEFORE any changes
gameHistory.push(saveGameState());
document.getElementById("undoButton").disabled = false;

let pitcherIndex = parseInt(document.getElementById("pitcherSelect").value);
let pitcher = game.fielding.players[pitcherIndex];
let pitcherKey = getGameStatsKey(game.fielding, pitcher);

let halfInningKey = game.inning + "-" + game.halfInning;
game.currentInningPitchers[halfInningKey] = pitcherIndex;

// Process batting result
let result = pendingBattingResult.result;
let batterKey = pendingBattingResult.batterKey;
let currentBatter = pendingBattingResult.batter;

let runs = 0;
let earnedRuns = 0;
let rbis = 0;

// AB rule: error still counts as an AB (unless it's a walk)
if (result !== "walk") {
game.gameStats[batterKey].atBats++;
}

if (result === "out" || result === "K") {
game.outs++;
if (result === "K") {
game.gameStats[batterKey].strikeouts++;
game.gameStats[pitcherKey].pitchStrikeouts++;
} else {
game.gameStats[batterKey].outs++;
}
game.gameStats[pitcherKey].pitchOuts++;

} else if (result === "doublePlay") {
const runnerCount = countBaseRunners();
if (runnerCount < 2) {
  showNotification("Need 2+ runners for a double play", 1500);
} else {
  game.outs += 2;
  game.gameStats[batterKey].outs++;
  game.gameStats[pitcherKey].pitchOuts += 2;

  let removedBase = game.bases.first ? 'first' : (game.bases.second ? 'second' : 'third');
  let removedRunner = game.bases[removedBase];
  game.bases[removedBase] = null;

  runs = 0; earnedRuns = 0; rbis = 0;

  showNotification("Double play!" + (removedRunner?.player ? (" (" + removedRunner.player + " out)") : ""), 1500);
}

} else if (result === "single") {
let res = advanceRunners(1, currentBatter, reachedOnError);
runs = res.runs;
earnedRuns = res.earnedRuns;
rbis = res.rbis;

if (!reachedOnError) {
game.gameStats[batterKey].hits++;
game.gameStats[batterKey].singles++;
}
game.gameStats[batterKey].rbis += rbis;

} else if (result === "double") {
let res = advanceRunners(2, currentBatter, reachedOnError);
runs = res.runs;
earnedRuns = res.earnedRuns;
rbis = res.rbis;

if (!reachedOnError) {
game.gameStats[batterKey].hits++;
game.gameStats[batterKey].doubles++;
}
game.gameStats[batterKey].rbis += rbis;

} else if (result === "triple") {
let res = advanceRunners(3, currentBatter, reachedOnError);
runs = res.runs;
earnedRuns = res.earnedRuns;
rbis = res.rbis;

if (!reachedOnError) {
game.gameStats[batterKey].hits++;
game.gameStats[batterKey].triples++;
}
game.gameStats[batterKey].rbis += rbis;

} else if (result === "HR") {
let res = advanceRunners(4, currentBatter, false);
runs = res.runs;
earnedRuns = res.earnedRuns;
rbis = res.rbis;

game.gameStats[batterKey].hits++;
game.gameStats[batterKey].homeRuns++;
game.gameStats[batterKey].rbis += rbis;

} else if (result === "walk") {
let res = advanceRunners(1, currentBatter, false);
runs = res.runs;
earnedRuns = res.earnedRuns;
rbis = res.rbis;

game.gameStats[batterKey].walks++;
game.gameStats[batterKey].rbis += rbis;
}

// Fielding error credit
if (pitchResult === "error") {
let fielderIdx = (errorFielderIndex !== null)
? errorFielderIndex
: parseInt(document.getElementById("pitcherSelect").value);

let fielder = game.fielding.players[fielderIdx];
let fielderKey = getGameStatsKey(game.fielding, fielder);
game.gameStats[fielderKey].fieldingErrors++;
}

// Add runs to score
if (game.batting === game.team1) game.team1Score += runs;
else game.team2Score += runs;

// Track half inning runs for run rule
game.halfInningRuns += runs;

// Pitcher runs/earned runs
game.gameStats[pitcherKey].runsAllowed += runs;
game.gameStats[pitcherKey].earnedRunsAllowed += earnedRuns;

// Next batter
game.batterIndex = (game.batterIndex + 1) % game.batting.players.length;
checkAndConvertToGhostie(game.batting.players[game.batterIndex]);

// ✅ Run rule: innings 1-2 only
if (game.inning <= 2 && game.halfInningRuns>= 6) {
	endHalfInning(pitcherKey, "Run rule reached (6). Switching sides.");
	pendingBattingResult = null;
keepLiveGameSectionsEnabled();
	updateGameScreen();
	return;
	}

	// ✅ Normal end of half-inning on 2 outs
	if (game.outs >= 2) {
	endHalfInning(pitcherKey, null);
	pendingBattingResult = null;
keepLiveGameSectionsEnabled();
	updateGameScreen();
	return;
	}

	// Reset for next play
	pendingBattingResult = null;
keepLiveGameSectionsEnabled();
	updateGameScreen();
}

async function saveGameStats() {
	for (let key in game.gameStats) {
		let gameStats = game.gameStats[key];
		let seasonStats = getOrCreateSeasonStatsByKey(key, gameStats.teamName, gameStats.playerName);

		seasonStats.atBats += gameStats.atBats;
		seasonStats.hits += gameStats.hits;
		seasonStats.singles += gameStats.singles;
		seasonStats.doubles += gameStats.doubles;
		seasonStats.triples += gameStats.triples;
		seasonStats.homeRuns += gameStats.homeRuns;
		seasonStats.walks += gameStats.walks;
		seasonStats.strikeouts += gameStats.strikeouts;
		seasonStats.outs += gameStats.outs;
		seasonStats.rbis += gameStats.rbis;
		seasonStats.pitchOuts += gameStats.pitchOuts;
		seasonStats.pitchStrikeouts += gameStats.pitchStrikeouts;
		seasonStats.fieldingErrors += gameStats.fieldingErrors;
		seasonStats.inningsPitched += gameStats.inningsPitched;
		seasonStats.runsAllowed += gameStats.runsAllowed;
		seasonStats.earnedRunsAllowed += gameStats.earnedRunsAllowed;
	}

	applyGameOutcomeOnce();
	saveSeason();
	queueServerSync("game", { immediate: true });
	return await releaseGameLock(game?._lockId || activeGameLock?.lockId || null, { quiet: true });
}

	function displayGameOver() {
		showGameOver();

		let winner = game.team1Score > game.team2Score ? game.team1.name : 
		             game.team2Score > game.team1Score ? game.team2.name : null;

		let banner = document.getElementById("winnerBanner");
		if (winner) {
			banner.innerText = "🏆 " + winner + " Wins! 🏆";
			banner.style.background = "#4a4";
		} else {
			banner.innerText = "It's a Tie!";
			banner.style.background = "#888";
		}

		document.getElementById("finalTeam1Name").innerText = game.team1.name;
		document.getElementById("finalTeam2Name").innerText = game.team2.name;
		document.getElementById("finalTeam1Score").innerText = game.team1Score;
		document.getElementById("finalTeam2Score").innerText = game.team2Score;

		let container = document.getElementById("statsContainer");
		container.innerHTML = "";

		let team1BattingCard = document.createElement("div");
		team1BattingCard.className = "card";
		team1BattingCard.innerHTML = `<h3>${game.team1.name} - Batting Statistics</h3>`;
		let team1BattingTable = createBattingStatsTable(game.team1, false);
		team1BattingCard.appendChild(team1BattingTable);
		container.appendChild(team1BattingCard);

		let team1PitchingCard = document.createElement("div");
		team1PitchingCard.className = "card";
		team1PitchingCard.innerHTML = `<h3>${game.team1.name} - Pitching Statistics</h3>`;
		let team1PitchingTable = createPitchingStatsTable(game.team1, false);
		team1PitchingCard.appendChild(team1PitchingTable);
		container.appendChild(team1PitchingCard);

		let team2BattingCard = document.createElement("div");
		team2BattingCard.className = "card";
		team2BattingCard.innerHTML = `<h3>${game.team2.name} - Batting Statistics</h3>`;
		let team2BattingTable = createBattingStatsTable(game.team2, false);
		team2BattingCard.appendChild(team2BattingTable);
		container.appendChild(team2BattingCard);

		let team2PitchingCard = document.createElement("div");
		team2PitchingCard.className = "card";
		team2PitchingCard.innerHTML = `<h3>${game.team2.name} - Pitching Statistics</h3>`;
		let team2PitchingTable = createPitchingStatsTable(game.team2, false);
		team2PitchingCard.appendChild(team2PitchingTable);
		container.appendChild(team2PitchingCard);
	}

function createBattingStatsTable(team, isSeason) {
	const table = document.createElement("table");
	table.className = "stats-table responsive";

	const headers = ["Player", "AVG", "H", "1B", "2B", "3B", "HR", "RBI"];
	if (isSeason) headers.push("AB");

	const thead = document.createElement("thead");
	const trh = document.createElement("tr");
	headers.forEach(h => {
		const th = document.createElement("th");
		th.textContent = h;
		trh.appendChild(th);
	});
	thead.appendChild(trh);
	table.appendChild(thead);

	const tbody = document.createElement("tbody");

	(team.players || []).forEach(player => {
		const key = isSeason ? getPlayerKey(team.name, player) : getGameStatsKey(team, player);
		let stats = isSeason ? season.playerStats[key] : game?.gameStats?.[key];

		if (!stats) {
			stats = isSeason ? initPlayerStats(team.name, player) : createEmptyStats(team.name, player);
			if (!isSeason && game?.gameStats) game.gameStats[key] = stats;
		}

		const avg = stats.atBats > 0 ? (stats.hits / stats.atBats).toFixed(3) : ".000";

		const values = [
			getDisplayNameForPlayer(team, player, isSeason),
			avg,
			stats.hits,
			stats.singles,
			stats.doubles,
			stats.triples,
			stats.homeRuns,
			stats.rbis
		];

		if (isSeason) values.push(stats.atBats);

		const tr = document.createElement("tr");
		values.forEach((v, i) => {
			const td = document.createElement("td");
			td.setAttribute("data-label", headers[i]);
			td.textContent = String(v);
			tr.appendChild(td);
		});
		tbody.appendChild(tr);
	});

	table.appendChild(tbody);
	return table;
}

function createPitchingStatsTable(team, isSeason) {
	const table = document.createElement("table");
	table.className = "stats-table responsive";

	const headers = ["Player", "IP", "K's", "K/3", "Outs", "R", "ER", "ERA", "Errors"];

	const thead = document.createElement("thead");
	const trh = document.createElement("tr");
	headers.forEach(h => {
		const th = document.createElement("th");
		th.textContent = h;
		trh.appendChild(th);
	});
	thead.appendChild(trh);
	table.appendChild(thead);

	const tbody = document.createElement("tbody");

	(team.players || []).forEach(player => {
		const key = isSeason ? getPlayerKey(team.name, player) : getGameStatsKey(team, player);
		let stats = isSeason ? season.playerStats[key] : game?.gameStats?.[key];

		if (!stats) {
			stats = isSeason ? initPlayerStats(team.name, player) : createEmptyStats(team.name, player);
			if (!isSeason && game?.gameStats) game.gameStats[key] = stats;
		}

		const era = stats.inningsPitched > 0
			? ((stats.earnedRunsAllowed / stats.inningsPitched) * 3).toFixed(2)
			: "-";

		const kPer3 = stats.inningsPitched > 0
			? ((stats.pitchStrikeouts / stats.inningsPitched) * 3).toFixed(2)
			: "-";

		const values = [
			getDisplayNameForPlayer(team, player, isSeason),
			Number(stats.inningsPitched).toFixed(1),
			stats.pitchStrikeouts,
			kPer3,
			stats.pitchOuts,
			stats.runsAllowed,
			stats.earnedRunsAllowed,
			era,
			stats.fieldingErrors
		];

		const tr = document.createElement("tr");
		values.forEach((v, i) => {
			const td = document.createElement("td");
			td.setAttribute("data-label", headers[i]);
			td.textContent = String(v);
			tr.appendChild(td);
		});
		tbody.appendChild(tr);
	});

	table.appendChild(tbody);
	return table;
}

function createSubBattingStatsTable(subEntries) {
	const table = document.createElement("table");
	table.className = "stats-table responsive";

	const headers = ["Player", "AVG", "H", "1B", "2B", "3B", "HR", "RBI", "AB"];
	const thead = document.createElement("thead");
	const trh = document.createElement("tr");
	headers.forEach(h => {
		const th = document.createElement("th");
		th.textContent = h;
		trh.appendChild(th);
	});
	thead.appendChild(trh);
	table.appendChild(thead);

	const tbody = document.createElement("tbody");
	(subEntries || []).forEach(stats => {
		const avg = stats.atBats > 0 ? (stats.hits / stats.atBats).toFixed(3) : ".000";
		const values = [stats.playerName, avg, stats.hits, stats.singles, stats.doubles, stats.triples, stats.homeRuns, stats.rbis, stats.atBats];

		const tr = document.createElement("tr");
		values.forEach((v, i) => {
			const td = document.createElement("td");
			td.setAttribute("data-label", headers[i]);
			td.textContent = String(v);
			tr.appendChild(td);
		});
		tbody.appendChild(tr);
	});

	table.appendChild(tbody);
	return table;
}

function createSubPitchingStatsTable(subEntries) {
	const table = document.createElement("table");
	table.className = "stats-table responsive";

	const headers = ["Player", "IP", "K's", "K/3", "Outs", "R", "ER", "ERA", "Errors"];
	const thead = document.createElement("thead");
	const trh = document.createElement("tr");
	headers.forEach(h => {
		const th = document.createElement("th");
		th.textContent = h;
		trh.appendChild(th);
	});
	thead.appendChild(trh);
	table.appendChild(thead);

	const tbody = document.createElement("tbody");
	(subEntries || []).forEach(stats => {
		const era = stats.inningsPitched > 0 ? ((stats.earnedRunsAllowed / stats.inningsPitched) * 3).toFixed(2) : "-";
		const kPer3 = stats.inningsPitched > 0 ? ((stats.pitchStrikeouts / stats.inningsPitched) * 3).toFixed(2) : "-";

		const values = [
			stats.playerName,
			Number(stats.inningsPitched).toFixed(1),
			stats.pitchStrikeouts,
			kPer3,
			stats.pitchOuts,
			stats.runsAllowed,
			stats.earnedRunsAllowed,
			era,
			stats.fieldingErrors
		];

		const tr = document.createElement("tr");
		values.forEach((v, i) => {
			const td = document.createElement("td");
			td.setAttribute("data-label", headers[i]);
			td.textContent = String(v);
			tr.appendChild(td);
		});
		tbody.appendChild(tr);
	});

	table.appendChild(tbody);
	return table;
}

function getSeasonTeamsForDisplay() {
	if (Array.isArray(league?.teams) && league.teams.length) {
		return league.teams;
	}

	const grouped = new Map();
	Object.values(season.playerStats || {}).forEach(stats => {
		const teamName = String(stats?.teamName || "").trim();
		const playerName = String(stats?.playerName || "").trim();
		if (!teamName || !playerName) return;
		if (!grouped.has(teamName)) grouped.set(teamName, new Set());
		grouped.get(teamName).add(playerName);
	});

	const orderedNames = (Array.isArray(schedule?.teamNames) && schedule.teamNames.length
		? schedule.teamNames.slice()
		: Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b))
	).filter(name => grouped.has(name));

	return orderedNames.map(teamName => ({
		name: teamName,
		players: Array.from(grouped.get(teamName) || []).sort((a, b) => a.localeCompare(b))
	}));
}

function displaySeasonStats() {
	let container = document.getElementById("seasonStatsContainer");
	container.innerHTML = "";

	const hasRegularStats = Object.keys(season.playerStats || {}).length > 0;
	const hasSubStats = Object.keys(season.subStats || {}).length > 0;

	if (!hasRegularStats && !hasSubStats) {
		container.innerHTML = "<div class='card'><p>No season statistics published yet.</p></div>";
		return;
	}

	const teamsForDisplay = getSeasonTeamsForDisplay();

	teamsForDisplay.forEach(team => {
		const playersWithStats = (team.players || []).filter(player => season.playerStats[getPlayerKey(team.name, player)]);
		if (!playersWithStats.length) return;

		const statsTeam = { ...team, players: playersWithStats };

		let battingCard = document.createElement("div");
		battingCard.className = "card";
		battingCard.innerHTML = `<h3>${team.name} (${formatTeamRecord(team.name)}) - Season Batting Statistics</h3>`;
		battingCard.appendChild(createBattingStatsTable(statsTeam, true));
		container.appendChild(battingCard);

		let pitchingCard = document.createElement("div");
		pitchingCard.className = "card";
		pitchingCard.innerHTML = `<h3>${team.name} (${formatTeamRecord(team.name)}) - Season Pitching Statistics</h3>`;
		pitchingCard.appendChild(createPitchingStatsTable(statsTeam, true));
		container.appendChild(pitchingCard);
	});

	const subEntries = Object.values(season.subStats || {}).sort((a, b) =>
		String(a.playerName).localeCompare(String(b.playerName))
	);

	if (subEntries.length) {
		const subHeader = document.createElement("div");
		subHeader.className = "card";
		subHeader.innerHTML = `<h3 style="margin-bottom:0;">Sub Stats</h3><p style="color:#aaa; margin-top:8px;">Season totals earned by substitute players. These stats stay separate from regular team rosters.</p>`;
		container.appendChild(subHeader);

		const battingCard = document.createElement("div");
		battingCard.className = "card";
		battingCard.innerHTML = `<h3>Sub Stats - Batting</h3>`;
		battingCard.appendChild(createSubBattingStatsTable(subEntries));
		container.appendChild(battingCard);

		const pitchingCard = document.createElement("div");
		pitchingCard.className = "card";
		pitchingCard.innerHTML = `<h3>Sub Stats - Pitching</h3>`;
		pitchingCard.appendChild(createSubPitchingStatsTable(subEntries));
		container.appendChild(pitchingCard);
	}
}
