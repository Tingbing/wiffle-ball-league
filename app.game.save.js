// Wiffle Ball League - app.game.save.js
// Split from the source-of-truth app.game.js. Load after app.core.js in the required order.
// Purpose: Completed-game log creation, stat saving, schedule/standings application, and game-over screen.

async function finalizeCompletedGame(options = {}) {
	const { allowTie = false } = options;
	if (!game) return;

	if (game._finalizeInProgress) {
		showNotification("Game is already saving. Please wait.", 1200);
		return;
	}

	game._finalizeInProgress = true;
	game._gameCompletePendingSave = true;
	try { persistLiveGameAutosave("finalize-started"); } catch (e) {}
	try { setLiveActionControlsBusy(true); } catch (e) {}
	try { setAppWorking(true, "Saving final game…"); } catch (e) {}

	let result = { savedOk: false, lockReleased: false };
	try {
		result = await saveGameStats({ allowTie });
	} catch (error) {
		console.error("Finalize completed game error:", error);
		result = { savedOk: false, lockReleased: false };
	} finally {
		try { setAppWorking(false); } catch (e) {}
	}

	if (!result.savedOk) {
		if (game) {
			game._finalizeInProgress = false;
			game._gameCompletePendingSave = true;
		}
		try { persistLiveGameAutosave("finalize-failed"); } catch (e) {}
		try { setLiveActionControlsBusy(false); } catch (e) {}
		showNotification("Game complete, but final save did not finish. Try again before leaving.", 3000);
		return;
	}

	if (!result.lockReleased) {
		alert("Game stats were saved, but the live-game lock could not be cleared automatically. Use the Sync button on the main menu to retry clearing the lock. If that still fails, use Emergency End Game.");
	}

	displayGameOver();
	try { clearLiveGameAutosave(); } catch (e) {}
}

function buildCompletedGameLogEntry() {
	if (!game?.team1?.name || !game?.team2?.name) return null;

	const playedAt = Date.now();
	const scheduleRef = game?._scheduleRef &&
		Number.isInteger(game._scheduleRef.dayIndex) &&
		Number.isInteger(game._scheduleRef.seriesIndex) &&
		Number.isInteger(game._scheduleRef.seriesGameIndex)
		? {
			dayIndex: game._scheduleRef.dayIndex,
			seriesIndex: game._scheduleRef.seriesIndex,
			seriesGameIndex: game._scheduleRef.seriesGameIndex
		}
		: null;

	const id = getCompletedGameEntryId(game)
		|| (scheduleRef
			? `scheduled-${scheduleRef.dayIndex}-${scheduleRef.seriesIndex}-${scheduleRef.seriesGameIndex}`
			: `manual-${game._lockId || playedAt}-${game.team1.name}-${game.team2.name}`);

	const subsUsed = [game.team1, game.team2].flatMap(teamObj => {
		const meta = teamObj?._playerMeta || {};
		return (teamObj?.players || []).map(playerName => {
			const playerMeta = meta[playerName] || null;
			if (!playerMeta?.isSub) return null;
			return {
				teamName: teamObj.name,
				subName: playerName,
				replacedPlayer: playerMeta.originalPlayer || null
			};
		}).filter(Boolean);
	});

	return {
		id,
		playedAt,
		team1Name: game.team1.name,
		team2Name: game.team2.name,
		team1Score: Number(game.team1Score || 0),
		team2Score: Number(game.team2Score || 0),
		scheduleRef,
		postseasonRef: game?._postseasonRef ? { ...game._postseasonRef } : null,
		seasonPhase: game?._postseasonRef ? "postseason" : "regular",
		scheduleMeta: game?._lockInfo ? {
			type: game._lockInfo.type || (game?._postseasonRef ? "postseason" : (scheduleRef ? "scheduled" : "manual")),
			dayNumber: Number(game._lockInfo.dayNumber || 0) || null,
			seriesNumber: Number(game._lockInfo.seriesNumber || 0) || null,
			seriesGameNumber: Number(game._lockInfo.seriesGameNumber || 0) || null,
			slotId: game?._postseasonRef?.slotId || null
		} : null,
		lineups: {
			[game.team1.name]: Array.isArray(game.team1.players) ? game.team1.players.slice() : [],
			[game.team2.name]: Array.isArray(game.team2.players) ? game.team2.players.slice() : []
		},
		lineScore: deepCloneJson(game.lineScore || {}),
overtime: game?.overtime?.active ? deepCloneJson(game.overtime) : null,
winningPitcher: deepCloneJson(game?.pitcherDecisions?.winningPitcher || null),
		losingPitcher: deepCloneJson(game?.pitcherDecisions?.losingPitcher || null),
		subsUsed,
		lockId: game._lockId || null,
		gameInstanceId: game._gameInstanceId || null,
		playerStats: Object.values(game.gameStats || {}).map(stats => ({ ...stats })),
		outcomeApplied: false
	};
}

