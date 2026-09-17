// Completion is acknowledged by one SQL transaction with the recording lease and league CAS.
async function finalizeCompletedGame(options={}) {
  if(!game) return false;
  if(recording.actionRunning) {game._gameCompletePendingSave=true;return true;}
  return recordAction('finish',()=>{game._gameCompletePendingSave=true;game._allowTie=!!options.allowTie;},
    {allowComplete:true,skipPitcher:true});
}
function buildFinalLeagueSnapshot(serverLeague) {
  if(!game) throw new Error('No live game to finish.');
  if(game.team1Score===game.team2Score && (!game._allowTie || game._postseasonRef)) throw new Error('This game is tied. Continue playing until one team wins.');
  const priorSeason=season,priorSchedule=schedule;
  try {
    season=ensureSeasonShape(cloneJson(serverLeague.season_json));
    schedule=ensureScheduleShape(cloneJson(serverLeague.schedule_json));
    const id=getCompletedGameEntryId(game);
    if(findCompletedGameLogEntry(id)) throw new Error('ALREADY_COMPLETE: This result already exists on the server.');
    game._resultSaved=false;
    const entry=saveCompletedGameLog({outcomeApplied:false});
    if(game._postseasonRef) {
      if(!applyPostseasonOutcomeOnce(game._postseasonRef.slotId,id)) throw new Error('Postseason result could not be applied.');
    } else {
      // Add this game's numeric stats once to the authoritative totals. Do not erase
      // historical aggregate stats that predate the detailed game-log feature.
      for(const line of entry.playerStats) {
        const key=line.isSub?getSubKey(line.playerName):getPlayerKey(line.teamName,line.playerName);
        const target=getOrCreateSeasonStatsByKey(key,line.teamName,line.playerName);
        for(const field of STATS_BACKUP_NUMERIC_FIELDS) target[field]=Number(target[field]||0)+Number(line[field]||0);
        syncPitchingInnings(target);
        if(line.isSub && !season.seasonSubs.includes(line.playerName)) season.seasonSubs.push(line.playerName);
      }
      if(!applyGameOutcomeOnce()) throw new Error('Schedule result could not be applied.');
    }
    markCompletedGameOutcomeApplied(id);
    return {season:cloneJson(season),schedule:cloneJson(schedule)};
  } finally {season=priorSeason;schedule=priorSchedule;}
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

