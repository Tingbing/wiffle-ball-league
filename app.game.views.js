// Wiffle Ball League - app.game.views.js
// Split from the source-of-truth app.game.js. Load after app.core.js in the required order.
// Purpose: Season stats, team/player stats, rankings, postseason displays, and past game log/detail views.

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
			stats = createEmptyStats(team.name, player, { isSub: false });
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
			stats = createEmptyStats(team.name, player, { isSub: false });
			if (!isSeason && game?.gameStats) game.gameStats[key] = stats;
		}

const innings = getPitchingInningsValue(stats);
const era = innings > 0
	? ((stats.earnedRunsAllowed / innings) * 3).toFixed(2)
	: "-";

const kPer3 = innings > 0
	? ((stats.pitchStrikeouts / innings) * 3).toFixed(2)
	: "-";

const values = [
	getDisplayNameForPlayer(team, player, isSeason),
	innings.toFixed(1),
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
		const innings = getPitchingInningsValue(stats);
const era = innings > 0 ? ((stats.earnedRunsAllowed / innings) * 3).toFixed(2) : "-";
const kPer3 = innings > 0 ? ((stats.pitchStrikeouts / innings) * 3).toFixed(2) : "-";

const values = [
	stats.playerName,
	innings.toFixed(1),
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

function buildSeasonStatsMetricGrid(metrics) {
	const grid = document.createElement("div");
	grid.className = "season-stats-metric-grid";

	(metrics || []).forEach(metric => {
		const item = document.createElement("div");
		item.className = "season-stats-metric";
		item.innerHTML = `
			<div class="season-stats-metric-label">${metric.label}</div>
			<div class="season-stats-metric-value">${metric.value}</div>
		`;
		grid.appendChild(item);
	});

	return grid;
}

function getSeasonPlayerOptions(teamsForDisplay) {
	const options = [];
	const seen = new Set();

	(teamsForDisplay || []).forEach(team => {
		(team.players || []).forEach(player => {
			const value = `REG|${team.name}|${player}`;
			if (seen.has(value)) return;
			seen.add(value);
			options.push({
				value,
				teamName: team.name,
				playerName: player,
				isSub: false,
				label: `${player} — ${team.name}`
			});
		});
	});

	Object.values(season.subStats || {})
		.sort((a, b) => String(a.playerName || "").localeCompare(String(b.playerName || "")))
		.forEach(stats => {
			const value = `SUB|${stats.playerName}`;
			if (seen.has(value)) return;
			seen.add(value);
			options.push({
				value,
				teamName: "SUB",
				playerName: stats.playerName,
				isSub: true,
				label: `${stats.playerName} — Sub`
			});
		});

	return options;
}

function getSeasonPlayerStatsForOption(option) {
	if (!option) return null;
	if (option.isSub) {
		return season.subStats?.[getSubKey(option.playerName)] || createEmptyStats("SUB", option.playerName, { isSub: true });
	}
	return season.playerStats?.[getPlayerKey(option.teamName, option.playerName)] || createEmptyStats(option.teamName, option.playerName, { isSub: false });
}

function getSeasonTeamTotals(team) {
	const totals = createEmptyStats(team?.name || "", team?.name || "", { isSub: false });
	const statKeys = [
		"atBats",
		"hits",
		"singles",
		"doubles",
		"triples",
		"homeRuns",
		"walks",
		"hitByPitch",
		"strikeouts",
		"outs",
		"rbis",
		"runsScored",
		"pitchOuts",
		"pitchStrikeouts",
		"fieldingErrors",
		"inningsPitched",
		"runsAllowed",
		"earnedRunsAllowed"
	];

	const seenPlayers = new Set();
	(team?.players || []).forEach(playerName => {
		const normalizedPlayerName = String(playerName || "").trim();
		if (!normalizedPlayerName || seenPlayers.has(normalizedPlayerName)) return;
		seenPlayers.add(normalizedPlayerName);

		const playerStats = season.playerStats?.[getPlayerKey(team.name, normalizedPlayerName)]
			|| createEmptyStats(team.name, normalizedPlayerName, { isSub: false });

		statKeys.forEach(key => {
			totals[key] = Number(totals[key] || 0) + Number(playerStats[key] || 0);
		});
	});

	return totals;
}

function getSeasonTeamRankings(teamsForDisplay) {
	const sorted = (teamsForDisplay || [])
		.map(team => {
			const record = getTeamRecord(team.name);
			const wins = Number(record.wins || 0);
			const losses = Number(record.losses || 0);
			const gameLog = getTeamGameLogForStats(team.name);
			const avgMargin = gameLog.length
				? gameLog.reduce((sum, gameRow) => sum + Number(gameRow.margin || 0), 0) / gameLog.length
				: 0;

			return {
				teamName: team.name,
				wins,
				losses,
				avgMargin
			};
		})
		.sort((a, b) => {
			if (b.wins !== a.wins) return b.wins - a.wins;
			if (a.losses !== b.losses) return a.losses - b.losses;
			if (b.avgMargin !== a.avgMargin) return b.avgMargin - a.avgMargin;
			return a.teamName.localeCompare(b.teamName);
		});

	let lastRank = 0;
	let lastRankKey = "";
	return sorted.map((entry, index) => {
		const rankKey = `${entry.wins}-${entry.losses}-${Number(entry.avgMargin || 0).toFixed(3)}`;
		if (rankKey !== lastRankKey) {
			lastRank = index + 1;
			lastRankKey = rankKey;
		}
		return { ...entry, rank: lastRank };
	});
}

function getTeamGameLogForStats(teamName) {
	const logs = [];
	(schedule?.days || []).forEach(day => {
		(day.games || []).forEach(seriesEntry => {
			(seriesEntry.gamesInSeries || []).forEach(seriesGame => {
				const result = seriesGame?.result;
				if (!result) return;

				if (result.type === "win") {
					if (result.winner === teamName) {
						logs.push({
							scored: Number(result.winnerScore || 0),
							allowed: Number(result.loserScore || 0),
							margin: Number(result.winnerScore || 0) - Number(result.loserScore || 0)
						});
					} else if (result.loser === teamName) {
						logs.push({
							scored: Number(result.loserScore || 0),
							allowed: Number(result.winnerScore || 0),
							margin: Number(result.loserScore || 0) - Number(result.winnerScore || 0)
						});
					}
				} else if (result.type === "tie") {
					if (result.team1 === teamName) {
						logs.push({
							scored: Number(result.score1 || 0),
							allowed: Number(result.score2 || 0),
							margin: Number(result.score1 || 0) - Number(result.score2 || 0)
						});
					} else if (result.team2 === teamName) {
						logs.push({
							scored: Number(result.score2 || 0),
							allowed: Number(result.score1 || 0),
							margin: Number(result.score2 || 0) - Number(result.score1 || 0)
						});
					}
				}
			});
		});
	});

	const countedManualIds = new Set();
	(season?.games || []).forEach(entry => {
		if (!entry || entry.scheduleRef || entry.postseasonRef || entry.seasonPhase === "postseason") return;

		const entryId = String(entry.id || "").trim();
		if (entryId && countedManualIds.has(entryId)) return;
		if (entryId) countedManualIds.add(entryId);

		const team1Name = String(entry.team1Name || "").trim();
		const team2Name = String(entry.team2Name || "").trim();
		const team1Score = Number(entry.team1Score || 0);
		const team2Score = Number(entry.team2Score || 0);

		if (!team1Name || !team2Name || team1Name === team2Name || team1Score === team2Score) return;

		if (team1Name === teamName) {
			logs.push({
				scored: team1Score,
				allowed: team2Score,
				margin: team1Score - team2Score
			});
		} else if (team2Name === teamName) {
			logs.push({
				scored: team2Score,
				allowed: team1Score,
				margin: team2Score - team1Score
			});
		}
	});

	return logs;
}

function formatSeasonStatsPercent(value) {
	return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function formatSeasonStatsSignedNumber(value, digits = 1) {
	const num = Number(value || 0);
	if (!Number.isFinite(num)) return "-";
	if (num > 0) return `+${num.toFixed(digits)}`;
	if (num < 0) return num.toFixed(digits);
	return num.toFixed(digits);
}

function createSeasonPlayerDetails(option) {
	const wrap = document.createElement("div");
	wrap.className = "season-stats-stack";

	if (!option) {
		wrap.innerHTML = '<p class="season-stats-empty">No players available yet.</p>';
		return wrap;
	}

	const stats = getSeasonPlayerStatsForOption(option);
const battingAvg = stats.atBats > 0 ? (stats.hits / stats.atBats).toFixed(3) : ".000";
const innings = getPitchingInningsValue(stats);
const era = innings > 0 ? ((stats.earnedRunsAllowed / innings) * 3).toFixed(2) : "-";
const kPer3 = innings > 0 ? ((stats.pitchStrikeouts / innings) * 3).toFixed(2) : "-";

	const header = document.createElement("div");
	header.className = "season-stats-selection-header";
	header.innerHTML = `
		<h4>${option.playerName}</h4>
		<p>${option.isSub ? "Substitute Player" : option.teamName}</p>
	`;
	wrap.appendChild(header);

	const battingCard = document.createElement("div");
	battingCard.className = "card";
	battingCard.innerHTML = '<h4>Batting Stats</h4>';
	battingCard.appendChild(buildSeasonStatsMetricGrid([
		{ label: "AVG", value: battingAvg },
		{ label: "AB", value: stats.atBats },
		{ label: "H", value: stats.hits },
		{ label: "1B", value: stats.singles },
		{ label: "2B", value: stats.doubles },
		{ label: "3B", value: stats.triples },
		{ label: "HR", value: stats.homeRuns },
		{ label: "RBI", value: stats.rbis },
		{ label: "BB", value: stats.walks },
		{ label: "K", value: stats.strikeouts }
	]));
	wrap.appendChild(battingCard);

	const pitchingCard = document.createElement("div");
	pitchingCard.className = "card";
	pitchingCard.innerHTML = '<h4>Pitching Stats</h4>';
	pitchingCard.appendChild(buildSeasonStatsMetricGrid([
		{ label: "IP", value: innings.toFixed(1) },
		{ label: "Outs", value: stats.pitchOuts },
		{ label: "K's", value: stats.pitchStrikeouts },
		{ label: "K/3", value: kPer3 },
		{ label: "R", value: stats.runsAllowed },
		{ label: "ER", value: stats.earnedRunsAllowed },
		{ label: "ERA", value: era },
		{ label: "Errors", value: stats.fieldingErrors }
	]));
	wrap.appendChild(pitchingCard);

	return wrap;
}

function createSeasonTeamDetails(team, rankings) {
	const wrap = document.createElement("div");
	wrap.className = "season-stats-stack";

	if (!team) {
		wrap.innerHTML = '<p class="season-stats-empty">No teams available yet.</p>';
		return wrap;
	}

	const record = getTeamRecord(team.name);
	const wins = Number(record.wins || 0);
	const losses = Number(record.losses || 0);
	const totalGames = wins + losses;
	const winRate = totalGames > 0 ? wins / totalGames : 0;
	const rankedTeam = (rankings || []).find(entry => entry.teamName === team.name) || null;
	const teamRank = rankedTeam?.rank || "-";
	const avgMargin = rankedTeam ? rankedTeam.avgMargin : 0;
	const totals = getSeasonTeamTotals(team);
	const battingAvg = Number(totals.atBats || 0) > 0 ? (Number(totals.hits || 0) / Number(totals.atBats || 0)).toFixed(3) : ".000";
	const innings = getPitchingInningsValue(totals);
	const era = innings > 0 ? ((Number(totals.earnedRunsAllowed || 0) / innings) * 3).toFixed(2) : "-";
	const kPer3 = innings > 0 ? ((Number(totals.pitchStrikeouts || 0) / innings) * 3).toFixed(2) : "-";

	const header = document.createElement("div");
	header.className = "season-stats-selection-header";
	header.innerHTML = `
		<h4>${team.name}</h4>
		<p>Regular-roster team totals and rates</p>
	`;
	wrap.appendChild(header);

	const summaryCard = document.createElement("div");
	summaryCard.className = "card";
	summaryCard.innerHTML = '<h4>Team Summary</h4>';
	summaryCard.appendChild(buildSeasonStatsMetricGrid([
		{ label: "Record", value: `${wins}-${losses}` },
		{ label: "Win Rate", value: formatSeasonStatsPercent(winRate) },
		{ label: "Avg Margin", value: totalGames > 0 ? formatSeasonStatsSignedNumber(avgMargin, 1) : "-" },
		{ label: "League Rank", value: `#${teamRank}` }
	]));

	const summaryNote = document.createElement("p");
	summaryNote.className = "season-stats-note";
	summaryNote.textContent = "Rank is based on record first, then average win/loss margin as the tiebreaker.";
	summaryCard.appendChild(summaryNote);
	wrap.appendChild(summaryCard);

	const battingCard = document.createElement("div");
	battingCard.className = "card";
	battingCard.innerHTML = '<h4>Team Batting Summary</h4>';
	battingCard.appendChild(buildSeasonStatsMetricGrid([
		{ label: "AVG", value: battingAvg },
		{ label: "AB", value: totals.atBats },
		{ label: "H", value: totals.hits },
		{ label: "1B", value: totals.singles },
		{ label: "2B", value: totals.doubles },
		{ label: "3B", value: totals.triples },
		{ label: "HR", value: totals.homeRuns },
		{ label: "RBI", value: totals.rbis },
		{ label: "BB", value: totals.walks },
		{ label: "K", value: totals.strikeouts }
	]));
	wrap.appendChild(battingCard);

	const pitchingCard = document.createElement("div");
	pitchingCard.className = "card";
	pitchingCard.innerHTML = '<h4>Team Pitching Summary</h4>';
	pitchingCard.appendChild(buildSeasonStatsMetricGrid([
		{ label: "IP", value: innings.toFixed(1) },
		{ label: "Outs", value: totals.pitchOuts },
		{ label: "K's", value: totals.pitchStrikeouts },
		{ label: "K/3", value: kPer3 },
		{ label: "R", value: totals.runsAllowed },
		{ label: "ER", value: totals.earnedRunsAllowed },
		{ label: "ERA", value: era },
		{ label: "Errors", value: totals.fieldingErrors }
	]));
	wrap.appendChild(pitchingCard);

	return wrap;
}

function displaySeasonStats() {
	const container = document.getElementById("seasonStatsContainer");
	if (!container) return;

	const hasRegularStats = Object.keys(season.playerStats || {}).length > 0;
	const hasSubStats = Object.keys(season.subStats || {}).length > 0;
	const teamsForDisplay = getSeasonTeamsForDisplay();

	container.innerHTML = "";

	const introCard = document.createElement("div");
	introCard.className = "card";
	introCard.innerHTML = `
		<h3 style="margin-top:0;">Season Stats Hub</h3>
		<p class="season-stats-note">Choose Rankings, Past Game Log, Player Stats, or Team Stats. Player Stats includes regular players and substitute players in the same selector.</p>
	`;

	if (!teamsForDisplay.length && !hasRegularStats && !hasSubStats) {
		introCard.innerHTML += `<p class="season-stats-note" style="margin-bottom:0;">No season statistics published yet.</p>`;
	}

	container.appendChild(introCard);
}

function displayPlayerStats() {
	const container = document.getElementById("playerStatsContainer");
	if (!container) return;

	const previousPlayerValue = document.getElementById("seasonPlayerSelect")?.value || "";
	container.innerHTML = "";

	const hasRegularStats = Object.keys(season.playerStats || {}).length > 0;
	const hasSubStats = Object.keys(season.subStats || {}).length > 0;
	const teamsForDisplay = getSeasonTeamsForDisplay();

	if (!teamsForDisplay.length && !hasRegularStats && !hasSubStats) {
		container.innerHTML = "<div class='card'><p>No season statistics published yet.</p></div>";
		return;
	}

	const playerOptions = getSeasonPlayerOptions(teamsForDisplay);

	const playerPanel = document.createElement("div");
	playerPanel.className = "card season-stats-panel";
	playerPanel.innerHTML = `
		<h3>Player Stats</h3>
		<p class="season-stats-note">Select one regular player or substitute player to view batting and pitching stats together.</p>
	`;
	container.appendChild(playerPanel);

	const playerSelect = document.createElement("select");
	playerSelect.id = "seasonPlayerSelect";
	playerSelect.className = "season-stats-select";
	if (!playerOptions.length) {
		const opt = document.createElement("option");
		opt.value = "";
		opt.textContent = "No players available";
		playerSelect.appendChild(opt);
		playerSelect.disabled = true;
	} else {
		playerOptions.forEach(option => {
			const opt = document.createElement("option");
			opt.value = option.value;
			opt.textContent = option.label;
			playerSelect.appendChild(opt);
		});
	}
	playerPanel.appendChild(playerSelect);

	const playerDetails = document.createElement("div");
	playerDetails.id = "seasonPlayerDetails";
	playerPanel.appendChild(playerDetails);

	function renderSelectedPlayer() {
		const selected = playerOptions.find(option => option.value === playerSelect.value) || playerOptions[0] || null;
		playerDetails.innerHTML = "";
		playerDetails.appendChild(createSeasonPlayerDetails(selected));
	}

	if (playerOptions.length) {
		playerSelect.value = playerOptions.some(option => option.value === previousPlayerValue)
			? previousPlayerValue
			: playerOptions[0].value;
	}

	playerSelect.addEventListener("change", renderSelectedPlayer);
	renderSelectedPlayer();
}

function displayTeamStats() {
	const container = document.getElementById("teamStatsContainer");
	if (!container) return;

	const previousTeamValue = document.getElementById("seasonTeamSelect")?.value || "";
	container.innerHTML = "";

	const hasRegularStats = Object.keys(season.playerStats || {}).length > 0;
	const teamsForDisplay = getSeasonTeamsForDisplay();

	if (!teamsForDisplay.length && !hasRegularStats) {
		container.innerHTML = "<div class='card'><p>No team statistics published yet.</p></div>";
		return;
	}

	const teamRankings = getSeasonTeamRankings(teamsForDisplay);

	const teamPanel = document.createElement("div");
	teamPanel.className = "card season-stats-panel";
	teamPanel.innerHTML = `
		<h3>Team Stats</h3>
		<p class="season-stats-note">Select one team to view record info plus full-team batting and pitching totals built from the regular roster.</p>
	`;
	container.appendChild(teamPanel);

	const teamSelect = document.createElement("select");
	teamSelect.id = "seasonTeamSelect";
	teamSelect.className = "season-stats-select";
	if (!teamsForDisplay.length) {
		const opt = document.createElement("option");
		opt.value = "";
		opt.textContent = "No teams available";
		teamSelect.appendChild(opt);
		teamSelect.disabled = true;
	} else {
		teamsForDisplay.forEach(team => {
			const opt = document.createElement("option");
			opt.value = team.name;
			opt.textContent = team.name;
			teamSelect.appendChild(opt);
		});
	}
	teamPanel.appendChild(teamSelect);

	const teamDetails = document.createElement("div");
	teamDetails.id = "seasonTeamDetails";
	teamPanel.appendChild(teamDetails);

	function renderSelectedTeam() {
		const selected = teamsForDisplay.find(team => team.name === teamSelect.value) || teamsForDisplay[0] || null;
		teamDetails.innerHTML = "";
		teamDetails.appendChild(createSeasonTeamDetails(selected, teamRankings));
	}

	if (teamsForDisplay.length) {
		teamSelect.value = teamsForDisplay.some(team => team.name === previousTeamValue)
			? previousTeamValue
			: teamsForDisplay[0].name;
	}

	teamSelect.addEventListener("change", renderSelectedTeam);
	renderSelectedTeam();
}

function buildRankingsPlayerEntry(stats, isSub) {
	const playerName = String(stats?.playerName || "").trim();
	if (!playerName) return null;
	return {
		playerName,
		displayName: isSub ? `${playerName} (Sub)` : playerName,
		isSub: !!isSub,
		stats
	};
}

function getRankingsPlayerPool() {
	const players = [];

	Object.values(season.playerStats || {}).forEach(stats => {
		const entry = buildRankingsPlayerEntry(stats, false);
		if (entry) players.push(entry);
	});

	Object.values(season.subStats || {}).forEach(stats => {
		const entry = buildRankingsPlayerEntry(stats, true);
		if (entry) players.push(entry);
	});

	return players;
}

function getRankingsLeaders(players, config) {
	return (players || [])
		.map(player => {
			const value = config.getValue(player.stats);
			return {
				...player,
				value
			};
		})
		.filter(player => {
			if (!Number.isFinite(player.value)) return false;
			return typeof config.isEligible === "function"
				? config.isEligible(player.stats, player.value)
				: true;
		})
		.sort((a, b) => {
			if (a.value !== b.value) {
				return config.lowerIsBetter ? a.value - b.value : b.value - a.value;
			}
			return a.playerName.localeCompare(b.playerName);
		});
}

function createRankingsTable(title, players, config) {
	const card = document.createElement("div");
	card.className = "card rankings-table-card";
	card.innerHTML = `<h4>${title}</h4>`;

	const leaders = getRankingsLeaders(players, config);
	if (!leaders.length) {
		const empty = document.createElement("p");
		empty.className = "rankings-empty";
		empty.textContent = "No eligible players yet.";
		card.appendChild(empty);
		return card;
	}

	const tableWrap = document.createElement("div");
	tableWrap.className = "rankings-table-wrap";

	const table = document.createElement("table");
	table.className = "stats-table rankings-table";

	const colgroup = document.createElement("colgroup");
	colgroup.innerHTML = `
		<col class="rankings-col-rank">
		<col class="rankings-col-name">
		<col class="rankings-col-value">
	`;
	table.appendChild(colgroup);

	const thead = document.createElement("thead");
	thead.innerHTML = `
		<tr>
			<th>Rank</th>
			<th>Player Name</th>
			<th>Stat Value</th>
		</tr>
	`;
	table.appendChild(thead);

	const tbody = document.createElement("tbody");
	leaders.forEach((leader, index) => {
		const tr = document.createElement("tr");

		const rankTd = document.createElement("td");
		rankTd.textContent = String(index + 1);
		rankTd.className = "rankings-rank-cell";
		tr.appendChild(rankTd);

		const nameTd = document.createElement("td");
		nameTd.textContent = leader.displayName;
		nameTd.className = "rankings-name-cell";
		tr.appendChild(nameTd);

		const valueTd = document.createElement("td");
		valueTd.className = "rankings-value rankings-value-cell";
		valueTd.textContent = config.formatValue(leader.value, leader.stats);
		tr.appendChild(valueTd);

		tbody.appendChild(tr);
	});

	table.appendChild(tbody);
	tableWrap.appendChild(table);
	card.appendChild(tableWrap);
	return card;
}

function displayRankings() {
	const container = document.getElementById("rankingsContainer");
	if (!container) return;
	container.innerHTML = "";

	const players = getRankingsPlayerPool();
	if (!players.length) {
		container.innerHTML = "<div class='card'><p>No season rankings published yet.</p></div>";
		return;
	}

	const introCard = document.createElement("div");
	introCard.className = "card";
	introCard.innerHTML = `
		<h3 style="margin-top:0;">Rankings Hub</h3>
	<p class="season-stats-note">
	This page shows the full player leaderboard in each category using the current saved season stats.
	Substitute players are labeled with <strong>(Sub)</strong>.
</p>
	`;
	container.appendChild(introCard);

	const layout = document.createElement("div");
	layout.className = "rankings-layout";
	container.appendChild(layout);

	const battingSection = document.createElement("div");
	battingSection.className = "rankings-section";
	battingSection.innerHTML = `
		<div class="card rankings-section-header">
			<div>
				<h3>Batting Rankings</h3>
				<p class="season-stats-note">
					Highest values rank first for batting average, RBIs, home runs, and total hits.
				</p>
			</div>
		</div>
	`;

	const battingGrid = document.createElement("div");
	battingGrid.className = "rankings-grid";

	battingGrid.appendChild(createRankingsTable("Batting Average", players, {
		getValue: stats => stats.atBats > 0 ? stats.hits / stats.atBats : NaN,
		isEligible: stats => Number(stats.atBats || 0) > 0,
		formatValue: value => value.toFixed(3)
	}));

	battingGrid.appendChild(createRankingsTable("RBIs", players, {
		getValue: stats => Number(stats.rbis || 0),
		formatValue: value => String(value)
	}));

	battingGrid.appendChild(createRankingsTable("Home Runs", players, {
		getValue: stats => Number(stats.homeRuns || 0),
		formatValue: value => String(value)
	}));

	battingGrid.appendChild(createRankingsTable("Total Hits", players, {
		getValue: stats => Number(stats.hits || 0),
		formatValue: value => String(value)
	}));

	battingSection.appendChild(battingGrid);
	layout.appendChild(battingSection);

	const pitchingSection = document.createElement("div");
	pitchingSection.className = "rankings-section";
	pitchingSection.innerHTML = `
		<div class="card rankings-section-header">
			<div>
				<h3>Pitching Rankings</h3>
				<p class="season-stats-note">
					K/3 and innings pitched rank highest first. ERA and errors made rank lowest first.
				</p>
			</div>
		</div>
	`;

	const pitchingGrid = document.createElement("div");
	pitchingGrid.className = "rankings-grid";

	pitchingGrid.appendChild(createRankingsTable("K/3", players, {
getValue: stats => {
	const innings = getPitchingInningsValue(stats);
	return innings > 0 ? (stats.pitchStrikeouts / innings) * 3 : NaN;
},
isEligible: stats => getPitchingInningsValue(stats) > 0,
		formatValue: value => value.toFixed(2)
	}));

	pitchingGrid.appendChild(createRankingsTable("ERA", players, {
	getValue: stats => {
		const innings = getPitchingInningsValue(stats);
		return innings > 0 ? (stats.earnedRunsAllowed / innings) * 3 : NaN;
	},
	isEligible: stats => getPitchingInningsValue(stats) > 0,
	lowerIsBetter: true,
	formatValue: value => value.toFixed(2)
}));

	pitchingGrid.appendChild(createRankingsTable("Errors Made", players, {
		getValue: stats => Number(stats.fieldingErrors || 0),
		isEligible: stats => getPitchingInningsValue(stats) > 0 || Number(stats.fieldingErrors || 0) > 0,
		lowerIsBetter: true,
		formatValue: value => String(value)
	}));

	pitchingGrid.appendChild(createRankingsTable("Total Innings Pitched", players, {
		getValue: stats => getPitchingInningsValue(stats),
isEligible: stats => getPitchingInningsValue(stats) > 0,
		formatValue: value => value.toFixed(1)
	}));

	pitchingSection.appendChild(pitchingGrid);
	layout.appendChild(pitchingSection);
}

function getPostseasonSectionConfig(slotId) {
	if (["W1", "W2", "W3"].includes(slotId)) return { sectionKey: "winners", sectionLabel: "Winners Bracket", sortSeries: 0 };
	if (["L1", "L2"].includes(slotId)) return { sectionKey: "losers", sectionLabel: "Losers Bracket", sortSeries: 1 };
	return { sectionKey: "championship", sectionLabel: "Championship", sortSeries: 2 };
}

function createPostseasonGameTemplate(slotId, label, section) {
	return {
		slotId,
		label,
		section,
		team1Name: "",
		team2Name: "",
		score1: null,
		score2: null,
		winner: "",
		loser: "",
		status: "pending",
		completedGameLogId: null,
		completedGameLogIds: [],
		playedAt: null,
		seriesWins1: 0,
		seriesWins2: 0,
		targetWins: 2
	};
}

function buildEmptyPostseasonGames() {
	return {
		W1: createPostseasonGameTemplate("W1", "Seed 1 vs Seed 4", "Winners Bracket"),
		W2: createPostseasonGameTemplate("W2", "Seed 2 vs Seed 3", "Winners Bracket"),
		W3: createPostseasonGameTemplate("W3", "Winners Final", "Winners Bracket"),
		L1: createPostseasonGameTemplate("L1", "Losers Round 1", "Losers Bracket"),
		L2: createPostseasonGameTemplate("L2", "Losers Final", "Losers Bracket"),
		C1: createPostseasonGameTemplate("C1", "Championship", "Championship"),
		C2: createPostseasonGameTemplate("C2", "Championship Reset", "Championship")
	};
}

function getPostseasonState() {
	season = ensureSeasonShape(season);
	return season.postseason;
}

function getPostseasonTypeLabel(entry) {
	if (entry?.postseasonRef?.slotId) return "Postseason";
	return entry?.scheduleRef ? "Scheduled" : "Manual";
}

function getPostseasonStandingsSnapshot() {
	const teamsForDisplay = getSeasonTeamsForDisplay();
	const rankings = getSeasonTeamRankings(teamsForDisplay);
	if (rankings.length !== 4) return [];
	return rankings.slice(0, 4).map((entry, index) => ({
		seed: index + 1,
		teamName: entry.teamName,
		wins: Number(entry.wins || 0),
		losses: Number(entry.losses || 0),
		avgMargin: Number(entry.avgMargin || 0)
	}));
}

function assignPostseasonParticipants(gameSlot, team1Name, team2Name) {
	gameSlot.team1Name = team1Name || "";
	gameSlot.team2Name = team2Name || "";
	if (gameSlot.status !== "final") {
		gameSlot.status = gameSlot.team1Name && gameSlot.team2Name ? "scheduled" : "pending";
	}
}

function carryPostseasonResult(gameSlot, previousSlot) {
	if (!previousSlot) return;
	if (!gameSlot.team1Name || !gameSlot.team2Name) return;
	if (previousSlot.team1Name !== gameSlot.team1Name || previousSlot.team2Name !== gameSlot.team2Name) return;

	gameSlot.seriesWins1 = Number(previousSlot.seriesWins1 || 0);
	gameSlot.seriesWins2 = Number(previousSlot.seriesWins2 || 0);
	gameSlot.targetWins = Number(previousSlot.targetWins || gameSlot.targetWins || 2);
	gameSlot.score1 = previousSlot.score1 == null ? null : Number(previousSlot.score1);
	gameSlot.score2 = previousSlot.score2 == null ? null : Number(previousSlot.score2);
	gameSlot.completedGameLogId = previousSlot.completedGameLogId || null;
	gameSlot.completedGameLogIds = Array.isArray(previousSlot.completedGameLogIds)
		? previousSlot.completedGameLogIds.filter(Boolean).slice()
		: (previousSlot.completedGameLogId ? [previousSlot.completedGameLogId] : []);
	gameSlot.playedAt = Number(previousSlot.playedAt || 0) || null;

	if (previousSlot.status === "final" && previousSlot.winner && previousSlot.loser && previousSlot.winner !== previousSlot.loser) {
		gameSlot.winner = previousSlot.winner;
		gameSlot.loser = previousSlot.loser;
		gameSlot.status = "final";
	} else {
		gameSlot.winner = "";
		gameSlot.loser = "";
		gameSlot.status = gameSlot.team1Name && gameSlot.team2Name ? "scheduled" : "pending";
	}
}

function recomputePostseasonBracket(postseasonObj) {
	const postseason = ensurePostseasonShape(deepCloneJson(postseasonObj));
	const seeds = (postseason.seeds || []).slice().sort((a, b) => Number(a.seed || 0) - Number(b.seed || 0));
	const previousGames = postseason.games || {};
	const games = buildEmptyPostseasonGames();

	assignPostseasonParticipants(games.W1, seeds[0]?.teamName || "", seeds[3]?.teamName || "");
	assignPostseasonParticipants(games.W2, seeds[1]?.teamName || "", seeds[2]?.teamName || "");
	carryPostseasonResult(games.W1, previousGames.W1);
	carryPostseasonResult(games.W2, previousGames.W2);

	assignPostseasonParticipants(games.W3, games.W1.winner || "", games.W2.winner || "");
	assignPostseasonParticipants(games.L1, games.W1.loser || "", games.W2.loser || "");
	carryPostseasonResult(games.W3, previousGames.W3);
	carryPostseasonResult(games.L1, previousGames.L1);

	assignPostseasonParticipants(games.L2, games.W3.loser || "", games.L1.winner || "");
	carryPostseasonResult(games.L2, previousGames.L2);

	assignPostseasonParticipants(games.C1, games.W3.winner || "", games.L2.winner || "");
	carryPostseasonResult(games.C1, previousGames.C1);

	postseason.needsResetGame = false;
	if (games.C1.status === "final" && games.C1.winner && games.C1.winner === games.C1.team2Name) {
		postseason.needsResetGame = true;
		assignPostseasonParticipants(games.C2, games.C1.team1Name || "", games.C1.team2Name || "");
		carryPostseasonResult(games.C2, previousGames.C2);
	}

	postseason.champion = null;
	if (games.C1.status === "final" && games.C1.winner && games.C1.winner === games.C1.team1Name) {
		postseason.champion = games.C1.winner;
	} else if (games.C2.status === "final" && games.C2.winner) {
		postseason.champion = games.C2.winner;
	}

	postseason.games = games;
	postseason.isComplete = !!postseason.champion;
	return postseason;
}

function createPostseasonBracketFromSeeds(seeds) {
	return recomputePostseasonBracket({
		...createEmptyPostseasonState(),
		created: true,
		createdAt: Date.now(),
		seeds: deepCloneJson(seeds || []),
		games: buildEmptyPostseasonGames(),
		champion: null,
		isComplete: false,
		needsResetGame: false
	});
}

function getLeagueTeamByName(teamName) {
	return (league?.teams || []).find(team => team && team.name === teamName) || null;
}

function applyPostseasonOutcomeOnce(slotId, completedGameLogId = null) {
	if (!game || !slotId) return false;
	const postseason = getPostseasonState();
	if (!postseason?.created) return false;

	const slot = postseason.games?.[slotId];
	if (!slot) return false;

	const team1Name = String(game.team1?.name || "").trim();
	const team2Name = String(game.team2?.name || "").trim();
	if (!team1Name || !team2Name) return false;
	if (slot.team1Name !== team1Name || slot.team2Name !== team2Name) return false;

	const completedGameLogIds = Array.isArray(slot.completedGameLogIds)
		? slot.completedGameLogIds.filter(Boolean).slice()
		: [];

	if (completedGameLogId && completedGameLogIds.includes(completedGameLogId)) {
		game._resultSaved = true;
		return true;
	}

	const score1 = Number(game.team1Score || 0);
	const score2 = Number(game.team2Score || 0);
	if (score1 === score2) return false;

	const team1Won = score1 > score2;
	const nextSeriesWins1 = Number(slot.seriesWins1 || 0) + (team1Won ? 1 : 0);
	const nextSeriesWins2 = Number(slot.seriesWins2 || 0) + (team1Won ? 0 : 1);
	const targetWins = Number(slot.targetWins || 2);
	const seriesIsFinal = nextSeriesWins1 >= targetWins || nextSeriesWins2 >= targetWins;

	if (completedGameLogId) {
		completedGameLogIds.push(completedGameLogId);
	}

	postseason.games[slotId] = {
		...slot,
		team1Name,
		team2Name,
		score1,
		score2,
		seriesWins1: nextSeriesWins1,
		seriesWins2: nextSeriesWins2,
		targetWins,
		winner: seriesIsFinal ? (team1Won ? team1Name : team2Name) : "",
		loser: seriesIsFinal ? (team1Won ? team2Name : team1Name) : "",
		status: seriesIsFinal ? "final" : "scheduled",
		completedGameLogId: completedGameLogId || slot.completedGameLogId || null,
		completedGameLogIds,
		playedAt: Date.now()
	};

	season.postseason = recomputePostseasonBracket(postseason);
	game._resultSaved = true;
	return true;
}

function createPostseasonBracket() {
	if (!hasFullAppAccess()) {
		alert("Sign in and enter the league code to create the postseason bracket.");
		return;
	}

	const postseason = getPostseasonState();
	if (postseason?.created) {
		alert("A postseason bracket already exists. Reset postseason first if you want to create a new one.");
		return;
	}

	const seeds = getPostseasonStandingsSnapshot();
	if (seeds.length !== 4) {
		alert("Postseason requires exactly 4 ranked teams in the current regular season standings.");
		return;
	}

	season.postseason = createPostseasonBracketFromSeeds(seeds);
	saveSeason();
	showNotification("Postseason bracket created.", 1500);
	displayPostseason();
}

function resetPostseason() {
	if (!hasFullAppAccess()) {
		alert("Sign in and enter the league code to reset postseason.");
		return;
	}
	if (!confirm("Reset postseason? This clears the playoff bracket only and does not change the regular season schedule or stats.")) return;
	season.postseason = createEmptyPostseasonState();
	saveSeason();
	displayPostseason();
}

function getNextPostseasonSeriesGameNumber(slot) {
	return Number(slot?.seriesWins1 || 0) + Number(slot?.seriesWins2 || 0) + 1;
}

async function startPostseasonGame(slotId) {
	if (!hasFullAppAccess()) {
		alert("Sign in and enter the league code to record postseason games.");
		return;
	}

	const postseason = getPostseasonState();
	if (!postseason?.created || postseason?.isComplete) {
		alert("Create the postseason bracket first, or reset it before starting more playoff games.");
		return;
	}

	const slot = postseason.games?.[slotId];
	if (!slot) {
		alert("That postseason game slot was not found.");
		return;
	}
	if (slot.status === "final") {
		alert("That postseason series was already completed.");
		return;
	}
	if (!slot.team1Name || !slot.team2Name) {
		alert("That postseason series cannot start yet because both teams are not known.");
		return;
	}

	const team1 = getLeagueTeamByName(slot.team1Name);
	const team2 = getLeagueTeamByName(slot.team2Name);
	if (!team1 || !team2) {
		alert("One or both postseason teams could not be found in the current league setup.");
		return;
	}

	const seriesGameNumber = getNextPostseasonSeriesGameNumber(slot);

	await beginLockedGame(
		team1,
		team2,
		null,
		{
			type: "postseason",
			postseasonSlotId: slotId,
			postseasonLabel: slot.label,
			postseasonGameNumber: seriesGameNumber
		},
		{
			postseasonRef: {
				slotId,
				label: slot.label,
				bracketId: postseason.createdAt || Date.now(),
				seriesGameNumber
			}
		}
	);
}

function getPostseasonGameDisplayStatus(slot) {
	if (!slot) return "pending";
	if (slot.status === "final") return "final";
	if (activeGameLock?.type === "postseason" && activeGameLock?.postseasonSlotId === slot.slotId) return "in_progress";
	return slot.status || "pending";
}

function createPostseasonSeedCard(seedRow) {
	const row = document.createElement("div");
	row.className = "postseason-seed-row";
	row.innerHTML = `
		<div class="postseason-seed-number">Seed ${seedRow.seed}</div>
		<div class="postseason-seed-name">${seedRow.teamName}</div>
		<div class="postseason-seed-note">${seedRow.wins}-${seedRow.losses} • ${formatSeasonStatsSignedNumber(seedRow.avgMargin, 1)} avg margin</div>
	`;
	return row;
}

function createPostseasonGameCard(slotId, slot) {
	const card = document.createElement("div");
	card.className = "postseason-game-card";

	const displayStatus = getPostseasonGameDisplayStatus(slot);
	const seriesWins1 = Number(slot?.seriesWins1 || 0);
	const seriesWins2 = Number(slot?.seriesWins2 || 0);
	const targetWins = Number(slot?.targetWins || 2);
	const nextGameNumber = getNextPostseasonSeriesGameNumber(slot);
	const lastGameScoreText = (slot?.score1 != null && slot?.score2 != null)
		? `${slot.score1} – ${slot.score2}`
		: "";
	const showSeriesScore = !!slot?.team1Name && !!slot?.team2Name;

	card.innerHTML = `
		<div class="postseason-game-header">
			<div>
				<div class="postseason-game-slot">${slotId}</div>
				<div class="postseason-game-label">${slot.label}</div>
			</div>
			<span class="postseason-status postseason-status-${displayStatus}">${displayStatus.replace("_", " ")}</span>
		</div>
		<div class="postseason-team-row ${slot.status === "final" && slot.winner === slot.team1Name ? "is-winner" : ""}">
			<span>${slot.team1Name || "TBD"}</span>
			${showSeriesScore ? `<strong>${seriesWins1}</strong>` : ""}
		</div>
		<div class="postseason-team-row ${slot.status === "final" && slot.winner === slot.team2Name ? "is-winner" : ""}">
			<span>${slot.team2Name || "TBD"}</span>
			${showSeriesScore ? `<strong>${seriesWins2}</strong>` : ""}
		</div>
	`;

	if (slot.status === "final") {
		const note = document.createElement("div");
		note.className = "postseason-game-note";
		note.textContent = `Series winner: ${slot.winner} • Series ${seriesWins1}-${seriesWins2}${lastGameScoreText ? ` • Last game ${lastGameScoreText}` : ""}`;
		card.appendChild(note);
	} else if (showSeriesScore) {
		const note = document.createElement("div");
		note.className = "postseason-game-note";
		note.textContent = `Best of 3 • First to ${targetWins} wins • Series ${seriesWins1}-${seriesWins2}${lastGameScoreText ? ` • Last game ${lastGameScoreText}` : ""}`;
		card.appendChild(note);
	}

	if (displayStatus === "in_progress") {
		const note = document.createElement("div");
		note.className = "postseason-game-note";
		note.textContent = "This playoff game is already in progress.";
		card.appendChild(note);
	} else if (hasFullAppAccess() && !getPostseasonState()?.isComplete && slot.team1Name && slot.team2Name && slot.status !== "final") {
		const button = document.createElement("button");
		button.textContent = `Start Game ${nextGameNumber}`;
		button.onclick = () => startPostseasonGame(slotId);
		card.appendChild(button);
	} else if (!slot.team1Name || !slot.team2Name) {
		const note = document.createElement("div");
		note.className = "postseason-game-note";
		note.textContent = "Waiting for earlier series results.";
		card.appendChild(note);
	}

	return card;
}

function createPostseasonSectionCard(title, slotIds, games) {
	const section = document.createElement("div");
	section.className = "card postseason-section";
	section.innerHTML = `<h3 style="margin-top:0;">${title}</h3>`;
	const stack = document.createElement("div");
	stack.className = "postseason-section-stack";
	slotIds.forEach(slotId => stack.appendChild(createPostseasonGameCard(slotId, games[slotId])));
	section.appendChild(stack);
	return section;
}

function displayPostseason() {
	const container = document.getElementById("postseasonContainer");
	if (!container) return;
	container.innerHTML = "";

	const postseason = getPostseasonState();
	const currentSeeds = getPostseasonStandingsSnapshot();

	const intro = document.createElement("div");
	intro.className = "card";
	intro.innerHTML = `
		<h3 style="margin-top:0;">4-Team Double-Elimination Bracket</h3>
		<p class="season-stats-note">Postseason is stored separately from the regular season schedule. Seeds are frozen from the current regular season standings only when you create the bracket.</p>
	`;
	if (postseason?.champion) {
		intro.innerHTML += `<div class="winner-banner" style="margin-top:12px;">🏆 Champion: ${postseason.champion}</div>`;
	}
	if (hasFullAppAccess()) {
		const controls = document.createElement("div");
		controls.style.cssText = "display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;";
		controls.innerHTML = `
			<button type="button" onclick="createPostseasonBracket()">Create Postseason Bracket</button>
			<button type="button" onclick="resetPostseason()" style="background:#a44; color:white;">Reset Postseason</button>
		`;
		intro.appendChild(controls);
	}
	container.appendChild(intro);

	const seedsCard = document.createElement("div");
	seedsCard.className = "card";
	seedsCard.innerHTML = `<h3 style="margin-top:0;">${postseason?.created ? "Frozen Seeds" : "Current Standings Preview"}</h3>`;
	const seedsToShow = postseason?.created ? (postseason.seeds || []) : currentSeeds;
	if (seedsToShow.length !== 4) {
		seedsCard.innerHTML += `<p class="season-stats-note">Exactly 4 ranked teams are required to create the postseason bracket.</p>`;
	} else {
		const seedWrap = document.createElement("div");
		seedWrap.className = "postseason-seeds";
		seedsToShow.slice().sort((a, b) => Number(a.seed || 0) - Number(b.seed || 0)).forEach(seedRow => seedWrap.appendChild(createPostseasonSeedCard(seedRow)));
		seedsCard.appendChild(seedWrap);
	}
	container.appendChild(seedsCard);

	if (!postseason?.created) {
		const empty = document.createElement("div");
		empty.className = "card";
		empty.innerHTML = `<p class="season-stats-note">No postseason bracket exists yet. Create it once the 4-team regular season standings are final.</p>`;
		container.appendChild(empty);
		return;
	}

	const layout = document.createElement("div");
	layout.className = "postseason-layout";
	layout.appendChild(createPostseasonSectionCard("Winners Bracket", ["W1", "W2", "W3"], postseason.games));
	layout.appendChild(createPostseasonSectionCard("Losers Bracket", ["L1", "L2"], postseason.games));
	const champSection = createPostseasonSectionCard("Championship", postseason.needsResetGame ? ["C1", "C2"] : ["C1"], postseason.games);
	layout.appendChild(champSection);
	container.appendChild(layout);
}

function formatPastGameDate(value) {
	if (!value) return "Unknown date";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "Unknown date";
	return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function formatPastGameTime(value) {
	if (!value) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function getPastGameDayKey(value) {
	const date = new Date(value || 0);
	if (Number.isNaN(date.getTime())) return "unknown";
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildLegacyPastGameEntry(dayObj, seriesEntry, seriesGame, dayIndex, seriesIndex, seriesGameIndex) {
	const result = seriesGame?.result;
	if (!result) return null;

	const team1Name = seriesEntry?.away || result.team1 || result.winner || "Team 1";
	const team2Name = seriesEntry?.home || result.team2 || result.loser || "Team 2";

	let team1Score = 0;
	let team2Score = 0;

	if (result.type === "tie") {
		team1Score = Number(result.score1 || 0);
		team2Score = Number(result.score2 || 0);
	} else {
		team1Score = result.winner === team1Name ? Number(result.winnerScore || 0) : Number(result.loserScore || 0);
		team2Score = result.winner === team2Name ? Number(result.winnerScore || 0) : Number(result.loserScore || 0);
	}

	return {
		id: `scheduled-${dayIndex}-${seriesIndex}-${seriesGameIndex}`,
		playedAt: Number(result.playedAt || 0),
		team1Name,
		team2Name,
		team1Score,
		team2Score,
		hasDetailedStats: false,
		playerStats: [],
		lineups: {},
		lineScore: null,
		winningPitcher: null,
		losingPitcher: null,
		subsUsed: [],
		scheduleRef: { dayIndex, seriesIndex, seriesGameIndex },
		scheduleMeta: {
			type: "scheduled",
			dayNumber: Number(dayObj?.day || (dayIndex + 1)),
			seriesNumber: Number(seriesEntry?.gameNumber || (seriesIndex + 1)),
			seriesGameNumber: Number(seriesGame?.gameNumber || (seriesGameIndex + 1))
		},
		scheduleLabel: `Game Day ${Number(dayObj?.day || (dayIndex + 1))}`
	};
}

function normalizePastGameEntry(entry) {
	if (!entry) return null;
	const lineScore = entry.lineScore && typeof entry.lineScore === "object" ? deepCloneJson(entry.lineScore) : null;
	const subsUsed = Array.isArray(entry.subsUsed) ? entry.subsUsed.map(item => ({ ...item })) : [];
	return {
		...entry,
		playedAt: Number(entry.playedAt || 0),
		playerStats: Array.isArray(entry.playerStats) ? entry.playerStats.map(stats => ({ ...stats })) : [],
		lineups: entry.lineups && typeof entry.lineups === "object" ? { ...entry.lineups } : {},
		lineScore,
		winningPitcher: entry?.winningPitcher ? { ...entry.winningPitcher } : null,
		losingPitcher: entry?.losingPitcher ? { ...entry.losingPitcher } : null,
		subsUsed,
		scheduleMeta: entry?.scheduleMeta && typeof entry.scheduleMeta === "object" ? { ...entry.scheduleMeta } : null,
		hasDetailedStats: Array.isArray(entry.playerStats) && entry.playerStats.length > 0
	};
}

function getPastGameLogEntries() {
	const entriesById = new Map();

	(season.games || []).forEach(entry => {
		const normalized = normalizePastGameEntry(entry);
		if (normalized?.id) entriesById.set(normalized.id, normalized);
	});

	(schedule?.days || []).forEach((dayObj, dayIndex) => {
		(dayObj.games || []).forEach((seriesEntry, seriesIndex) => {
			(seriesEntry.gamesInSeries || []).forEach((seriesGame, seriesGameIndex) => {
				if (!seriesGame?.result) return;
				const legacyEntry = buildLegacyPastGameEntry(dayObj, seriesEntry, seriesGame, dayIndex, seriesIndex, seriesGameIndex);
				if (!legacyEntry?.id || entriesById.has(legacyEntry.id)) return;
				entriesById.set(legacyEntry.id, legacyEntry);
			});
		});
	});

	return Array.from(entriesById.values()).sort((a, b) => Number(b.playedAt || 0) - Number(a.playedAt || 0));
}

function getPastGameEntryForScheduleSlot(dayIndex, seriesIndex, seriesGameIndex) {
	const entryId = `scheduled-${dayIndex}-${seriesIndex}-${seriesGameIndex}`;
	return getPastGameLogEntries().find(entry => entry.id === entryId) || null;
}

function getPastGameBrowserMeta(entry) {
	if (entry?.postseasonRef?.slotId) {
		const slotId = entry.postseasonRef.slotId;
		const section = getPostseasonSectionConfig(slotId);
		const slotSortMap = { W1: 1, W2: 2, W3: 3, L1: 1, L2: 2, C1: 1, C2: 2 };
		const seriesGameNumber = Number(entry?.postseasonRef?.seriesGameNumber || 0);
		return {
			dayKey: "postseason",
			dayLabel: "Postseason",
			seriesKey: `postseason-${section.sectionKey}`,
			seriesLabel: section.sectionLabel,
			gameKey: entry.id,
			gameLabel: seriesGameNumber > 0 ? `${slotId} Game ${seriesGameNumber}` : slotId,
			sortDay: 998,
			sortSeries: section.sortSeries,
			sortGame: (Number(slotSortMap[slotId] || 0) * 10) + Number(seriesGameNumber || 0)
		};
	}

	const ref = entry?.scheduleRef;
	if (
		ref &&
		Number.isInteger(ref.dayIndex) &&
		Number.isInteger(ref.seriesIndex) &&
		Number.isInteger(ref.seriesGameIndex) &&
		schedule?.days?.[ref.dayIndex]
	) {
		const dayObj = schedule.days[ref.dayIndex];
		const seriesEntry = dayObj?.games?.[ref.seriesIndex] || {};
		const dayNumber = Number(dayObj?.day || (ref.dayIndex + 1));
		const away = seriesEntry?.away || entry.team1Name || "Team 1";
		const home = seriesEntry?.home || entry.team2Name || "Team 2";

		return {
			dayKey: `day-${ref.dayIndex}`,
			dayLabel: `Day ${dayNumber}`,
			seriesKey: `day-${ref.dayIndex}-series-${ref.seriesIndex}`,
			seriesLabel: `${away} vs ${home}`,
			gameKey: entry.id,
			gameLabel: `Game ${Number(ref.seriesGameIndex) + 1}`,
			sortDay: ref.dayIndex,
			sortSeries: ref.seriesIndex,
			sortGame: ref.seriesGameIndex
		};
	}

	return {
		dayKey: "other-games",
		dayLabel: "Other Games",
		seriesKey: `other-series-${entry?.team1Name || "team1"}-${entry?.team2Name || "team2"}`,
		seriesLabel: `${entry?.team1Name || "Team 1"} vs ${entry?.team2Name || "Team 2"}`,
		gameKey: entry?.id || "",
		gameLabel: formatPastGameDate(entry?.playedAt),
		sortDay: 999,
		sortSeries: 999,
		sortGame: Number(entry?.playedAt || 0)
	};
}

function getPastGameDayOptions(games) {
	const map = new Map();

	(games || []).forEach(entry => {
		const meta = getPastGameBrowserMeta(entry);
		if (!map.has(meta.dayKey)) {
			map.set(meta.dayKey, {
				key: meta.dayKey,
				label: meta.dayLabel,
				sortDay: meta.sortDay
			});
		}
	});

	return Array.from(map.values()).sort((a, b) => a.sortDay - b.sortDay);
}

function getPastGameSeriesOptions(games, selectedDayKey) {
	const map = new Map();

	(games || []).forEach(entry => {
		const meta = getPastGameBrowserMeta(entry);
		if (meta.dayKey !== selectedDayKey) return;

		if (!map.has(meta.seriesKey)) {
			map.set(meta.seriesKey, {
				key: meta.seriesKey,
				label: meta.seriesLabel,
				sortDay: meta.sortDay,
				sortSeries: meta.sortSeries
			});
		}
	});

	return Array.from(map.values()).sort((a, b) => {
		if (a.sortDay !== b.sortDay) return a.sortDay - b.sortDay;
		if (a.sortSeries !== b.sortSeries) return a.sortSeries - b.sortSeries;
		return a.label.localeCompare(b.label);
	});
}

function getPastGameOptionsForSeries(games, selectedSeriesKey) {
	return (games || [])
		.map(entry => {
			const meta = getPastGameBrowserMeta(entry);
			return { entry, meta };
		})
		.filter(item => item.meta.seriesKey === selectedSeriesKey)
		.sort((a, b) => {
			if (a.meta.sortGame !== b.meta.sortGame) return a.meta.sortGame - b.meta.sortGame;
			return Number(a.entry.playedAt || 0) - Number(b.entry.playedAt || 0);
		});
}

function getPastGamePlayerDisplayName(stats) {
	const playerName = String(stats?.playerName || "");
	return stats?.isSub ? `${playerName} (Sub)` : playerName;
}

function getPastGameStatsForTeam(entry, teamName) {
	const allStats = (entry?.playerStats || []).filter(stats => stats.teamName === teamName);
	const order = Array.isArray(entry?.lineups?.[teamName]) ? entry.lineups[teamName] : [];

	return allStats.sort((a, b) => {
		const aIndex = order.indexOf(a.playerName);
		const bIndex = order.indexOf(b.playerName);

		if (aIndex !== bIndex) {
			if (aIndex === -1) return 1;
			if (bIndex === -1) return -1;
			return aIndex - bIndex;
		}

		return String(a.playerName || "").localeCompare(String(b.playerName || ""));
	});
}

function createPastGameStatsTable(headers, rows) {
	const table = document.createElement("table");
	table.className = "stats-table responsive";

	const thead = document.createElement("thead");
	const headerRow = document.createElement("tr");
	headers.forEach(header => {
		const th = document.createElement("th");
		th.textContent = header;
		headerRow.appendChild(th);
	});
	thead.appendChild(headerRow);
	table.appendChild(thead);

	const tbody = document.createElement("tbody");
	rows.forEach(values => {
		const tr = document.createElement("tr");
		values.forEach((value, index) => {
			const td = document.createElement("td");
			td.setAttribute("data-label", headers[index]);
			td.textContent = String(value);
			tr.appendChild(td);
		});
		tbody.appendChild(tr);
	});
	table.appendChild(tbody);

	return table;
}

function createPastGameBattingTable(entry, teamName) {
	const teamStats = getPastGameStatsForTeam(entry, teamName);
	const headers = ["Player", "AVG", "AB", "H", "1B", "2B", "3B", "HR", "RBI", "BB", "K"];

	const rows = teamStats.map(stats => {
		const avg = Number(stats.atBats || 0) > 0 ? (Number(stats.hits || 0) / Number(stats.atBats || 0)).toFixed(3) : ".000";
		return [
			getPastGamePlayerDisplayName(stats),
			avg,
			stats.atBats,
			stats.hits,
			stats.singles,
			stats.doubles,
			stats.triples,
			stats.homeRuns,
			stats.rbis,
			stats.walks,
			stats.strikeouts
		];
	});

	return createPastGameStatsTable(headers, rows);
}

function createPastGamePitchingTable(entry, teamName) {
	const allTeamStats = getPastGameStatsForTeam(entry, teamName);
	const teamStats = allTeamStats.filter(stats =>
		Number(stats.pitchOuts || 0) > 0 ||
		Number(stats.pitchStrikeouts || 0) > 0 ||
		Number(stats.runsAllowed || 0) > 0 ||
		Number(stats.earnedRunsAllowed || 0) > 0
	);
	const rowsSource = teamStats.length ? teamStats : allTeamStats;
	const headers = ["Player", "IP", "K's", "K/3", "R", "ER", "ERA", "Errors"];

	const rows = rowsSource.map(stats => {
		const innings = getPitchingInningsValue(stats);
		const kPer3 = innings > 0 ? ((Number(stats.pitchStrikeouts || 0) / innings) * 3).toFixed(2) : "-";
		const era = innings > 0 ? ((Number(stats.earnedRunsAllowed || 0) / innings) * 3).toFixed(2) : "-";

		return [
			getPastGamePlayerDisplayName(stats),
			innings.toFixed(1),
			stats.pitchStrikeouts,
			kPer3,
			stats.runsAllowed,
			stats.earnedRunsAllowed,
			era,
			stats.fieldingErrors
		];
	});

	return createPastGameStatsTable(headers, rows);
}

function getPastGameTeamErrorTotal(entry, teamName) {
	return getPastGameStatsForTeam(entry, teamName).reduce((sum, stats) => sum + Number(stats.fieldingErrors || 0), 0);
}

function getPastGameScheduleSlotLabel(entry) {

		if (entry?.postseasonRef?.slotId) {
		const seriesGameNumber = Number(entry?.postseasonRef?.seriesGameNumber || 0);
		return `Postseason • ${entry.postseasonRef.slotId}${seriesGameNumber > 0 ? ` • Game ${seriesGameNumber}` : ""}`;
	}
	const meta = entry?.scheduleMeta || null;
	if (meta?.dayNumber && meta?.seriesNumber && meta?.seriesGameNumber) {
		return `Day ${meta.dayNumber} • Series ${meta.seriesNumber} • Game ${meta.seriesGameNumber}`;
	}
	if (entry?.scheduleLabel) return entry.scheduleLabel;
	return entry?.scheduleRef ? "Scheduled game" : "Manual game";
}

function getPastGameDetailLevelLabel(entry) {
	if (!entry?.hasDetailedStats) return "Score only";
	if (entry?.lineScore && typeof entry.lineScore === "object") return "Full box score";
	return "Detailed lines only";
}

function createPastGameLineScoreCard(entry) {
	const card = document.createElement("div");
	card.className = "card";
	card.innerHTML = `<h4>Line Score</h4>`;

	const lineScore = entry?.lineScore && typeof entry.lineScore === "object" ? entry.lineScore : null;
	const team1Runs = Array.isArray(lineScore?.[entry.team1Name]) ? lineScore[entry.team1Name] : [];
	const team2Runs = Array.isArray(lineScore?.[entry.team2Name]) ? lineScore[entry.team2Name] : [];
	const inningCount = lineScore ? Math.max(team1Runs.length, team2Runs.length, 3) : 0;

	if (!inningCount) {
		const note = document.createElement("p");
		note.className = "season-stats-note";
		note.textContent = entry?.hasDetailedStats
			? "Inning-by-inning line score was not stored for this older saved game."
			: "Full inning-by-inning line score was not stored for this older game.";
		card.appendChild(note);
		return card;
	}

	const table = document.createElement("table");
	table.className = "stats-table responsive past-game-line-score-table";
	const thead = document.createElement("thead");
	const headRow = document.createElement("tr");
const lineScoreHeaders = ["Team", ...Array.from({ length: inningCount }, (_, index) => getLineScoreInningLabel(index)), "R", "E"];

lineScoreHeaders.forEach(label => {
		const th = document.createElement("th");
		th.textContent = label;
		headRow.appendChild(th);
	});
	thead.appendChild(headRow);
	table.appendChild(thead);

	const tbody = document.createElement("tbody");
	[
		{ teamName: entry.team1Name, inningRuns: team1Runs, totalRuns: entry.team1Score },
		{ teamName: entry.team2Name, inningRuns: team2Runs, totalRuns: entry.team2Score }
	].forEach(row => {
		const tr = document.createElement("tr");
		const values = [
			row.teamName,
			...Array.from({ length: inningCount }, (_, index) => Number(row.inningRuns[index] || 0)),
			row.totalRuns,
			getPastGameTeamErrorTotal(entry, row.teamName)
		];
		values.forEach((value, index) => {
			const td = document.createElement("td");
td.setAttribute("data-label", lineScoreHeaders[index]);
			td.textContent = String(value);
			tr.appendChild(td);
		});
		tbody.appendChild(tr);
	});
	table.appendChild(tbody);
	card.appendChild(table);

	return card;
}

function createPastGameNotesCard(entry) {
	const card = document.createElement("div");
	card.className = "card";
	card.innerHTML = `<h4>Game Notes</h4>`;

	card.appendChild(buildSeasonStatsMetricGrid([
		{ label: "Winning Pitcher", value: entry?.winningPitcher?.pitcherName ? `${entry.winningPitcher.pitcherName} (${entry.winningPitcher.teamName || ""})` : "-" },
		{ label: "Losing Pitcher", value: entry?.losingPitcher?.pitcherName ? `${entry.losingPitcher.pitcherName} (${entry.losingPitcher.teamName || ""})` : "-" },
		{ label: `${entry?.team1Name || "Team 1"} Errors`, value: getPastGameTeamErrorTotal(entry, entry?.team1Name) },
		{ label: `${entry?.team2Name || "Team 2"} Errors`, value: getPastGameTeamErrorTotal(entry, entry?.team2Name) }
	]));

	const subs = Array.isArray(entry?.subsUsed) ? entry.subsUsed : [];
	if (subs.length) {
		const list = document.createElement("div");
		list.className = "past-game-sub-list";
		list.innerHTML = `<div class="season-stats-note" style="margin-bottom:8px;">Subs Used</div>`;
		subs.forEach(item => {
			const row = document.createElement("div");
			row.className = "past-game-sub-item";
			row.textContent = item?.replacedPlayer
				? `${item.subName} (${item.teamName}) for ${item.replacedPlayer}`
				: `${item.subName} (${item.teamName})`;
			list.appendChild(row);
		});
		card.appendChild(list);
	} else {
		const note = document.createElement("p");
		note.className = "season-stats-note";
		note.textContent = entry?.hasDetailedStats
			? "No subs were used, or sub usage was not stored for this saved game."
			: "Sub usage was not stored for this older game.";
		card.appendChild(note);
	}

	return card;
}

function createPastGameTeamCard(entry, teamName, score) {
	const wrap = document.createElement("div");
	wrap.className = "season-stats-stack";

	const header = document.createElement("div");
	header.className = "season-stats-selection-header";
	header.innerHTML = `
		<h4>${teamName}</h4>
		<p>Final Score: ${score}</p>
	`;
	wrap.appendChild(header);

	const battingCard = document.createElement("div");
	battingCard.className = "card";
	battingCard.innerHTML = `<h4>${teamName} Batting</h4>`;
	battingCard.appendChild(createPastGameBattingTable(entry, teamName));
	wrap.appendChild(battingCard);

	const pitchingCard = document.createElement("div");
	pitchingCard.className = "card";
	pitchingCard.innerHTML = `<h4>${teamName} Pitching</h4>`;
	pitchingCard.appendChild(createPastGamePitchingTable(entry, teamName));
	wrap.appendChild(pitchingCard);

	return wrap;
}

function createPastGameDetails(entry) {
	const wrap = document.createElement("div");
	wrap.className = "season-stats-stack";

	if (!entry) {
		wrap.innerHTML = '<div class="card"><p class="season-stats-empty">No past game selected.</p></div>';
		return wrap;
	}

	const summaryCard = document.createElement("div");
	summaryCard.className = "card";
	summaryCard.innerHTML = `
		<h3 style="margin-top:0;">${entry.team1Name} vs ${entry.team2Name}</h3>
		<div class="past-game-scoreboard">
			<div class="past-game-score-team">
				<div class="past-game-score-name">${entry.team1Name}</div>
				<div class="past-game-score-value">${entry.team1Score}</div>
			</div>
			<div class="past-game-score-divider">–</div>
			<div class="past-game-score-team">
				<div class="past-game-score-name">${entry.team2Name}</div>
				<div class="past-game-score-value">${entry.team2Score}</div>
			</div>
		</div>
	`;

	summaryCard.appendChild(buildSeasonStatsMetricGrid([
		{ label: "Date", value: formatPastGameDate(entry.playedAt) },
		{ label: "Time", value: formatPastGameTime(entry.playedAt) || "-" },
		{ label: "Type", value: getPostseasonTypeLabel(entry) },
		{ label: "Slot", value: getPastGameScheduleSlotLabel(entry) },
		{ label: "Detail", value: getPastGameDetailLevelLabel(entry) }
	]));

	const note = document.createElement("p");
	note.className = "season-stats-note";
	if (!entry.hasDetailedStats) {
		note.textContent = "This older saved game has a final score, but the full box score was not stored yet.";
	} else if (!entry.lineScore) {
		note.textContent = "This saved game includes batting and pitching lines, but inning-by-inning line score and some box score extras were not stored yet.";
	} else {
		note.textContent = "This saved game includes the full box score details that were stored at game finalization.";
	}
	summaryCard.appendChild(note);
	wrap.appendChild(summaryCard);

	wrap.appendChild(createPastGameLineScoreCard(entry));
	wrap.appendChild(createPastGameNotesCard(entry));

	if (!entry.hasDetailedStats) {
		const noDetailsCard = document.createElement("div");
		noDetailsCard.className = "card";
		noDetailsCard.innerHTML = `
			<h4>Player Performances</h4>
			<p class="season-stats-note">Detailed batting and pitching lines were not stored for this older game.</p>
		`;
		wrap.appendChild(noDetailsCard);
		return wrap;
	}

	const teamsGrid = document.createElement("div");
	teamsGrid.className = "past-game-team-grid";
	teamsGrid.appendChild(createPastGameTeamCard(entry, entry.team1Name, entry.team1Score));
	teamsGrid.appendChild(createPastGameTeamCard(entry, entry.team2Name, entry.team2Score));
	wrap.appendChild(teamsGrid);

	return wrap;
}

function displayPastGameLog() {
	const container = document.getElementById("pastGameLogContainer");
	if (!container) return;

	const previousDayValue = document.getElementById("pastGameDaySelect")?.value || "";
	const previousSeriesValue = document.getElementById("pastGameSeriesSelect")?.value || "";
	const previousGameValue = document.getElementById("pastGameSelect")?.value || "";
	container.innerHTML = "";

	const games = getPastGameLogEntries();
	if (!games.length) {
		container.innerHTML = "<div class='card'><p>No completed games have been logged yet.</p></div>";
		return;
	}

	const introCard = document.createElement("div");
	introCard.className = "card";
	introCard.innerHTML = `
		<h3 style="margin-top:0;">Past Game Log</h3>
		<p class="season-stats-note">Browse completed games by season day or postseason round, then choose the series and game number to review the final score and saved player performances.</p>
	`;
	container.appendChild(introCard);

	const browserCard = document.createElement("div");
	browserCard.className = "card";
	browserCard.innerHTML = `<h3 style="margin-top:0;">Find a Game</h3>`;
	container.appendChild(browserCard);

	const browserGrid = document.createElement("div");
	browserGrid.className = "past-game-browser-grid";
	browserCard.appendChild(browserGrid);

	const dayGroup = document.createElement("div");
	dayGroup.className = "past-game-select-group";
	dayGroup.innerHTML = `<label for="pastGameDaySelect">Season Day</label>`;
	browserGrid.appendChild(dayGroup);

	const daySelect = document.createElement("select");
	daySelect.id = "pastGameDaySelect";
	daySelect.className = "season-stats-select";
	dayGroup.appendChild(daySelect);

	const seriesGroup = document.createElement("div");
	seriesGroup.className = "past-game-select-group";
	seriesGroup.innerHTML = `<label for="pastGameSeriesSelect">Series</label>`;
	browserGrid.appendChild(seriesGroup);

	const seriesSelect = document.createElement("select");
	seriesSelect.id = "pastGameSeriesSelect";
	seriesSelect.className = "season-stats-select";
	seriesGroup.appendChild(seriesSelect);

	const gameGroup = document.createElement("div");
	gameGroup.className = "past-game-select-group";
	gameGroup.innerHTML = `<label for="pastGameSelect">Game</label>`;
	browserGrid.appendChild(gameGroup);

	const gameSelect = document.createElement("select");
	gameSelect.id = "pastGameSelect";
	gameSelect.className = "season-stats-select";
	gameGroup.appendChild(gameSelect);

	const details = document.createElement("div");
	details.id = "pastGameDetails";
	container.appendChild(details);

	const dayOptions = getPastGameDayOptions(games);
	dayOptions.forEach(option => {
		const el = document.createElement("option");
		el.value = option.key;
		el.textContent = option.label;
		daySelect.appendChild(el);
	});

	function populateSeriesSelect() {
		const selectedDayKey = daySelect.value;
		const seriesOptions = getPastGameSeriesOptions(games, selectedDayKey);

		seriesSelect.innerHTML = "";
		seriesOptions.forEach(option => {
			const el = document.createElement("option");
			el.value = option.key;
			el.textContent = option.label;
			seriesSelect.appendChild(el);
		});

		if (seriesOptions.some(option => option.key === previousSeriesValue)) {
			seriesSelect.value = previousSeriesValue;
		} else if (seriesOptions[0]) {
			seriesSelect.value = seriesOptions[0].key;
		}
	}

	function populateGameSelect() {
		const selectedSeriesKey = seriesSelect.value;
		const gameOptions = getPastGameOptionsForSeries(games, selectedSeriesKey);

		gameSelect.innerHTML = "";
		gameOptions.forEach(item => {
			const option = document.createElement("option");
			option.value = item.entry.id;
			option.textContent = item.meta.gameLabel;
			gameSelect.appendChild(option);
		});

		if (gameOptions.some(item => item.entry.id === previousGameValue)) {
			gameSelect.value = previousGameValue;
		} else if (gameOptions[0]) {
			gameSelect.value = gameOptions[0].entry.id;
		}
	}

	function renderSelectedGame() {
		const selected = games.find(entry => entry.id === gameSelect.value) || null;
		details.innerHTML = "";
		details.appendChild(createPastGameDetails(selected));
	}

	daySelect.value = dayOptions.some(option => option.key === previousDayValue)
		? previousDayValue
		: (dayOptions[0]?.key || "");

	populateSeriesSelect();
	populateGameSelect();

	daySelect.addEventListener("change", () => {
		populateSeriesSelect();
		populateGameSelect();
		renderSelectedGame();
	});

	seriesSelect.addEventListener("change", () => {
		populateGameSelect();
		renderSelectedGame();
	});

	gameSelect.addEventListener("change", renderSelectedGame);
	renderSelectedGame();
}

/* ================================
   MANUAL COMPLETED-GAME STAT EDITOR
================================== */
const MANUAL_GAME_STAT_EDITOR_BATTING_FIELDS = [
	{ key: "atBats", label: "AB" },
	{ key: "hits", label: "H" },
	{ key: "singles", label: "1B" },
	{ key: "doubles", label: "2B" },
	{ key: "triples", label: "3B" },
	{ key: "homeRuns", label: "HR" },
	{ key: "rbis", label: "RBI" },
	{ key: "runsScored", label: "R" },
	{ key: "walks", label: "BB" },
	{ key: "hitByPitch", label: "HBP" },
	{ key: "strikeouts", label: "SO" },
	{ key: "outs", label: "Outs" },
	{ key: "fieldingErrors", label: "E" }
];

const MANUAL_GAME_STAT_EDITOR_PITCHING_FIELDS = [
	{ key: "pitchOuts", label: "Pitch Outs" },
	{ key: "pitchStrikeouts", label: "K" },
	{ key: "runsAllowed", label: "R" },
	{ key: "earnedRunsAllowed", label: "ER" }
];

function getManualGameStatEditorEditableFields(kind) {
	const source = kind === "pitching"
		? MANUAL_GAME_STAT_EDITOR_PITCHING_FIELDS
		: MANUAL_GAME_STAT_EDITOR_BATTING_FIELDS;
	const validFields = Array.isArray(STATS_BACKUP_NUMERIC_FIELDS) ? STATS_BACKUP_NUMERIC_FIELDS : [];
	return source.filter(field => validFields.includes(field.key));
}

function getManualGameStatEditorEntries() {
	const storedGames = Array.isArray(season?.games) ? season.games : [];
	return getPastGameLogEntries()
		.filter(entry => entry?.seasonPhase !== "postseason" && !entry?.postseasonRef)
		.map(entry => {
		const storedIndex = storedGames.findIndex(storedEntry => storedEntry && storedEntry.id === entry.id);
		const storedEntry = storedIndex >= 0 ? storedGames[storedIndex] : null;
		const editable = !!storedEntry && Array.isArray(storedEntry.playerStats) && storedEntry.playerStats.length > 0;
		return {
			entry,
			storedIndex,
			editable,
			meta: getPastGameBrowserMeta(entry)
		};
	});
}

function getManualGameStatEditorOptionLabel(item) {
	const entry = item?.entry || {};
	const meta = item?.meta || getPastGameBrowserMeta(entry);
	const dateText = formatPastGameDate(entry.playedAt);
	const scoreText = `${entry.team1Name || "Team 1"} ${Number(entry.team1Score || 0)} - ${Number(entry.team2Score || 0)} ${entry.team2Name || "Team 2"}`;
	const editText = item?.editable ? "" : " (score only - not editable)";
	return `${meta.dayLabel} • ${meta.seriesLabel} • ${meta.gameLabel} • ${dateText} • ${scoreText}${editText}`;
}

function getManualGameStatEditorRowsForTeam(entry, teamName) {
	const order = Array.isArray(entry?.lineups?.[teamName]) ? entry.lineups[teamName] : [];
	return (entry?.playerStats || [])
		.map((stats, statIndex) => ({ stats, statIndex }))
		.filter(row => row.stats?.teamName === teamName)
		.sort((a, b) => {
			const aIndex = order.indexOf(a.stats?.playerName);
			const bIndex = order.indexOf(b.stats?.playerName);

			if (aIndex !== bIndex) {
				if (aIndex === -1) return 1;
				if (bIndex === -1) return -1;
				return aIndex - bIndex;
			}

			return String(a.stats?.playerName || "").localeCompare(String(b.stats?.playerName || ""));
		});
}

function createManualGameStatEditorTable(entry, teamName, kind) {
	const fields = getManualGameStatEditorEditableFields(kind);
	const rows = getManualGameStatEditorRowsForTeam(entry, teamName);
	const wrap = document.createElement("div");
	wrap.className = "manual-game-editor-table-wrap";

	const table = document.createElement("table");
	table.className = "stats-table manual-game-editor-table";
	wrap.appendChild(table);

	const thead = document.createElement("thead");
	const headerRow = document.createElement("tr");
	["Player", ...fields.map(field => field.label)].forEach(label => {
		const th = document.createElement("th");
		th.textContent = label;
		headerRow.appendChild(th);
	});
	thead.appendChild(headerRow);
	table.appendChild(thead);

	const tbody = document.createElement("tbody");
	rows.forEach(row => {
		const tr = document.createElement("tr");

		const nameCell = document.createElement("td");
		nameCell.textContent = getPastGamePlayerDisplayName(row.stats);
		tr.appendChild(nameCell);

		fields.forEach(field => {
			const td = document.createElement("td");
			const input = document.createElement("input");
			input.type = "number";
			input.min = "0";
			input.step = "1";
			input.inputMode = "numeric";
			input.value = String(Math.max(0, Math.trunc(Number(row.stats?.[field.key] || 0))));
			input.dataset.manualGameId = String(entry.id || "");
			input.dataset.statIndex = String(row.statIndex);
			input.dataset.statField = field.key;
			input.setAttribute("aria-label", `${getPastGamePlayerDisplayName(row.stats)} ${field.label}`);
			td.appendChild(input);
			tr.appendChild(td);
		});

		tbody.appendChild(tr);
	});
	table.appendChild(tbody);

	if (!rows.length) {
		const empty = document.createElement("p");
		empty.className = "season-stats-note";
		empty.textContent = `No saved ${kind} lines were found for ${teamName}.`;
		wrap.appendChild(empty);
	}

	return wrap;
}

function createManualGameStatEditorTeamCard(entry, teamName) {
	const stack = document.createElement("div");
	stack.className = "season-stats-stack";

	const battingCard = document.createElement("div");
	battingCard.className = "card";
	battingCard.innerHTML = `<h4 style="margin-top:0;">${teamName} Batting / Fielding</h4>`;
	battingCard.appendChild(createManualGameStatEditorTable(entry, teamName, "batting"));
	stack.appendChild(battingCard);

	const pitchingCard = document.createElement("div");
	pitchingCard.className = "card";
	pitchingCard.innerHTML = `<h4 style="margin-top:0;">${teamName} Pitching</h4>`;
	pitchingCard.appendChild(createManualGameStatEditorTable(entry, teamName, "pitching"));
	stack.appendChild(pitchingCard);

	return stack;
}

function getManualGameStatEditorRebuildBlockReason() {
	const regularLogs = (Array.isArray(season?.games) ? season.games : []).filter(entry =>
		entry && entry.seasonPhase !== "postseason" && !entry.postseasonRef
	);
	const scoreOnlyRegularLogs = regularLogs.filter(entry =>
		!Array.isArray(entry.playerStats) || entry.playerStats.length === 0
	);
	if (scoreOnlyRegularLogs.length) {
		return "At least one regular-season game log is score-only and does not have saved playerStats. Rebuilding totals now could remove stats from that older game.";
	}

	if (typeof buildRecordedScheduleGameIds === "function") {
		const recordedIds = buildRecordedScheduleGameIds(schedule);
		const detailedIds = new Set(
			regularLogs
				.filter(entry => Array.isArray(entry.playerStats) && entry.playerStats.length > 0)
				.map(entry => String(entry.id || "").trim())
				.filter(Boolean)
		);
		const missingDetailedScheduledLogs = recordedIds.filter(id => !detailedIds.has(id));
		if (missingDetailedScheduledLogs.length) {
			return "At least one recorded scheduled game does not have a detailed saved playerStats log. Rebuilding totals now could make season totals incomplete.";
		}
	}

	return "";
}

function normalizeManualGameStatEditorInputValue(input) {
	const raw = String(input?.value || "").trim();
	if (!raw) return null;
	const value = Number(raw);
	if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) return null;
	return value;
}

function rebuildSeasonTotalsAfterManualGameStatEdit() {
	const rebuilt = rebuildSeasonStatBucketsFromGameLogs(season);
	season.playerStats = rebuilt.playerStats || {};
	season.subStats = rebuilt.subStats || {};
	season.seasonSubs = Array.isArray(rebuilt.seasonSubs) ? rebuilt.seasonSubs : [];

	try { rebuildCurrentTeamRecordsFromSavedResults({ preserveWhenNoSource: true }); } catch (e) {
		console.warn("Manual game editor could not rebuild team records:", e);
	}
}

function displayManualGameStatEditor(selectedGameId = "") {
	const container = document.getElementById("manualGameStatEditorContainer");
	if (!container) return;

	container.innerHTML = "";

	const unlocked = typeof isLeagueUnlocked === "function" ? isLeagueUnlocked() : !isPublicViewOnlyMode();
	if (isPublicViewOnlyMode() || !unlocked) {
		container.innerHTML = `
			<div class="card">
				<p class="season-stats-empty">Sign in and enter the league code to edit completed game stats.</p>
			</div>
		`;
		return;
	}

	const introCard = document.createElement("div");
	introCard.className = "card";
	introCard.innerHTML = `
		<h3 style="margin-top:0;">Manual Game Stat Editor</h3>
		<div class="manual-game-editor-warning">
			⚠️ Use this only to fix tracking mistakes after a game is complete. Saving corrections rewrites that one saved game log, then rebuilds regular-season player totals from the completed game logs.
		</div>
		<p class="season-stats-note" style="margin-top:10px;">
			This editor uses the current saved player stat fields: AB, H, 1B, 2B, 3B, HR, RBI, R, BB, HBP, SO, batting outs, fielding errors, pitching outs, pitching strikeouts, runs allowed, and earned runs allowed.
		</p>
	`;
	container.appendChild(introCard);

	const entries = getManualGameStatEditorEntries();
	if (!entries.length) {
		const emptyCard = document.createElement("div");
		emptyCard.className = "card";
		emptyCard.innerHTML = `<p class="season-stats-empty">No completed games have been logged yet.</p>`;
		container.appendChild(emptyCard);
		return;
	}

	const browserCard = document.createElement("div");
	browserCard.className = "card";
	browserCard.innerHTML = `<h3 style="margin-top:0;">Choose Completed Game</h3>`;
	container.appendChild(browserCard);

	const select = document.createElement("select");
	select.id = "manualGameStatEditorSelect";
	select.className = "season-stats-select";
	entries.forEach(item => {
		const option = document.createElement("option");
		option.value = String(item.entry.id || "");
		option.textContent = getManualGameStatEditorOptionLabel(item);
		select.appendChild(option);
	});
	browserCard.appendChild(select);

	const chosenId = selectedGameId && entries.some(item => item.entry.id === selectedGameId)
		? selectedGameId
		: (entries[0]?.entry?.id || "");
	select.value = chosenId;
	select.addEventListener("change", () => displayManualGameStatEditor(select.value));

	const selectedItem = entries.find(item => item.entry.id === select.value) || entries[0];
	const entry = selectedItem?.entry || null;

	if (!entry) return;

	const summaryCard = document.createElement("div");
	summaryCard.className = "card";
	summaryCard.innerHTML = `
		<h3 style="margin-top:0;">${entry.team1Name} vs ${entry.team2Name}</h3>
		<p class="season-stats-note">
			${formatPastGameDate(entry.playedAt)} ${formatPastGameTime(entry.playedAt) || ""} • ${getPastGameScheduleSlotLabel(entry)}
		</p>
		<div class="past-game-scoreboard">
			<div class="past-game-score-team">
				<div class="past-game-score-name">${entry.team1Name}</div>
				<div class="past-game-score-value">${entry.team1Score}</div>
			</div>
			<div class="past-game-score-divider">–</div>
			<div class="past-game-score-team">
				<div class="past-game-score-name">${entry.team2Name}</div>
				<div class="past-game-score-value">${entry.team2Score}</div>
			</div>
		</div>
	`;
	container.appendChild(summaryCard);

	if (!selectedItem.editable) {
		const lockedCard = document.createElement("div");
		lockedCard.className = "card";
		lockedCard.innerHTML = `
			<h3 style="margin-top:0;">This game cannot be edited</h3>
			<p class="season-stats-note">This completed game does not have a detailed saved playerStats array in season.games. It may be an older score-only schedule result, so there are no player lines to safely edit.</p>
		`;
		container.appendChild(lockedCard);
		return;
	}

	const blockReason = getManualGameStatEditorRebuildBlockReason();
	if (blockReason) {
		const blockedCard = document.createElement("div");
		blockedCard.className = "card";
		blockedCard.innerHTML = `
			<h3 style="margin-top:0;">Rebuild is not safe yet</h3>
			<p class="season-stats-note">${blockReason}</p>
			<p class="season-stats-note">No changes were made. This protects the current season totals from being rebuilt with incomplete game-log data.</p>
		`;
		container.appendChild(blockedCard);
		return;
	}

	const teamsGrid = document.createElement("div");
	teamsGrid.className = "past-game-team-grid";
	teamsGrid.appendChild(createManualGameStatEditorTeamCard(entry, entry.team1Name));
	teamsGrid.appendChild(createManualGameStatEditorTeamCard(entry, entry.team2Name));
	container.appendChild(teamsGrid);

	const actionsCard = document.createElement("div");
	actionsCard.className = "card";
	const actions = document.createElement("div");
	actions.className = "manual-game-editor-actions";
	actionsCard.appendChild(actions);

	const saveBtn = document.createElement("button");
	saveBtn.className = "menu-button";
	saveBtn.type = "button";
	saveBtn.textContent = "💾 Save Corrections";
	saveBtn.addEventListener("click", () => saveManualGameStatEditorCorrections(entry.id));
	actions.appendChild(saveBtn);

	const cancelBtn = document.createElement("button");
	cancelBtn.className = "small-link";
	cancelBtn.type = "button";
	cancelBtn.textContent = "Cancel Changes";
	cancelBtn.addEventListener("click", () => displayManualGameStatEditor(entry.id));
	actions.appendChild(cancelBtn);

	const pastLogBtn = document.createElement("button");
	pastLogBtn.className = "small-link";
	pastLogBtn.type = "button";
	pastLogBtn.textContent = "Back to Past Game Log";
	pastLogBtn.addEventListener("click", () => showPastGameLog());
	actions.appendChild(pastLogBtn);

	container.appendChild(actionsCard);
}

async function saveManualGameStatEditorCorrections(entryId) {
	const unlocked = typeof isLeagueUnlocked === "function" ? isLeagueUnlocked() : !isPublicViewOnlyMode();
	if (isPublicViewOnlyMode() || !unlocked) {
		alert("Sign in and enter the league code to edit completed game stats.");
		return false;
	}

	if (game) {
		alert("Finish or End Game Early before editing completed game stats.");
		return false;
	}

	const blockReason = getManualGameStatEditorRebuildBlockReason();
	if (blockReason) {
		alert("Manual stat editing is blocked because rebuilding season totals is not safe yet. " + blockReason);
		return false;
	}

	season.games = Array.isArray(season.games) ? season.games : [];
	const gameIndex = season.games.findIndex(entry => entry && entry.id === entryId);
	if (gameIndex < 0) {
		alert("That completed game could not be found in season.games. Nothing was saved.");
		return false;
	}

	const nextEntry = deepCloneJson(season.games[gameIndex]);
	if (!nextEntry || !Array.isArray(nextEntry.playerStats) || !nextEntry.playerStats.length) {
		alert("This game does not have detailed player stats to edit.");
		return false;
	}

	const editableFields = new Set([
		...getManualGameStatEditorEditableFields("batting").map(field => field.key),
		...getManualGameStatEditorEditableFields("pitching").map(field => field.key)
	]);

	const inputs = Array.from(document.querySelectorAll("#manualGameStatEditorContainer input[data-manual-game-id]"))
		.filter(input => input.dataset.manualGameId === String(entryId));
	for (const input of inputs) {
		const statIndex = Number(input.dataset.statIndex);
		const field = input.dataset.statField;
		const value = normalizeManualGameStatEditorInputValue(input);

		if (!Number.isInteger(statIndex) || !nextEntry.playerStats[statIndex] || !editableFields.has(field) || value === null) {
			alert("Every edited stat must be a whole number of 0 or higher. Nothing was saved.");
			return false;
		}

		nextEntry.playerStats[statIndex][field] = value;
	}

	nextEntry.playerStats = nextEntry.playerStats.map(rawStats => {
		const stats = { ...rawStats };
		STATS_BACKUP_NUMERIC_FIELDS.forEach(field => {
			stats[field] = Math.max(0, Math.trunc(Number(stats[field] || 0)));
		});
		syncPitchingInnings(stats);
		return stats;
	});

	const confirmMessage =
		"Save these corrected stats for this completed game?\n\n" +
		"This will update the saved game log, rebuild regular-season player totals from all detailed completed game logs, refresh the stats screens, and sync the season data.";

	if (!confirm(confirmMessage)) return false;

	season.games[gameIndex] = nextEntry;
	rebuildSeasonTotalsAfterManualGameStatEdit();

	const savedLocally = saveSeason({ skipServerSync: true });
	if (!savedLocally) {
		alert("The app stopped this save because a newer/conflicting local snapshot was detected. Nothing was synced.");
		return false;
	}

	let synced = false;
	try {
		synced = await withAppWorking("Saving corrections…", async () => {
			return await syncSeasonToServer({ quiet: true });
		});
	} catch (error) {
		console.warn("Manual game stat editor sync failed:", error);
		synced = false;
	}

	try { displayManualGameStatEditor(entryId); } catch (e) {}
	try { if (!document.getElementById("seasonStatsScreen")?.classList.contains("hidden")) displaySeasonStats(); } catch (e) {}
	try { if (!document.getElementById("rankingsScreen")?.classList.contains("hidden")) displayRankings(); } catch (e) {}
	try { if (!document.getElementById("pastGameLogScreen")?.classList.contains("hidden")) displayPastGameLog(); } catch (e) {}

	if (synced) {
		alert("✅ Game stat corrections saved, season totals rebuilt, and data synced.");
	} else {
		try { queueServerSync("manual-game-stat-editor", { immediate: true }); } catch (e) {}
		alert("Corrections were saved locally and season totals were rebuilt, but server sync was not confirmed. Press the Sync button when your connection is good.");
	}

	return true;
}
