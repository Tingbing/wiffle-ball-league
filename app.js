const SUPABASE_URL = "https://hunqtklytyorvmztgpqt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1bnF0a2x5dHlvcnZtenRncHF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NDc0MzcsImV4cCI6MjA4NjQyMzQzN30.ONu6M24_vhaeN-YlqKr-mtNjRuLLMfMeMfdTDMUllfA";
// 🔁 Bump this each time you publish (any new value works)
	
const BUILD_LABEL = location.pathname.split("/").pop(); // shows app.v2026-...html

let supabaseClient = null;
let SUPABASE_READY = false;

function showFatalError(title, msg, details) {
  console.trace("showFatalError called", { title, msg, details });
  try { hideAllScreens(); } catch (e) {}
  try { showGate("login", "Enter your email to get a login link."); } catch (e) {}
 
  const fs = document.getElementById("fatalScreen");
  if (fs) fs.classList.remove("hidden");

  const t = document.getElementById("fatalTitle");
  const m = document.getElementById("fatalMsg");
  const d = document.getElementById("fatalDetails");

  if (t) t.innerText = title || "Error";
  if (m) m.innerText = msg || "Something went wrong.";
  if (d) d.innerText = details || "";
}

function hideFatalError() {
  const fs = document.getElementById("fatalScreen");
  if (fs) fs.classList.add("hidden");
}

console.log("SUPABASE AT CHECK TIME:", window.supabase, window.supabase?.createClient);

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve(src);
    s.onerror = () => reject(new Error("Failed to load " + src));
    document.head.appendChild(s);
  });
}

async function ensureSupabaseGlobal() {
  if (window.supabase && window.supabase.createClient) return { ok: true, tried: [] };

  const tried = [];
  const candidates = [
    "vendor/supabase.js",
    "./vendor/supabase.js",
    "/vendor/supabase.js",
    "/wiffle-ball-league/vendor/supabase.js"
  ];

  for (const src of [...new Set(candidates)]) {
    tried.push(src);
    try {
      await loadScript(src);
    } catch (e) {
      // try next candidate
    }
    if (window.supabase && window.supabase.createClient) {
      return { ok: true, tried };
    }
  }

  return { ok: false, tried };
}

async function initializeSupabaseClient() {
  if (SUPABASE_READY && supabaseClient) return true;

  const loadState = await ensureSupabaseGlobal();
  if (!loadState.ok) {
    const details =
      "window.supabase=" + (typeof window.supabase) + ", " +
      "createClient=" + (typeof window.supabase?.createClient) + ", " +
      "path=" + location.pathname + ", href=" + location.href + ", " +
      "tried=" + loadState.tried.join(",");

    console.error("FATAL TRIGGERED:", details);
    showFatalError("Error", "Supabase failed to load.", details);
    return false;
  }

  let initStage = "preflight";
  const supabaseInitDiag = {
    href: location.href,
    path: location.pathname,
    supabaseType: typeof window.supabase,
    createClientType: typeof window.supabase?.createClient,
    urlType: typeof SUPABASE_URL,
    keyType: typeof SUPABASE_ANON_KEY,
    keyParts: (typeof SUPABASE_ANON_KEY === "string") ? SUPABASE_ANON_KEY.split(".").length : 0
  };

  try {
    initStage = "validate-url";
    // Throws if malformed
    new URL(SUPABASE_URL);

    initStage = "create-client";
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
        // Avoid browser LockManager abort issues seen in some localhost/browser states.
        lock: async (_name, _acquireTimeout, fn) => await fn()
      }
    });

    initStage = "mark-ready";
    SUPABASE_READY = true;

    initStage = "hide-fatal";
    hideFatalError();

    console.log("Supabase init OK", { stage: initStage, diag: supabaseInitDiag });
    return true;
  } catch (e) {
    console.error("Supabase init failed", {
      stage: initStage,
      diag: supabaseInitDiag,
      error: e
    });

    const detailPrefix = "stage=" + initStage + "; diag=" + JSON.stringify(supabaseInitDiag);
    const errText = (e && (e.stack || e.message)) ? (e.stack || e.message) : String(e);

    showFatalError(
      "Login system failed to start",
      "Supabase loaded but could not initialize.",
      detailPrefix + "; error=" + errText
    );
    return false;
  }
}
/* ================================
   ✅ LEAGUE ACCESS SETTINGS
   - Change LEAGUE_CODE to your secret
==================================*/
const LEAGUE_CODE = "6767"; // <-- IMPORTANT: change this

const LS_NAME_KEY = "wbl_userName";
const LS_EMAIL_KEY = "wbl_userEmail";
const LS_LEAGUE_OK_KEY = "wbl_leagueOk";

	// ✅ Limits
const MAX_TEAMS = 4;
const MAX_PLAYERS_PER_TEAM = 2;


/* ================================
   ✅ ACCESS GATE HELPERS
==================================*/
function getStoredName() {
  return (localStorage.getItem(LS_NAME_KEY) || "").trim();
}
function setStoredName(name) {
  localStorage.setItem(LS_NAME_KEY, (name || "").trim());
}
function getStoredEmail() {
  return (localStorage.getItem(LS_EMAIL_KEY) || "").trim();
}
function setStoredEmail(email) {
  localStorage.setItem(LS_EMAIL_KEY, (email || "").trim());
}
let leagueUnlockedThisSession = false;

