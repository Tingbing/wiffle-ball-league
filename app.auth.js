const SUPABASE_URL = "https://hunqtklytyorvmztgpqt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1bnF0a2x5dHlvcnZtenRncHF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NDc0MzcsImV4cCI6MjA4NjQyMzQzN30.ONu6M24_vhaeN-YlqKr-mtNjRuLLMfMeMfdTDMUllfA";
// 🔁 Bump this each time you publish (any new value works)
	 
const BUILD_LABEL = location.pathname.split("/").pop(); // shows app.v2026-...html

let supabaseClient = null;
let SUPABASE_READY = false;

function showFatalError(title, msg, details) {
  console.trace("showFatalError called", { title, msg, details });
  try { hideAllScreens(); } catch (e) {}
  try { document.getElementById("accessGate")?.classList.add("hidden"); } catch (e) {}

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

const MAX_TEAMS = 5;
const MAX_PLAYERS_PER_TEAM = 2;

/* ================================
   ✅ LEAGUE ACCESS SETTINGS
   - Change LEAGUE_CODE to your secret
==================================*/
const LEAGUE_CODE = "6767"; // <-- IMPORTANT: change this

// ✅ No device memory (no localStorage for name/email)
let CURRENT_EMAIL = "";

function getStoredName() {
  // Keep this function name because other code calls it,
  // but now it returns the CURRENT session email (not stored on device).
  return (CURRENT_EMAIL || "").trim();
}
function setStoredName(_name) {
  // no-op
}
function getStoredEmail() {
  // no prefill, no storage
  return "";
}
function setStoredEmail(_email) {
  // no-op
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
	
const email = (session.user.email || "unknown@email").trim();
CURRENT_EMAIL = email;

  presenceUserId = userId;

  // upsert on load
  try {
    await supabaseClient.from("active_users").upsert({
      user_id: userId,
    name: email,
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
  name: CURRENT_EMAIL || email,
  last_seen: new Date().toISOString()
}, { onConflict: "user_id" });
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
CURRENT_EMAIL = (data?.session?.user?.email || "").trim();
const unlocked = loggedIn && isLeagueUnlocked();

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
  const gateTitle = document.getElementById("gateTitle");
  const gateMsg = document.getElementById("gateMsg");
  const badge = document.getElementById("gateStatusBadge");

  const loginStep = document.getElementById("gateStepLogin");
  const codeStep = document.getElementById("gateStepCode");
  const doneStep = document.getElementById("gateStepDone");
  const nameRow = document.getElementById("gateNameRow");

  gate.classList.remove("hidden");

  // Hide app behind the gate
  try { hideAllScreens(); } catch (e) {}

  // HARD RESET: hide every step first
  if (loginStep) loginStep.classList.add("hidden");
  if (codeStep) codeStep.classList.add("hidden");
  if (doneStep) doneStep.classList.add("hidden");
  if (nameRow) nameRow.classList.add("hidden");

  if (gateMsg) {
    gateMsg.innerText = msg || "To use this app, you must log in and enter the league code.";
  }

  // Default to login if anything unexpected happens
  if (step !== "login" && step !== "code" && step !== "done") {
    step = "login";
  }

  if (step === "login") {
    if (gateTitle) gateTitle.innerText = "Login Required";
    if (badge) badge.innerText = "Status: Locked (not logged in)";
    if (loginStep) loginStep.classList.remove("hidden");

    const emailBox = document.getElementById("gateLoginEmail");
    if (emailBox) emailBox.focus();
    return;
  }

  if (step === "code") {
    if (gateTitle) gateTitle.innerText = "League Code Required";
    if (badge) badge.innerText = "Status: Locked (league code not entered)";
    if (codeStep) codeStep.classList.remove("hidden");

    const codeBox = document.getElementById("gateLeagueCode");
    if (codeBox) {
      codeBox.value = "";
      codeBox.focus();
    }
    return;
  }

  if (step === "done") {
    if (gateTitle) gateTitle.innerText = "Access Granted";
    if (badge) badge.innerText = "Status: Unlocked";
    document.getElementById("gateWelcomeName").innerText = (CURRENT_EMAIL || "Player");
    if (doneStep) doneStep.classList.remove("hidden");
  }
}

async function finishAccessGrant() {
  try { clearAuthBootFlagsFromUrl(); } catch (e) {}
  document.getElementById("accessGate").classList.add("hidden");
  setPublicViewOnlyMode(false);
  showMainMenu();
  try { await maybeOfferLiveGameResume(); } catch (e) { console.warn("resume prompt failed:", e); }
}

function refreshVisibleReadOnlyScreens() {
  try {
    const seasonStatsScreen = document.getElementById("seasonStatsScreen");
    const scheduleScreen = document.getElementById("scheduleScreen");
    const rankingsScreen = document.getElementById("rankingsScreen");
    const pastGameLogScreen = document.getElementById("pastGameLogScreen");

    if (seasonStatsScreen && !seasonStatsScreen.classList.contains("hidden")) displaySeasonStats();
    if (scheduleScreen && !scheduleScreen.classList.contains("hidden")) renderScheduleUI();
    if (rankingsScreen && !rankingsScreen.classList.contains("hidden")) displayRankings();
    if (pastGameLogScreen && !pastGameLogScreen.classList.contains("hidden")) displayPastGameLog();
  } catch (e) {
    console.warn("visible screen refresh failed:", e);
  }
}

function refreshPublicViewInBackground() {
  setTimeout(async () => {
    try {
      await refreshPublicViewData({ quiet: true });
      refreshVisibleReadOnlyScreens();
    } catch (e) {
      console.warn("public view refresh failed:", e);
    }
  }, 0);
}

async function closeGate() {
  await finishAccessGrant();
}

function validateEmailBasic(email) {
  // simple check only
  return /.+@.+\..+/.test(email);
}

function maybeShowNameBox(_email) {
  // Name entry disabled (email-only login)
  return;
}

function hasPostAuthBootFlag() {
  try {
    const url = new URL(location.href);
    return url.searchParams.get("postAuth") === "1" || url.searchParams.get("src") === "email";
  } catch (e) {
    return false;
  }
}

function clearAuthBootFlagsFromUrl() {
  try {
    const url = new URL(location.href);
    const hadFlags = url.searchParams.has("postAuth") || url.searchParams.has("src");
    url.searchParams.delete("postAuth");
    url.searchParams.delete("src");

    if (hadFlags) {
      const nextUrl =
        url.pathname +
        (url.search ? url.search : "") +
        (url.hash ? url.hash : "");
      history.replaceState({}, document.title, nextUrl);
    }
  } catch (e) {}
}

async function getSessionSafe({ timeoutMs = 2000 } = {}) {
  if (!SUPABASE_READY || !supabaseClient) {
    const ok = await initializeSupabaseClient();
    if (!ok || !supabaseClient) {
      return { ready: false, session: null, timedOut: false };
    }
  }

  try {
    const result = await Promise.race([
      supabaseClient.auth.getSession(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("session-timeout")), timeoutMs))
    ]);

    return {
      ready: true,
      session: result?.data?.session || null,
      timedOut: false
    };
  } catch (e) {
    console.warn("getSessionSafe failed:", e);
    return {
      ready: true,
      session: null,
      timedOut: true,
      error: e
    };
  }
}

