// Wiffle Ball League - Core app logic
// Split from the current source-of-truth app.js. Load this BEFORE app.game.js.

	let league = { teams: [] };
    let season = { playerStats: {}, teamRecords: {}, seasonSubs: [], subStats: {}, games: [] };
	let game = null;
	let gameHistory = [];
	let lastPlay = null;
	let pendingBattingResult = null;
    let playInputLock = false;
let activeGameLock = null;
const ACTIVE_GAME_LOCK_KEY = "wiggleActiveGameLock";

try {
	activeGameLock = JSON.parse(localStorage.getItem(ACTIVE_GAME_LOCK_KEY) || "null");
} catch (e) {
	activeGameLock = null;
}

let publicViewOnlyMode = false;

function setPublicViewOnlyMode(v) {
	publicViewOnlyMode = !!v;
	try { updatePublicAccessUI(); } catch (e) {}
}

function isPublicViewOnlyMode() {
	return !!publicViewOnlyMode;
}

function hasFullAppAccess() {
	return !publicViewOnlyMode;
}

function updatePublicAccessUI() {
	const adminCard = document.getElementById("seasonStatsAdminCard");
	if (adminCard) adminCard.classList.toggle("hidden", publicViewOnlyMode);
}

async function refreshPublicViewData({ quiet = true } = {}) {
	const row = await fetchSeasonRowFromServer({ quiet, publicView: true });
	if (row) applyServerSeasonRow(row);
	return row;
}

	/* ================================
	✅ SCHEDULE DATA (persisted)
	==================================*/
	let schedule = { days: [], teamNames: [] };
	
function saveSchedule({ skipServerSync = false, touchMeta = true } = {}) {
  // stamp update time (used for cross-device sync)
  try {
    if (!schedule || typeof schedule !== "object") schedule = { days: [], teamNames: [] };
    if (touchMeta) {
      schedule._meta = schedule._meta || {};
      schedule._meta.updated_at = new Date().toISOString();
    }
  } catch (e) {}

  localStorage.setItem("wiggleSchedule", JSON.stringify(schedule));
  if (!skipServerSync) queueServerSync("schedule");
}

	function loadSchedule() {
	const data = localStorage.getItem("wiggleSchedule");
	if (data) schedule = JSON.parse(data);
	schedule = ensureScheduleShape(schedule);
}

	/* ==========================================
	✅ TEAM SOURCE: pulls from Configure Teams
	- uses only teams that have players
	==========================================*/
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

function getEditableFiveTeamSeriesLayouts(dayIndex, seriesIndex) {
	return getEditableFiveTeamDayOptions(dayIndex).filter(option => {
		const pair = option?.pairings?.[seriesIndex];
		return Array.isArray(pair) && pair.length === 2;
	});
}

function getAllowedTeamsForFiveTeamSeries(dayIndex, seriesIndex) {
	return Array.from(new Set(
		getEditableFiveTeamSeriesLayouts(dayIndex, seriesIndex).flatMap(option => option.pairings?.[seriesIndex] || [])
	)).sort();
}

function getAllowedOpponentsForFiveTeamSeries(dayIndex, seriesIndex, teamName) {
	if (!teamName) return [];

	return Array.from(new Set(
		getEditableFiveTeamSeriesLayouts(dayIndex, seriesIndex)
			.flatMap(option => {
				const pair = option?.pairings?.[seriesIndex] || [];
				if (pair[0] === teamName) return [pair[1]];
				if (pair[1] === teamName) return [pair[0]];
				return [];
			})
	)).sort();
}

