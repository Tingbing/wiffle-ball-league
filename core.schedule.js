// Wiffle Ball League - Schedule generation, editing, rendering, and game selection helpers
// Split from app.core.js. Load this AFTER core.sync.js and BEFORE core.stats.js, core.ui.js, app.game.js, and app.auth.js.

/* ================================
   SCHEDULE BASICS
================================== */
	function getValidTeamsForSchedule() {
	return league.teams.filter(t => Array.isArray(t.players) && t.players.length > 0);
	}
	
	/* ================================
	✅ RANDOM HELPERS
	==================================*/
	function shuffleArray(arr) {
	for (let i = arr.length - 1; i > 0; i--) {
	const j = Math.floor(Math.random() * (i + 1));
	[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
	}
	
/* ==========================================================
	✅ BALANCED RANDOM SCHEDULE (4 teams, 6 days, 2 series/day)
	- Each pair plays exactly 2 best-of-3 series
==========================================================*/

/* ==========================================================
	✅ SCHEDULE HELPERS
	- 4 teams: double round robin (existing behavior)
	- 5 teams: single round robin with one bye each day
==========================================================*/

const SCHEDULE_FORMAT_DOUBLE_ROUND_ROBIN_4 = "double_round_robin_4";
const SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5 = "single_round_robin_5";

function getScheduleConfigForTeamCount(teamCount) {
	if (Number(teamCount) === 4) {
		return {
			id: SCHEDULE_FORMAT_DOUBLE_ROUND_ROBIN_4,
			teamCount: 4,
			totalDays: 6,
			seriesPerDay: 2,
			description: "6 game days • 4 teams • everyone plays each other twice"
		};
	}

	if (Number(teamCount) === 5) {
		return {
			id: SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5,
			teamCount: 5,
			totalDays: 5,
			seriesPerDay: 2,
			description: "5 game days • 5 teams • everyone plays each other once • 1 bye each day"
		};
	}

	return null;
}

function getScheduleConfigForTeams(teamsOrNames) {
	const count = Array.isArray(teamsOrNames) ? teamsOrNames.length : Number(teamsOrNames || 0);
	return getScheduleConfigForTeamCount(count);
}

function normalizeMatchupKey(teamA, teamB) {
	return [teamA, teamB].map(v => String(v || "").trim()).sort().join("||");
}

function createSeriesGameSlot(gameNumber, result = null) {
	return { gameNumber, result, skipped: null, subAssignments: [] };
}

function createSeriesEntry(away, home, seriesNumber) {
	return {
		gameNumber: seriesNumber, // keeps the schedule screen looking the same
		away,
		home,
		gamesInSeries: [
			createSeriesGameSlot(1),
			createSeriesGameSlot(2),
			createSeriesGameSlot(3)
		],
		subAssignments: [],
		result: null // final series result only
	};
}

function countCompletedSeriesGames(seriesEntry) {
	return (seriesEntry?.gamesInSeries || []).filter(g => g?.result).length;
}

function isSeriesGameSkipped(seriesGame) {
	return !!(seriesGame?.skipped && typeof seriesGame.skipped === "object");
}

function isSeriesGameResolved(seriesGame) {
	return !!seriesGame?.result || isSeriesGameSkipped(seriesGame);
}

function getSeriesEarlyEndCandidate(seriesEntry) {
	const games = Array.isArray(seriesEntry?.gamesInSeries) ? seriesEntry.gamesInSeries : [];
	const game1 = games[0];
	const game2 = games[1];
	const game3 = games[2];

	if (!game1?.result || !game2?.result || !game3) return null;
	if (game3?.result || isSeriesGameSkipped(game3)) return null;
	if (game1.result.type !== "win" || game2.result.type !== "win") return null;
	if (String(game1.result.winner || "").trim() === "") return null;
	if (game1.result.winner !== game2.result.winner) return null;

	const winner = game1.result.winner;
	const loser = winner === seriesEntry.away ? seriesEntry.home : seriesEntry.away;

	return {
		winner,
		loser,
		skippedGameNumber: Number(game3?.gameNumber || 3)
	};
}

function canEndSeriesEarly(seriesEntry) {
	return !!getSeriesEarlyEndCandidate(seriesEntry);
}

function computeSeriesResult(seriesEntry) {
	if (!seriesEntry || !Array.isArray(seriesEntry.gamesInSeries)) return null;

	const playedGames = seriesEntry.gamesInSeries.filter(g => g && g.result);
	const skippedGames = seriesEntry.gamesInSeries.filter(g => isSeriesGameSkipped(g));

	let awayWins = 0;
	let homeWins = 0;
	let tieGames = 0;

	playedGames.forEach(g => {
		const r = g.result;
		if (!r) return;

		if (r.type === "tie") {
			tieGames += 1;
			return;
		}

		if (r.winner === seriesEntry.away) awayWins += 1;
		if (r.winner === seriesEntry.home) homeWins += 1;
	});

	if (playedGames.length === 2 && skippedGames.length === 1) {
		if (awayWins === 2 || homeWins === 2) {
			const winner = awayWins > homeWins ? seriesEntry.away : seriesEntry.home;
			const loser = winner === seriesEntry.away ? seriesEntry.home : seriesEntry.away;

			return {
				type: "win",
				winner,
				loser,
				winnerGames: Math.max(awayWins, homeWins),
				loserGames: Math.min(awayWins, homeWins),
				tieGames,
				playedAt: Number(skippedGames[0]?.skipped?.skippedAt || 0) || Date.now(),
				endedEarly: true,
				skippedGameNumber: Number(skippedGames[0]?.gameNumber || 3)
			};
		}
		return null;
	}

	if (playedGames.length < 3) return null;

	if (awayWins === homeWins) {
		return {
			type: "tie",
			away: seriesEntry.away,
			home: seriesEntry.home,
			awayWins,
			homeWins,
			tieGames,
			playedAt: Date.now()
		};
	}

	const winner = awayWins > homeWins ? seriesEntry.away : seriesEntry.home;
	const loser = winner === seriesEntry.away ? seriesEntry.home : seriesEntry.away;

	return {
		type: "win",
		winner,
		loser,
		winnerGames: Math.max(awayWins, homeWins),
		loserGames: Math.min(awayWins, homeWins),
		tieGames,
		playedAt: Date.now()
	};
}

function getDayTeamNames(dayObj) {
	return Array.from(new Set((dayObj?.games || []).flatMap(seriesEntry => [seriesEntry?.away, seriesEntry?.home]).filter(Boolean)));
}

function getByeTeamForDay(dayObj, teamNames = schedule?.teamNames || []) {
	if (dayObj?.byeTeam && teamNames.includes(dayObj.byeTeam)) return dayObj.byeTeam;
	const usedTeams = new Set(getDayTeamNames(dayObj));
	return (teamNames || []).find(teamName => !usedTeams.has(teamName)) || "";
}

function getSeriesMatchupKey(seriesEntry) {
	return normalizeMatchupKey(seriesEntry?.away || "", seriesEntry?.home || "");
}

function getScheduleMatchupKeys(scheduleObj, { endBeforeDayIndex = null } = {}) {
	const keys = [];
	(scheduleObj?.days || []).forEach((dayObj, dayIndex) => {
		if (Number.isInteger(endBeforeDayIndex) && dayIndex >= endBeforeDayIndex) return;
		(dayObj?.games || []).forEach(seriesEntry => {
			const key = getSeriesMatchupKey(seriesEntry);
			if (key) keys.push(key);
		});
	});
	return keys;
}

function getFiveTeamDayLayouts(teamNames) {
	if (!Array.isArray(teamNames) || teamNames.length !== 5) return [];

	const layouts = [];

	teamNames.forEach(byeTeam => {
		const remaining = teamNames.filter(teamName => teamName !== byeTeam);
		const [a, b, c, d] = remaining;
		const pairingSets = [
			[[a, b], [c, d]],
			[[a, c], [b, d]],
			[[a, d], [b, c]]
		];

		pairingSets.forEach(pairings => {
			const matchupKeys = pairings.map(pairing => normalizeMatchupKey(pairing[0], pairing[1])).sort();
			layouts.push({
				byeTeam,
				pairings,
				matchupKeys,
				key: `${byeTeam}__${matchupKeys.join("__")}`,
				label: `Bye: ${byeTeam} — ${pairings[0][0]} vs ${pairings[0][1]} • ${pairings[1][0]} vs ${pairings[1][1]}`
			});
		});
	});

	return layouts;
}

function buildFiveTeamSchedulePlan(teamNames, usedBefore = new Set(), daysNeeded = 5, { firstLayoutKey = "", preferredLayoutKeys = [] } = {}) {
	const layouts = getFiveTeamDayLayouts(teamNames);
	if (!layouts.length) return null;

	const used = new Set(Array.from(usedBefore || []));

	function backtrack(dayOffset) {
		if (dayOffset >= daysNeeded) return [];

		let candidates = layouts.filter(layout => layout.matchupKeys.every(key => !used.has(key)));
		if (dayOffset === 0 && firstLayoutKey) {
			candidates = candidates.filter(layout => layout.key === firstLayoutKey);
		}
		if (!candidates.length) return null;

		const preferredKey = preferredLayoutKeys[dayOffset] || "";
		const shuffled = shuffleArray(candidates.slice());
		shuffled.sort((a, b) => {
			const aPreferred = preferredKey && a.key === preferredKey ? 1 : 0;
			const bPreferred = preferredKey && b.key === preferredKey ? 1 : 0;
			return bPreferred - aPreferred;
		});

		for (const layout of shuffled) {
			layout.matchupKeys.forEach(key => used.add(key));
			const rest = backtrack(dayOffset + 1);
			if (rest) return [layout, ...rest];
			layout.matchupKeys.forEach(key => used.delete(key));
		}

		return null;
	}

	return backtrack(0);
}

function getFiveTeamLayoutKeyForDay(dayObj, teamNames = schedule?.teamNames || []) {
	const byeTeam = getByeTeamForDay(dayObj, teamNames);
	const matchupKeys = (dayObj?.games || []).map(getSeriesMatchupKey).filter(Boolean).sort();
	return `${byeTeam}__${matchupKeys.join("__")}`;
}

function canEditFiveTeamScheduleFromDay(dayIndex) {
	if (!Number.isInteger(dayIndex)) return false;

	const teamNames = Array.isArray(schedule?.teamNames) ? schedule.teamNames.filter(Boolean) : [];
	const config = getScheduleConfigForTeams(teamNames);
	if (!config || config.id !== SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5) return false;

	const guard = getScheduleGuardState();
	if (!guard.ok) return false;

	return !(schedule?.days || []).slice(dayIndex).some(dayObj =>
		(dayObj?.games || []).some(seriesEntry =>
			!!seriesEntry?.result ||
			(seriesEntry?.gamesInSeries || []).some(seriesGame => !!seriesGame?.result)
		)
	);
}

function getEditableFiveTeamDayOptions(dayIndex) {
	const teamNames = Array.isArray(schedule?.teamNames) ? schedule.teamNames.filter(Boolean) : [];
	if (teamNames.length !== 5) return [];
	if (!canEditFiveTeamScheduleFromDay(dayIndex)) return [];

	const usedBefore = new Set(getScheduleMatchupKeys(schedule, { endBeforeDayIndex: dayIndex }));
	const preferredLayoutKeys = (schedule?.days || []).slice(dayIndex).map(dayObj => getFiveTeamLayoutKeyForDay(dayObj, teamNames));
	const remainingDayCount = (schedule?.days || []).length - dayIndex;

	return getFiveTeamDayLayouts(teamNames)
		.map(layout => {
			const plan = buildFiveTeamSchedulePlan(teamNames, usedBefore, remainingDayCount, {
				firstLayoutKey: layout.key,
				preferredLayoutKeys
			});
			if (!plan) return null;
			return { ...layout, plan };
		})
		.filter(Boolean)
		.sort((a, b) => a.label.localeCompare(b.label));
}

function getAllowedByeTeamsForFiveTeamDay(dayIndex) {
	return Array.from(new Set(
		getEditableFiveTeamDayOptions(dayIndex).map(option => option?.byeTeam).filter(Boolean)
	)).sort();
}

function getBestFiveTeamByeEditOption(dayIndex, byeTeam) {
	const currentDay = schedule?.days?.[dayIndex];
	const currentMatchupKeys = (currentDay?.games || []).map(getSeriesMatchupKey).filter(Boolean).sort();
	const currentByeTeam = getByeTeamForDay(currentDay, schedule?.teamNames || []);

	const candidates = getEditableFiveTeamDayOptions(dayIndex)
		.filter(option => option?.byeTeam === byeTeam)
		.sort((a, b) => {
			const aCurrentByeScore = a.byeTeam === currentByeTeam ? 1 : 0;
			const bCurrentByeScore = b.byeTeam === currentByeTeam ? 1 : 0;
			if (bCurrentByeScore !== aCurrentByeScore) return bCurrentByeScore - aCurrentByeScore;

			const aKeys = (a?.matchupKeys || []).slice().sort();
			const bKeys = (b?.matchupKeys || []).slice().sort();
			const aMatchScore = aKeys.filter(key => currentMatchupKeys.includes(key)).length;
			const bMatchScore = bKeys.filter(key => currentMatchupKeys.includes(key)).length;
			if (bMatchScore !== aMatchScore) return bMatchScore - aMatchScore;

			return a.label.localeCompare(b.label);
		});

	return candidates[0] || null;
}

function rebuildFiveTeamScheduleFromDay(dayIndex, rebuiltPlan, teamNames) {
	const newDays = (schedule.days || []).slice(0, dayIndex).map((dayObj, idx) => ({
		...dayObj,
		day: Number(dayObj?.day || (idx + 1)),
		byeTeam: getByeTeamForDay(dayObj, teamNames)
	}));

	rebuiltPlan.forEach((layout, offset) => {
		const originalDay = schedule.days?.[dayIndex + offset] || {};
		newDays.push(createDayEntryFromLayout(layout, Number(originalDay?.day || (dayIndex + offset + 1))));
	});

	schedule = ensureScheduleShape({
		...schedule,
		format: SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5,
		teamNames,
		days: newDays
	});
}

function refreshChangeScheduleControls() {
	const panel = document.getElementById("changeSchedulePanel");
	if (!panel) return;

	const daySelect = document.getElementById("changeScheduleDaySelect");
	const byeSelect = document.getElementById("changeScheduleByeSelect");
	const status = document.getElementById("changeScheduleStatus");
	const applyBtn = document.getElementById("applyScheduleChangeBtn");
	if (!daySelect || !byeSelect || !status || !applyBtn) return;

	const teamNames = Array.isArray(schedule?.teamNames) ? schedule.teamNames.filter(Boolean) : [];
	const config = getScheduleConfigForTeams(teamNames);
	if (!config || config.id !== SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5 || !hasFullAppAccess()) {
		panel.classList.add("hidden");
		return;
	}
	panel.classList.remove("hidden");

	const editableDayIndexes = (schedule.days || [])
		.map((dayObj, idx) => canEditFiveTeamScheduleFromDay(idx) ? idx : null)
		.filter(idx => Number.isInteger(idx));

if (!editableDayIndexes.length) {
	daySelect.innerHTML = `<option value="">No editable days</option>`;
	byeSelect.innerHTML = `<option value="">Bye Team Locked</option>`;
	status.innerText = "You can only change a bye for a day when that day and all later days are still unplayed. Earlier recorded days stay frozen.";
	applyBtn.disabled = true;
	return;
}

	const previousDayValue = daySelect.value;
	daySelect.innerHTML = editableDayIndexes.map(dayIndex => {
		const dayNumber = Number(schedule?.days?.[dayIndex]?.day || (dayIndex + 1));
		return `<option value="${dayIndex}">Day ${dayNumber}</option>`;
	}).join("");
	daySelect.value = editableDayIndexes.includes(Number(previousDayValue)) ? previousDayValue : String(editableDayIndexes[0]);

	const dayIndex = Number(daySelect.value);
	const dayObj = schedule?.days?.[dayIndex];
	const currentByeTeam = getByeTeamForDay(dayObj, teamNames);
	const allowedByeTeams = getAllowedByeTeamsForFiveTeamDay(dayIndex);
	const previousByeValue = byeSelect.value;

	byeSelect.innerHTML = allowedByeTeams.map(teamName => `<option value="${teamName}">${teamName}</option>`).join("");
	byeSelect.value = allowedByeTeams.includes(previousByeValue) ? previousByeValue : (allowedByeTeams.includes(currentByeTeam) ? currentByeTeam : (allowedByeTeams[0] || ""));

	const selectedOption = getBestFiveTeamByeEditOption(dayIndex, byeSelect.value);
	if (selectedOption) {
		const pairingsText = (selectedOption.pairings || []).map((pair, idx) => `Series ${idx + 1}: ${pair[0]} vs ${pair[1]}`).join(" • ");
		status.innerText = `Day ${Number(dayObj?.day || (dayIndex + 1))} bye: ${selectedOption.byeTeam}. ${pairingsText}. Later unplayed days will auto-adjust only if needed to keep the round robin valid.`;
	} else {
		status.innerText = "That bye team is not valid for this round robin setup.";
	}
	applyBtn.disabled = !selectedOption;
}

function applySelectedScheduleChange() {
	const guard = getScheduleGuardState();
	if (!guard.ok) {
		alert("Schedule editing is unavailable because the saved schedule is out of sync with the current season setup.");
		renderScheduleUI();
		return;
	}

	const config = getScheduleConfigForTeams(schedule?.teamNames || []);
	if (!config || config.id !== SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5) {
		alert("Schedule editing is only available for the 5-team single round robin schedule.");
		return;
	}

	const dayIndex = Number(document.getElementById("changeScheduleDaySelect")?.value);
	const byeTeam = document.getElementById("changeScheduleByeSelect")?.value || "";

	if (!Number.isInteger(dayIndex)) {
		alert("Pick a valid day first.");
		return;
	}
	if (!byeTeam) {
		alert("Pick a valid bye team.");
		return;
	}
	if (!canEditFiveTeamScheduleFromDay(dayIndex)) {
	alert("You can only change a bye for a day when that day and all later days are still unplayed. Earlier recorded days stay frozen.");
	return;
}

	const selectedOption = getBestFiveTeamByeEditOption(dayIndex, byeTeam);
	if (!selectedOption) {
		alert("That bye team is not valid. Choose a different team.");
		return;
	}

	const teamNames = schedule.teamNames.slice();
	rebuildFiveTeamScheduleFromDay(dayIndex, selectedOption.plan, teamNames);
	saveSchedule();
	renderScheduleUI();
	showNotification(`✅ Day ${Number(schedule.days?.[dayIndex]?.day || (dayIndex + 1))} bye updated to ${byeTeam}`, 1600);
}

function applyFiveTeamDayEdit(dayIndex) {
	const config = getScheduleConfigForTeams(schedule?.teamNames || []);
	if (!config || config.id !== SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5) {
		alert("Day editing is only available for the 5-team single round robin schedule.");
		return;
	}

	if (!canEditFiveTeamScheduleFromDay(dayIndex)) {
		alert("You can only edit a day before that day and the days after it have any recorded games.");
		return;
	}

	const select = document.getElementById(`dayEditSelect-${dayIndex}`);
	const selectedLayoutKey = select?.value || "";
	if (!selectedLayoutKey) {
		alert("Pick a valid day layout first.");
		return;
	}

	const teamNames = schedule.teamNames.slice();
	const usedBefore = new Set(getScheduleMatchupKeys(schedule, { endBeforeDayIndex: dayIndex }));
	const preferredLayoutKeys = (schedule?.days || []).slice(dayIndex).map(dayObj => getFiveTeamLayoutKeyForDay(dayObj, teamNames));
	const remainingDayCount = (schedule?.days || []).length - dayIndex;
	const rebuiltPlan = buildFiveTeamSchedulePlan(teamNames, usedBefore, remainingDayCount, {
		firstLayoutKey: selectedLayoutKey,
		preferredLayoutKeys
	});

	if (!rebuiltPlan) {
		alert("That change would break the round robin. Pick a different option.");
		return;
	}

	rebuildFiveTeamScheduleFromDay(dayIndex, rebuiltPlan, teamNames);
	saveSchedule();
	renderScheduleUI();
	showNotification(`✅ Day ${Number(schedule.days?.[dayIndex]?.day || (dayIndex + 1))} updated`, 1600);
}

function validateDoubleRoundRobin4(scheduleObj, teamNames) {
	const matchupCounts = {};
	const appearanceCounts = Object.fromEntries(teamNames.map(teamName => [teamName, 0]));

	for (const dayObj of (scheduleObj?.days || [])) {
		if (!Array.isArray(dayObj?.games) || dayObj.games.length !== 2) return false;
		const dayTeams = getDayTeamNames(dayObj);
		if (dayTeams.length !== 4) return false;
		for (const seriesEntry of dayObj.games) {
			if (!Array.isArray(seriesEntry?.gamesInSeries) || seriesEntry.gamesInSeries.length !== 3) return false;
			if (!teamNames.includes(seriesEntry.away) || !teamNames.includes(seriesEntry.home)) return false;
			if (seriesEntry.away === seriesEntry.home) return false;
			const key = normalizeMatchupKey(seriesEntry.away, seriesEntry.home);
			matchupCounts[key] = (matchupCounts[key] || 0) + 1;
			appearanceCounts[seriesEntry.away] += 1;
			appearanceCounts[seriesEntry.home] += 1;
		}
	}

	const expectedPairCount = (teamNames.length * (teamNames.length - 1)) / 2;
	if (Object.keys(matchupCounts).length !== expectedPairCount) return false;
	if (Object.values(matchupCounts).some(count => count !== 2)) return false;
	if (Object.values(appearanceCounts).some(count => count !== 6)) return false;
	return true;
}

function validateSingleRoundRobin5(scheduleObj, teamNames) {
	const matchupCounts = {};
	const appearanceCounts = Object.fromEntries(teamNames.map(teamName => [teamName, 0]));
	const byeCounts = Object.fromEntries(teamNames.map(teamName => [teamName, 0]));

	for (const dayObj of (scheduleObj?.days || [])) {
		if (!Array.isArray(dayObj?.games) || dayObj.games.length !== 2) return false;
		const dayTeams = getDayTeamNames(dayObj);
		if (dayTeams.length !== 4) return false;
		const byeTeam = getByeTeamForDay(dayObj, teamNames);
		if (!byeTeam) return false;
		if (dayTeams.includes(byeTeam)) return false;
		byeCounts[byeTeam] += 1;

		for (const seriesEntry of dayObj.games) {
			if (!Array.isArray(seriesEntry?.gamesInSeries) || seriesEntry.gamesInSeries.length !== 3) return false;
			if (!teamNames.includes(seriesEntry.away) || !teamNames.includes(seriesEntry.home)) return false;
			if (seriesEntry.away === seriesEntry.home) return false;
			const key = normalizeMatchupKey(seriesEntry.away, seriesEntry.home);
			matchupCounts[key] = (matchupCounts[key] || 0) + 1;
			appearanceCounts[seriesEntry.away] += 1;
			appearanceCounts[seriesEntry.home] += 1;
		}
	}

	const expectedPairCount = (teamNames.length * (teamNames.length - 1)) / 2;
	if (Object.keys(matchupCounts).length !== expectedPairCount) return false;
	if (Object.values(matchupCounts).some(count => count !== 1)) return false;
	if (Object.values(appearanceCounts).some(count => count !== 4)) return false;
	if (Object.values(byeCounts).some(count => count !== 1)) return false;
	return true;
}

function isScheduleCurrentFormat(scheduleObj, teamNames) {
	if (!Array.isArray(teamNames) || !teamNames.length) return false;
	const config = getScheduleConfigForTeams(teamNames);
	if (!config) return false;
	if (!scheduleObj?.days?.length) return false;
	if (scheduleObj.days.length !== config.totalDays) return false;

	const scheduleNames = (scheduleObj?.teamNames || []).slice().sort();
	const normalizedTeamNames = teamNames.slice().sort();
	if (scheduleNames.join("|") !== normalizedTeamNames.join("|")) return false;

	if (config.id === SCHEDULE_FORMAT_DOUBLE_ROUND_ROBIN_4) {
		return validateDoubleRoundRobin4(scheduleObj, normalizedTeamNames);
	}

	if (config.id === SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5) {
		return validateSingleRoundRobin5(scheduleObj, normalizedTeamNames);
	}

	return false;
}

function generateBalancedSchedule4(teams) {
	const names = teams.map(t => t.name);

	// randomize initial order
	shuffleArray(names);

	let a = names[0], b = names[1], c = names[2], d = names[3];

	const rounds = [
		[[a, d], [b, c]],
		[[a, c], [d, b]],
		[[a, b], [c, d]]
	];

	// each pair gets a second series with flipped home/away
	const doubleRounds = [
		...rounds,
		...rounds.map(r => r.map(g => [g[1], g[0]]))
	];

	shuffleArray(doubleRounds);

	return ensureScheduleShape({
		format: SCHEDULE_FORMAT_DOUBLE_ROUND_ROBIN_4,
		teamNames: teams.map(t => t.name),
		days: doubleRounds.map((seriesList, i) => ({
			day: i + 1,
			games: seriesList.map((seriesTeams, idx) =>
				createSeriesEntry(seriesTeams[0], seriesTeams[1], idx + 1)
			)
		}))
	});
}

function generateSingleRoundRobinSchedule5(teams) {
	const teamNames = teams.map(t => t.name);
	const plan = buildFiveTeamSchedulePlan(teamNames, new Set(), 5);
	if (!plan) throw new Error("Could not build a valid 5-team single round robin schedule.");

	return ensureScheduleShape({
		format: SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5,
		teamNames: teamNames.slice(),
		days: plan.map((layout, i) => createDayEntryFromLayout(layout, i + 1))
	});
}

function generateScheduleForTeams(validTeams) {
	const config = getScheduleConfigForTeams(validTeams);
	if (!config) return null;
	if (config.id === SCHEDULE_FORMAT_DOUBLE_ROUND_ROBIN_4) return generateBalancedSchedule4(validTeams);
	if (config.id === SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5) return generateSingleRoundRobinSchedule5(validTeams);
	return null;
}

/* ================================
   SCHEDULE-BASED SUB / ACTIVE LINEUP HELPERS
================================== */
function getSelectedScheduleContext() {
	const daySelect = document.getElementById("scheduleDaySelect");
	const seriesSelect = document.getElementById("scheduleSeriesSelect");
	const gameSelect = document.getElementById("scheduleGameSelect");

	if (!daySelect || !seriesSelect) return null;
	if (!seriesSelect.value) return null;

	const [dayIndexStr, seriesIndexStr] = seriesSelect.value.split("|");
	const dayIndex = parseInt(dayIndexStr, 10);
	const seriesIndex = parseInt(seriesIndexStr, 10);
	let seriesGameIndex = null;

	if (gameSelect && gameSelect.value) {
		const parts = gameSelect.value.split("|");
		if (parts.length === 3) seriesGameIndex = parseInt(parts[2], 10);
	}

	const dayObj = schedule?.days?.[dayIndex];
	const seriesEntry = dayObj?.games?.[seriesIndex];
	const seriesGame = Number.isInteger(seriesGameIndex) ? seriesEntry?.gamesInSeries?.[seriesGameIndex] : null;
	if (!dayObj || !seriesEntry) return null;

	return { dayIndex, seriesIndex, seriesGameIndex, dayObj, seriesEntry, seriesGame };
}

function getSeriesAssignmentStore(dayIndex, seriesIndex) {
	const seriesEntry = schedule?.days?.[dayIndex]?.games?.[seriesIndex];
	if (!seriesEntry) return [];
	if (!Array.isArray(seriesEntry.subAssignments)) seriesEntry.subAssignments = [];
	return seriesEntry.subAssignments;
}

function getGameAssignmentStore(dayIndex, seriesIndex, seriesGameIndex) {
	const seriesGame = schedule?.days?.[dayIndex]?.games?.[seriesIndex]?.gamesInSeries?.[seriesGameIndex];
	if (!seriesGame) return [];
	if (!Array.isArray(seriesGame.subAssignments)) seriesGame.subAssignments = [];
	return seriesGame.subAssignments;
}

function getEffectiveSubAssignmentsForGame(scheduleRef, teamName = null) {
	if (!scheduleRef || !Number.isInteger(scheduleRef.dayIndex) || !Number.isInteger(scheduleRef.seriesIndex)) return [];

	const seriesAssignments = getSeriesAssignmentStore(scheduleRef.dayIndex, scheduleRef.seriesIndex).map(a => ({ ...a, scope: "series" }));
	const gameAssignments = Number.isInteger(scheduleRef.seriesGameIndex)
		? getGameAssignmentStore(scheduleRef.dayIndex, scheduleRef.seriesIndex, scheduleRef.seriesGameIndex).map(a => ({ ...a, scope: "game" }))
		: [];

	const merged = new Map();
	seriesAssignments.forEach(a => merged.set(`${a.teamName}|${a.replacedPlayer}`, a));
	gameAssignments.forEach(a => merged.set(`${a.teamName}|${a.replacedPlayer}`, a));

	const out = Array.from(merged.values());
	return teamName ? out.filter(a => a.teamName === teamName) : out;
}

function buildActiveTeamForGame(teamObj, scheduleRef = null) {
	const basePlayers = Array.isArray(teamObj?.players) ? teamObj.players.slice() : [];
	const activePlayers = basePlayers.slice();
	const playerMeta = {};

	basePlayers.forEach(playerName => {
		playerMeta[playerName] = {
			displayName: playerName,
			originalPlayer: playerName,
			statsKey: getPlayerKey(teamObj.name, playerName),
			isSub: false
		};
	});

	const assignments = getEffectiveSubAssignmentsForGame(scheduleRef, teamObj?.name);
	assignments.forEach(assign => {
		const idx = activePlayers.indexOf(assign.replacedPlayer);
		if (idx === -1 || !assign.subName || activePlayers.includes(assign.subName)) return;

		activePlayers[idx] = assign.subName;
		playerMeta[assign.subName] = {
			displayName: assign.subName,
			originalPlayer: assign.replacedPlayer,
			statsKey: getSubKey(assign.subName),
			isSub: true
		};
	});

	return {
		name: teamObj.name,
		players: activePlayers,
		_basePlayers: basePlayers,
		_playerMeta: playerMeta
	};
}

/* ================================
   SCHEDULE SCREEN RENDERING
================================== */
function formatScheduleTeamList(teamNames) {
	const names = Array.isArray(teamNames) ? teamNames.filter(Boolean) : [];
	return names.length ? names.join(", ") : "none";
}

function hasRecordedScheduleResults(scheduleObj = schedule) {
	return (scheduleObj?.days || []).some(dayObj =>
		(dayObj?.games || []).some(seriesEntry =>
			!!seriesEntry?.result ||
			(seriesEntry?.gamesInSeries || []).some(seriesGame => !!seriesGame?.result)
		)
	);
}

function hasRecordedSeasonGames() {
	return hasRecordedScheduleResults(schedule)
		|| ((season?.games || []).some(entry => !!entry));
}

function getScheduleGuardState() {
	const validTeams = getValidTeamsForSchedule();
	const liveConfig = getScheduleConfigForTeams(validTeams);
	const liveTeamNames = validTeams.map(t => String(t?.name || "").trim()).filter(Boolean).sort();

	const snapshotTeamNames = Array.isArray(schedule?.teamNames)
		? schedule.teamNames.map(name => String(name || "").trim()).filter(Boolean).sort()
		: [];

	const hasSnapshot = Array.isArray(schedule?.days) && schedule.days.length > 0 && snapshotTeamNames.length > 0;
	const snapshotConfig = getScheduleConfigForTeams(snapshotTeamNames);
	const snapshotFormatValid = hasSnapshot && !!snapshotConfig && isScheduleCurrentFormat(schedule, snapshotTeamNames.slice());
	const ignoreTeamMismatchInPublicView =
	typeof isPublicViewOnlyMode === "function" && isPublicViewOnlyMode();

const teamMismatch =
	!ignoreTeamMismatchInPublicView &&
	hasSnapshot &&
	snapshotTeamNames.join("|") !== liveTeamNames.join("|");
	const seasonStarted = hasRecordedSeasonGames();

	let ok = false;
	let status = "missing";
	let scheduleMessage = "";
	let selectionMessage = "";
	let canExplicitRebuild = false;
	let showScheduledCard = false;

	if (!hasSnapshot) {
		status = liveConfig ? "missing" : "unsupported";
		scheduleMessage = liveConfig
			? "No season schedule has been generated yet. The app will not auto-build one anymore."
			: "Scheduled seasons require either 4 or 5 teams with at least one player on each team.";
		selectionMessage = liveConfig
			? "No season schedule has been published yet. Use the Season Schedule screen to build one before recording scheduled games."
			: "Scheduled game selection requires either 4 or 5 teams with players.";
		canExplicitRebuild = !!liveConfig && !seasonStarted;
		showScheduledCard = !!liveConfig;
	} else if (!snapshotFormatValid) {
		status = "invalid_snapshot";
		scheduleMessage = seasonStarted
			? "The saved season schedule no longer matches the current supported format. It was left untouched to protect recorded history."
			: "The saved season schedule is out of sync with the current supported format. It was left untouched instead of being auto-rebuilt.";
		selectionMessage = seasonStarted
			? "Scheduled game selection is disabled because the saved schedule is frozen and no longer matches the supported format."
			: "Scheduled game selection is disabled until an admin explicitly rebuilds the saved schedule.";
		canExplicitRebuild = !!liveConfig && !seasonStarted;
		showScheduledCard = true;
	} else if (teamMismatch) {
		status = "team_mismatch";
		scheduleMessage = seasonStarted
			? "The current team list no longer matches the frozen season schedule. The app will not rebuild it automatically because games have already been recorded."
			: "The current team list no longer matches the saved season schedule. The app will not rebuild it automatically.";
		selectionMessage = seasonStarted
			? "Scheduled game selection is disabled because the current team list does not match the frozen schedule."
			: "Scheduled game selection is disabled until an admin rebuilds the saved schedule from the current teams.";
		canExplicitRebuild = !!liveConfig && !seasonStarted;
		showScheduledCard = true;
	} else {
		ok = true;
		status = "ready";
		showScheduledCard = true;
	}

	return {
		ok,
		status,
		validTeams,
		liveConfig,
		liveTeamNames,
		snapshotTeamNames,
		snapshotConfig,
		hasSnapshot,
		snapshotFormatValid,
		teamMismatch,
		seasonStarted,
		canExplicitRebuild,
		showScheduledCard,
		scheduleMessage,
		selectionMessage
	};
}

function renderScheduleGuardNotice(guard = getScheduleGuardState()) {
	const notice = document.getElementById("scheduleGuardNotice");
	if (!notice) return;

	// Public viewers should be able to read the schedule without seeing
	// admin-only schedule guard warnings.
	if (typeof isPublicViewOnlyMode === "function" && isPublicViewOnlyMode()) {
		notice.innerHTML = "";
		return;
	}

	if (guard.ok) {
		notice.innerHTML = "";
		return;
	}

	const canRebuildHere = hasFullAppAccess() && guard.canExplicitRebuild;
	const savedTeamsText = formatScheduleTeamList(guard.snapshotTeamNames);
	const currentTeamsText = formatScheduleTeamList(guard.liveTeamNames);

	let actionHtml = "";
	if (canRebuildHere) {
		actionHtml = `
			<div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">
				<button type="button" onclick="forceRegenerateSchedule()">Rebuild Schedule from Current Teams</button>
			</div>
			<p style="color:#aaa; font-size:13px; margin:10px 0 0;">
				This only works before any games have been recorded.
			</p>
		`;
	} else if (guard.seasonStarted) {
		actionHtml = `
			<p style="color:#aaa; font-size:13px; margin:10px 0 0;">
				Rebuild is blocked because this season already has recorded games. Keep the frozen schedule, or use a future migration/restore workflow instead.
			</p>
		`;
	}

	notice.innerHTML = `
		<div class="card">
			<h3 style="margin-top:0;">⚠️ Schedule Warning</h3>
			<p style="color:#ffcccc; margin-top:0;">${guard.scheduleMessage}</p>
			<p style="color:#aaa; font-size:13px; margin:0;">
				<b style="color:white;">Saved schedule teams:</b> ${savedTeamsText}<br>
				<b style="color:white;">Current eligible teams:</b> ${currentTeamsText}
			</p>
			${actionHtml}
		</div>
	`;
}

function setScheduleRecoveryActionsVisible(show, noteText = "") {
	const box = document.getElementById("scheduleRecoveryActions");
	const note = document.getElementById("scheduleRecoveryNote");
	if (!box) return;

	const shouldShow = !!show && hasFullAppAccess();
	box.classList.toggle("hidden", !shouldShow);

	if (note) {
		note.innerText = noteText || (
			"If this season is no longer usable, reset season data first. " +
			"That clears recorded stats and schedule results so you can safely start over."
		);
	}
}

function setScheduledGameSelectionUnavailable(message, guard = null) {
	const warning = document.getElementById("scheduleSelectionWarning");
	const daySelect = document.getElementById("scheduleDaySelect");
	const seriesSelect = document.getElementById("scheduleSeriesSelect");
	const gameSelect = document.getElementById("scheduleGameSelect");
	const hint = document.getElementById("schedulePickHint");
	const startBtn = document.getElementById("startScheduledGameBtn");
	const subBtn = document.getElementById("openSubAssignBtn");

	const unavailableText = message || "Scheduled game selection is currently unavailable.";

	if (warning) {
		warning.innerText = unavailableText;
		warning.classList.remove("hidden");
	}

	[
		{ el: daySelect, label: "Schedule unavailable" },
		{ el: seriesSelect, label: "Schedule unavailable" },
		{ el: gameSelect, label: "Schedule unavailable" }
	].forEach(({ el, label }) => {
		if (!el) return;
		el.innerHTML = `<option value="">${label}</option>`;
		el.disabled = true;
	});

	if (startBtn) startBtn.disabled = true;
	if (subBtn) subBtn.disabled = true;
	if (hint) hint.innerText = unavailableText;

	const recoveryNote = guard?.seasonStarted
		? "This season already has recorded games. If the team list was changed by mistake, use Reset Season Data first, then rebuild the schedule from the current teams."
		: "";

	setScheduleRecoveryActionsVisible(!!guard?.seasonStarted, recoveryNote);
	toggleSubAssignCard(false);
}

function refreshGameSetupScheduleCards() {
	const schedCard = document.getElementById("scheduledGameCard");
	const manualCard = document.getElementById("manualTeamCard");
	const warning = document.getElementById("scheduleSelectionWarning");
	const subBtn = document.getElementById("openSubAssignBtn");
	const guard = ensureScheduleUpToDateForSelection();

	if (!schedCard || !manualCard) return guard;

	if (guard.ok) {
		schedCard.style.display = "block";
		manualCard.style.display = "none";

		if (warning) {
			warning.innerText = "";
			warning.classList.add("hidden");
		}

		setScheduleRecoveryActionsVisible(false);

		if (subBtn) subBtn.disabled = false;
		populateScheduleDaySelect();
	} else {
		schedCard.style.display = guard.showScheduledCard ? "block" : "none";
		manualCard.style.display = "block";
		setScheduledGameSelectionUnavailable(guard.selectionMessage, guard);
		updateGameSetupSelects();
	}

	refreshGameLockUI();
	return guard;
}

function forceRegenerateSchedule() {
	const guard = getScheduleGuardState();
	const validTeams = guard.validTeams;
	const config = guard.liveConfig;

	if (!config) {
		alert("You need either 4 or 5 teams with players to generate a schedule.");
		return;
	}

	if (guard.seasonStarted) {
		alert(
			"This season already has recorded games.\n\n" +
			"Schedule rebuild is blocked to protect schedule history.\n\n" +
			"Keep the frozen schedule for now, or use a future migration/restore workflow instead."
		);
		return;
	}

	const actionWord = guard.hasSnapshot ? "replace" : "build";
	const teamListText = formatScheduleTeamList(validTeams.map(team => team.name));
	const ok = confirm(
		`This will ${actionWord} the saved season schedule using the current teams:\n\n${teamListText}\n\nContinue?`
	);
	if (!ok) return;

	schedule = generateScheduleForTeams(validTeams);
	saveSchedule();
	renderScheduleUI();
	refreshGameSetupScheduleCards();
	showNotification("✅ Schedule rebuilt from current team list", 1600);
}

async function endSeriesEarly(dayIndex, seriesIndex) {
	if (!hasFullAppAccess()) {
		alert("Sign in and enter the league code to edit the schedule.");
		return;
	}

	if (game || activeGameLock) {
		alert("A live game is currently in progress. Finish or emergency-end that game before ending a series early.");
		return;
	}

	const seriesEntry = schedule?.days?.[dayIndex]?.games?.[seriesIndex];
	const candidate = getSeriesEarlyEndCandidate(seriesEntry);

	if (!seriesEntry || !candidate) {
		alert("This series cannot be ended early right now.");
		return;
	}

	let latestRow = null;
	if (typeof fetchSeasonRowFromServer === "function") {
		try {
			latestRow = await fetchSeasonRowFromServer({ quiet: true });
		} catch (e) {
			latestRow = null;
		}
	}

	if (latestRow?.active_game_lock) {
		persistActiveGameLock(latestRow.active_game_lock);
		alert("A game is currently being recorded on another device. Finish or clear that game before ending a series early.");
		return;
	}

	if (latestRow?.schedule_json) {
		const latestSchedule = ensureScheduleShape(deepCloneJson(latestRow.schedule_json));
		const latestSeriesEntry = latestSchedule?.days?.[dayIndex]?.games?.[seriesIndex];
		const latestCandidate = getSeriesEarlyEndCandidate(latestSeriesEntry);

		if (
			!latestSeriesEntry ||
			!latestCandidate ||
			latestCandidate.winner !== candidate.winner ||
			latestCandidate.loser !== candidate.loser ||
			latestCandidate.skippedGameNumber !== candidate.skippedGameNumber
		) {
			try { applyServerSeasonRow(latestRow, { source: "end-series-early-check" }); } catch (e) {}
			try { renderScheduleUI(); } catch (e) {}
			try { refreshGameSetupScheduleCards(); } catch (e) {}

			alert("The schedule changed on another device, or this series is no longer eligible to end early. Sync the schedule and check it again.");
			return;
		}
	}

	if (!confirm(
		`${candidate.winner} has already won the first 2 games of this series.\n\n` +
		`Game ${candidate.skippedGameNumber} will be marked as not played.\n` +
		`No stats, standings, records, game logs, or box scores will be added for that skipped game.\n\n` +
		`End this series early?`
	)) {
		return;
	}

	const skippedGame = seriesEntry.gamesInSeries?.[2];
	if (!skippedGame) {
		alert("Could not find Game 3 for this series.");
		return;
	}

	skippedGame.result = null;
	skippedGame.skipped = {
		reason: "series_clinched",
		winner: candidate.winner,
		loser: candidate.loser,
		skippedAt: Date.now(),
		gameNumber: candidate.skippedGameNumber
	};

	seriesEntry.result = computeSeriesResult(seriesEntry);

	try {
		rebuildCurrentTeamRecordsFromSavedResults({ preserveWhenNoSource: false });
	} catch (e) {
		if (seriesEntry.result?.type === "win" && !seriesEntry._seriesStandingsApplied) {
			getTeamRecord(seriesEntry.result.winner).wins += 1;
			getTeamRecord(seriesEntry.result.loser).losses += 1;
		}
	}

	if (seriesEntry.result?.type === "win") {
		seriesEntry._seriesStandingsApplied = true;
	}

	saveSchedule();
	saveSeason();
	try { refreshGameSetupScheduleCards(); } catch (e) {}
	renderScheduleUI();
	showNotification("✅ Series ended early. Game 3 marked not played.", 1800);
}

function getScheduleSeriesStatusMeta(seriesEntry) {
	const completedCount = countCompletedSeriesGames(seriesEntry);
	const hasSkippedGame = (seriesEntry?.gamesInSeries || []).some(seriesGame => isSeriesGameSkipped(seriesGame));

	if (seriesEntry?.result?.type === "tie") {
		const awayWins = Number(seriesEntry.result.awayWins || 0);
		const homeWins = Number(seriesEntry.result.homeWins || 0);
		const ties = Number(seriesEntry.result.tieGames || 0);
		return {
			text: ties > 0 ? `Series tied ${awayWins}-${homeWins}-${ties}` : `Series tied ${awayWins}-${homeWins}`,
			className: "schedule-series-status is-complete"
		};
	}

	if (seriesEntry?.result?.type === "win") {
		const ties = Number(seriesEntry.result.tieGames || 0);
		return {
			text: hasSkippedGame
				? `${seriesEntry.result.winner} won ${seriesEntry.result.winnerGames}-${seriesEntry.result.loserGames} • ended early`
				: (ties > 0
					? `${seriesEntry.result.winner} won ${seriesEntry.result.winnerGames}-${seriesEntry.result.loserGames}-${ties}`
					: `${seriesEntry.result.winner} won ${seriesEntry.result.winnerGames}-${seriesEntry.result.loserGames}`),
			className: "schedule-series-status is-complete"
		};
	}

	if (completedCount > 0) {
		return {
			text: `${completedCount} of 3 games played`,
			className: "schedule-series-status is-partial"
		};
	}

	return {
		text: "Not played yet",
		className: "schedule-series-status is-pending"
	};
}

function getScheduleGameResultLabel(seriesEntry, seriesGame, pastGameEntry) {
	if (pastGameEntry) {
		return `${pastGameEntry.team1Name} ${pastGameEntry.team1Score} – ${pastGameEntry.team2Score} ${pastGameEntry.team2Name}`;
	}

	const result = seriesGame?.result || null;
	if (!result) return "Not Played Yet";
	if (result.type === "tie") return `${seriesEntry.away} ${Number(result.score1 || 0)} – ${Number(result.score2 || 0)} ${seriesEntry.home}`;

	const awayScore = result.winner === seriesEntry.away ? Number(result.winnerScore || 0) : Number(result.loserScore || 0);
	const homeScore = result.winner === seriesEntry.home ? Number(result.winnerScore || 0) : Number(result.loserScore || 0);
	return `${seriesEntry.away} ${awayScore} – ${homeScore} ${seriesEntry.home}`;
}

function createScheduleSeriesExpansionRow(dayIndex, seriesIndex, seriesEntry) {
	const tr = document.createElement("tr");
	tr.className = "schedule-series-expand-row";
	const td = document.createElement("td");
	td.colSpan = 3;
	tr.appendChild(td);

	const details = document.createElement("details");
	details.className = "schedule-series-details";
	const summary = document.createElement("summary");
	summary.textContent = "View Games";
	details.appendChild(summary);

	const body = document.createElement("div");
	body.className = "schedule-series-games-panel";

	(seriesEntry?.gamesInSeries || []).forEach((seriesGame, seriesGameIndex) => {
		const gameEntry = typeof getPastGameEntryForScheduleSlot === "function"
			? getPastGameEntryForScheduleSlot(dayIndex, seriesIndex, seriesGameIndex)
			: null;

		const gameCard = document.createElement("div");
		gameCard.className = "schedule-series-game-card";

		const header = document.createElement("div");
		header.className = "schedule-series-game-header";

		const title = document.createElement("div");
		title.className = "schedule-series-game-title";
		title.textContent = `Game ${Number(seriesGame?.gameNumber || (seriesGameIndex + 1))}`;
		header.appendChild(title);

		gameCard.appendChild(header);

		if (seriesGame?.result) {
			const result = seriesGame.result;
			const playedAt = Number(gameEntry?.playedAt || result?.playedAt || 0);

			const awayName = gameEntry?.team1Name || seriesEntry.away;
			const homeName = gameEntry?.team2Name || seriesEntry.home;

			const awayScore = gameEntry
				? Number(gameEntry.team1Score || 0)
				: (result?.type === "tie"
					? Number(result.score1 || 0)
					: (result?.winner === awayName ? Number(result.winnerScore || 0) : Number(result.loserScore || 0)));

			const homeScore = gameEntry
				? Number(gameEntry.team2Score || 0)
				: (result?.type === "tie"
					? Number(result.score2 || 0)
					: (result?.winner === homeName ? Number(result.winnerScore || 0) : Number(result.loserScore || 0)));

			let scoreLine = "";
			if (awayScore === homeScore) {
				scoreLine = `${awayName} tied ${homeName}, ${awayScore}–${homeScore}`;
			} else if (awayScore > homeScore) {
				scoreLine = `${awayName} beat ${homeName}, ${awayScore}–${homeScore}`;
			} else {
				scoreLine = `${homeName} beat ${awayName}, ${homeScore}–${awayScore}`;
			}

			const dateText = playedAt
				? (typeof formatPastGameDate === "function"
					? formatPastGameDate(playedAt)
					: new Date(playedAt).toLocaleDateString())
				: "-";

			const summaryCard = document.createElement("div");
			summaryCard.className = "schedule-series-game-summary";
			summaryCard.innerHTML = `
				<div class="schedule-series-game-score-big">${scoreLine}</div>
				<div class="schedule-series-game-date">Played: ${dateText}</div>
			`;

			gameCard.appendChild(summaryCard);
		} else if (isSeriesGameSkipped(seriesGame)) {
			const skippedMeta = seriesGame.skipped || {};
			const summaryCard = document.createElement("div");
			summaryCard.className = "schedule-series-game-summary is-neutral";
			summaryCard.innerHTML = `
				<div class="schedule-series-game-score-big">Not Played</div>
				<div class="schedule-series-game-date">Series ended early • ${skippedMeta.winner || "Series clinched"} won in 2 games</div>
			`;
			gameCard.appendChild(summaryCard);
		} else {
			const pending = document.createElement("div");
			pending.className = "season-stats-note";
			pending.textContent = "Not Played Yet";
			gameCard.appendChild(pending);
		}

		body.appendChild(gameCard);
	});

	if (canEndSeriesEarly(seriesEntry) && hasFullAppAccess()) {
		const actionWrap = document.createElement("div");
		actionWrap.className = "schedule-series-action";
		actionWrap.innerHTML = `
			<button type="button" onclick="endSeriesEarly(${dayIndex}, ${seriesIndex})">End Series Early</button>
			<div class="season-stats-note">This series is already decided 2-0. Game 3 will be marked not played and will not add stats.</div>
		`;
		body.appendChild(actionWrap);
	}

	details.appendChild(body);
	td.appendChild(details);
	return tr;
}

function renderScheduleUI() {
	const container = document.getElementById("scheduleContainer");
	const summaryText = document.getElementById("scheduleSummaryText");
	if (!container) return;

	container.innerHTML = "";

	const guard = getScheduleGuardState();
	renderScheduleGuardNotice(guard);

	const snapshotTeamNames = Array.isArray(schedule?.teamNames) ? schedule.teamNames.filter(Boolean) : [];
	const activeConfig = getScheduleConfigForTeams(snapshotTeamNames) || guard.liveConfig;

	if (summaryText) {
		summaryText.innerText = activeConfig?.description || "Season schedule will appear here once teams are ready.";
	}

	if (!Array.isArray(schedule?.days) || schedule.days.length === 0) {
		container.innerHTML = guard.liveConfig
			? `
			<div class="card">
				<h3>No schedule yet</h3>
				<p style="color:#aaa;">The app will not auto-build the season schedule anymore. Use the rebuild button above once you are ready.</p>
			</div>
			`
			: `
			<div class="card">
				<h3>No public schedule available yet</h3>
				<p style="color:#aaa;">The season schedule has not been published yet.</p>
			</div>
			`;
		return;
	}

	const activeConfigId = activeConfig?.id || "";

	if (guard.ok && activeConfigId === SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5 && hasFullAppAccess()) {
		const editCard = document.createElement("div");
		editCard.className = "card";
		editCard.innerHTML = `
			<div class="section-header">Change Schedule</div>
			<div id="changeSchedulePanel">
				<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:10px; align-items:end;">
					<div>
						<div style="font-size:13px; color:#aaa; margin-bottom:6px;">Day</div>
						<select id="changeScheduleDaySelect" onchange="refreshChangeScheduleControls()"></select>
					</div>
					<div>
						<div style="font-size:13px; color:#aaa; margin-bottom:6px;">Bye Team</div>
						<select id="changeScheduleByeSelect" onchange="refreshChangeScheduleControls()"></select>
					</div>
				</div>
				<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:12px;">
					<button id="applyScheduleChangeBtn" type="button" onclick="applySelectedScheduleChange()">Update Schedule</button>
					<span id="changeScheduleStatus" style="color:#aaa; font-size:13px;"></span>
				</div>
			</div>
		`;
		container.appendChild(editCard);
		setTimeout(refreshChangeScheduleControls, 0);
	}

	schedule.days.forEach((dayObj, dayIndex) => {
		const dayCard = document.createElement("div");
		dayCard.className = "card";

		const byeTeam = activeConfigId === SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5
			? getByeTeamForDay(dayObj, snapshotTeamNames)
			: "";

		const dayLockedNote = guard.ok && activeConfigId === SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5 && hasFullAppAccess() && !canEditFiveTeamScheduleFromDay(dayIndex)
			? `<div style="margin:6px 0 12px; color:#aaa; font-size:13px;">Schedule editing is locked for this day because this day or a later day already has recorded results. Earlier recorded days stay frozen, but future unplayed days can still be changed if the round robin remains valid.</div>`
			: "";

		dayCard.innerHTML = `
			<div class="section-header">Day ${dayObj.day}</div>
			${byeTeam ? `<div style="margin:6px 0 12px; color:#aaa;"><b style="color:white;">Bye:</b> ${byeTeam}</div>` : ""}
			${dayLockedNote}
		`;

		const table = document.createElement("table");
		table.className = "stats-table schedule-series-table";
		table.innerHTML = `
			<thead>
				<tr>
					<th>Series</th>
					<th>Matchup</th>
					<th>Status</th>
				</tr>
			</thead>
		`;

		const tbody = document.createElement("tbody");
		(dayObj.games || []).forEach((seriesEntry, seriesIndex) => {
			const awayRec = formatTeamRecord(seriesEntry.away);
			const homeRec = formatTeamRecord(seriesEntry.home);
			const statusMeta = getScheduleSeriesStatusMeta(seriesEntry);
			const completedCount = countCompletedSeriesGames(seriesEntry);

			const row = document.createElement("tr");
			row.innerHTML = `
				<td>Series ${seriesEntry.gameNumber}</td>
				<td>
					<div class="schedule-matchup-main">
						<b>${seriesEntry.away}</b> <span class="schedule-team-record">(${awayRec})</span>
						<span class="schedule-matchup-vs">vs</span>
						<b>${seriesEntry.home}</b> <span class="schedule-team-record">(${homeRec})</span>
					</div>
				</td>
				<td>
					<div class="schedule-series-status-wrap">
						<span class="${statusMeta.className}">${statusMeta.text}</span>
					</div>
				</td>
			`;
			tbody.appendChild(row);

			if (completedCount > 0) {
				tbody.appendChild(createScheduleSeriesExpansionRow(dayIndex, seriesIndex, seriesEntry));
			}
		});

		table.appendChild(tbody);
		dayCard.appendChild(table);
		container.appendChild(dayCard);
	});
}
	// NAVIGATION FUNCTIONS

/* ================================
   GAME SETUP SCHEDULE DROPDOWNS
================================== */
function updateGameSetupSelects() {
	let validTeams = league.teams.filter(t => t.players.length > 0);
	
	let team1Select = document.getElementById("team1Select");
	let team2Select = document.getElementById("team2Select");
	
	team1Select.innerHTML = "";
	team2Select.innerHTML = "";

	validTeams.forEach((t, i) => {
		let opt1 = document.createElement("option");
		opt1.value = i;
		opt1.text = t.name;
		team1Select.appendChild(opt1);

		let opt2 = document.createElement("option");
		opt2.value = i;
		opt2.text = t.name;
		team2Select.appendChild(opt2);
	});

	if (validTeams.length > 1) {
		team2Select.selectedIndex = 1;
	}

	refreshGameLockUI();
}

function ensureScheduleUpToDateForSelection() {
	return getScheduleGuardState();
}


function populateScheduleDaySelect() {
	const daySelect = document.getElementById("scheduleDaySelect");
	if (!daySelect) return;

	daySelect.innerHTML = "";

	(schedule.days || []).forEach((dayObj, idx) => {
		const openGames = (dayObj.games || []).reduce((count, seriesEntry) => {
			return count + (seriesEntry.gamesInSeries || []).filter(g => !isSeriesGameResolved(g)).length;
		}, 0);

		const opt = document.createElement("option");
		opt.value = String(idx);
		opt.text = `Day ${dayObj.day}` + (openGames === 0 ? " (all resolved)" : "");
		daySelect.appendChild(opt);
	});

	const firstOpen = (schedule.days || []).findIndex(dayObj =>
		(dayObj.games || []).some(seriesEntry =>
			(seriesEntry.gamesInSeries || []).some(g => !isSeriesGameResolved(g))
		)
	);

	daySelect.value = String(firstOpen >= 0 ? firstOpen : 0);
	toggleSubAssignCard(false);
	populateScheduleSeriesSelect();
}

function populateScheduleSeriesSelect() {
	const daySelect = document.getElementById("scheduleDaySelect");
	const seriesSelect = document.getElementById("scheduleSeriesSelect");
	if (!daySelect || !seriesSelect) return;

	const dayIndex = parseInt(daySelect.value, 10);
	const dayObj = schedule?.days?.[dayIndex];

	seriesSelect.innerHTML = "";

	if (!dayObj || !Array.isArray(dayObj.games)) {
		populateScheduleGameSelect();
		return;
	}

	let added = 0;

	dayObj.games.forEach((seriesEntry, seriesIndex) => {
		const openGames = (seriesEntry.gamesInSeries || []).filter(g => !isSeriesGameResolved(g)).length;
		if (openGames === 0) return;

		const opt = document.createElement("option");
		opt.value = `${dayIndex}|${seriesIndex}`;
		opt.text = `Series ${seriesEntry.gameNumber}: ${seriesEntry.away} vs ${seriesEntry.home}`;
		seriesSelect.appendChild(opt);
		added += 1;
	});

	if (added === 0) {
		const opt = document.createElement("option");
		opt.value = "";
		opt.text = "No available series (already resolved)";
		seriesSelect.appendChild(opt);
		seriesSelect.disabled = true;
	} else {
		seriesSelect.disabled = false;
	}

	toggleSubAssignCard(false);
	populateScheduleGameSelect();
}

function populateScheduleGameSelect() {
	const seriesSelect = document.getElementById("scheduleSeriesSelect");
	const gameSelect = document.getElementById("scheduleGameSelect");
	const hint = document.getElementById("schedulePickHint");
	const btn = document.getElementById("startScheduledGameBtn");

	if (!seriesSelect || !gameSelect) return;

	gameSelect.innerHTML = "";

	if (!seriesSelect.value) {
		const opt = document.createElement("option");
		opt.value = "";
		opt.text = "No available games (already resolved)";
		gameSelect.appendChild(opt);
		gameSelect.disabled = true;
		if (btn) btn.disabled = true;
		if (hint) hint.innerText = "All series for this day are already resolved.";
		renderSubAssignmentSummary();
		return;
	}

	const [dayIndexStr, seriesIndexStr] = seriesSelect.value.split("|");
	const dayIndex = parseInt(dayIndexStr, 10);
	const seriesIndex = parseInt(seriesIndexStr, 10);
	const seriesEntry = schedule?.days?.[dayIndex]?.games?.[seriesIndex];

	if (!seriesEntry || !Array.isArray(seriesEntry.gamesInSeries)) {
		if (hint) hint.innerText = "No series found.";
		if (btn) btn.disabled = true;
		gameSelect.disabled = true;
		renderSubAssignmentSummary();
		return;
	}

	let added = 0;

	seriesEntry.gamesInSeries.forEach((seriesGame, seriesGameIndex) => {
		if (isSeriesGameResolved(seriesGame)) return;

		const opt = document.createElement("option");
		opt.value = `${dayIndex}|${seriesIndex}|${seriesGameIndex}`;
		opt.text = `Game ${seriesGame.gameNumber}`;
		gameSelect.appendChild(opt);
		added += 1;
	});

	if (added === 0) {
		const opt = document.createElement("option");
		opt.value = "";
		opt.text = "No available games (already resolved)";
		gameSelect.appendChild(opt);
		gameSelect.disabled = true;
		if (btn) btn.disabled = true;

		if ((seriesEntry.gamesInSeries || []).some(seriesGame => isSeriesGameSkipped(seriesGame))) {
			if (hint) hint.innerText = "This series ended early. Game 3 was marked not played.";
		} else {
			if (hint) hint.innerText = "All 3 games in that series are already recorded.";
		}
	} else {
		gameSelect.disabled = false;
		if (btn) btn.disabled = false;

		const completedCount = countCompletedSeriesGames(seriesEntry);
		if (hint) {
			hint.innerText = completedCount > 0
				? `${completedCount} of 3 games already recorded for this series.`
				: "";
		}
	}

	renderSubAssignmentSummary();
	refreshGameLockUI();
}

async function startSelectedScheduledGame() {
	return await runGameStartAction(async (startActionId) => {
		const guard = ensureScheduleUpToDateForSelection();
		if (!guard.ok) {
			alert(guard.selectionMessage || "Scheduled game selection is currently unavailable.");
			refreshGameSetupScheduleCards();
			return false;
		}

		const gameSelect = document.getElementById("scheduleGameSelect");
		if (!gameSelect || !gameSelect.value) return false;

		const [dayIndexStr, seriesIndexStr, seriesGameIndexStr] = gameSelect.value.split("|");
		const dayIndex = parseInt(dayIndexStr, 10);
		const seriesIndex = parseInt(seriesIndexStr, 10);
		const seriesGameIndex = parseInt(seriesGameIndexStr, 10);

		const dayObj = schedule?.days?.[dayIndex];
		const seriesEntry = dayObj?.games?.[seriesIndex];
		const seriesGame = seriesEntry?.gamesInSeries?.[seriesGameIndex];

		if (!seriesEntry || !seriesGame) {
			alert("Could not find that scheduled series game.");
			return false;
		}

		if (seriesGame.result) {
			alert("That game was already recorded.");
			populateScheduleGameSelect();
			return false;
		}

		if (isSeriesGameSkipped(seriesGame)) {
			alert("That game was marked not played because the series ended early.");
			populateScheduleGameSelect();
			return false;
		}

		const validTeams = league.teams.filter(t => t.players.length > 0);
		const t1 = validTeams.find(t => t.name === seriesEntry.away);
		const t2 = validTeams.find(t => t.name === seriesEntry.home);

		if (!t1 || !t2) {
			alert("Could not match schedule teams to your team list.");
			return false;
		}

		return await beginLockedGame(t1, t2, { dayIndex, seriesIndex, seriesGameIndex }, {
	type: "scheduled",
	dayNumber: Number(dayObj?.day || (dayIndex + 1)),
	seriesNumber: Number(seriesEntry?.gameNumber || (seriesIndex + 1)),
	seriesGameNumber: Number(seriesGame?.gameNumber || (seriesGameIndex + 1))
}, null, startActionId);
	});
}
