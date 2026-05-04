// Wiffle Ball League - app.game.rules.js
// Split from the source-of-truth app.game.js. Load after app.core.js in the required order.
// Purpose: Overtime, inning labels, half-inning transitions, and regulation/overtime flow rules.

function normalizeOvertimeState(value = null) {
	const base = (value && typeof value === "object") ? value : {};
	return {
		active: base.active === true,
		round: Math.max(0, Number(base.round || 0) || 0),
		halfSetupKeys: (base.halfSetupKeys && typeof base.halfSetupKeys === "object") ? { ...base.halfSetupKeys } : {},
		automaticRunners: (base.automaticRunners && typeof base.automaticRunners === "object") ? JSON.parse(JSON.stringify(base.automaticRunners)) : {}
	};
}

function ensureOvertimeState() {
	if (!game) return null;
	game.overtime = normalizeOvertimeState(game.overtime);
	return game.overtime;
}

function isOvertimeActive() {
	if (!game) return false;

	const inning = Number(game.inning || 0);
	const overtime = game.overtime || {};

	if (inning <= 3) {
		if (game.overtime?.active) {
			game.overtime.active = false;
			game.overtime.round = 0;
		}
		return false;
	}

	return overtime.active === true;
}

function getOvertimeRoundForCurrentInning() {
	return Math.max(1, Number(game?.inning || 4) - 3);
}

function getLastBatterInfoForCurrentTeam() {
	const players = Array.isArray(game?.batting?.players) ? game.batting.players : [];
	if (!players.length) return null;

	const currentIndex = getCurrentBatterIndex();
	const runnerIndex = ((currentIndex - 1) % players.length + players.length) % players.length;

	return {
		playerName: players[runnerIndex] || null,
		runnerIndex
	};
}

function startOvertimeHalfInning(reasonText = "") {
	if (!game) return false;

	const inning = Number(game.inning || 0);
	const team1Score = Number(game.team1Score || 0);
	const team2Score = Number(game.team2Score || 0);

	if (inning <= 3) {
		if (game.overtime) {
			game.overtime.active = false;
			game.overtime.round = 0;
		}
		return false;
	}

	if (game.halfInning === "top" && team1Score !== team2Score) {
		if (game.overtime) game.overtime.active = false;
		finalizeCompletedGame();
		return false;
	}

	const overtime = ensureOvertimeState();
	overtime.active = true;
	overtime.round = getOvertimeRoundForCurrentInning();
	overtime.halfSetupKeys = overtime.halfSetupKeys || {};
	overtime.automaticRunners = overtime.automaticRunners || {};

	const halfKey = getCurrentHalfInningKey();
	if (overtime.halfSetupKeys[halfKey]) return false;

	const runnerInfo = getLastBatterInfoForCurrentTeam();
	const runnerName = runnerInfo?.playerName || null;

	game.bases = { first: null, second: null, third: null };
	game.outs = 1;
	game.halfInningRuns = 0;

	if (runnerName) {
		const runner = createBaseRunner(runnerName, false, game.batting, {
			pitcherKey: null,
			pitcherName: null,
			teamName: game.fielding?.name || ""
		});

		runner.responsiblePitcherKey = null;
		runner.responsiblePitcherName = null;
		runner.awaitingOvertimePitcherResponsibility = true;
		runner.isAutomaticOvertimeRunner = true;
		runner.overtimeRound = overtime.round;
		runner.overtimeHalf = game.halfInning;
		runner.battingOrderIndex = runnerInfo.runnerIndex;

		game.bases.second = runner;

		overtime.automaticRunners[halfKey] = {
			player: runnerName,
			teamName: game.batting?.name || "",
			statsKey: runner.statsKey || null,
			round: overtime.round,
			halfInning: game.halfInning,
			battingOrderIndex: runnerInfo.runnerIndex
		};
	}

	overtime.halfSetupKeys[halfKey] = true;

	showNotification(
		reasonText || `OT ${overtime.round}: ${game.batting.name} starts with 1 out and a runner on 2nd.`,
		2200
	);

	return true;
}

function getLiveInningLabel() {
	const halfText = game.halfInning === "top" ? "Top" : "Bottom";

	if (isOvertimeActive()) {
		return `${halfText} of OT ${getOvertimeRoundForCurrentInning()} | ${game.batting.name} Batting`;
	}

	return `${halfText} of Inning ${game.inning} | ${game.batting.name} Batting`;
}

