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
	return { gameNumber, result, subAssignments: [] };
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

function createDayEntryFromLayout(layout, dayNumber) {
	return {
		day: dayNumber,
		byeTeam: layout?.byeTeam || "",
		games: (layout?.pairings || []).map((pairing, idx) =>
			createSeriesEntry(pairing[0], pairing[1], idx + 1)
		)
	};
}

function countCompletedSeriesGames(seriesEntry) {
	return (seriesEntry?.gamesInSeries || []).filter(g => g?.result).length;
}

function computeSeriesResult(seriesEntry) {
	if (!seriesEntry || !Array.isArray(seriesEntry.gamesInSeries)) return null;

	const playedGames = seriesEntry.gamesInSeries.filter(g => g && g.result);
	if (playedGames.length < 3) return null;

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
	if (hasRecordedSeasonGames()) return false;
	return !(schedule?.days || []).slice(dayIndex).some(dayObj =>
		(dayObj?.games || []).some(seriesEntry =>
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
	status.innerText = hasRecordedSeasonGames()
		? "Schedule editing is locked because this season already has recorded games. The saved schedule is frozen to protect history."
		: "Schedule changes lock once the selected day or later days already have recorded games.";
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
		alert("You can only change a day when that day and all later days are still unplayed.");
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
	const teamMismatch = hasSnapshot && snapshotTeamNames.join("|") !== liveTeamNames.join("|");
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

function setScheduledGameSelectionUnavailable(message) {
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
		if (subBtn) subBtn.disabled = false;
		populateScheduleDaySelect();
	} else {
		schedCard.style.display = guard.showScheduledCard ? "block" : "none";
		manualCard.style.display = "block";
		setScheduledGameSelectionUnavailable(guard.selectionMessage);
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

		const rows = (dayObj.games || []).map(seriesEntry => {
			const awayRec = formatTeamRecord(seriesEntry.away);
			const homeRec = formatTeamRecord(seriesEntry.home);

			let awayTag = "";
			let homeTag = "";
			let scoreTag = "";

			if (seriesEntry.result) {
				if (seriesEntry.result.type === "tie") {
					awayTag = " 🤝 T";
					homeTag = " 🤝 T";
					const tieText = `${seriesEntry.result.awayWins}-${seriesEntry.result.homeWins}`;
					scoreTag = ` — Series tied (${tieText})`;
				} else {
					awayTag = (seriesEntry.result.winner === seriesEntry.away) ? " ✅ W" : " ❌ L";
					homeTag = (seriesEntry.result.winner === seriesEntry.home) ? " ✅ W" : " ❌ L";
					scoreTag = ` — Series ${seriesEntry.result.winnerGames}-${seriesEntry.result.loserGames}`;
				}
			}

			return `
			<tr>
				<td>Series ${seriesEntry.gameNumber}</td>
				<td>
					<b>${seriesEntry.away}</b> <span style="color:#aaa;">(${awayRec})</span>${awayTag}
					&nbsp;vs&nbsp;
					<b>${seriesEntry.home}</b> <span style="color:#aaa;">(${homeRec})</span>${homeTag}
					<span style="color:#aaa;">${scoreTag}</span>
				</td>
			</tr>
			`;
		}).join("");

		const byeTeam = activeConfigId === SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5
			? getByeTeamForDay(dayObj, snapshotTeamNames)
			: "";

		const dayLockedNote = guard.ok && activeConfigId === SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5 && hasFullAppAccess() && !canEditFiveTeamScheduleFromDay(dayIndex)
			? `<div style="margin:6px 0 12px; color:#aaa; font-size:13px;">Schedule editing is locked for this day because this season already has recorded games or this day/later days already have recorded results.</div>`
			: "";

		dayCard.innerHTML = `
		<div class="section-header">Day ${dayObj.day}</div>
		${byeTeam ? `<div style="margin:6px 0 12px; color:#aaa;"><b style="color:white;">Bye:</b> ${byeTeam}</div>` : ""}
		${dayLockedNote}
		<table class="stats-table">
			<tr>
				<th>Series</th>
				<th>Matchup</th>
			</tr>
			${rows}
		</table>
		`;

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
			return count + (seriesEntry.gamesInSeries || []).filter(g => !g.result).length;
		}, 0);

		const opt = document.createElement("option");
		opt.value = String(idx);
		opt.text = `Day ${dayObj.day}` + (openGames === 0 ? " (all recorded)" : "");
		daySelect.appendChild(opt);
	});

	const firstOpen = (schedule.days || []).findIndex(dayObj =>
		(dayObj.games || []).some(seriesEntry =>
			(seriesEntry.gamesInSeries || []).some(g => !g.result)
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
		const openGames = (seriesEntry.gamesInSeries || []).filter(g => !g.result).length;
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
		opt.text = "No available series (already recorded)";
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
		opt.text = "No available games (already recorded)";
		gameSelect.appendChild(opt);
		gameSelect.disabled = true;
		if (btn) btn.disabled = true;
		if (hint) hint.innerText = "All series for this day are already recorded.";
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
		if (seriesGame.result) return;

		const opt = document.createElement("option");
		opt.value = `${dayIndex}|${seriesIndex}|${seriesGameIndex}`;
		opt.text = `Game ${seriesGame.gameNumber}`;
		gameSelect.appendChild(opt);
		added += 1;
	});

	if (added === 0) {
		const opt = document.createElement("option");
		opt.value = "";
		opt.text = "No available games (already recorded)";
		gameSelect.appendChild(opt);
		gameSelect.disabled = true;
		if (btn) btn.disabled = true;
		if (hint) hint.innerText = "All 3 games in that series are already recorded.";
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
	const guard = ensureScheduleUpToDateForSelection();
	if (!guard.ok) {
		alert(guard.selectionMessage || "Scheduled game selection is currently unavailable.");
		refreshGameSetupScheduleCards();
		return;
	}

	const gameSelect = document.getElementById("scheduleGameSelect");
	if (!gameSelect || !gameSelect.value) return;

	const [dayIndexStr, seriesIndexStr, seriesGameIndexStr] = gameSelect.value.split("|");
	const dayIndex = parseInt(dayIndexStr, 10);
	const seriesIndex = parseInt(seriesIndexStr, 10);
	const seriesGameIndex = parseInt(seriesGameIndexStr, 10);

	const dayObj = schedule?.days?.[dayIndex];
	const seriesEntry = dayObj?.games?.[seriesIndex];
	const seriesGame = seriesEntry?.gamesInSeries?.[seriesGameIndex];

	if (!seriesEntry || !seriesGame) return alert("Could not find that scheduled series game.");

	if (seriesGame.result) {
		alert("That game was already recorded.");
		populateScheduleGameSelect();
		return;
	}

	const validTeams = league.teams.filter(t => t.players.length > 0);
	const t1 = validTeams.find(t => t.name === seriesEntry.away);
	const t2 = validTeams.find(t => t.name === seriesEntry.home);

	if (!t1 || !t2) {
		alert("Could not match schedule teams to your team list.");
		return;
	}

	await beginLockedGame(t1, t2, { dayIndex, seriesIndex, seriesGameIndex }, {
		type: "scheduled",
		dayNumber: Number(dayObj?.day || (dayIndex + 1)),
		seriesNumber: Number(seriesEntry?.gameNumber || (seriesIndex + 1)),
		seriesGameNumber: Number(seriesGame?.gameNumber || (seriesGameIndex + 1))
	});
}
