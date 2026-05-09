// Wiffle Ball League - app.game.save.js
// Split from the source-of-truth app.game.js. Load after app.core.js in the required order.
// Purpose: Completed-game log creation, stat saving, schedule/standings application, and game-over screen.

function getCurrentGameDebugId(fallbackEntry = null) {
	return fallbackEntry?.id
		|| (typeof getCompletedGameEntryId === "function" ? getCompletedGameEntryId(game) : null)
		|| game?._gameInstanceId
		|| game?._lockId
		|| activeGameLock?.lockId
		|| "unknown-game";
}

function getShortTechnicalError(error) {
	if (!error) return "No technical error provided.";
	if (typeof error === "string") return error;
	return error.message || error.details || error.hint || error.code || String(error);
}

function buildDetailedGameFailureMessage({ title, step, gameId, safeLocal, nextAction, phase, error }) {
	const timestamp = new Date().toISOString();
	return [
		title,
		"",
		safeLocal,
		"",
		`Step failed: ${step}`,
		`Game ID: ${gameId || "unknown-game"}`,
		`Time: ${timestamp}`,
		`Where: ${phase || "ending game"}`,
		`Error: ${getShortTechnicalError(error)}`,
		"",
		nextAction,
		"",
		"If this keeps happening, send this full message to AI/developer."
	].filter(Boolean).join("\n");
}

function showDetailedGameFailure(config) {
	const message = buildDetailedGameFailureMessage(config);
	console.warn("[wbl] detailed game save/sync message:", message, config?.error || "");
	alert(message);
}

function rebuildLocalSeasonTotalsFromCompletedGamesOrThrow() {
	if (typeof rebuildSeasonStatBucketsFromGameLogs !== "function") {
		throw new Error("rebuildSeasonStatBucketsFromGameLogs is missing");
	}

	season = ensureSeasonShape(season);

	const rebuilt = rebuildSeasonStatBucketsFromGameLogs(season);
	season.playerStats = rebuilt.playerStats || {};
	season.subStats = rebuilt.subStats || {};
	season.seasonSubs = Array.isArray(rebuilt.seasonSubs) ? rebuilt.seasonSubs : [];

	if (typeof rebuildCurrentTeamRecordsFromSavedResults === "function") {
		rebuildCurrentTeamRecordsFromSavedResults({ preserveWhenNoSource: false });
	}
}

function saveCompletedSeasonSnapshotOrThrow(gameId, step = "completed game local save") {
	season = ensureSeasonShape(season);
	season.games = Array.isArray(season.games) ? season.games : [];

	const saveOk = saveSeason({ skipServerSync: true, allowConflictBypass: true });
	if (saveOk === false) throw new Error("saveSeason returned false");

	const storedSeason = readJsonStorage(SEASON_STORAGE_KEY, null);
	const storedGames = Array.isArray(storedSeason?.games) ? storedSeason.games : [];
	const storedEntry = storedGames.find(entry => entry && entry.id === gameId);

	if (!storedEntry) {
		throw new Error(`${step} verification failed: completed game was not found in localStorage season.games`);
	}

	return storedEntry;
}

function saveScheduleSnapshotBestEffort() {
	try {
		if (typeof saveSchedule === "function") {
			saveSchedule({ skipServerSync: true, allowConflictBypass: true });
		}
	} catch (error) {
		console.warn("[wbl] schedule local save failed after completed game save:", error);
	}
}

function clearLiveDraftAfterCompletedLocalSave(gameId) {
	try {
		if (typeof clearLiveGameAutosave === "function") clearLiveGameAutosave();
		return true;
	} catch (error) {
		showDetailedGameFailure({
			title: "Game saved locally, but the live game draft could not be cleared.",
			step: "live game draft clear",
			gameId,
			safeLocal: "Your completed game is safe on this device. You may see a resume prompt until this clears.",
			nextAction: "Go to the main menu and press Sync. If the resume prompt appears for this already-finished game, do not record new plays into it.",
			phase: "ending game",
			error
		});
		return false;
	}
}

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
	// The completed game has already been saved locally before this screen is shown.
