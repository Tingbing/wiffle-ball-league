// Wiffle Ball League - Menus, screens, team configuration, and UI glue
// Split from app.core.js. Load this AFTER core.stats.js and BEFORE app.game.js and app.auth.js.

/* ================================
   NOTIFICATIONS
================================== */
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

/* ================================
   SCREEN NAVIGATION
================================== */
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

	refreshGameSetupScheduleCards();
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

/* ================================
   TEAM CONFIGURATION
================================== */
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

/* ================================
   GENERAL UI REFRESH
================================== */
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

/* ================================
   SEASON SUBSTITUTIONS UI
================================== */
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

/* ================================
   SCHEDULE SCREEN ENTRY
================================== */
async function showSchedule() {
  hideAllScreens();
  if (isPublicViewOnlyMode()) {
	  try { await refreshPublicViewData({ quiet: true }); } catch (e) {}
  }
  document.getElementById("scheduleScreen").classList.remove("hidden");
  renderScheduleUI();
}
