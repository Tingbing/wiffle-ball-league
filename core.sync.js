// RPC-only persistence. No account, direct table writes, or last-writer-wins outbox.
let leagueRevision = null;
let leagueEditActive = false;
let appConnected = false;
let liveGames = [];
let appPollTimer = null;
let pollRunning = false;
let serverClockOffset = 0;
let syncState = {serverSeasonRevision:0,serverScheduleRevision:0,serverUpdatedAt:null};

async function wblRpc(name,args) {
  const generation=accessGeneration;
  const privateRpc=['wbl_read','wbl_mutate','wbl_change_code','wbl_leave_access'].includes(name);
  if(privateRpc) {
    if(!activeAccess) throw new Error('ACCESS_REQUIRED: Enter this league’s code.');
    if(name==='wbl_mutate') {
      if(args.p_request.league_id && args.p_request.league_id!==LEAGUE_CODE) throw new Error('Wrong league recovery request.');
      args={p_request:{...args.p_request,league_id:LEAGUE_CODE,access_token:activeAccess.token}};
    } else args={...args,p_league_id:LEAGUE_CODE,p_access_token:activeAccess.token};
  }
  if (!navigator.onLine) throw new Error('Offline. Scoring is paused.');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await fetch(SUPABASE_URL+'/rest/v1/rpc/'+name,{
      method:'POST',cache:'no-store',signal:controller.signal,
      headers:{'Content-Type':'application/json',apikey:SUPABASE_ANON_KEY,
        Authorization:'Bearer '+SUPABASE_ANON_KEY}, body:JSON.stringify(args)
    });
    const result=await response.json();
    if(!response.ok) { const raw=String(result.message || ''); const safe=/^(ACCESS_REQUIRED|LEAGUE_CHANGED|LIVE_GAME|SCORED_SEASON|OP_ID_REUSED|INVALID_|GAME_EXISTS|SLOT_CHANGED|ALREADY_COMPLETE|STALE_|LEASE_|NOT_OWNER|OWNER_|EPOCH_|REVISION_|SEASON_RULES_CHANGED|Use |Settings |Each team |Players need |Leagues support |Invalid creation |Add at least)/.test(raw); const e=new Error(safe?raw:'The server could not accept this request. Refresh and try again.'); e.definite=response.status>=400 && response.status<500; throw e; }
    if(!result) throw new Error('Backend migration is missing. Run database/01_recording_handoff.sql.');
    if(privateRpc && generation!==accessGeneration) throw new Error("League changed; old response ignored.");
    if(result.error) {const e=new Error(result.error);e.definite=true;throw e;}
    appConnected=true;
    return result;
  } catch(error) { if(generation===accessGeneration) {appConnected=false; if(privateRpc && /ACCESS_REQUIRED/.test(error.message)) invalidateCurrentAccess();} throw error; }
  finally { clearTimeout(timer); }
}
function setConnectionMessage(message) {
  const el=document.getElementById('connectionMessage'); if(el) el.textContent=message;
}
function persistConfirmedLeague() {
  try {
    localStorage.setItem(SEASON_STORAGE_KEY,JSON.stringify(season));
    localStorage.setItem(SCHEDULE_STORAGE_KEY,JSON.stringify(schedule));
    localStorage.setItem(leagueKey('teams'),JSON.stringify(league));
    localStorage.setItem(leagueKey('confirmed'),JSON.stringify({revision:leagueRevision,season,schedule,league}));
  } catch(error) { setConnectionMessage('Server saved. Device storage is full; do not rely on offline recovery on this device.'); }
}
function applyLeagueData(data) {
  if(!data?.league) return;
  if(data.league.id!==LEAGUE_CODE || !activeAccess) throw new Error("Wrong league response rejected.");
  if(data.api_version!==4) throw new Error('Backend version mismatch. Apply the included SQL migration.');
  serverClockOffset=Date.parse(data.server_time)-Date.now();
  liveGames=data.games || [];
  activeGameLock=liveGames.length?{lockId:liveGames[0].id,team1:liveGames[0].team1,team2:liveGames[0].team2}:null;
  leagueRevision=Number(data.league.revision);
  leagueSettings=cloneJson(data.league.settings); leagueName=data.league.name;
  season=ensureSeasonShape(cloneJson(data.league.season_json));
  schedule=ensureScheduleShape(cloneJson(data.league.schedule_json));
  league=cloneJson(data.league.teams_json);
  syncState.serverSeasonRevision=getSeasonRevisionFrom(season);
  syncState.serverScheduleRevision=getScheduleRevisionFrom(schedule);
  syncState.serverUpdatedAt=data.league.updated_at;
  persistConfirmedLeague(); renderLeagueHeader(); renderLiveGameList();
}
async function refreshLeagueFromServer() {
  const data=await wblRpc('wbl_read',{});
  if(!leagueEditActive && !recording.pending && !recording.busy && !isLeagueEditorVisible()) applyLeagueData(data);
  else {liveGames=data.games || []; renderLiveGameList();}
  setConnectionMessage('Connected • Changes are saved to the server before the next play.');
  return data;
}
function isLeagueEditorVisible() {
  return ['teamConfigScreen','gameSetupScreen','manualGameStatEditorScreen'].some(id=>!document.getElementById(id)?.classList.contains('hidden'));
}
function refreshVisibleReadOnlyScreens() {
  const screens={seasonStatsScreen:displaySeasonStats,playerStatsScreen:displayPlayerStats,
    teamStatsScreen:displayTeamStats,rankingsScreen:displayRankings,pastGameLogScreen:displayPastGameLog,
    scheduleScreen:renderScheduleUI,postseasonScreen:displayPostseason};
  for(const [id,fn] of Object.entries(screens)) {
    if(!document.getElementById(id)?.classList.contains('hidden')) fn();
  }
}
async function pollApp() {
  if(!activeAccess || pollRunning || leagueEditActive || recording.busy || recording.pending || document.hidden) return;
  pollRunning=true;
  try {
    if(recording.row && game) await refreshRecording();
    else { await refreshLeagueFromServer(); refreshVisibleReadOnlyScreens(); }
  } catch(error) {
    appConnected=false; recording.verified=false;
    setConnectionMessage('Connection interrupted. Viewing saved data; scoring is paused.');
    renderRecordingStatus();
  } finally { pollRunning=false; }
}
function startAppPolling() { if(!appPollTimer) appPollTimer=setInterval(pollApp,4000); }
function stopRealtime() { clearInterval(appPollTimer); appPollTimer=null; }
function getSeasonRevisionFrom(obj=season) { return Number(obj?._meta?.revision || 0); }
function getScheduleRevisionFrom(obj=schedule) { return Number(obj?._meta?.revision || 0); }
function normalizeSnapshotMeta(obj) { obj._meta=obj._meta || {revision:0}; return obj; }
function readLocalSyncHead() { return {seasonRevision:getSeasonRevisionFrom(),scheduleRevision:getScheduleRevisionFrom()}; }
function writeLocalSyncHead() { return readLocalSyncHead(); }
function syncStateFromHead() {}
function clearSyncConflictState() {}
function assertCanWriteLocalSnapshot() { return leagueEditActive; }
function hasUnsyncedLocalChanges() { return !!recording.pending; }
function queueServerSync() { /* Top-level league actions commit once in runLeagueEdit. */ }
async function syncSeasonToServer() {
  if(leagueEditActive) return true;
  return retryRecording();
}
async function manualResaveAllStats() {
  if(recording.pending || recording.row) return retryRecording();
  try { await refreshLeagueFromServer(); update(); refreshVisibleReadOnlyScreens(); }
  catch(error) { alert(error.message); }
}
async function refreshPublicViewData() { await refreshLeagueFromServer(); return true; }
async function fetchSeasonRowFromServer() { const data=await wblRpc('wbl_read',{}); return data.league; }
function applyServerSeasonRow() { /* Legacy last-writer-wins callers removed. */ }
function refreshGameLockUI() { renderLiveGameList(); }
function getActiveGameLockLabel() { return liveGames.length?'An in-progress game is available on the main menu.':''; }
function persistActiveGameLock(value) { activeGameLock=value; }
async function requireConnectedApp() {
  if(leagueEditActive) return true;
  try { await refreshLeagueFromServer(); return true; }
  catch(error) { alert(error.message); return false; }
}
function withTimeout(promise,ms,fallback=false) {
  let timer; return Promise.race([promise,new Promise(r=>{timer=setTimeout(()=>r(fallback),ms);})]).finally(()=>clearTimeout(timer));
}
function setSyncButtonResult(state,detail='') { setConnectionMessage(detail || state); }
function setSyncButtonBusy(busy) { document.getElementById('resaveStatsBtn').disabled=busy; }
function setSyncButtonEnabled(enabled) { document.getElementById('resaveStatsBtn').disabled=!enabled; }
async function runLeagueEdit(fn,args) {
  if(leagueEditActive) return await fn(...args);
  if(recording.busy || recording.pending || game) return alert('Finish or leave recording and resolve pending saves before editing the league.');
  let before;
  recording.busy=true;
  try {
    const fresh=await wblRpc('wbl_read',{});
    if(Number(fresh.league.revision)!==leagueRevision) {
      applyLeagueData(fresh); update(); refreshVisibleReadOnlyScreens();
      if(!document.getElementById('manualGameStatEditorScreen').classList.contains('hidden')) displayManualGameStatEditor();
      alert('The league changed on another device. The latest data is loaded; please make your edit again.'); return false;
    }
    if(fresh.games.length) return alert('Finish all in-progress games before changing rosters, schedules, or past statistics. You can still view and record games.');
    before={settings:cloneJson(leagueSettings),name:leagueName,season:cloneJson(season),schedule:cloneJson(schedule),teams:cloneJson(league)};
    leagueEditActive=true;
    const result=await fn(...args);
    const next={settings:cloneJson(leagueSettings),name:leagueName,season:cloneJson(season),schedule:cloneJson(schedule),teams:cloneJson(league)};
    if(JSON.stringify(before)===JSON.stringify(next)) return result;
    recording.pending={league_id:LEAGUE_CODE,op:'league',op_id:crypto.randomUUID(),league_revision:leagueRevision,...next};
    if(!persistRecordingRecovery()) throw new Error('Device recovery storage failed. The league edit was not sent.');
    const response=await sendPendingMutation();
    applyLeagueData(response.data); setConnectionMessage('League changes saved to the server.');
    leagueEditActive=false; showNotification('Changes saved to the server.',2500);
    return result;
  } catch(error) {
    if(before && activeAccess) {leagueSettings=before.settings;leagueName=before.name;season=before.season;schedule=before.schedule;league=before.teams;}
    setConnectionMessage('League edit is not confirmed. Use Refresh / Retry before making more changes. '+error.message);
    alert(error.message+' Your attempted edit is kept for recovery if a request was sent.'); return false;
  } finally {leagueEditActive=false;recording.busy=false;renderLiveGameList();renderRecordingStatus();}
}
function archiveLegacyLocalData() {
  if(localStorage.getItem('wbl-pre-handoff-backup')) return;
  const keys=['wiggleLeague','wiggleSeason','wiggleSchedule','wiggleSyncHeadV1','wiggleLiveGameStateV1','wiggleActiveGameLock'];
  const original={savedAt:new Date().toISOString()};
  for(const key of keys) original[key]=readJsonStorage(key,null);
  localStorage.setItem('wbl-pre-handoff-backup',JSON.stringify(original));
}