// The live draft is cleared only after that local completed-game save is verified.
// Server sync continues separately in the background.
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

	if (!game) return failureResult;

	const completedEntry = buildCompletedGameLogEntry();
	const completedEntryId = completedEntry?.id || getCurrentGameDebugId(completedEntry);
	const existingEntry = findCompletedGameLogEntry(completedEntryId);
	const isTied = Number(game?.team1Score || 0) === Number(game?.team2Score || 0);
	const postseasonRef = game?._postseasonRef?.slotId ? { ...game._postseasonRef } : null;
	const lockId = game?._lockId || activeGameLock?.lockId || null;

	if (isTied && !allowTie) {
		alert("This game is still tied. Continue overtime until one team wins.");
		return failureResult;
	}

	if (postseasonRef && isTied) {
		alert("Postseason games cannot end in a tie. Keep playing until one team wins.");
		return failureResult;
	}

	const completeAndExit = async () => {
		clearLiveDraftAfterCompletedLocalSave(completedEntryId);
		try { setLiveGameStatus("pending", "Game Saved Locally • Sync Needed"); } catch (e) {}
		try { markLiveGameServerSyncPending("completed game"); } catch (e) {}
		scheduleFinalizeBackgroundSync(lockId, completedEntryId);
		return { savedOk: true, lockReleased: true };
	};

	try {
		if (postseasonRef) {
			const postseason = season?.postseason?.created ? season.postseason : null;
			const slot = postseason?.games?.[postseasonRef.slotId] || null;

			if (!slot) {
				throw new Error("postseason slot was not found in local season.postseason.games");
			}

			const logId = existingEntry?.id || completedEntryId;

			if (!existingEntry) {
				saveCompletedGameLog({
					outcomeApplied: false,
					postseasonRef: { ...postseasonRef },
					seasonPhase: "postseason"
				});
				saveCompletedSeasonSnapshotOrThrow(completedEntryId, "completed postseason game local save");
			}

			if (!existingEntry?.outcomeApplied) {
				const postseasonApplied = applyPostseasonOutcomeOnce(postseasonRef.slotId, logId);
				if (!postseasonApplied) {
					throw new Error("applyPostseasonOutcomeOnce returned false");
				}
				markCompletedGameOutcomeApplied(logId);
			}

			saveCompletedSeasonSnapshotOrThrow(completedEntryId, "postseason outcome local save");
			return await completeAndExit();
		}

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
			const scheduledSeriesEntry = schedule?.days?.[scheduledRef.dayIndex]?.games?.[scheduledRef.seriesIndex];
			const scheduledSeriesGame = scheduledSeriesEntry?.gamesInSeries?.[scheduledRef.seriesGameIndex];
			const teamsMatch =
				!!scheduledSeriesEntry &&
				(
					(scheduledSeriesEntry.away === game?.team1?.name && scheduledSeriesEntry.home === game?.team2?.name) ||
					(scheduledSeriesEntry.away === game?.team2?.name && scheduledSeriesEntry.home === game?.team1?.name)
				);

			if (!scheduledSeriesEntry || !scheduledSeriesGame || !teamsMatch) {
				throw new Error("scheduled game could not be matched to the local schedule slot");
			}
		}

		if (!existingEntry) {
			saveCompletedGameLog({ outcomeApplied: false });
			saveCompletedSeasonSnapshotOrThrow(completedEntryId, "completed game local save");
		}

		const entryAfterLocalSave = findCompletedGameLogEntry(completedEntryId);
		if (!entryAfterLocalSave) {
			throw new Error("completed game log upsert did not create a readable season.games entry");
		}

		if (!entryAfterLocalSave.outcomeApplied) {
			const outcomeApplied = applyGameOutcomeOnce();
			if (!outcomeApplied) {
				throw new Error("applyGameOutcomeOnce returned false");
			}
			markCompletedGameOutcomeApplied(completedEntryId);
		}

		rebuildLocalSeasonTotalsFromCompletedGamesOrThrow();
		saveScheduleSnapshotBestEffort();
		saveCompletedSeasonSnapshotOrThrow(completedEntryId, "rebuilt season totals local save");

		return await completeAndExit();
	} catch (error) {
		console.error("saveGameStats local-first failure:", error);
		showDetailedGameFailure({
			title: "Completed game could not be safely finalized locally.",
			step: "ending game local-first save",
			gameId: completedEntryId,
			safeLocal: "Do not close the app yet. Your live game draft is still being kept so the game is not lost.",
			nextAction: "Try pressing End Game again. If it still fails, copy this message and send it to AI/developer.",
			phase: "ending game",
			error
		});
		return failureResult;
	}
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

function scheduleFinalizeBackgroundSync(lockId, completedGameId = null) {
	// The completed game is already saved locally. Mark dirty and let the
	// outbox worker push it. The outbox retries on its own, and the lock
	// is released once the push confirms.
	setTimeout(async () => {
		try { markLiveGameServerSyncPending("finalize"); } catch (e) {}

		// Trigger an immediate push attempt.
		const pushed = await syncSeasonToServer({ quiet: true });

		if (!pushed) {
			// The outbox kept the data dirty and will keep retrying in the
			// background. We don't show a scary alert here — the sync indicator
			// shows "Server Sync Delayed" and the user can press Sync to retry.
			console.warn("[wbl] finalize: outbox could not confirm immediately; retries scheduled.");
			return;
		}

		// Confirmed pushed → safe to release lock.
		if (lockId) {
			try { await releaseGameLockReliably(lockId, { quiet: true }); }
			catch (e) { console.warn("[wbl] background lock release error:", e); }
		}
		try { markLiveGameServerSyncSuccess(); } catch (e) {}
	}, 0);
}