function getBestFiveTeamSeriesEditOption(dayIndex, seriesIndex, team1, team2) {
	const matchupKey = normalizeMatchupKey(team1, team2);
	const currentDay = schedule?.days?.[dayIndex];
	const currentByeTeam = getByeTeamForDay(currentDay, schedule?.teamNames || []);
	const currentOtherMatchupKey = getSeriesMatchupKey(currentDay?.games?.[seriesIndex === 0 ? 1 : 0]);

	const candidates = getEditableFiveTeamSeriesLayouts(dayIndex, seriesIndex)
		.filter(option => {
			const pair = option?.pairings?.[seriesIndex] || [];
			return normalizeMatchupKey(pair[0], pair[1]) === matchupKey;
		})
		.sort((a, b) => {
			const aByeScore = a.byeTeam === currentByeTeam ? 1 : 0;
			const bByeScore = b.byeTeam === currentByeTeam ? 1 : 0;
			if (bByeScore !== aByeScore) return bByeScore - aByeScore;

			const aOtherKey = normalizeMatchupKey(...(a?.pairings?.[seriesIndex === 0 ? 1 : 0] || ["", ""]));
			const bOtherKey = normalizeMatchupKey(...(b?.pairings?.[seriesIndex === 0 ? 1 : 0] || ["", ""]));
			const aOtherScore = aOtherKey === currentOtherMatchupKey ? 1 : 0;
			const bOtherScore = bOtherKey === currentOtherMatchupKey ? 1 : 0;
			if (bOtherScore !== aOtherScore) return bOtherScore - aOtherScore;

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
	const seriesSelect = document.getElementById("changeScheduleSeriesSelect");
	const team1Select = document.getElementById("changeScheduleTeam1Select");
	const team2Select = document.getElementById("changeScheduleTeam2Select");
	const status = document.getElementById("changeScheduleStatus");
	const applyBtn = document.getElementById("applyScheduleChangeBtn");
	if (!daySelect || !seriesSelect || !team1Select || !team2Select || !status || !applyBtn) return;

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
		seriesSelect.innerHTML = `<option value="">Series locked</option>`;
		team1Select.innerHTML = `<option value="">First Team</option>`;
		team2Select.innerHTML = `<option value="">Second Team</option>`;
		status.innerText = "Schedule changes lock once the selected day or later days already have recorded games.";
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
	const seriesCount = Math.min(2, Array.isArray(dayObj?.games) ? dayObj.games.length : 0);
	const previousSeriesValue = seriesSelect.value;
	seriesSelect.innerHTML = Array.from({ length: seriesCount }, (_, idx) => (
		`<option value="${idx}">Series ${idx + 1}</option>`
	)).join("");
	seriesSelect.value = previousSeriesValue && Number(previousSeriesValue) < seriesCount ? previousSeriesValue : "0";

	const seriesIndex = Number(seriesSelect.value || 0);
	const currentSeries = dayObj?.games?.[seriesIndex];
	const currentTeam1 = currentSeries?.away || "";
	const currentTeam2 = currentSeries?.home || "";

	const allowedTeams = getAllowedTeamsForFiveTeamSeries(dayIndex, seriesIndex);
	team1Select.innerHTML = allowedTeams.map(teamName => `<option value="${teamName}">${teamName}</option>`).join("");
	team1Select.value = allowedTeams.includes(team1Select.value) ? team1Select.value : (allowedTeams.includes(currentTeam1) ? currentTeam1 : (allowedTeams[0] || ""));

	const allowedOpponents = getAllowedOpponentsForFiveTeamSeries(dayIndex, seriesIndex, team1Select.value)
		.filter(teamName => teamName !== team1Select.value);
	team2Select.innerHTML = allowedOpponents.map(teamName => `<option value="${teamName}">${teamName}</option>`).join("");
	team2Select.value = allowedOpponents.includes(team2Select.value) ? team2Select.value : (allowedOpponents.includes(currentTeam2) ? currentTeam2 : (allowedOpponents[0] || ""));

	const selectedOption = getBestFiveTeamSeriesEditOption(dayIndex, seriesIndex, team1Select.value, team2Select.value);
	const previewByeTeam = selectedOption?.byeTeam || getByeTeamForDay(dayObj, teamNames);
	status.innerText = selectedOption
		? `Day ${Number(dayObj?.day || (dayIndex + 1))}, Series ${seriesIndex + 1}. Bye team will be ${previewByeTeam}. The other series and later unplayed days will auto-adjust only if needed to keep the round robin valid.`
		: "That matchup is not valid for this round robin setup.";
	applyBtn.disabled = !selectedOption;
}

function applySelectedScheduleChange() {
	const config = getScheduleConfigForTeams(schedule?.teamNames || []);
	if (!config || config.id !== SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5) {
		alert("Schedule editing is only available for the 5-team single round robin schedule.");
		return;
	}

	const dayIndex = Number(document.getElementById("changeScheduleDaySelect")?.value);
	const seriesIndex = Number(document.getElementById("changeScheduleSeriesSelect")?.value);
	const team1 = document.getElementById("changeScheduleTeam1Select")?.value || "";
	const team2 = document.getElementById("changeScheduleTeam2Select")?.value || "";

	if (!Number.isInteger(dayIndex) || !Number.isInteger(seriesIndex)) {
		alert("Pick a valid day and series first.");
		return;
	}
	if (!team1 || !team2 || team1 === team2) {
		alert("Pick two different teams for the new matchup.");
		return;
	}
	if (!canEditFiveTeamScheduleFromDay(dayIndex)) {
		alert("You can only change a day when that day and all later days are still unplayed.");
		return;
	}

	const selectedOption = getBestFiveTeamSeriesEditOption(dayIndex, seriesIndex, team1, team2);
	if (!selectedOption) {
		alert("That matchup is not valid. Choose a different team pairing.");
		return;
	}

	const teamNames = schedule.teamNames.slice();
	rebuildFiveTeamScheduleFromDay(dayIndex, selectedOption.plan, teamNames);
	saveSchedule();
	renderScheduleUI();
	showNotification(`✅ Day ${Number(schedule.days?.[dayIndex]?.day || (dayIndex + 1))} Series ${seriesIndex + 1} updated`, 1600);
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

	function save() {
		localStorage.setItem("wiggleLeague", JSON.stringify(league));
	}

	async function load() {
  // load teams + players from Supabase
  const { data: teams, error: teamErr } = await supabaseClient
    .from("teams")
    .select("id, name, players:players(id, name)")
    .order("name", { ascending: true });

  if (teamErr) {
    console.log(teamErr);
    // fallback to localStorage if you want:
    const local = localStorage.getItem("wiggleLeague");
    if (local) league = JSON.parse(local);
    return;
  }

  league.teams = (teams || []).map(t => ({
    name: t.name,
    players: (t.players || []).map(p => p.name)
  }));
}

function saveSeason({ skipServerSync = false, touchMeta = true } = {}) {
  // stamp update time (used for cross-device sync)
  try {
    if (!season || typeof season !== "object") {
     season = { playerStats: {}, teamRecords: {}, seasonSubs: [], subStats: {}, games: [] };
    }
    if (touchMeta) {
      season._meta = season._meta || {};
      season._meta.updated_at = new Date().toISOString();
    }
  } catch (e) {}

  localStorage.setItem("wiggleSeason", JSON.stringify(season));
  if (!skipServerSync) queueServerSync("season");
}

function loadSeason() {
	let data = localStorage.getItem("wiggleSeason");
	if (data) {
		season = JSON.parse(data);
	}
	season = ensureSeasonShape(season);
}

	/* ================================
	✅ SYNC + REALTIME (teams + season data)
	- Auto-sync season/schedule to Supabase (if season_data table exists)
	- Realtime subscribe so all devices see updates quickly
	==================================*/
	let autoSyncEnabled = false;          // turns on after post-unlock setup
	let suppressAutoSync = false;         // prevents sync loops when applying server data
	let postUnlockSetupPromise = null;

	let realtimeChannel = null;
	let teamsReloadTimer = null;

	let serverSyncTimer = null;

	function setSyncButtonEnabled(enabled) {
		const btn = document.getElementById("resaveStatsBtn");
		if (!btn) return;
		btn.disabled = !enabled;
		btn.style.opacity = enabled ? "1" : "0.6";
		btn.style.pointerEvents = enabled ? "auto" : "none";
	}

	function getLocalUpdatedAtMs() {
		const s = Date.parse(season?._meta?.updated_at || "") || 0;
		const sch = Date.parse(schedule?._meta?.updated_at || "") || 0;
		return Math.max(s, sch);
	}

function ensureSeasonShape(obj) {
	if (!obj || typeof obj !== "object") {
		obj = { playerStats: {}, teamRecords: {}, seasonSubs: [], subStats: {}, games: [] };
	}
	if (!obj.playerStats) obj.playerStats = {};
	if (!obj.teamRecords) obj.teamRecords = {};
	if (!Array.isArray(obj.seasonSubs)) obj.seasonSubs = [];
	if (!obj.subStats || typeof obj.subStats !== "object") obj.subStats = {};
	if (!Array.isArray(obj.games)) obj.games = [];
	return obj;
}

function ensureScheduleShape(obj) {
	if (!obj || typeof obj !== "object") obj = { days: [], teamNames: [] };
	if (!Array.isArray(obj.days)) obj.days = [];
	if (!Array.isArray(obj.teamNames)) obj.teamNames = [];

	obj.days = obj.days.map((dayObj, dayIndex) => {
		const nextDay = { ...dayObj, day: Number(dayObj?.day || (dayIndex + 1)) };
		const rawGames = Array.isArray(dayObj?.games) ? dayObj.games : [];

		nextDay.games = rawGames.map((entry, entryIndex) => {
			const seriesNumber = Number(entry?.gameNumber || (entryIndex + 1));
			const away = entry?.away || "";
			const home = entry?.home || "";

			// already in new series format
			if (Array.isArray(entry?.gamesInSeries)) {
				
			const gamesInSeries = entry.gamesInSeries.slice(0, 3).map((slot, slotIndex) => ({
	gameNumber: Number(slot?.gameNumber || (slotIndex + 1)),
	result: slot?.result || null,
	subAssignments: Array.isArray(slot?.subAssignments) ? slot.subAssignments.map(a => ({ ...a })) : []
}));
				while (gamesInSeries.length < 3) {
					gamesInSeries.push(createSeriesGameSlot(gamesInSeries.length + 1));
				}

				const normalized = {
	...entry,
	gameNumber: seriesNumber,
	away,
	home,
	gamesInSeries,
	subAssignments: Array.isArray(entry?.subAssignments) ? entry.subAssignments.map(a => ({ ...a })) : [],
	result: entry?.result || null
};

				if (!normalized.result) {
					normalized.result = computeSeriesResult(normalized);
				}

				return normalized;
			}

			// old format -> convert single game row into new series row
			const migrated = createSeriesEntry(away, home, seriesNumber);

			if (entry?.result) {
				migrated.gamesInSeries[0].result = entry.result;
			}

			migrated.result = computeSeriesResult(migrated);
			return migrated;
		});

		return nextDay;
	});

	return obj;
}

function snapshotHasData(seasonObj, scheduleObj) {
  try {
    const ps = seasonObj?.playerStats || {};
    if (ps && Object.keys(ps).length) return true;

    const subStats = seasonObj?.subStats || {};
    if (subStats && Object.keys(subStats).length) return true;

    if (Array.isArray(seasonObj?.seasonSubs) && seasonObj.seasonSubs.length) return true;
  } catch (e) {}

  try {
    const days = scheduleObj?.days || [];
    for (const d of days) {
      for (const seriesEntry of (d.games || [])) {
        if (seriesEntry && seriesEntry.result) return true;
        if (Array.isArray(seriesEntry?.subAssignments) && seriesEntry.subAssignments.length) return true;

        for (const sg of (seriesEntry?.gamesInSeries || [])) {
          if (sg && sg.result) return true;
          if (Array.isArray(sg?.subAssignments) && sg.subAssignments.length) return true;
        }
      }
    }
  } catch (e) {}

  return false;
}

function persistActiveGameLock(lockObj) {
	activeGameLock = lockObj || null;
	try {
		if (activeGameLock) localStorage.setItem(ACTIVE_GAME_LOCK_KEY, JSON.stringify(activeGameLock));
		else localStorage.removeItem(ACTIVE_GAME_LOCK_KEY);
	} catch (e) {}
	try { refreshGameLockUI(); } catch (e) {}
}

function getActiveGameLockLabel(lockObj = activeGameLock) {
	if (!lockObj) return "";
	if (lockObj.type === "scheduled") {
		const parts = [];
		if (Number.isInteger(lockObj.dayNumber)) parts.push(`Day ${lockObj.dayNumber}`);
		if (Number.isInteger(lockObj.seriesNumber)) parts.push(`Series ${lockObj.seriesNumber}`);
		if (Number.isInteger(lockObj.seriesGameNumber)) parts.push(`Game ${lockObj.seriesGameNumber}`);
		const slot = parts.join(" • ");
		const matchup = (lockObj.team1 && lockObj.team2) ? `${lockObj.team1} vs ${lockObj.team2}` : "Scheduled game";
		return slot ? `${slot} — ${matchup}` : matchup;
	}
	return (lockObj.team1 && lockObj.team2)
		? `Manual game — ${lockObj.team1} vs ${lockObj.team2}`
		: "Manual game in progress";
}

function refreshGameLockUI() {
	const notice = document.getElementById("gameSetupLockNotice");
	const manualBtn = document.getElementById("manualStartGameBtn");
	const scheduledBtn = document.getElementById("startScheduledGameBtn");
	const addSubBtn = document.getElementById("openSubAssignBtn");
	const lockedByAnotherGame = !!activeGameLock && (!game?._lockId || game._lockId !== activeGameLock.lockId);

	if (notice) {
		if (lockedByAnotherGame) {
			const startedBy = activeGameLock.startedByName ? ` by ${activeGameLock.startedByName}` : "";
			notice.innerText = `🔒 Game recording is locked${startedBy}. ${getActiveGameLockLabel(activeGameLock)} is currently in progress.`;
			notice.classList.remove("hidden");
		} else {
			notice.innerText = "";
			notice.classList.add("hidden");
		}
	}

	if (manualBtn) manualBtn.disabled = lockedByAnotherGame;
	if (scheduledBtn) scheduledBtn.disabled = lockedByAnotherGame || !!scheduledBtn.disabled;
	if (addSubBtn) addSubBtn.disabled = lockedByAnotherGame;
}

async function ensureSeasonRowExistsForLocking() {
	const { data } = await supabaseClient.auth.getSession();
	const userId = data?.session?.user?.id || null;
	const payload = {
		league_code: String(LEAGUE_CODE),
		season_json: season,
		schedule_json: schedule,
		updated_at: new Date().toISOString(),
		updated_by: userId,
		active_game_lock: null,
		active_game_lock_id: null
	};
	const { error } = await supabaseClient
		.from("season_data")
		.upsert(payload, { onConflict: "league_code", ignoreDuplicates: true });
	if (error) throw error;
}

async function acquireGameLock(lockDetails) {
	if (!(await requireLogin())) return { ok: false, reason: "login" };

	if (activeGameLock && (!game?._lockId || game._lockId !== activeGameLock.lockId)) {
		return { ok: false, reason: "locked", lock: activeGameLock };
	}

	const { data } = await supabaseClient.auth.getSession();
	const user = data?.session?.user || null;
	const lockId = `lock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	const lockPayload = {
		...lockDetails,
		lockId,
		startedAt: new Date().toISOString(),
		startedByName: getStoredName() || user?.email || "Unknown user",
		startedByUserId: user?.id || null
	};

	let row = null;
	for (let attempt = 0; attempt < 2; attempt++) {
		const { data: updatedRow, error } = await supabaseClient
			.from("season_data")
			.update({
				active_game_lock: lockPayload,
				active_game_lock_id: lockId,
				updated_at: new Date().toISOString(),
				updated_by: user?.id || null
			})
			.eq("league_code", String(LEAGUE_CODE))
			.is("active_game_lock_id", null)
			.select("season_json,schedule_json,updated_at,active_game_lock,active_game_lock_id")
			.maybeSingle();

		if (error) throw error;
		if (updatedRow) {
			row = updatedRow;
			break;
		}

		const latestRow = await fetchSeasonRowFromServer({ quiet: true });
		if (latestRow) {
			applyServerSeasonRow(latestRow);
			if (latestRow.active_game_lock) {
				return { ok: false, reason: "locked", lock: latestRow.active_game_lock, row: latestRow };
			}
		}

		await ensureSeasonRowExistsForLocking();
	}

	if (!row) {
		const latestRow = await fetchSeasonRowFromServer({ quiet: true });
		if (latestRow) applyServerSeasonRow(latestRow);
		return { ok: false, reason: "locked", lock: latestRow?.active_game_lock || activeGameLock, row: latestRow || null };
	}

	applyServerSeasonRow(row);
	return { ok: true, lock: row.active_game_lock || lockPayload, lockId, row };
}

async function releaseGameLock(lockId, { quiet = false } = {}) {
	if (!lockId) {
		persistActiveGameLock(null);
		return true;
	}

	if (!(await requireLogin())) return false;

	const { data } = await supabaseClient.auth.getSession();
	const userId = data?.session?.user?.id || null;
	const { error } = await supabaseClient
		.from("season_data")
		.update({
			active_game_lock: null,
			active_game_lock_id: null,
			updated_at: new Date().toISOString(),
			updated_by: userId
		})
		.eq("league_code", String(LEAGUE_CODE))
		.eq("active_game_lock_id", lockId);

	if (error) {
		if (!quiet) console.log("release game lock failed:", error);
		return false;
	}

	persistActiveGameLock(null);
	return true;
}

async function fetchSeasonRowFromServer({ quiet = true, publicView = false } = {}) {
	try {
		const tableName = publicView ? "season_data_public" : "season_data";
		const selectCols = publicView
			? "season_json,schedule_json,updated_at"
			: "season_json,schedule_json,updated_at,active_game_lock,active_game_lock_id";

		const { data, error } = await supabaseClient
			.from(tableName)
			.select(selectCols)
			.eq("league_code", String(LEAGUE_CODE))
			.maybeSingle();

		if (error) throw error;
		return data || null;
	} catch (e) {
		if (!quiet) console.log(`fetch ${publicView ? "season_data_public" : "season_data"} failed:`, e);
		return null;
	}
}

function applyServerSeasonRow(row) {
	if (!row) return;

	suppressAutoSync = true;

	season = ensureSeasonShape(row.season_json);
	schedule = ensureScheduleShape(row.schedule_json);
	persistActiveGameLock(row.active_game_lock || null);

	try {
		const serverIso = row.updated_at || new Date().toISOString();
		season._meta = season._meta || {};
		schedule._meta = schedule._meta || {};
		season._meta.updated_at = serverIso;
		schedule._meta.updated_at = serverIso;
	} catch (e) {}

	try { saveSeason({ skipServerSync: true, touchMeta: false }); } catch (e) {}
	try { saveSchedule({ skipServerSync: true, touchMeta: false }); } catch (e) {}

	suppressAutoSync = false;

	try { update(); } catch (e) {}
	try { if (!document.getElementById("seasonStatsScreen").classList.contains("hidden")) displaySeasonStats(); } catch (e) {}
	try { if (!document.getElementById("scheduleScreen").classList.contains("hidden")) renderScheduleUI(); } catch (e) {}
	try {
		if (!document.getElementById("gameSetupScreen").classList.contains("hidden")) {
			const info = ensureScheduleUpToDateForSelection();
			if (info.ok) populateScheduleDaySelect();
			else updateGameSetupSelects();
			refreshGameLockUI();
		}
	} catch (e) {}
}

	async function hydrateFromServerIfNewer() {
		if (!(await requireLogin())) return;

		const row = await fetchSeasonRowFromServer({ quiet: true });
		if (!row) return;

		const serverMs = Date.parse(row.updated_at || "") || 0;
		const localMs = getLocalUpdatedAtMs();
		
// Pull if server is newer OR server has data and local is empty
const serverHas = snapshotHasData(row.season_json, row.schedule_json);
const localHas = snapshotHasData(season, schedule);

if ((serverHas && !localHas) || (serverMs > localMs + 1000)) {
  applyServerSeasonRow(row);
  showNotification("⬇️ Pulled latest stats from server", 1200);
}


	}

	function queueServerSync(reason, { immediate = false } = {}) {
		if (!autoSyncEnabled) return;
		if (suppressAutoSync) return;
		if (!isLeagueUnlocked() || !getStoredName()) return;

		// debounce sync to avoid spamming Supabase
		if (serverSyncTimer) clearTimeout(serverSyncTimer);

		const run = async () => {
			serverSyncTimer = null;
			await syncSeasonToServer({ quiet: true });
		};

		if (immediate) run();
		else serverSyncTimer = setTimeout(run, 1400);
	}

	async function ensurePostUnlockSetup() {
		if (postUnlockSetupPromise) return postUnlockSetupPromise;

		postUnlockSetupPromise = (async () => {
			setSyncButtonEnabled(false);

			// Best effort: pull down newer server snapshot before enabling autosync
			try { await hydrateFromServerIfNewer(); } catch (e) {}

			// Start realtime listeners
			try { await startRealtime(); } catch (e) {}

			autoSyncEnabled = true;
			setSyncButtonEnabled(true);
		})();

		return postUnlockSetupPromise;
	}

	function scheduleTeamsReload() {
		if (teamsReloadTimer) clearTimeout(teamsReloadTimer);
		teamsReloadTimer = setTimeout(async () => {
			teamsReloadTimer = null;
			try { await load(); } catch (e) {}
			try { syncTeamRecordsWithLeague(); } catch (e) {}
			try { update(); } catch (e) {}
		}, 400);
	}

	async function startRealtime() {
		if (realtimeChannel) return;

		// channel name must be unique-ish per league
		realtimeChannel = supabaseClient.channel("wbl-realtime-" + String(LEAGUE_CODE));

		// Teams + players updates
		realtimeChannel.on(
			"postgres_changes",
			{ event: "*", schema: "public", table: "teams" },
			() => scheduleTeamsReload()
		);

		realtimeChannel.on(
			"postgres_changes",
			{ event: "*", schema: "public", table: "players" },
			() => scheduleTeamsReload()
		);

		// Season snapshot updates (optional table)
		realtimeChannel.on(
			"postgres_changes",
			{ event: "*", schema: "public", table: "season_data", filter: "league_code=eq." + String(LEAGUE_CODE) },
			async (payload) => {
				// If deleted, clear locally too
				if (payload.eventType === "DELETE") {
					suppressAutoSync = true;
				season = { playerStats: {}, teamRecords: {}, seasonSubs: [], subStats: {} };
schedule = { days: [], teamNames: [] };
persistActiveGameLock(null);
					try { localStorage.removeItem("wiggleSeason"); } catch (e) {}
					try { localStorage.removeItem("wiggleSchedule"); } catch (e) {}
					suppressAutoSync = false;
					try { update(); } catch (e) {}
					try { if (!document.getElementById("seasonStatsScreen").classList.contains("hidden")) displaySeasonStats(); } catch (e) {}
					try { if (!document.getElementById("scheduleScreen").classList.contains("hidden")) renderScheduleUI(); } catch (e) {}
					return;
				}

				// For insert/update, pull latest
				const row = await fetchSeasonRowFromServer({ quiet: true });
				if (row) applyServerSeasonRow(row);
			}
		);

		await realtimeChannel.subscribe();
	}

	function stopRealtime() {
		try {
			if (realtimeChannel) realtimeChannel.unsubscribe();
		} catch (e) {}
		realtimeChannel = null;
		postUnlockSetupPromise = null;
		autoSyncEnabled = false;
	}


	/* ================================
	✅ SERVER BACKUP (manual + automatic)
	- Optional Supabase table: season_data
	  Columns (recommended):
	    league_code (text, PK or unique)
	    season_json (jsonb)
	    schedule_json (jsonb)
	    updated_at (timestamptz)
	    updated_by (uuid)
	==================================*/
	async function syncSeasonToServer({ quiet = false } = {}) {
		// Keep local copy always
		try { saveSeason({ skipServerSync: true }); } catch (e) {}
		try { saveSchedule({ skipServerSync: true }); } catch (e) {}

		// Only attempt if user is authenticated + league unlocked
		const ok = await requireLogin();
		if (!ok) return false;

		try {
			const { data } = await supabaseClient.auth.getSession();
			const userId = data?.session?.user?.id || null;

			const payload = {
				league_code: String(LEAGUE_CODE),
				season_json: season,
				schedule_json: schedule,
				updated_at: new Date().toISOString(),
				updated_by: userId
			};

			const { error } = await supabaseClient
				.from("season_data")
				.upsert(payload, { onConflict: "league_code" });

			if (error) throw error;

			if (!quiet) showNotification("✅ Season stats saved to server", 1800);
			return true;
		} catch (e) {
			console.log("season_data upsert failed:", e);
			if (!quiet) {
				alert(
					"Could not save to server.\n\n" +
					"Local season stats are still saved on this device.\n" +
					"To enable server backups, create a Supabase table named 'season_data' with a unique 'league_code' column."
				);
			}
			return false;
		}
	}

	async function manualResaveAllStats() {
  if (!(await requireLogin())) return;

  setSyncButtonEnabled(false);
  showNotification("🔄 Syncing data…", 1200);

  // Always refresh teams from Supabase so you see latest adds/deletes
  try { await load(); } catch (e) {}
  try { syncTeamRecordsWithLeague(); } catch (e) {}
  try { update(); } catch (e) {}

  // If server has a newer snapshot, pull it down instead of overwriting
  const row = await fetchSeasonRowFromServer({ quiet: true });
  const serverMs = row ? (Date.parse(row.updated_at || "") || 0) : 0;
  const localMs = getLocalUpdatedAtMs();

  if (row && serverMs > localMs + 1000) {
    applyServerSeasonRow(row);
    setSyncButtonEnabled(true);
    alert("✅ Data was synced.");
    return;
  }

  // Otherwise push local snapshot up
  try { saveSeason({ skipServerSync: true }); } catch (e) {}
  try { saveSchedule({ skipServerSync: true }); } catch (e) {}

  const ok = await syncSeasonToServer({ quiet: false });
  setSyncButtonEnabled(true);
  if (ok) alert("✅ Data was synced.");
}




	function getTeamRecord(teamName) {
		if (!season.teamRecords) season.teamRecords = {};
		if (!season.teamRecords[teamName]) {
			season.teamRecords[teamName] = { wins: 0, losses: 0 };
		}
		return season.teamRecords[teamName];
	}

	function formatTeamRecord(teamName) {
		const r = getTeamRecord(teamName);
		return `${r.wins}-${r.losses}`;
	}

	function syncTeamRecordsWithLeague() {
		// Make sure every current team has a record row
		(league.teams || []).forEach(t => getTeamRecord(t.name));
		try { saveSeason({ skipServerSync: true, touchMeta: false }); } catch (e) {}

	}

function updateScheduleForCompletedGame(teamA, teamB, resultObj) {
	if (!schedule?.days?.length) return;

	const applySeriesWinLoss = (seriesEntry) => {
		if (!seriesEntry || seriesEntry._seriesStandingsApplied || !seriesEntry.result) return;

		if (seriesEntry.result.type === "win") {
			getTeamRecord(seriesEntry.result.winner).wins += 1;
			getTeamRecord(seriesEntry.result.loser).losses += 1;
		}

		seriesEntry._seriesStandingsApplied = true;
	};

	// exact scheduled slot
	const ref = game?._scheduleRef;
	if (ref && Number.isInteger(ref.dayIndex) && Number.isInteger(ref.seriesIndex) && Number.isInteger(ref.seriesGameIndex)) {
		const day = schedule.days[ref.dayIndex];
		const seriesEntry = day?.games?.[ref.seriesIndex];
		const seriesGame = seriesEntry?.gamesInSeries?.[ref.seriesGameIndex];

		if (seriesEntry && seriesGame) {
			if (seriesGame.result) return; // already recorded

			seriesGame.result = resultObj;

			if (!seriesEntry.result) {
				seriesEntry.result = computeSeriesResult(seriesEntry);
				applySeriesWinLoss(seriesEntry);
			}

			saveSchedule();
			return;
		}
	}

	// fallback
	for (const day of schedule.days) {
		for (const seriesEntry of (day.games || [])) {
			const match =
				(seriesEntry.away === teamA && seriesEntry.home === teamB) ||
				(seriesEntry.away === teamB && seriesEntry.home === teamA);

			if (!match) continue;

			const openGame = (seriesEntry.gamesInSeries || []).find(seriesGame => !seriesGame.result);
			if (!openGame) continue;

			openGame.result = resultObj;

			if (!seriesEntry.result) {
				seriesEntry.result = computeSeriesResult(seriesEntry);
				applySeriesWinLoss(seriesEntry);
			}

			saveSchedule();
			return;
		}
	}
}

function applyGameOutcomeOnce() {
	if (!game || game._resultSaved) return;
	game._resultSaved = true;

	const t1 = game.team1?.name;
	const t2 = game.team2?.name;
	if (!t1 || !t2) return;

	const s1 = Number(game.team1Score || 0);
	const s2 = Number(game.team2Score || 0);

	// make sure record objects exist
	getTeamRecord(t1);
	getTeamRecord(t2);

	let resultObj;

	if (s1 === s2) {
		resultObj = {
			type: "tie",
			team1: t1,
			team2: t2,
			score1: s1,
			score2: s2,
			playedAt: Date.now()
		};
	} else {
		const winner = s1 > s2 ? t1 : t2;
		const loser = s1 > s2 ? t2 : t1;

		resultObj = {
			type: "win",
			winner,
			loser,
			winnerScore: Math.max(s1, s2),
			loserScore: Math.min(s1, s2),
			playedAt: Date.now()
		};
	}

	// scheduled series game -> store game result, series result happens after all 3
	if (game?._scheduleRef &&
		Number.isInteger(game._scheduleRef.dayIndex) &&
		Number.isInteger(game._scheduleRef.seriesIndex)
	) {
		updateScheduleForCompletedGame(t1, t2, resultObj);
	}
	// manual game -> old single-game win/loss behavior
	else if (s1 !== s2) {
		const winner = s1 > s2 ? t1 : t2;
		const loser = s1 > s2 ? t2 : t1;
		getTeamRecord(winner).wins += 1;
		getTeamRecord(loser).losses += 1;
	}

	saveSeason();
}

	async function resetSeason() {
		if (!(await requireLogin())) return;
  const msg =
    "⚠️ Reset Season?\n\n" +
    "This will permanently delete:\n" +
    "• All season stats\n" +
    "• All schedule game results\n" +
    "• Local saved season/schedule data\n" +
    "• Server backup (season_data) for this league\n\n" +
    "This cannot be undone.\n\n" +
    "Are you sure you want to continue?";
  if (!confirm(msg)) return;

  try {
    // 1) Clear local season + schedule
    try { localStorage.removeItem("wiggleSeason"); } catch (e) {}
    try { localStorage.removeItem("wiggleSchedule"); } catch (e) {}
    try { localStorage.removeItem("wbl_lastSchedule"); } catch (e) {}
    try { localStorage.removeItem("wbl_lastScheduleKey"); } catch (e) {}

    // Reset in-memory structures if they exist
    if (typeof season !== "undefined") {
     season = { teamRecords: {}, playerStats: {}, seasonSubs: [], subStats: {}, games: [] };
    }
    if (typeof schedule !== "undefined") {
      schedule = [];
    }

    // 2) Delete server backup row (best-effort)
    // Only runs if supabaseClient exists and user is logged in
    if (typeof supabaseClient !== "undefined") {
      const { data: { user } = {} } = await supabaseClient.auth.getUser();
      const leagueCode = (typeof LEAGUE_CODE !== "undefined" ? String(LEAGUE_CODE) : "").trim();

      if (user && leagueCode) {
        const { error } = await supabaseClient
          .from("season_data")
          .delete()
          .eq("league_code", leagueCode);

        if (error) {
          console.warn("Season reset: server delete failed:", error);
          // Don’t throw—local reset still succeeded
        }
      }
    }

    // 3) Re-render UI / save fresh empty season locally
    if (typeof loadSeason === "function") loadSeason();
    if (typeof loadSchedule === "function") loadSchedule();
    if (typeof renderSeasonStats === "function") renderSeasonStats();
    if (typeof renderSchedule === "function") renderSchedule();
    if (typeof showToast === "function") {
      showToast("✅ Season reset complete.");
    } else {
      alert("✅ Season reset complete.");
    }
  } catch (err) {
    console.error(err);
    alert("❌ Reset failed. Check console for details.");
  }
}

function getPlayerKey(teamName, playerName) {
	return teamName + "|" + playerName;
}

function getSubKey(subName) {
	return "SUB|" + subName;
}

function isSubKey(key) {
	return String(key || "").startsWith("SUB|");
}

function createEmptyStats(teamName, playerName, extra = {}) {
	return {
		teamName: teamName,
		playerName: playerName,
		atBats: 0,
		hits: 0,
		singles: 0,
		doubles: 0,
		triples: 0,
		homeRuns: 0,
		walks: 0,
		strikeouts: 0,
		outs: 0,
		rbis: 0,
		pitchOuts: 0,
		pitchStrikeouts: 0,
		fieldingErrors: 0,
		inningsPitched: 0,
		runsAllowed: 0,
		earnedRunsAllowed: 0,
		...extra
	};
}

function initPlayerStats(teamName, playerName) {
	let key = getPlayerKey(teamName, playerName);
	if (!season.playerStats[key]) {
		season.playerStats[key] = createEmptyStats(teamName, playerName, { isSub: false });
	}
	return season.playerStats[key];
}

function initSubStats(subName) {
	season.subStats = season.subStats || {};
	const key = getSubKey(subName);
	if (!season.subStats[key]) {
		season.subStats[key] = createEmptyStats("SUB", subName, { isSub: true });
	}
	return season.subStats[key];
}

function getSeasonStatsBucketForKey(key) {
	if (isSubKey(key)) {
		season.subStats = season.subStats || {};
		return season.subStats;
	}
	season.playerStats = season.playerStats || {};
	return season.playerStats;
}

function getOrCreateSeasonStatsByKey(key, teamName = "", playerName = "") {
	const bucket = getSeasonStatsBucketForKey(key);
	if (!bucket[key]) {
		if (isSubKey(key)) {
			bucket[key] = createEmptyStats("SUB", String(key).replace(/^SUB\|/, ""), { isSub: true });
		} else {
			bucket[key] = createEmptyStats(teamName, playerName, { isSub: false });
		}
	}
	return bucket[key];
}

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

function getGameStatsKey(teamOrName, playerName) {
	const teamObj = typeof teamOrName === "string"
		? [game?.team1, game?.team2].find(t => t?.name === teamOrName)
		: teamOrName;

	const statsKey = teamObj?._playerMeta?.[playerName]?.statsKey;
	return statsKey || getPlayerKey(teamObj?.name || teamOrName, playerName);
}

function getDisplayNameForPlayer(teamObj, playerName, isSeason) {
	if (isSeason) return playerName;
	const meta = teamObj?._playerMeta?.[playerName];
	if (meta?.isSub && meta?.originalPlayer) return `${playerName} (sub for ${meta.originalPlayer})`;
	return playerName;
}

function getAllPlayerNames() {
	const names = [];
	(league.teams || []).forEach(team => (team.players || []).forEach(player => names.push(player)));
	return names;
}

	function showNotification(message, duration = 2000) {
		let notif = document.getElementById("notification");
		if (notif) {
			notif.innerText = message;
			notif.classList.remove("hidden");
			setTimeout(() => {
				notif.classList.add("hidden");
			}, duration);
		}
	}

// GAME SETUP + SCHEDULE / MENU FLOW

function forceRegenerateSchedule() {
	const validTeams = getValidTeamsForSchedule();
	const config = getScheduleConfigForTeams(validTeams);
	if (!config) {
		alert("You need either 4 or 5 teams with players to generate a schedule.");
		return;
	}
	schedule = generateScheduleForTeams(validTeams);
	saveSchedule();
	renderScheduleUI();
}

function renderScheduleUI() {
	const container = document.getElementById("scheduleContainer");
	const summaryText = document.getElementById("scheduleSummaryText");
	container.innerHTML = "";

	const validTeams = getValidTeamsForSchedule();
	const liveConfig = getScheduleConfigForTeams(validTeams);
	const snapshotTeamNames = Array.isArray(schedule?.teamNames) ? schedule.teamNames.filter(Boolean) : [];
	const canRenderSnapshot = Array.isArray(schedule?.days) && schedule.days.length > 0 && snapshotTeamNames.length > 0 && isScheduleCurrentFormat(schedule, snapshotTeamNames.slice().sort());

	if (!canRenderSnapshot && liveConfig) {
		schedule = generateScheduleForTeams(validTeams);
		saveSchedule();
	}

	const activeTeamNames = Array.isArray(schedule?.teamNames) ? schedule.teamNames.filter(Boolean) : [];
	const activeConfig = getScheduleConfigForTeams(activeTeamNames) || liveConfig;
	if (summaryText) {
		summaryText.innerText = activeConfig?.description || "Season schedule will appear here once teams are ready.";
	}

	if (!Array.isArray(schedule?.days) || schedule.days.length === 0) {
		container.innerHTML = liveConfig
			? `
			<div class="card">
				<h3>No schedule yet</h3>
				<p style="color:#aaa;">Generate or sync a season schedule first.</p>
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

	if (activeConfigId === SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5 && hasFullAppAccess()) {
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
						<div style="font-size:13px; color:#aaa; margin-bottom:6px;">Series</div>
						<select id="changeScheduleSeriesSelect" onchange="refreshChangeScheduleControls()"></select>
					</div>
					<div>
						<div style="font-size:13px; color:#aaa; margin-bottom:6px;">First Team</div>
						<select id="changeScheduleTeam1Select" onchange="refreshChangeScheduleControls()"></select>
					</div>
					<div>
						<div style="font-size:13px; color:#aaa; margin-bottom:6px;">Second Team</div>
						<select id="changeScheduleTeam2Select" onchange="refreshChangeScheduleControls()"></select>
					</div>
				</div>
				<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:12px;">
					<button id="applyScheduleChangeBtn" type="button" onclick="applySelectedScheduleChange()">Apply Change</button>
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
			? getByeTeamForDay(dayObj, activeTeamNames)
			: "";

		const dayLockedNote = activeConfigId === SCHEDULE_FORMAT_SINGLE_ROUND_ROBIN_5 && hasFullAppAccess() && !canEditFiveTeamScheduleFromDay(dayIndex)
			? `<div style="margin:6px 0 12px; color:#aaa; font-size:13px;">Schedule editing is locked for this day because this day or a later day already has recorded games.</div>`
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

function showPublicMenu() {
	hideAllScreens();
	try { document.getElementById("accessGate").classList.add("hidden"); } catch (e) {}
	document.getElementById("publicMenu").classList.remove("hidden");
	updatePublicAccessUI();
}

function showMainMenu() {
	if (isPublicViewOnlyMode()) {
		showPublicMenu();
		return;
	}
	hideAllScreens();
	document.getElementById("mainMenu").classList.remove("hidden");
	updatePublicAccessUI();
}

function showTeamConfig() {
	if (isPublicViewOnlyMode()) {
		alert("Sign in and enter the league code to configure teams.");
		showPublicMenu();
		return;
	}
	hideAllScreens();
	document.getElementById("teamConfigScreen").classList.remove("hidden");
	update();
}

async function showGameSetup() {
	if (isPublicViewOnlyMode()) {
		alert("Sign in and enter the league code to record games.");
		showPublicMenu();
		return;
	}
	hideAllScreens();
	
	if (league.teams.length < 2) {
		alert("You need at least 2 teams! Please configure teams first.");
		showTeamConfig();
		return;
	}

	let validTeams = league.teams.filter(t => t.players.length > 0);
	if (validTeams.length < 2) {
		alert("You need at least 2 teams with players! Please add players first.");
		showTeamConfig();
		return;
	}

	document.getElementById("gameSetupScreen").classList.remove("hidden");

	const schedCard = document.getElementById("scheduledGameCard");
	const manualCard = document.getElementById("manualTeamCard");

	const info = ensureScheduleUpToDateForSelection();
	if (info.ok) {
		schedCard.style.display = "block";
		manualCard.style.display = "none";
		populateScheduleDaySelect();
	} else {
		schedCard.style.display = "none";
		manualCard.style.display = "block";
		updateGameSetupSelects();
	}

	refreshGameLockUI();
}

async function showSeasonStats() {
	hideAllScreens();
	if (isPublicViewOnlyMode()) {
		try { await refreshPublicViewData({ quiet: true }); } catch (e) {}
	}
	document.getElementById("seasonStatsScreen").classList.remove("hidden");
	updatePublicAccessUI();
	displaySeasonStats();
}

async function showRankings() {
	hideAllScreens();
	if (isPublicViewOnlyMode()) {
		try { await refreshPublicViewData({ quiet: true }); } catch (e) {}
	}
	document.getElementById("rankingsScreen").classList.remove("hidden");
	updatePublicAccessUI();
	displayRankings();
}

async function showPastGameLog() {
	hideAllScreens();
	if (isPublicViewOnlyMode()) {
		try { await refreshPublicViewData({ quiet: true }); } catch (e) {}
	}
	document.getElementById("pastGameLogScreen").classList.remove("hidden");
	updatePublicAccessUI();
	displayPastGameLog();
}

function hideAllScreens() {
	document.getElementById("publicMenu").classList.add("hidden");
	document.getElementById("mainMenu").classList.add("hidden");
	document.getElementById("teamConfigScreen").classList.add("hidden");
	document.getElementById("gameSetupScreen").classList.add("hidden");
	document.getElementById("gameScreen").classList.add("hidden");
	document.getElementById("gameOverScreen").classList.add("hidden");
	document.getElementById("seasonStatsScreen").classList.add("hidden");
	document.getElementById("rankingsScreen").classList.add("hidden");
	document.getElementById("pastGameLogScreen").classList.add("hidden");
	document.getElementById("scheduleScreen").classList.add("hidden");
	document.getElementById("activeUsersScreen").classList.add("hidden");
}

	function showGame() {
		hideAllScreens();
		document.getElementById("gameScreen").classList.remove("hidden");
	}

	function showGameOver() {
		hideAllScreens();
		document.getElementById("gameOverScreen").classList.remove("hidden");
	}

	// TEAM MANAGEMENT FUNCTIONS
async function addTeam() {
  if (!(await requireLogin())) return;

  // ✅ Make sure we’re checking the latest team list before enforcing limit
  try { await load(); } catch (e) {}

  const name = (document.getElementById("teamName")?.value || "").trim();
  if (!name) return;

	const normalizedTeamName = name.toLowerCase();

const duplicateTeamExists = (league?.teams || []).some(team =>
  String(team.name).trim().toLowerCase() === normalizedTeamName
);

if (duplicateTeamExists) {
  alert("⚠️ That team name already exists.\nEach team must have a different name.");
  return;
}

  if ((league?.teams?.length || 0) >= MAX_TEAMS) {
    alert(`⚠️ Max ${MAX_TEAMS} teams reached.\nRemove a team before adding another.`);
    return;
  }

  const { error } = await supabaseClient.from("teams").insert([{ name }]);
  if (error) return alert(error.message);

  document.getElementById("teamName").value = "";
  await load();
  syncTeamRecordsWithLeague();
  update();
}

	async function addPlayer() {
  if (!(await requireLogin())) return;

  const teamIndexStr = document.getElementById("teamSelect")?.value;
  if (teamIndexStr === "" || teamIndexStr == null) return alert("Select a team");

  const teamIndex = Number(teamIndexStr);

  const playerInput = (document.getElementById("playerName")?.value || "");
  const player = playerInput
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!player) return;

  const normalizedPlayer = player.toLowerCase();

  // Keep the exact team the user selected before refreshing
  const selectedTeamName = league?.teams?.[teamIndex]?.name;
  if (!selectedTeamName) return alert("Select a team");

// ✅ Check the real Supabase players table directly
const { data: allPlayers, error: dupErr } = await supabaseClient
  .from("players")
  .select("name");

if (dupErr) {
  console.log("Duplicate player check failed:", dupErr);
  alert("Could not check existing players. Please try again.");
  return;
}

const duplicateExists = (allPlayers || []).some(row => {
  const existingNorm = String(row.name || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return existingNorm === normalizedPlayer;
});

if (duplicateExists) {
  alert("⚠️ That player name is already in this league.\nEach player must have a different name.");
  return;
}

// Refresh latest teams after duplicate check
try { await load(); } catch (e) {}

  const teamObj = (league?.teams || []).find(t => t.name === selectedTeamName);
  const currentPlayers = (teamObj?.players || []).length;

  if (currentPlayers >= MAX_PLAYERS_PER_TEAM) {
    alert(`⚠️ ${selectedTeamName} already has ${MAX_PLAYERS_PER_TEAM} players.\nRemove a player before adding another.`);
    return;
  }

  const { data: teamRow, error: tErr } = await supabaseClient
    .from("teams")
    .select("id")
    .eq("name", selectedTeamName)
    .single();

  if (tErr) return alert(tErr.message);

  const { error } = await supabaseClient.from("players").insert([{
    team_id: teamRow.id,
    name: player
  }]);

  if (error) return alert(error.message);

  document.getElementById("playerName").value = "";
  await load();
  syncTeamRecordsWithLeague();
  update();
}



	async function removeTeam(teamIndex) {
		if (!(await requireLogin())) return;

		const teamName = league.teams?.[teamIndex]?.name;
		if (!teamName) return;

		if (!confirm("Remove this team? This will delete it for everyone.")) return;

		try {
			// Look up team id
			const { data: teamRow, error: tErr } = await supabaseClient
				.from("teams")
				.select("id")
				.eq("name", teamName)
				.single();

			if (tErr) throw tErr;

			// Delete players first (safe even if FK cascade exists)
			await supabaseClient.from("players").delete().eq("team_id", teamRow.id);
			const { error: delErr } = await supabaseClient.from("teams").delete().eq("id", teamRow.id);
			if (delErr) throw delErr;

			// Remove that team's season stats locally too (prevents ghost rows)
			try {
				if (season?.playerStats) {
					Object.keys(season.playerStats).forEach(k => {
						if (k.startsWith(teamName + "|")) delete season.playerStats[k];
					});
				}
				if (season?.teamRecords) delete season.teamRecords[teamName];
				saveSeason();
			} catch (e) {}

			await load();
			syncTeamRecordsWithLeague();
			update();
			showNotification("✅ Team deleted", 1400);
		} catch (e) {
			console.log(e);
			alert(e.message || "Could not delete team.");
		}
	}

	async function removePlayer(teamIndex, playerIndex) {
		if (!(await requireLogin())) return;

		const teamName = league.teams?.[teamIndex]?.name;
		const playerName = league.teams?.[teamIndex]?.players?.[playerIndex];
		if (!teamName || !playerName) return;

		if (!confirm("Remove this player? This will delete them for everyone.")) return;

		try {
			const { data: teamRow, error: tErr } = await supabaseClient
				.from("teams")
				.select("id")
				.eq("name", teamName)
				.single();
			if (tErr) throw tErr;

			const { error: pErr } = await supabaseClient
				.from("players")
				.delete()
				.eq("team_id", teamRow.id)
				.eq("name", playerName);

			if (pErr) throw pErr;

			// Remove player's season stats locally too
			try {
				const key = getPlayerKey(teamName, playerName);
				if (season?.playerStats) delete season.playerStats[key];
				saveSeason();
			} catch (e) {}

			await load();
			syncTeamRecordsWithLeague();
			update();
			showNotification("✅ Player deleted", 1400);
		} catch (e) {
			console.log(e);
			alert(e.message || "Could not delete player.");
		}
	}

function update() {
	let select = document.getElementById("teamSelect");
	select.innerHTML = "";

	if (league.teams.length === 0) {
		select.innerHTML = "<option>Add a team first</option>";
	}

	league.teams.forEach((t, i) => {
		let opt = document.createElement("option");
		opt.value = i;
		opt.text = t.name;
		select.appendChild(opt);
	});

	let list = document.getElementById("teamList");
	list.innerHTML = "";

	if (league.teams.length === 0) {
		list.innerHTML = "<p>No teams yet. Add a team above!</p>";
	}

	league.teams.forEach((team, teamIndex) => {
		let div = document.createElement("div");
		div.className = "card";

		let playersHTML = "";
		team.players.forEach((player, playerIndex) => {
			playersHTML += `<div>${player} <button onclick="removePlayer(${teamIndex},${playerIndex})">Remove</button></div>`;
		});
		if (playersHTML === "") playersHTML = "No players yet";

		div.innerHTML = `<b>${team.name}</b> <button onclick="removeTeam(${teamIndex})">Remove Team</button><br>Players:<br>${playersHTML}`;
		list.appendChild(div);
	});

	const subsList = document.getElementById("seasonSubsList");
	if (subsList) {
		subsList.innerHTML = "";
		const subs = Array.isArray(season?.seasonSubs) ? season.seasonSubs : [];

		if (!subs.length) {
			subsList.innerHTML = "<p>No season subs yet.</p>";
		} else {
			subs.forEach((subName, subIndex) => {
				const row = document.createElement("div");
				row.innerHTML = `${subName} <button onclick="removeSeasonSub(${subIndex})">Remove</button>`;
				subsList.appendChild(row);
			});
		}
	}

	save();
}

function addSeasonSub() {
	season = ensureSeasonShape(season);
	const input = document.getElementById("seasonSubName");
	if (!input) return;

	const subName = String(input.value || "").trim();
	if (!subName) return alert("Enter a substitute name first.");

	if ((season.seasonSubs || []).some(name => String(name).toLowerCase() === subName.toLowerCase())) {
		return alert("That substitute name already exists.");
	}

	if (getAllPlayerNames().some(name => String(name).toLowerCase() === subName.toLowerCase())) {
		return alert("That name is already being used by a roster player. Pick a different sub name.");
	}

	season.seasonSubs.push(subName);
	initSubStats(subName);
	input.value = "";
	saveSeason();
	update();
}

function removeSeasonSub(subIndex) {
	season = ensureSeasonShape(season);
	const subs = season.seasonSubs || [];
	const subName = subs[subIndex];
	if (!subName) return;

	if (!confirm(`Remove ${subName} from the Season Subs list? Existing sub stats and old assignments will stay saved.`)) return;

	subs.splice(subIndex, 1);
	saveSeason();
	update();
	renderSubAssignmentSummary();
}

function toggleSubAssignCard(forceOpen = null) {
	const card = document.getElementById("subAssignCard");
	if (!card) return;

	const shouldOpen = forceOpen === null ? card.classList.contains("hidden") : !!forceOpen;
	if (shouldOpen) {
		const ctx = getSelectedScheduleContext();
		if (!ctx) return alert("Select a day and series first.");
		card.classList.remove("hidden");
		populateSubTeamSelect();
		return;
	}

	card.classList.add("hidden");
}

function populateSubTeamSelect() {
	const ctx = getSelectedScheduleContext();
	const teamSelect = document.getElementById("subTeamSelect");
	if (!teamSelect) return;

	teamSelect.innerHTML = "";
	if (!ctx) return;

	[ctx.seriesEntry.away, ctx.seriesEntry.home].forEach(teamName => {
		const opt = document.createElement("option");
		opt.value = teamName;
		opt.text = teamName;
		teamSelect.appendChild(opt);
	});

	populateSubReplacePlayerSelect();
}

function populateSubReplacePlayerSelect() {
	const teamSelect = document.getElementById("subTeamSelect");
	const replaceSelect = document.getElementById("subReplacePlayerSelect");
	if (!teamSelect || !replaceSelect) return;

	replaceSelect.innerHTML = "";
	const teamObj = league.teams.find(t => t.name === teamSelect.value);

	(teamObj?.players || []).forEach(playerName => {
		const opt = document.createElement("option");
		opt.value = playerName;
		opt.text = playerName;
		replaceSelect.appendChild(opt);
	});

	populateSeasonSubSelect();
}

function populateSeasonSubSelect() {
	const select = document.getElementById("seasonSubSelect");
	const msg = document.getElementById("subAssignHint");
	if (!select) return;

	select.innerHTML = "";
	const subs = Array.isArray(season?.seasonSubs) ? season.seasonSubs : [];

	if (!subs.length) {
		const opt = document.createElement("option");
		opt.value = "";
		opt.text = "No Season Subs added yet";
		select.appendChild(opt);
		select.disabled = true;
		if (msg) msg.innerText = "Add season subs in Configure Teams before assigning one here.";
		return;
	}

	select.disabled = false;
	subs.forEach(subName => {
		const opt = document.createElement("option");
		opt.value = subName;
		opt.text = subName;
		select.appendChild(opt);
	});

	if (msg) msg.innerText = "";
}

function renderSubAssignmentSummary() {
	const box = document.getElementById("subAssignmentSummary");
	if (!box) return;

	box.innerHTML = "";
	const ctx = getSelectedScheduleContext();
	if (!ctx) return;

	const seriesAssignments = getSeriesAssignmentStore(ctx.dayIndex, ctx.seriesIndex);
	const gameAssignments = Number.isInteger(ctx.seriesGameIndex)
		? getGameAssignmentStore(ctx.dayIndex, ctx.seriesIndex, ctx.seriesGameIndex)
		: [];

	if (!seriesAssignments.length && !gameAssignments.length) {
		box.innerHTML = '<p style="color:#aaa; margin:8px 0 0 0;">No substitutes assigned for this selection yet.</p>';
		return;
	}

	const card = document.createElement("div");
	card.className = "card";

	let html = '<h3 style="margin-top:0;">Current Sub Assignments</h3>';

	if (seriesAssignments.length) {
		html += '<div style="margin-bottom:8px;"><b>Entire Series</b>';
		seriesAssignments.forEach((assignment, idx) => {
			html += `<div style="margin-top:6px;">${assignment.teamName}: ${assignment.subName} for ${assignment.replacedPlayer} <button onclick="removeSubAssignment('series', ${ctx.dayIndex}, ${ctx.seriesIndex}, ${idx})">Remove</button></div>`;
		});
		html += '</div>';
	}

	if (gameAssignments.length && Number.isInteger(ctx.seriesGameIndex)) {
		html += `<div><b>Game ${ctx.seriesGameIndex + 1} Only</b>`;
		gameAssignments.forEach((assignment, idx) => {
			html += `<div style="margin-top:6px;">${assignment.teamName}: ${assignment.subName} for ${assignment.replacedPlayer} <button onclick="removeSubAssignment('game', ${ctx.dayIndex}, ${ctx.seriesIndex}, ${ctx.seriesGameIndex}, ${idx})">Remove</button></div>`;
		});
		html += '</div>';
	}

	card.innerHTML = html;
	box.appendChild(card);
}

function removeSubAssignment(scope, dayIndex, seriesIndex, a, b) {
	let store = [];
	let removeIndex = -1;

	if (scope === "series") {
		store = getSeriesAssignmentStore(dayIndex, seriesIndex);
		removeIndex = a;
	} else {
		store = getGameAssignmentStore(dayIndex, seriesIndex, a);
		removeIndex = b;
	}

	if (!Array.isArray(store) || removeIndex < 0 || removeIndex >= store.length) return;

	store.splice(removeIndex, 1);
	saveSchedule();
	renderSubAssignmentSummary();
	populateSubTeamSelect();
}

function confirmSubAssignment() {
	const ctx = getSelectedScheduleContext();
	if (!ctx) return alert("Select a day and series first.");

	const scope = document.getElementById("subScopeSelect")?.value || "series";
	const teamName = document.getElementById("subTeamSelect")?.value || "";
	const replacedPlayer = document.getElementById("subReplacePlayerSelect")?.value || "";
	const subName = document.getElementById("seasonSubSelect")?.value || "";

	if (!teamName || !replacedPlayer || !subName) {
		return alert("Choose a team, the player being replaced, and the substitute.");
	}

	if (scope === "game" && !Number.isInteger(ctx.seriesGameIndex)) {
		return alert("Select a game number before adding a game-only substitute.");
	}

	const teamObj = league.teams.find(t => t.name === teamName);
	if (!teamObj || !(teamObj.players || []).includes(replacedPlayer)) {
		return alert("That roster player could not be found on the selected team.");
	}

	const allSeriesAssignments = [
		...getSeriesAssignmentStore(ctx.dayIndex, ctx.seriesIndex),
		...ctx.seriesEntry.gamesInSeries.flatMap(g => Array.isArray(g.subAssignments) ? g.subAssignments : [])
	];

	if (allSeriesAssignments.some(a => a.subName === subName && !(a.teamName === teamName && a.replacedPlayer === replacedPlayer))) {
		return alert("That substitute is already assigned somewhere in this series. Remove the old assignment first if you want to switch them.");
	}

	const targetStore = scope === "series"
		? getSeriesAssignmentStore(ctx.dayIndex, ctx.seriesIndex)
		: getGameAssignmentStore(ctx.dayIndex, ctx.seriesIndex, ctx.seriesGameIndex);

	const existingIndex = targetStore.findIndex(a => a.teamName === teamName && a.replacedPlayer === replacedPlayer);
	const payload = {
		teamName,
		replacedPlayer,
		subName,
		createdAt: Date.now()
	};

	if (existingIndex >= 0) targetStore[existingIndex] = payload;
	else targetStore.push(payload);

	initSubStats(subName);
	saveSeason();
	saveSchedule();
	renderSubAssignmentSummary();
	showNotification(`${subName} will sub for ${replacedPlayer}.`, 1500);
}

	// GAME SETUP FUNCTIONS

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
	const validTeams = getValidTeamsForSchedule();
	const config = getScheduleConfigForTeams(validTeams);
	if (!config) {
		return { ok: false, reason: "Schedule requires either 4 or 5 teams with players." };
	}

	const teamNames = validTeams.map(t => t.name).sort();

	if (!isScheduleCurrentFormat(schedule, teamNames)) {
		schedule = generateScheduleForTeams(validTeams);
		saveSchedule();
	}

	return { ok: true, validTeams };
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

async function showSchedule() {
  hideAllScreens();
  if (isPublicViewOnlyMode()) {
	  try { await refreshPublicViewData({ quiet: true }); } catch (e) {}
  }
  document.getElementById("scheduleScreen").classList.remove("hidden");
  renderScheduleUI();
}