// ✅ Do NOT persist the league-code unlock.
// This forces users to re-enter the league code any time the page/app is opened fresh.
function isLeagueUnlocked() {
  return !!leagueUnlockedThisSession;
}
function setLeagueUnlocked(v) {
  leagueUnlockedThisSession = !!v;
}

/* ================================
   ✅ ACTIVE USERS (who's logged in)
   - Uses Supabase table: active_users
==================================*/
let presenceInterval = null;
let presenceUserId = null;

async function startPresence() {
  if (!isLeagueUnlocked()) return; // only after correct league code
  const { data } = await supabaseClient.auth.getSession();
  const session = data?.session;
  if (!session) return;

  const userId = session.user.id;
  const name = (getStoredName() || "Player").trim();

  presenceUserId = userId;

  // upsert on load
  try {
    await supabaseClient.from("active_users").upsert({
      user_id: userId,
      name,
      last_seen: new Date().toISOString()
    });
  } catch (e) {
    console.log("active_users upsert failed:", e);
  }

  // heartbeat every 60s
  if (presenceInterval) clearInterval(presenceInterval);
  presenceInterval = setInterval(async () => {
    if (!presenceUserId) return;
    try {
      await supabaseClient.from("active_users").upsert({
        user_id: presenceUserId,
        name,
        last_seen: new Date().toISOString()
      });
    } catch (e) {}
  }, 60000);

  // best-effort cleanup
  window.addEventListener("beforeunload", () => {
    try {
      if (presenceUserId) supabaseClient.from("active_users").delete().eq("user_id", presenceUserId);
    } catch (e) {}
  });
}

async function stopPresence() {
  if (presenceInterval) clearInterval(presenceInterval);
  presenceInterval = null;

  try {
    if (presenceUserId) await supabaseClient.from("active_users").delete().eq("user_id", presenceUserId);
  } catch (e) {}

  presenceUserId = null;
}

async function updateAuthUI() {
  const { data } = await supabaseClient.auth.getSession();
  const loggedIn = !!data?.session;
  const unlocked = loggedIn && isLeagueUnlocked() && !!getStoredName();

  const mainLoginBlock = document.getElementById("mainLoginBlock");
  const logoutBtn = document.getElementById("mainLogoutBtn");
  const activeBtn = document.getElementById("showActiveUsersBtn");
  const resaveBtn = document.getElementById("resaveStatsBtn");
  const syncTag = document.getElementById("syncDataTag");

  if (mainLoginBlock) mainLoginBlock.classList.toggle("hidden", unlocked);
  if (logoutBtn) logoutBtn.classList.toggle("hidden", !loggedIn);
  if (activeBtn) activeBtn.classList.toggle("hidden", !unlocked);
  if (resaveBtn) resaveBtn.classList.toggle("hidden", !unlocked);
  if (syncTag) syncTag.classList.toggle("hidden", !unlocked);

  if (unlocked) {
    startPresence();
    await ensurePostUnlockSetup();
    setSyncButtonEnabled(true);
  } else {
    stopPresence();
    stopRealtime();
    setSyncButtonEnabled(false);
  }
}

async function showActiveUsers() {
  if (!(await requireLogin())) return;
  hideAllScreens();
  document.getElementById("activeUsersScreen").classList.remove("hidden");
  await loadActiveUsers();
}

async function loadActiveUsers() {
  const box = document.getElementById("activeUsersContainer");
  if (!box) return;

  box.innerHTML = '<p style="color:#aaa;">Loading...</p>';

  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data, error } = await supabaseClient
    .from("active_users")
    .select("name,last_seen")
    .gte("last_seen", cutoff)
    .order("name", { ascending: true });

  if (error) {
    box.innerHTML = '<p style="color:#f88;">Could not load active users (table missing or permissions).</p>';
    console.log(error);
    return;
  }

  const names = (data || [])
    .map(r => (r.name || "").trim())
    .filter(Boolean);

  if (!names.length) {
    box.innerHTML = '<p style="color:#aaa;">No one active right now.</p>';
    return;
  }

  box.innerHTML = names.map(n => `<div style="padding:8px;border-bottom:1px solid #333;">${n}</div>`).join("");
}


function showGate(step, msg) {
  const gate = document.getElementById("accessGate");
  gate.classList.remove("hidden");

  // Hide the app UI behind the gate (prevents old menu showing through)
  try { hideAllScreens(); } catch (e) {}

  document.getElementById("gateStepLogin").classList.add("hidden");
  document.getElementById("gateStepCode").classList.add("hidden");
  document.getElementById("gateStepDone").classList.add("hidden");

  const badge = document.getElementById("gateStatusBadge");
  if (msg) document.getElementById("gateMsg").innerText = msg;

  if (step === "login") {
    document.getElementById("gateTitle").innerText = "Login Required";
    document.getElementById("gateStepLogin").classList.remove("hidden");
    // Always show league code entry while login step is visible.
    document.getElementById("gateStepCode").classList.remove("hidden");
    badge.innerText = "Status: Locked (not logged in)";
  } else if (step === "code") {
    document.getElementById("gateTitle").innerText = "League Code Required";
    document.getElementById("gateStepCode").classList.remove("hidden");
    badge.innerText = "Status: Locked (league code not entered)";
  } else if (step === "done") {
    document.getElementById("gateTitle").innerText = "Access Granted";
    document.getElementById("gateWelcomeName").innerText = getStoredName() || "Player";
    document.getElementById("gateStepDone").classList.remove("hidden");
    badge.innerText = "Status: Unlocked";
  } else {
    // fallback
    document.getElementById("gateTitle").innerText = "League Access Required";
    document.getElementById("gateStepLogin").classList.remove("hidden");
    document.getElementById("gateStepCode").classList.remove("hidden");
    badge.innerText = "Status: Locked";
  }

  // Prefill gate email/name from localStorage
  const e = getStoredEmail();
  if (e) document.getElementById("gateLoginEmail").value = e;
  const n = getStoredName();
  if (n) document.getElementById("gateNameInput").value = n;
}
function closeGate() {
  document.getElementById("accessGate").classList.add("hidden");
  showMainMenu();
}