async function beginFullAccessFlow() {
  const authState = await getSessionSafe({ timeoutMs: 2000 });

  if (!authState.ready) {
    alert("Login is still starting up. Please wait a second and tap again.");
    return false;
  }

  const session = authState.session;
  CURRENT_EMAIL = "";

  // Always require email first before league code.
  // If a remembered Supabase session exists, clear it now so the user must
  // go through the email step again.
  if (session) {
    try {
      await supabaseClient.auth.signOut();
    } catch (e) {
      console.warn("Could not clear remembered session before login flow:", e);
    }
  }

  setLeagueUnlocked(false);
  setPublicViewOnlyMode(true);

  const gateEmailEl = document.getElementById("gateLoginEmail");
  if (gateEmailEl) gateEmailEl.value = "";

  showGate("login", "Sign in with your email for full league access.");
  try { await updateAuthUI(); } catch (e) {}
  return false;
}

async function evaluateAccess() {
  const { data } = await supabaseClient.auth.getSession();
  const session = data?.session;

  CURRENT_EMAIL = (session?.user?.email || "").trim();

  if (!session) {
    setLeagueUnlocked(false);
    setPublicViewOnlyMode(true);
    document.getElementById("accessGate").classList.add("hidden");
    clearAuthBootFlagsFromUrl();
    showPublicMenu();
    await updateAuthUI();
    refreshPublicViewInBackground();
    return;
  }

  // If the user has just returned from the email magic link,
  // continue the access flow instead of dumping them back to public mode.
  if (hasPostAuthBootFlag()) {
    setPublicViewOnlyMode(false);

    if (!isLeagueUnlocked()) {
      showGate("code", "Logged in. Now enter the league code.");
      await updateAuthUI();
      return;
    }

    await finishAccessGrant();
    await updateAuthUI();
    return;
  }

  // Normal boot behavior:
  // always land on the public-first screen, even if this browser
  // still has a remembered Supabase session from earlier.
  setPublicViewOnlyMode(true);
  document.getElementById("accessGate").classList.add("hidden");
  showPublicMenu();
  await updateAuthUI();
  refreshPublicViewInBackground();
}
	
async function submitLeagueCode() {
  const entered = (document.getElementById("gateLeagueCode")?.value || "").trim();
  if (!entered) return alert("Enter the league code.");

  if (entered !== String(LEAGUE_CODE).trim()) {
    setLeagueUnlocked(false);
    alert("Incorrect league code.");
    return;
  }

  setLeagueUnlocked(true);

  // Go straight into the unlocked flow so resume can run immediately.
  await finishAccessGrant();
  await updateAuthUI();
}


