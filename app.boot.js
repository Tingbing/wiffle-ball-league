const SUPABASE_URL = "https://hunqtklytyorvmztgpqt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1bnF0a2x5dHlvcnZtenRncHF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NDc0MzcsImV4cCI6MjA4NjQyMzQzN30.ONu6M24_vhaeN-YlqKr-mtNjRuLLMfMeMfdTDMUllfA";

const LEAGUE_CODE = "6767"; // Internal identifier, not a password.
let SUPABASE_READY = true;
function isLeagueUnlocked() { return true; }
function getStoredName() { return "Recorder"; }
(async function boot() {
  hideAllScreens(); document.getElementById("mainMenu").classList.remove("hidden");
  try {
    archiveLegacyLocalData();
    loadSeason(); loadSchedule();
    league=readJsonStorage("wiggleLeague",{teams:[]});
    update();
    await initializeRecordingIdentity();
    await refreshLeagueFromServer();
    await restoreRecordingRecovery();
    startAppPolling();
  } catch(error) { setConnectionMessage("Cannot connect. Viewing cached data; recording is paused. " + error.message); startAppPolling(); }
})();