function saveCompletedGameLog(extraFields = {}) {
	const entry = buildCompletedGameLogEntry();
	if (!entry) return null;

	const nextEntry = { ...entry, ...extraFields };
	season.games = Array.isArray(season.games) ? season.games : [];

	const existingIndex = season.games.findIndex(gameEntry => gameEntry && gameEntry.id === nextEntry.id);
	if (existingIndex >= 0) {
		season.games[existingIndex] = { ...season.games[existingIndex], ...nextEntry };
	} else {
		season.games.unshift(nextEntry);
	}

	return nextEntry;
}

async function saveGameStats(options = {}) {
	const { allowTie = false } = options;
	const failureResult = { savedOk: false, lockReleased: false };
	const isTied = Number(game?.team1Score || 0) === Number(game?.team2Score || 0);

	if (isTied && !allowTie) {
		alert("This game is still tied. Continue overtime until one team wins.");
		return failureResult;
	}

	const completedEntry = buildCompletedGameLogEntry();
	const completedEntryId = completedEntry?.id || null;
	const existingEntry = findCompletedGameLogEntry(completedEntryId);
	const postseasonRef = game?._postseasonRef?.slotId ? { ...game._postseasonRef } : null;

	if (postseasonRef && isTied) {
		alert("Postseason games cannot end in a tie. Keep playing until one team wins.");
		return failureResult;
	}

	// Shared cleanup-and-exit. Awaits server sync, THEN releases the lock so
	// another tab cannot acquire the lock and overwrite an unsynced finalized game.
	const completeAndExit = async ({ alreadyFinalized = false } = {}) => {
		if (!alreadyFinalized) {
			try { saveSeason({ skipServerSync: true }); } catch (e) {}
		}
		clearLiveGameAutosave();

		try { await queueServerSync("game", { immediate: true }); } catch (e) {}

		const lockId = game?._lockId || activeGameLock?.lockId || null;
		const lockReleased = await releaseGameLockReliably(lockId, { quiet: true });
		return { savedOk: true, lockReleased };
	};

	// ============== POSTSEASON GAMES ==============
	if (postseasonRef) {
		const postseason = season?.postseason?.created ? season.postseason : null;
		const slot = postseason?.games?.[postseasonRef.slotId] || null;
		if (!slot) {
			alert("This postseason game could not be matched back to its playoff bracket slot. Nothing was saved.");
			return failureResult;
		}

		if (slot.status === "final" && !existingEntry) {
			alert("That postseason game was already recorded. Nothing new was saved.");
			return await completeAndExit({ alreadyFinalized: true });
		}

		const logId = existingEntry?.id || completedEntryId;
		const postseasonApplied = applyPostseasonOutcomeOnce(postseasonRef.slotId, logId);
		if (!postseasonApplied) {
			alert("This postseason game could not be applied back to the playoff bracket slot, so nothing new was finalized.");
			return failureResult;
		}

		if (!existingEntry) {
			saveCompletedGameLog({
				outcomeApplied: true,
				postseasonRef: { ...postseasonRef },
				seasonPhase: "postseason"
			});
		} else {
			markCompletedGameOutcomeApplied(logId);
		}

		return await completeAndExit();
	}

	// ============== SCHEDULED GAMES (verify on server first) ==============
	const scheduledRef =
		game?._scheduleRef &&
		Number.isInteger(game._scheduleRef.dayIndex) &&
		Number.isInteger(game._scheduleRef.seriesIndex) &&
		Number.isInteger(game._scheduleRef.seriesGameIndex)
			? {
				dayIndex: game._scheduleRef.dayIndex,
				seriesIndex: game._scheduleRef.seriesIndex,
				seriesGameIndex: game._scheduleRef.seriesGameIndex
			}
			: null;

	if (scheduledRef) {
		try {
			const latestRow = typeof fetchSeasonRowFromServer === "function"
				? await withTimeout(fetchSeasonRowFromServer({ quiet: true }), 5000, null)
				: null;
			const latestSchedule = latestRow?.schedule_json
				? ensureScheduleShape(deepCloneJson(latestRow.schedule_json))
				: null;
			const latestSeriesEntry = latestSchedule?.days?.[scheduledRef.dayIndex]?.games?.[scheduledRef.seriesIndex];
			const latestSeriesGame = latestSeriesEntry?.gamesInSeries?.[scheduledRef.seriesGameIndex];

			if ((latestSeriesGame?.result || latestSeriesGame?.skipped) && !existingEntry) {
				alert("That scheduled game was already finalized on the server. Nothing new was saved.");
				return await completeAndExit({ alreadyFinalized: true });
			}
		} catch (e) {
			console.warn("Could not verify scheduled game before finalizing:", e);
			try { markLiveGameServerSyncDelayed(); } catch (statusErr) {}
		}

		const scheduledSeriesEntry = schedule?.days?.[scheduledRef.dayIndex]?.games?.[scheduledRef.seriesIndex];
		const scheduledSeriesGame = scheduledSeriesEntry?.gamesInSeries?.[scheduledRef.seriesGameIndex];
		const teamsMatch =
			!!scheduledSeriesEntry &&
			(
				(scheduledSeriesEntry.away === game?.team1?.name && scheduledSeriesEntry.home === game?.team2?.name) ||
				(scheduledSeriesEntry.away === game?.team2?.name && scheduledSeriesEntry.home === game?.team1?.name)
			);

		if (!scheduledSeriesEntry || !scheduledSeriesGame || !teamsMatch) {
			alert("This scheduled game could not be matched back to its exact season slot. Nothing was saved, so the schedule could not be corrupted. Refresh the season data before trying again.");
			return failureResult;
		}

		if (scheduledSeriesGame.result && !existingEntry) {
			alert("That scheduled game was already recorded. Nothing new was saved.");
			return await completeAndExit({ alreadyFinalized: true });
		}
	}

	// ============== EXISTING ENTRY (resume after partial save) ==============
	if (existingEntry) {
		if (!existingEntry.outcomeApplied) {
			const outcomeApplied = applyGameOutcomeOnce();
			if (!outcomeApplied) {
				alert("This completed game could not be linked back to the exact scheduled slot, so its result was not applied.");
				return failureResult;
			}
			markCompletedGameOutcomeApplied(completedEntryId);
		}
		return await completeAndExit();
	}

	// ============== NEW GAME (apply stats and outcome) ==============
	for (let key in game.gameStats) {
		const gameStats = ensureExtendedStatFields(game.gameStats[key]);
		const seasonStats = ensureExtendedStatFields(
			getOrCreateSeasonStatsByKey(key, gameStats.teamName, gameStats.playerName)
		);

		seasonStats.atBats = Number(seasonStats.atBats || 0) + Number(gameStats.atBats || 0);
		seasonStats.hits = Number(seasonStats.hits || 0) + Number(gameStats.hits || 0);
		seasonStats.singles = Number(seasonStats.singles || 0) + Number(gameStats.singles || 0);
		seasonStats.doubles = Number(seasonStats.doubles || 0) + Number(gameStats.doubles || 0);
		seasonStats.triples = Number(seasonStats.triples || 0) + Number(gameStats.triples || 0);
		seasonStats.homeRuns = Number(seasonStats.homeRuns || 0) + Number(gameStats.homeRuns || 0);
		seasonStats.walks = Number(seasonStats.walks || 0) + Number(gameStats.walks || 0);
		seasonStats.hitByPitch = Number(seasonStats.hitByPitch || 0) + Number(gameStats.hitByPitch || 0);
		seasonStats.strikeouts = Number(seasonStats.strikeouts || 0) + Number(gameStats.strikeouts || 0);
		seasonStats.outs = Number(seasonStats.outs || 0) + Number(gameStats.outs || 0);
		seasonStats.rbis = Number(seasonStats.rbis || 0) + Number(gameStats.rbis || 0);
		seasonStats.runsScored = Number(seasonStats.runsScored || 0) + Number(gameStats.runsScored || 0);
		seasonStats.pitchOuts = Number(seasonStats.pitchOuts || 0) + Number(gameStats.pitchOuts || 0);
		seasonStats.pitchStrikeouts = Number(seasonStats.pitchStrikeouts || 0) + Number(gameStats.pitchStrikeouts || 0);
		seasonStats.fieldingErrors = Number(seasonStats.fieldingErrors || 0) + Number(gameStats.fieldingErrors || 0);
		syncPitchingInnings(seasonStats);
		seasonStats.runsAllowed = Number(seasonStats.runsAllowed || 0) + Number(gameStats.runsAllowed || 0);
		seasonStats.earnedRunsAllowed = Number(seasonStats.earnedRunsAllowed || 0) + Number(gameStats.earnedRunsAllowed || 0);
	}

	saveCompletedGameLog({ outcomeApplied: false });
	saveSeason({ skipServerSync: true });

	const outcomeApplied = applyGameOutcomeOnce();
	if (!outcomeApplied) {
		alert("This completed game could not be linked back to the exact scheduled slot, so its result was not applied.");
		return failureResult;
	}

	markCompletedGameOutcomeApplied(completedEntryId);
	return await completeAndExit();
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