function validateEmailBasic(email) {
  // simple check only
  return /.+@.+\..+/.test(email);
}

function maybeShowNameBox(email) {
  const row = document.getElementById("gateNameRow");
  // show name input after email is entered (your request)
  if (validateEmailBasic(email) && !getStoredName()) row.classList.remove("hidden");
  if (getStoredName()) row.classList.add("hidden");
}

// ===== AUTH GATE (FIXED) =====
async function evaluateAccess() {
  const { data } = await supabaseClient.auth.getSession();
  const session = data?.session;

  // 1) Not logged in -> show email gate
  if (!session) {
    showGate("login", "Enter your email to get a login link.");
    await updateAuthUI();
    return;
  }

  // 2) Logged in but no name saved yet -> keep them on login gate + show name box
  if (!getStoredName()) {
    showGate("login", "You’re logged in — enter your name once to continue.");
    const row = document.getElementById("gateNameRow");
    if (row) row.classList.remove("hidden");
    await updateAuthUI();
    return;
  }

  // 3) Logged in + name, but league code not unlocked -> show code gate
  if (!isLeagueUnlocked()) {
    showGate("code", "Logged in. Now enter the league code.");
    await updateAuthUI();
    return;
  }

  // 4) All good -> unlock app
  document.getElementById("accessGate").classList.add("hidden");
  await updateAuthUI();
  showMainMenu();
}
	