function getLineScoreInningLabel(index) {
	return index < 3 ? String(index + 1) : `OT${index - 2}`;
}

function ensureOvertimeHalfSetupAfterResume() {
	if (!game || game?.overtime?.active !== true) return false;

	const overtime = ensureOvertimeState();
	const halfKey = getCurrentHalfInningKey();
	if (!halfKey || overtime.halfSetupKeys?.[halfKey]) return false;

	const hasRunnerOnBase = !!(game.bases?.first || game.bases?.second || game.bases?.third);
	if (Number(game.outs || 0) !== 0 || hasRunnerOnBase) return false;

	return startOvertimeHalfInning(
		`Recovered OT ${getOvertimeRoundForCurrentInning()} setup: 1 out and a runner on 2nd.`
	);
}

function endHalfInning(pitcherKey, reasonText) {
	// innings pitched are derived from pitchOuts, so side changes should not hand out extra IP
	if (!game) return "none";

	const endingHalf = game.halfInning;
	const endingInning = Number(game.inning || 0);
	const team1Score = Number(game.team1Score || 0);
	const team2Score = Number(game.team2Score || 0);
	const scoreIsTied = team1Score === team2Score;
	const endingBottomHalf = endingHalf === "bottom";
	const regulationOrLaterComplete = endingBottomHalf && endingInning >= 3;

	// Critical resume-safety rule:
	// A non-tied game is complete at the end of the bottom half of inning 3+.
	// Do NOT clear bases, reset outs, or advance to inning 4 before the completed
	// state has been saved locally. If the user leaves during the async save,
	// the app must restore this completed game and retry finalizing.
	if (regulationOrLaterComplete && !scoreIsTied) {
		if (game.overtime) {
			game.overtime.active = false;
			game.overtime.round = 0;
		}

		game.outs = 2;
		game._gameCompletePendingSave = true;
		pendingBattingResult = null;

		try { persistLiveGameAutosave("game-complete-pending-save"); } catch (e) {}
		try { setLiveActionControlsBusy(true); } catch (e) {}
		showNotification("Game complete. Saving result…", 1800);

		Promise.resolve(finalizeCompletedGame()).catch(error => {
			console.error("Finalize completed game failed:", error);
			if (game) {
				game._finalizeInProgress = false;
				game._gameCompletePendingSave = true;
			}
			try { setLiveActionControlsBusy(false); } catch (e) {}
			try { persistLiveGameAutosave("finalize-failed"); } catch (e) {}
			showNotification("Game is complete, but saving had an error. Try again before leaving.", 3000);
		});

		return "finalizing";
	}

	game.bases.first = null;
	game.bases.second = null;
	game.bases.third = null;
	game.outs = 0;
	game.halfInningRuns = 0;

	if (endingHalf === "top") {
		game.halfInning = "bottom";

		let temp = game.batting;
		game.batting = game.fielding;
		game.fielding = temp;

		setCurrentBatterIndex(getCurrentBatterIndex());
		updatePitcherSelect();

		if (isOvertimeActive()) {
			ensureOvertimeState().round = getOvertimeRoundForCurrentInning();
			startOvertimeHalfInning(
				reasonText || `OT ${getOvertimeRoundForCurrentInning()}: ${game.batting.name} now gets the same runner-on-2nd setup.`
			);
		} else {
			showNotification(reasonText || ("Side change! " + game.batting.name + " now batting."), 1500);
		}

		return "side-change";
	}

	game.halfInning = "top";

	let temp = game.batting;
	game.batting = game.fielding;
	game.fielding = temp;

	setCurrentBatterIndex(getCurrentBatterIndex());
	game.inning++;

	if (game.inning > 3) {
		const overtime = ensureOvertimeState();
		overtime.active = true;
		overtime.round = getOvertimeRoundForCurrentInning();

		updatePitcherSelect();

		startOvertimeHalfInning(
			reasonText || `Tie game after regulation — OT ${overtime.round} begins with 1 out and a runner on 2nd.`
		);

		return "overtime";
	}

	updatePitcherSelect();
	showNotification(reasonText || ("Inning " + game.inning + " starting! " + game.batting.name + " batting."), 1500);
	return "side-change";
}