async function sendLoginLink() {
  // main menu fallback (kept for convenience)
  const email = (document.getElementById("loginEmail")?.value || "").trim();
  if (!email) return alert("Enter an email");
  if (!validateEmailBasic(email)) return alert("Enter a valid email");

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
	
  if (!email) return alert("Enter an email");
  if (!validateEmailBasic(email)) return alert("Enter a valid email");

  const emailRedirectTo = buildEmailRedirectUrl();

  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo }
  });

  if (error) return alert(error.message);
  alert("Check your email for the login link!");
}

async function logout() {
  try { await stopPresence(); } catch (e) {}
  try { stopRealtime(); } catch (e) {}

  try {
    await supabaseClient.auth.signOut();
  } catch (e) {
    alert("Could not log out.");
    return;
  }

  setLeagueUnlocked(false);
  CURRENT_EMAIL = "";

  try {
    localStorage.removeItem("wbl_userName");
    localStorage.removeItem("wbl_userEmail");
    localStorage.removeItem("wbl_leagueOk");
  } catch (e) {}

  try {
    const gateEmail = document.getElementById("gateLoginEmail");
    const gateCode = document.getElementById("gateLeagueCode");
    const mainEmail = document.getElementById("loginEmail");

    if (gateEmail) gateEmail.value = "";
    if (gateCode) gateCode.value = "";
    if (mainEmail) mainEmail.value = "";
  } catch (e) {}

  try {
    history.replaceState({}, document.title, location.pathname);
  } catch (e) {}

  hideAllScreens();
  document.getElementById("accessGate").classList.add("hidden");
  setPublicViewOnlyMode(true);
  try { await refreshPublicViewData({ quiet: true }); } catch (e) {}
  showPublicMenu();
  await updateAuthUI();
}

window.logout = logout;

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

  // Force a safe public-first UI immediately,
  // before any async startup work can stall.
  try { hideAllScreens(); } catch (e) {}
  try { document.getElementById("accessGate")?.classList.add("hidden"); } catch (e) {}
  try { setPublicViewOnlyMode(true); } catch (e) {}
  try { showPublicMenu(); } catch (e) {}

  // Ensure Supabase is initialized before any protected startup logic runs.
  if (!(await initializeSupabaseClient())) return;
	// ✅ wipe any old remembered fields from older versions
try {
  localStorage.removeItem("wbl_userName");
  localStorage.removeItem("wbl_userEmail");
  localStorage.removeItem("wbl_leagueOk");
} catch (e) {}

  try {
    const safeInitStep = async (label, fn) => {
      try {
        await fn();
      } catch (e) {
        console.warn("Non-fatal init step failed:", label, e);
      }
    };

    // Keep main menu email typing behavior too (optional)
	  const mainLogoBtn = document.getElementById("mainLogoBtn");
if (mainLogoBtn && !mainLogoBtn.dataset.wired) {
  mainLogoBtn.dataset.wired = "1";
  mainLogoBtn.addEventListener("click", handleLogoClick);
}

const mainLogoutBtn = document.getElementById("mainLogoutBtn");
if (mainLogoutBtn && !mainLogoutBtn.dataset.wired) {
  mainLogoutBtn.dataset.wired = "1";
  mainLogoutBtn.addEventListener("click", logout);
}
const mainEmailEl = document.getElementById("loginEmail");
if (mainEmailEl && !mainEmailEl.dataset.wired) {
  mainEmailEl.dataset.wired = "1";
  mainEmailEl.addEventListener("change", () => {
    const email = (mainEmailEl.value || "").trim();

    // Keep the gate email box in sync for convenience,
    // but do NOT force-open the login gate from a field change.
    const gateEmailEl = document.getElementById("gateLoginEmail");
    if (gateEmailEl && email && !gateEmailEl.value) {
      gateEmailEl.value = email;
    }
  });
}

    // React to login/logout automatically
    supabaseClient.auth.onAuthStateChange(async (_event, _session) => {
      await evaluateAccess();
      await updateAuthUI();
    });

    await safeInitStep("load schedule", async () => { loadSchedule(); });
    await safeInitStep("load season", async () => { loadSeason(); });
    await safeInitStep("evaluate access", async () => { await evaluateAccess(); });
    await safeInitStep("update auth UI", async () => { await updateAuthUI(); });

    await safeInitStep("load teams", async () => { await load(); });
    await safeInitStep("sync team records", async () => { syncTeamRecordsWithLeague(); });
    await safeInitStep("save season", async () => {
      saveSeason({ skipServerSync: true, touchMeta: false });
    });
    await safeInitStep("update UI", async () => { update(); });
    await safeInitStep("refresh visible screens", async () => { refreshVisibleReadOnlyScreens(); });

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

	