async function submitLeagueCode() {
  const entered = (document.getElementById("gateLeagueCode")?.value || "").trim();
  if (!entered) return alert("Enter the league code.");

  if (entered === String(LEAGUE_CODE).trim()) {
    setLeagueUnlocked(true);
    await updateAuthUI();
    showGate("done", "Access granted. You’ll need the league code each time you open the app.");
} else {
    setLeagueUnlocked(false);
    alert("Incorrect league code.");
  }
}

	let league = { teams: [] };
	let season = { playerStats: {}, teamRecords: {} };
	let game = null;
	let gameHistory = [];
	let lastPlay = null;
	let pendingBattingResult = null;

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
	if (!schedule || typeof schedule !== "object") schedule = { days: [], teamNames: [] };
	if (!Array.isArray(schedule.days)) schedule.days = [];
	if (!Array.isArray(schedule.teamNames)) schedule.teamNames = [];
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
	✅ BALANCED RANDOM SCHEDULE (4 teams, 6 days, 2 games/day)
	- Each pair plays exactly 2 times (double round robin)
	==========================================================*/
	function generateBalancedSchedule4(teams) {
	const names = teams.map(t => t.name);
	
	// randomize initial order (changes matchups)
	shuffleArray(names);
	
	let a = names[0], b = names[1], c = names[2], d = names[3];
	
	// 3 rounds (circle method)
	const rounds = [
	[[a, d], [b, c]],
	[[a, c], [d, b]],
	[[a, b], [c, d]]
	];
	
	// duplicate (play each other twice)
	const doubleRounds = [
	...rounds,
	...rounds.map(r => r.map(g => [g[1], g[0]])) // reverse home/away
	];
	
	// shuffle day order
	shuffleArray(doubleRounds);
	
	return {
	teamNames: teams.map(t => t.name),
	days: doubleRounds.map((games, i) => ({
	day: i + 1,
	games: games.map((g, idx) => ({
	gameNumber: idx + 1,
	away: g[0],
	home: g[1]
	}))
	}))
	};
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
    if (!season || typeof season !== "object") season = { playerStats: {}, teamRecords: {} };
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
		// ✅ ensure new fields exist (older saves won't have them)
		if (!season || typeof season !== "object") season = { playerStats: {}, teamRecords: {} };
		if (!season.playerStats) season.playerStats = {};
		if (!season.teamRecords) season.teamRecords = {};
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
		if (!obj || typeof obj !== "object") return { playerStats: {}, teamRecords: {} };
		if (!obj.playerStats) obj.playerStats = {};
		if (!obj.teamRecords) obj.teamRecords = {};
		return obj;
	}

	function ensureScheduleShape(obj) {
		if (!obj || typeof obj !== "object") return { days: [], teamNames: [] };
		if (!Array.isArray(obj.days)) obj.days = [];
		if (!Array.isArray(obj.teamNames)) obj.teamNames = [];
		return obj;
	}

	function snapshotHasData(seasonObj, scheduleObj) {
  try {
    const ps = seasonObj?.playerStats || {};
    if (ps && Object.keys(ps).length) return true;
  } catch (e) {}

  try {
    const days = scheduleObj?.days || [];
    for (const d of days) {
      for (const g of (d.games || [])) {
        if (g && g.result) return true;
      }
    }
  } catch (e) {}

  return false;
}


	async function fetchSeasonRowFromServer({ quiet = true } = {}) {
		try {
			const { data, error } = await supabaseClient
				.from("season_data")
				.select("season_json,schedule_json,updated_at")
				.eq("league_code", String(LEAGUE_CODE))
				.maybeSingle();

			if (error) throw error;
			return data || null;
		} catch (e) {
			if (!quiet) console.log("fetch season_data failed:", e);
			return null;
		}
	}

	function applyServerSeasonRow(row) {
		if (!row) return;

		suppressAutoSync = true;

		season = ensureSeasonShape(row.season_json);
		schedule = ensureScheduleShape(row.schedule_json);

		// carry server updated_at into local meta
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

		// Refresh screens if visible
		try { update(); } catch (e) {}
		try { if (!document.getElementById("seasonStatsScreen").classList.contains("hidden")) displaySeasonStats(); } catch (e) {}
		try { if (!document.getElementById("scheduleScreen").classList.contains("hidden")) renderScheduleUI(); } catch (e) {}
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
					season = { playerStats: {}, teamRecords: {} };
					schedule = { days: [], teamNames: [] };
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

	// ✅ If this game started from the schedule picker, update that exact entry
	const ref = game?._scheduleRef;
	if (ref && Number.isInteger(ref.dayIndex) && Number.isInteger(ref.gameIndex)) {
		const day = schedule.days[ref.dayIndex];
		const g = day?.games?.[ref.gameIndex];
		if (g) {
			if (g.result) return; // already recorded
			g.result = resultObj;
			saveSchedule();
			return;
		}
	}

	// fallback (old behavior): find first unplayed matching matchup
	for (const day of schedule.days) {
		for (const g of day.games) {
			if (g.result) continue; // already played
			const match =
				(g.away === teamA && g.home === teamB) ||
				(g.away === teamB && g.home === teamA);
			if (!match) continue;

			g.result = resultObj;
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

		// Create records if missing
		getTeamRecord(t1);
		getTeamRecord(t2);

		let resultObj;
		if (s1 === s2) {
			// tie: don't change W/L, but still mark schedule
			resultObj = { type: "tie", team1: t1, team2: t2, score1: s1, score2: s2, playedAt: Date.now() };
		} else {
			const winner = s1 > s2 ? t1 : t2;
			const loser = s1 > s2 ? t2 : t1;
			getTeamRecord(winner).wins += 1;
			getTeamRecord(loser).losses += 1;
			resultObj = {
				type: "win",
				winner,
				loser,
				winnerScore: Math.max(s1, s2),
				loserScore: Math.min(s1, s2),
				playedAt: Date.now()
			};
		}

		saveSeason();
		updateScheduleForCompletedGame(t1, t2, resultObj);
	}

	async function resetSeason() {
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
    try { localStorage.removeItem("wbl_season"); } catch (e) {}
    try { localStorage.removeItem("wbl_schedule"); } catch (e) {}
    try { localStorage.removeItem("wbl_lastSchedule"); } catch (e) {}
    try { localStorage.removeItem("wbl_lastScheduleKey"); } catch (e) {}

    // Reset in-memory structures if they exist
    if (typeof season !== "undefined") {
      season = { teamRecords: {}, playerStats: {}, games: [] };
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

	function initPlayerStats(teamName, playerName) {
		let key = getPlayerKey(teamName, playerName);
		if (!season.playerStats[key]) {
			season.playerStats[key] = {
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
				earnedRunsAllowed: 0
			};
		}
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


function forceRegenerateSchedule() {
const validTeams = getValidTeamsForSchedule();
if (validTeams.length !== 4) {
alert("You need exactly 4 teams with players to generate a schedule.");
return;
}
schedule = generateBalancedSchedule4(validTeams);
saveSchedule();
renderScheduleUI();
}

function renderScheduleUI() {
const container = document.getElementById("scheduleContainer");
container.innerHTML = "";

const validTeams = getValidTeamsForSchedule();

// This schedule feature is for exactly 4 teams
if (validTeams.length !== 4) {
container.innerHTML = `
<div class="card">
	<h3>Need 4 teams to build a season schedule</h3>
	<p style="color:#aaa;">
		You currently have <b>${validTeams.length}</b> team(s) with players.
		Go to Configure Teams and make sure you have exactly 4 teams, each with at least 1 player.
	</p>
</div>
`;
return;
}

const teamNames = validTeams.map(t => t.name).sort();
const scheduleNames = (schedule?.teamNames || []).slice().sort();

const needsNew =
!schedule?.days?.length ||
schedule.days.length !== 6 ||
scheduleNames.join("|") !== teamNames.join("|");

if (needsNew) {
schedule = generateBalancedSchedule4(validTeams);
saveSchedule();
}

schedule.days.forEach(dayObj => {
const dayCard = document.createElement("div");
dayCard.className = "card";

const rows = dayObj.games.map(g => {
	const awayRec = formatTeamRecord(g.away);
	const homeRec = formatTeamRecord(g.home);

	let awayTag = "";
	let homeTag = "";
	let scoreTag = "";

	if (g.result) {
		if (g.result.type === "tie") {
			awayTag = " 🤝 T";
			homeTag = " 🤝 T";
			scoreTag = ` — ${g.result.score1}-${g.result.score2}`;
		} else {
			awayTag = (g.result.winner === g.away) ? " ✅ W" : " ❌ L";
			homeTag = (g.result.winner === g.home) ? " ✅ W" : " ❌ L";
			scoreTag = ` — ${g.result.winnerScore}-${g.result.loserScore}`;
		}
	}

	return `
<tr>
	<td>Game ${g.gameNumber}</td>
	<td>
		<b>${g.away}</b> <span style="color:#aaa;">(${awayRec})</span>${awayTag}
		&nbsp;vs&nbsp;
		<b>${g.home}</b> <span style="color:#aaa;">(${homeRec})</span>${homeTag}
		<span style="color:#aaa;">${scoreTag}</span>
	</td>
</tr>
`;
}).join("");

dayCard.innerHTML = `
<div class="section-header">Day ${dayObj.day}</div>
<table class="stats-table">
	<tr>
		<th>Game</th>
		<th>Matchup</th>
	</tr>
	${rows}
</table>
`;

container.appendChild(dayCard);
});
}

	// NAVIGATION FUNCTIONS
	function showMainMenu() {
		hideAllScreens();
		document.getElementById("mainMenu").classList.remove("hidden");
		// ✅ ADD THIS to hideAllScreens()
	}

	function showTeamConfig() {
		hideAllScreens();
		document.getElementById("teamConfigScreen").classList.remove("hidden");
		update();
	}

function showGameSetup() {
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
}


	function showGame() {
		hideAllScreens();
		document.getElementById("gameScreen").classList.remove("hidden");
	}

	function showGameOver() {
		hideAllScreens();
		document.getElementById("gameOverScreen").classList.remove("hidden");
	}

	function showSeasonStats() {
		hideAllScreens();
		document.getElementById("seasonStatsScreen").classList.remove("hidden");
		displaySeasonStats();
	}

	function hideAllScreens() {
		document.getElementById("mainMenu").classList.add("hidden");
		document.getElementById("teamConfigScreen").classList.add("hidden");
		document.getElementById("gameSetupScreen").classList.add("hidden");
		document.getElementById("gameScreen").classList.add("hidden");
		document.getElementById("gameOverScreen").classList.add("hidden");
		document.getElementById("seasonStatsScreen").classList.add("hidden");
document.getElementById("scheduleScreen").classList.add("hidden");

	
document.getElementById("activeUsersScreen").classList.add("hidden");
}

	// TEAM MANAGEMENT FUNCTIONS
async function addTeam() {
  if (!(await requireLogin())) return;

  // ✅ Make sure we’re checking the latest team list before enforcing limit
  try { await load(); } catch (e) {}

  const name = (document.getElementById("teamName")?.value || "").trim();
  if (!name) return;

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

  const player = (document.getElementById("playerName")?.value || "").trim();
  if (!player) return;

  const selectedTeamName = league?.teams?.[teamIndex]?.name;
  if (!selectedTeamName) return alert("Select a team");

  // ✅ Refresh latest teams/players before enforcing limit
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

		save();
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
	}

function ensureScheduleUpToDateForSelection() {
	const validTeams = getValidTeamsForSchedule();
	if (validTeams.length !== 4) {
		return { ok: false, reason: "Schedule requires exactly 4 teams with players." };
	}

	// Same “needsNew” logic your schedule screen uses :contentReference[oaicite:5]{index=5}
	const teamNames = validTeams.map(t => t.name).sort();
	const scheduleNames = (schedule?.teamNames || []).slice().sort();

	const needsNew =
		!schedule?.days?.length ||
		schedule.days.length !== 6 ||
		scheduleNames.join("|") !== teamNames.join("|");

	if (needsNew) {
		schedule = generateBalancedSchedule4(validTeams);
		saveSchedule();
	}

	return { ok: true, validTeams };
}

function populateScheduleDaySelect() {
	const daySelect = document.getElementById("scheduleDaySelect");
	if (!daySelect) return;

	daySelect.innerHTML = "";

	(schedule.days || []).forEach((dayObj, idx) => {
		const unplayed = (dayObj.games || []).filter(g => !g.result).length;
		const opt = document.createElement("option");
		opt.value = String(idx);
		opt.text = `Day ${dayObj.day}` + (unplayed === 0 ? " (all recorded)" : "");
		daySelect.appendChild(opt);
	});

	// default to first day with an unplayed game
	const firstOpen = (schedule.days || []).findIndex(d => (d.games || []).some(g => !g.result));
	daySelect.value = String(firstOpen >= 0 ? firstOpen : 0);

	populateScheduleGameSelect();
}

function populateScheduleGameSelect() {
	const daySelect = document.getElementById("scheduleDaySelect");
	const gameSelect = document.getElementById("scheduleGameSelect");
	const hint = document.getElementById("schedulePickHint");
	const btn = document.getElementById("startScheduledGameBtn");

	if (!daySelect || !gameSelect) return;

	const dayIndex = parseInt(daySelect.value, 10);
	const dayObj = schedule?.days?.[dayIndex];

	gameSelect.innerHTML = "";

	if (!dayObj || !Array.isArray(dayObj.games)) {
		if (hint) hint.innerText = "No schedule found.";
		if (btn) btn.disabled = true;
		gameSelect.disabled = true;
		return;
	}

	let added = 0;

	dayObj.games.forEach((g, gameIndex) => {
		if (g.result) return; // already recorded
		const opt = document.createElement("option");
		opt.value = `${dayIndex}|${gameIndex}`;
		opt.text = `Game ${g.gameNumber}: ${g.away} vs ${g.home}`;
		gameSelect.appendChild(opt);
		added++;
	});

	if (added === 0) {
		const opt = document.createElement("option");
		opt.value = "";
		opt.text = "No available games (already recorded)";
		gameSelect.appendChild(opt);
		gameSelect.disabled = true;
		if (btn) btn.disabled = true;
		if (hint) hint.innerText = "All games for this day are already recorded.";
	} else {
		gameSelect.disabled = false;
		if (btn) btn.disabled = false;
		if (hint) hint.innerText = "";
	}
}

function startSelectedScheduledGame() {
	const gameSelect = document.getElementById("scheduleGameSelect");
	if (!gameSelect || !gameSelect.value) return;

	const [dayIndexStr, gameIndexStr] = gameSelect.value.split("|");
	const dayIndex = parseInt(dayIndexStr, 10);
	const gameIndex = parseInt(gameIndexStr, 10);

	const dayObj = schedule?.days?.[dayIndex];
	const g = dayObj?.games?.[gameIndex];
	if (!g) return alert("Could not find that scheduled game.");
	if (g.result) {
		alert("That game was already recorded.");
		populateScheduleGameSelect();
		return;
	}

	const validTeams = league.teams.filter(t => t.players.length > 0);
	const t1 = validTeams.find(t => t.name === g.away);
	const t2 = validTeams.find(t => t.name === g.home);

	if (!t1 || !t2) {
		alert("Could not match schedule teams to your team list.");
		return;
	}

	startGameWithTeams(t1, t2, { dayIndex, gameIndex });
}

function startGameWithTeams(t1, t2, scheduleRef = null) {
	t1.players.forEach(p => initPlayerStats(t1.name, p));
	t2.players.forEach(p => initPlayerStats(t2.name, p));

	let batting = Math.random() > 0.5 ? t1 : t2;
	let fielding = batting === t1 ? t2 : t1;

	game = {
		team1: t1,
		team2: t2,
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

		// ✅ this is what ties the game to the exact schedule entry
		_scheduleRef: scheduleRef
	};

	[...t1.players, ...t2.players].forEach(p => {
		let teamName = t1.players.includes(p) ? t1.name : t2.name;
		let key = getPlayerKey(teamName, p);
		game.gameStats[key] = {
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
			earnedRunsAllowed: 0
		};
	});

	gameHistory = [];
	pendingBattingResult = null;
	document.getElementById("undoButton").disabled = true;

	showGame();
	updatePitcherSelect();
	updateGameScreen();
}

function startGame() {
	let validTeams = league.teams.filter(t => t.players.length > 0);

	let team1Index = parseInt(document.getElementById("team1Select").value);
	let team2Index = parseInt(document.getElementById("team2Select").value);

	if (team1Index === team2Index) {
		alert("Please select two different teams!");
		return;
	}

	let t1 = validTeams[team1Index];
	let t2 = validTeams[team2Index];

	startGameWithTeams(t1, t2, null);
}


	function endGameEarly() {
		if (confirm("End this game early? Stats will be saved up to this point.")) {
			saveGameStats();
			displayGameOver();
		}
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
			
			if (pendingBattingResult) {
				document.getElementById("battingSection").classList.add("disabled");
				document.getElementById("pitchingSection").classList.remove("disabled");
			} else {
				document.getElementById("battingSection").classList.remove("disabled");
				document.getElementById("pitchingSection").classList.add("disabled");
			}
			
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
		document.getElementById("batterText").innerText = "Up: " + player;

		updateBasesDisplay();
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

function getCurrentPitcherKey() {
// pitcher is always from the fielding team
let pitcherIndex = parseInt(document.getElementById("pitcherSelect").value);
let pitcher = game.fielding.players[pitcherIndex];
return getPlayerKey(game.fielding.name, pitcher);
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
if (!game) return;
// Double play only allowed when 2+ runners are on base
if (result === 'doublePlay' && countBaseRunners() < 2) {
  showNotification('Need 2+ runners on base for a double play', 1500);
  return;
}

let currentBatter = game.batting.players[game.batterIndex];
let batterKey = getPlayerKey(game.batting.name, currentBatter);

pendingBattingResult = {
result: result,
batter: currentBatter,
batterKey: batterKey
};

// Save "who was fielding" at the moment of contact (important if inning flips)
lastPlay = {
battingTeamName: game.batting.name,
fieldingTeamName: game.fielding.name,
pitcherIndex: parseInt(document.getElementById("pitcherSelect").value),
batterKey: batterKey,
batterName: currentBatter,
result: result
};

// Automatically process as NO ERROR
recordPitchingResult("clean");
}
function showErrorPicker() {
if (!lastPlay) {
alert("No play to assign an error to yet.");
return;
}

// Find the fielding team from the last play
let fieldingTeam = league.teams.find(t => t.name === lastPlay.fieldingTeamName);
if (!fieldingTeam) {
alert("Could not find the fielding team for the last play.");
return;
}

let sel = document.getElementById("errorPlayerSelect");
sel.innerHTML = "";

fieldingTeam.players.forEach((p, i) => {
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

  let fieldingTeam = league.teams.find(t => t.name === lastPlay.fieldingTeamName);
  let fielderName = fieldingTeam.players[idx];
  let fielderKey = getPlayerKey(fieldingTeam.name, fielderName);

  // game + season error
  if (game?.gameStats?.[fielderKey]) game.gameStats[fielderKey].fieldingErrors++;
  if (season.playerStats[fielderKey]) {
    season.playerStats[fielderKey].fieldingErrors++;
    saveSeason();
  }

  // mark batter as reachedOnError on the base they’re currently on
  const batterName = lastPlay.batterName;
  ["first", "second", "third"].forEach(base => {
    if (game.bases[base] && game.bases[base].player === batterName) {
      game.bases[base].reachedOnError = true;
    }
  });

  // undo hit credit if you want (optional)
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
saveGameStats();
displayGameOver();
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
let pitcherKey = getPlayerKey(game.fielding.name, pitcher);

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
// Double play: 2 outs, one runner erased, and no advancement/scores
const runnerCount = countBaseRunners();
if (runnerCount < 2) {
  // safety (UI already blocks)
  showNotification("Need 2+ runners for a double play", 1500);
} else {
  // batter out + one runner out
  game.outs += 2;
  game.gameStats[batterKey].outs++;
  game.gameStats[pitcherKey].pitchOuts += 2;

  // remove a forced runner (priority: 1st, then 2nd, then 3rd)
  let removedBase = game.bases.first ? 'first' : (game.bases.second ? 'second' : 'third');
  let removedRunner = game.bases[removedBase];
  game.bases[removedBase] = null;

  // no runs / RBIs on a double play
  runs = 0; earnedRuns = 0; rbis = 0;

  showNotification("Double play!" + (removedRunner?.player ? (" (" + removedRunner.player + " out)") : ""), 1500);
}

} else if (result === "single") {
let res = advanceRunners(1, currentBatter, reachedOnError);
runs = res.runs;
earnedRuns = res.earnedRuns;
rbis = res.rbis;

// ✅ if reached on error, do NOT count a hit
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
let fielderKey = getPlayerKey(game.fielding.name, fielder);
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
	document.getElementById("battingSection").classList.remove("disabled");
	document.getElementById("pitchingSection").classList.add("disabled");
	updateGameScreen();
	return;
	}

	// ✅ Normal end of half-inning on 2 outs
	if (game.outs >= 2) {
	endHalfInning(pitcherKey, null);
	pendingBattingResult = null;
	document.getElementById("battingSection").classList.remove("disabled");
	document.getElementById("pitchingSection").classList.add("disabled");
	updateGameScreen();
	return;
	}

	// Reset for next play
	pendingBattingResult = null;
	document.getElementById("battingSection").classList.remove("disabled");
	document.getElementById("pitchingSection").classList.add("disabled");
	updateGameScreen();
	}
	function saveGameStats() {
		for (let key in game.gameStats) {
			let gameStats = game.gameStats[key];
			let seasonStats = season.playerStats[key];

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
			const key = getPlayerKey(team.name, player);
			let stats = isSeason ? season.playerStats[key] : game?.gameStats?.[key];

			// safety: ensure row exists
			if (!stats) {
				stats = initPlayerStats(team.name, player);
				if (isSeason) season.playerStats[key] = stats;
				else if (game?.gameStats) game.gameStats[key] = stats;
			}

			const avg = stats.atBats > 0 ? (stats.hits / stats.atBats).toFixed(3) : ".000";

			const values = [
				player,
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
			const key = getPlayerKey(team.name, player);
			let stats = isSeason ? season.playerStats[key] : game?.gameStats?.[key];

			if (!stats) {
				stats = initPlayerStats(team.name, player);
				if (isSeason) season.playerStats[key] = stats;
				else if (game?.gameStats) game.gameStats[key] = stats;
			}

			const era = stats.inningsPitched > 0
				? ((stats.earnedRunsAllowed / stats.inningsPitched) * 3).toFixed(2)
				: "-";

			const kPer3 = stats.inningsPitched > 0
				? ((stats.pitchStrikeouts / stats.inningsPitched) * 3).toFixed(2)
				: "-";

			const values = [
				player,
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

	function displaySeasonStats() {
		let container = document.getElementById("seasonStatsContainer");
		container.innerHTML = "";

		if (Object.keys(season.playerStats).length === 0) {
			container.innerHTML = "<div class='card'><p>No season statistics yet. Play some games!</p></div>";
			return;
		}

		let teamGroups = {};
		league.teams.forEach(team => {
			teamGroups[team.name] = [];
			team.players.forEach(player => {
				let key = getPlayerKey(team.name, player);
				if (season.playerStats[key]) {
					teamGroups[team.name].push(player);
				}
			});
		});

		for (let teamName in teamGroups) {
			if (teamGroups[teamName].length === 0) continue;

			let team = league.teams.find(t => t.name === teamName);
			
			let battingCard = document.createElement("div");
			battingCard.className = "card";
			battingCard.innerHTML = `<h3>${teamName} (${formatTeamRecord(teamName)}) - Season Batting Statistics</h3>`;
			let battingTable = createBattingStatsTable(team, true);
			battingCard.appendChild(battingTable);
			container.appendChild(battingCard);

			let pitchingCard = document.createElement("div");
			pitchingCard.className = "card";
			pitchingCard.innerHTML = `<h3>${teamName} (${formatTeamRecord(teamName)}) - Season Pitching Statistics</h3>`;
			let pitchingTable = createPitchingStatsTable(team, true);
			pitchingCard.appendChild(pitchingTable);
			container.appendChild(pitchingCard);
		}
	}

	function showSchedule() {
	  hideAllScreens();
	  document.getElementById("scheduleScreen").classList.remove("hidden");
	  renderScheduleUI();
	}
	
async function sendLoginLink() {
  // main menu fallback (kept for convenience)
  const email = (document.getElementById("loginEmail")?.value || "").trim();
  if (!email) return alert("Enter an email");
  if (!validateEmailBasic(email)) return alert("Enter a valid email");

  // store email
  setStoredEmail(email);

  const emailRedirectTo = buildEmailRedirectUrl();

  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo
    }
  });

  if (error) return alert(error.message);
  alert("Check your email for the login link!");
}

async function sendLoginLinkFromGate() {
  const email = (document.getElementById("gateLoginEmail")?.value || "").trim();
  const name = (document.getElementById("gateNameInput")?.value || "").trim();

  if (!email) return alert("Enter an email");
  if (!validateEmailBasic(email)) return alert("Enter a valid email");

  // After user enters their email, require name (your request)
  if (!getStoredName() && !name) {
    document.getElementById("gateNameRow").classList.remove("hidden");
    return alert("Please enter your name.");
  }

  if (name) setStoredName(name);
  setStoredEmail(email);

  const emailRedirectTo = buildEmailRedirectUrl();

  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo }
  });

  if (error) return alert(error.message);
  alert("Check your email for the login link!");
}



async function logout() {
  await stopPresence();
  await supabaseClient.auth.signOut();
  setLeagueUnlocked(false);
  alert("Logged out");
  // lock back down
  await evaluateAccess();
}

	async function supabaseConnectionTest() {
  console.log("Supabase URL:", SUPABASE_URL);

  // This just checks that Supabase responds (no tables required)
  const { data, error } = await supabaseClient.from("_dummy_does_not_exist").select("*").limit(1);

  // If connected, you'll usually get an error about the table not existing (THAT'S OK)
  if (error) {
    console.log("Supabase responded ✅ (expected error):", error.message);
    alert("Supabase connected ✅ (it responded). Next: add real tables + save/load code.");
  } else {
    console.log("Unexpected data:", data);
    alert("Supabase connected ✅");
  }
}

	async function requireLogin() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) {
    alert("You must be logged in. Use your email to get a login link.");
    showGate("login");
    return false;
  }
  if (!getStoredName()) {
    alert("Please enter your name to continue.");
    showGate("login");
    document.getElementById("gateNameRow").classList.remove("hidden");
    return false;
  }
  if (!isLeagueUnlocked()) {
    alert("League code required to use the app.");
    showGate("code");
    return false;
  }
  return true;
}

function showEmailScreen() {
  hideAllScreens();
  document.getElementById("emailScreen").classList.remove("hidden");
}

function showLeagueCodeScreen() {
  hideAllScreens();
  document.getElementById("leagueCodeScreen").classList.remove("hidden");
}

function buildEmailRedirectUrl() {
  const redirectUrl = new URL(location.pathname || "/", location.origin);
  // Keep explicit post-login flags for boot/access logic.
  redirectUrl.searchParams.set("postAuth", "1");
  redirectUrl.searchParams.set("src", "email");
  return redirectUrl.toString();
}


// Initialize
// Initialize

(async function init() {

console.log("INIT STARTED");
window.__INIT_STARTED = true;

  // Always start hidden until boot finishes (prevents UI flash / partial state)
  try { hideAllScreens(); } catch (e) {}

  // Ensure Supabase is initialized before any startup logic runs.
  if (!(await initializeSupabaseClient())) return;

  try {
    const safeInitStep = async (label, fn) => {
      try {
        await fn();
      } catch (e) {
        console.warn("Non-fatal init step failed:", label, e);
      }
    };

    // Gate email typing -> show name box after email entered
    const gateEmailEl = document.getElementById("gateLoginEmail");
    if (gateEmailEl) {
      gateEmailEl.addEventListener("input", (e) =>
        maybeShowNameBox((e.target.value || "").trim())
      );
    }

    // Keep main menu email typing behavior too (optional)
    const mainEmailEl = document.getElementById("loginEmail");
    if (mainEmailEl) {
      mainEmailEl.addEventListener("change", (e) => {
        const email = (e.target.value || "").trim();
        if (email) setStoredEmail(email);
        if (email && !getStoredName()) showGate("login");
      });
    }

    // React to login/logout automatically
    supabaseClient.auth.onAuthStateChange(async (_event, _session) => {
      await evaluateAccess();
      await updateAuthUI();
    });

    await safeInitStep("load teams", async () => { await load(); });
    await safeInitStep("load schedule", async () => { loadSchedule(); });
    await safeInitStep("load season", async () => { loadSeason(); });
    await safeInitStep("sync team records", async () => { syncTeamRecordsWithLeague(); });
await safeInitStep("save season", async () => {
  saveSeason({ skipServerSync: true, touchMeta: false });
});
    await safeInitStep("update UI", async () => { update(); });

    await safeInitStep("evaluate access", async () => { await evaluateAccess(); });
    await safeInitStep("update auth UI", async () => { await updateAuthUI(); });

    hideFatalError();
  } catch (err) {
    console.error("INIT CRASHED:", err);

    showFatalError(
      "Startup error",
      "The app hit an error while starting.",
      (err && (err.stack || err.message)) ? (err.stack || err.message) : String(err)
    );
  }
})();

	
