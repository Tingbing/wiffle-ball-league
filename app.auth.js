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

	
