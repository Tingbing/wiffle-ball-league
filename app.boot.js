const SUPABASE_URL = "https://hunqtklytyorvmztgpqt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1bnF0a2x5dHlvcnZtenRncHF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NDc0MzcsImV4cCI6MjA4NjQyMzQzN30.ONu6M24_vhaeN-YlqKr-mtNjRuLLMfMeMfdTDMUllfA";

let SUPABASE_READY = true;
function isLeagueUnlocked() { return !!activeAccess; }
function getStoredName() { return "Recorder"; }
(async function boot() {
  for(const id of ['mainMenu','teamConfigScreen','gameSetupScreen','gameScreen','gameOverScreen','seasonStatsScreen','playerStatsScreen','teamStatsScreen','rankingsScreen','pastGameLogScreen','manualGameStatEditorScreen','scheduleScreen','postseasonScreen','leagueSettingsScreen']) {
    privateScreenTemplates.set(id,document.getElementById(id).innerHTML);
  }
  hideAllScreens();
  try {await openRoute({restoreLast:true});} catch(error) {showDirectory();message('directoryAccessMessage',error.message);}
})();
