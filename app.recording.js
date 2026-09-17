// One complete, acknowledged mutation at a time. SQL validates every write.
const recording={token:null,identityReady:false,unlock:null,row:null,verified:false,
  leaseDeadline:0,busy:false,actionRunning:false,pending:null,lastError:'',restoring:false};
const RECOVERY_PREFIX='wbl-recording-v3-';
function newRecorderToken() {return Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');}
async function holdRecorderIdentity(token) {
  if(!navigator.locks) throw new Error('This browser needs Web Locks support to record. Use an updated browser over HTTPS. Viewing is available.');
  return await new Promise((resolve,reject)=>{
    navigator.locks.request('wbl-recorder-'+token,{ifAvailable:true},async lock=>{
      if(!lock) return resolve(false);
      recording.token=token; recording.identityReady=true;
      let release; const held=new Promise(r=>release=r); recording.unlock=release;
      resolve(true); await held;
    }).catch(reject);
  });
}
async function initializeRecordingIdentity() {
  let token=sessionStorage.getItem('wbl-recorder-token-v3') || newRecorderToken();
  if(!await holdRecorderIdentity(token)) {token=newRecorderToken(); await holdRecorderIdentity(token);}
  sessionStorage.setItem('wbl-recorder-token-v3',token);
}
function recoveryKey() {return RECOVERY_PREFIX+recording.token;}
function persistRecordingRecovery() {
  if(!recording.identityReady) return false;
  try {
    const record={version:3,savedAt:new Date().toISOString(),pending:recording.pending,
      row:recording.row,snapshot:buildLiveGameSavePayload(),lastError:recording.lastError};
    const json=JSON.stringify(record);
    localStorage.setItem(recoveryKey(),json);
    return localStorage.getItem(recoveryKey())===json;
  } catch(error) {recording.verified=false;recording.lastError='Device recovery storage is full/unavailable. Free storage before recording.';return false;}
}
function recordingCanAct() {
  return recording.identityReady && recording.verified && recording.row?.mine && recording.row.status==='live'
    && performance.now()<recording.leaseDeadline && navigator.onLine && !document.hidden
    && !recording.busy && !recording.pending;
}
function adoptRecordingRow(row,sentAt=performance.now()) {
  recording.row=row;
  recording.verified=!!(row?.mine && row.status==='live' && !row.available);
  // Subtract the full request duration and a safety margin; don't trust the phone's wall clock.
  const remaining=Math.max(0,Date.parse(row?.lease_until)-Date.parse(row?.server_time)-2000);
  recording.leaseDeadline=sentAt+remaining;
  if(performance.now()>=recording.leaseDeadline) recording.verified=false;
}
async function readRecording(id=recording.row?.id) {
  const sentAt=performance.now();
  const data=await wblRpc('wbl_read',{p_game_id:id,p_token:recording.token});
  return {data,sentAt};
}
async function renewRecording() {
  const row=recording.row;
  if(!row?.mine) throw new Error('Another device owns recording.');
  const sentAt=performance.now();
  const response=await wblRpc('wbl_mutate',{p_request:{op:'renew',op_id:crypto.randomUUID(),
    game_id:row.id,epoch:row.epoch,token:recording.token}});
  adoptRecordingRow(response.data.game,sentAt);
  if(!recording.verified) throw new Error('Recording ownership could not be confirmed.');
  return response.data;
}
async function sendPendingMutation() {
  const request=recording.pending;
  if(!request) throw new Error('No pending save.');
  const sentAt=performance.now();
  const response=await wblRpc('wbl_mutate',{p_request:request});
  if(response.receipt?.op_id!==request.op_id) throw new Error('Server did not confirm this exact save.');
  // Persist the acknowledgment before enabling any new action.
  recording.pending=null; recording.lastError='';
  if(request.op!=='league') adoptRecordingRow(response.data.game,sentAt);
  if(!persistRecordingRecovery()) {
    recording.pending=request; recording.verified=false;
    throw new Error('Server accepted this save, but device recovery could not be updated. Retry after freeing device storage.');
  }
  return response;
}
async function stageAndSend(request) {
  recording.pending=request; recording.lastError='';
  if(!persistRecordingRecovery()) throw new Error('Could not store the recovery copy. Scoring is paused; do not close this page.');
  renderRecordingStatus();
  return await sendPendingMutation();
}
function gameRequest(op,extra={}) {
  const row=recording.row;
  return {op,op_id:crypto.randomUUID(),game_id:row.id,token:recording.token,
    epoch:row.epoch,revision:row.revision,...extra};
}
async function startRecordingGame(t1,t2,ref,details,context) {
  if(recording.busy || recording.pending || game) return false;
  if(!recording.identityReady) return alert('Recording is unavailable in this browser. Use a current browser over HTTPS.');
  recording.busy=true; recording.verified=false;
  try {
    const fresh=await wblRpc('wbl_read',{});
    if(Number(fresh.league.revision)!==leagueRevision) {
      applyLeagueData(fresh); refreshGameSetupScheduleCards();
      alert('The schedule or rosters changed. Please choose the game again.'); return false;
    }
    const gid=crypto.randomUUID();
    recording.row={id:gid,mine:false,status:'live',epoch:1,revision:0};
    startGameWithTeams(t1,t2,ref,{...details,lockId:gid},context);
    if(!ref && !context?.postseasonRef) game._gameInstanceId='manual-'+gid;
    const request={op:'start',op_id:crypto.randomUUID(),game_id:gid,token:recording.token,
      league_revision:leagueRevision,state:buildLiveGameSavePayload()};
    const response=await stageAndSend(request);
    applyLeagueData(response.data); restoreLiveSnapshot(response.data.game.state);
    persistRecordingRecovery(); return true;
  } catch(error) {
    if(error.definite && /GAME_EXISTS|ALREADY_COMPLETE|SLOT_CHANGED|LEAGUE_CHANGED|POSTSEASON_CHANGED/.test(error.message)) {
      const entryId=game?._gameInstanceId;
      const fresh=await wblRpc('wbl_read',{});
      const existing=fresh.games.find(g=>g.entry_id===entryId);
      recording.pending=null;recording.row=null;game=null;
      localStorage.removeItem(recoveryKey());applyLeagueData(fresh);
      if(existing) {
        const {data,sentAt}=await readRecording(existing.id);
        adoptRecordingRow(data.game,sentAt);restoreLiveSnapshot(data.game.state);
      } else {showMainMenu();setConnectionMessage('That game or schedule changed. The latest server data is loaded.');}
      return false;
    }
    recording.lastError=error.message;recording.verified=false;persistRecordingRecovery();
    alert('Game start is not confirmed. '+error.message+' Use Retry or Use Server Game; do not start another copy.'); return false;
  } finally {recording.busy=false;applyPitcherSelectionLockState();renderRecordingStatus();}
}
async function recordAction(label,fn,options={}) {
  if(!recordingCanAct()) {renderRecordingStatus();return false;}
  if(game?._gameCompletePendingSave && !options.allowComplete) return false;
  if(label!=='undo' && !options.skipPitcher && isPitcherSelectionBlockingPlayInput()) {
    showNotification('Select/confirm the pitcher first.',1800);return false;
  }
  recording.busy=true;renderRecordingStatus();
  let before=null;
  try {
    await renewRecording();
    if(document.hidden || !navigator.onLine) throw new Error('Recording paused while the app is in the background or offline.');
    before=buildLiveGameSavePayload();
    recording.actionRunning=true;
    try {fn();} catch(error) {restoreLiveSnapshot(before);throw error;}
    finally {recording.actionRunning=false;}
    {
      // Confirm the last play BEFORE fetching the season needed to calculate final totals.
      // If that fetch fails, the complete live draft is still on the server and recoverable.
      const response=await stageAndSend(gameRequest('save',{state:buildLiveGameSavePayload()}));
      if(response.data.game?.mine && response.data.game.epoch===response.receipt.epoch) {
        restoreLiveSnapshot(response.data.game.state);
      } else {
        restoreLiveSnapshot(response.data.game.state); recording.verified=false;
      }
      persistRecordingRecovery();
      if(game._gameCompletePendingSave && recording.verified) await sendFinalResult();
    }
    return true;
  } catch(error) {
    recording.lastError=error.message;recording.verified=false;
    persistRecordingRecovery();renderRecordingStatus();return false;
  } finally {
    recording.actionRunning=false;recording.busy=false;
    applyPitcherSelectionLockState();renderRecordingStatus();
  }
}
async function sendFinalResult() {
  const {data}=await readRecording();
  if(!data.game?.mine || data.game.available || data.game.epoch!==recording.row.epoch) throw new Error('OWNERSHIP_LOST: Cannot finish this game.');
  const result=buildFinalLeagueSnapshot(data.league);
  const response=await stageAndSend(gameRequest('finish',{league_revision:Number(data.league.revision),
    season:result.season,schedule:result.schedule,state:buildLiveGameSavePayload()}));
  applyLeagueData(response.data);restoreLiveSnapshot(response.data.game.state);
  if(response.data.game.status==='complete') {
    recording.verified=false;localStorage.removeItem(recoveryKey());displayGameOver();
  }
}
async function openRecording(id) {
  if(recording.busy || recording.pending) return alert('Resolve the pending save first.');
  if(recording.row?.mine && recording.row.status==='live') {showGame();return;}
  recording.busy=true;
  try {
    const {data,sentAt}=await readRecording(id);
    if(!data.game) throw new Error('Game was not found. Refresh the main menu.');
    applyLeagueData(data);adoptRecordingRow(data.game,sentAt);restoreLiveSnapshot(data.game.state);
    if(data.game.mine && !data.game.available) await renewRecording();
    if(data.game.status==='complete') displayGameOver();
    if(data.game.mine) persistRecordingRecovery();
  } catch(error) {recording.lastError=error.message;recording.verified=false;alert(error.message);}
  finally {recording.busy=false;applyPitcherSelectionLockState();renderRecordingStatus();}
}
async function takeRecording() {
  if(recording.busy || recording.pending || !recording.identityReady) return;
  recording.busy=true;recording.verified=false;renderRecordingStatus();
  try {
    const {data}=await readRecording();
    if(!data.game?.available) throw new Error('Someone is still recording. Wait for Leave Recording or the expiry countdown.');
    const old=data.game;
    restoreLiveSnapshot(old.state);adoptRecordingRow(old);
    if(old.lease_until && !confirm('The previous recorder stopped responding. Continue from the last SERVER-SAVED score shown here? Check with them for any unconfirmed play before adding new plays.')) return;
    const response=await stageAndSend(gameRequest('claim'));
    applyLeagueData(response.data);restoreLiveSnapshot(response.data.game.state);persistRecordingRecovery();
  } catch(error) {
    if(error.definite && /GAME_CHANGED|RECORDER_BUSY|ALREADY_COMPLETE/.test(error.message)) {
      recording.pending=null;
      const {data,sentAt}=await readRecording();
      adoptRecordingRow(data.game,sentAt);restoreLiveSnapshot(data.game.state);
      recording.lastError='Another recorder took control first. You are viewing the saved game.';
    } else {recording.lastError=error.message;recording.verified=false;persistRecordingRecovery();alert(error.message);}
  }
  finally {recording.busy=false;applyPitcherSelectionLockState();renderRecordingStatus();}
}
async function leaveRecording() {
  if(recording.busy) return;
  if(recording.pending) return alert('A save is unconfirmed. Retry it before handing off.');
  if(!recordingCanAct()) return alert('Reconnect and verify ownership before leaving recording.');
  recording.busy=true;renderRecordingStatus();
  try {
    // Every scoring action has already been acknowledged. Verify ownership and release at exactly that revision.
    await renewRecording();
    const response=await stageAndSend(gameRequest('leave'));
    applyLeagueData(response.data);adoptRecordingRow(response.data.game);
    localStorage.removeItem(recoveryKey());game=null;recording.row=null;
    showMainMenu();setConnectionMessage('Recording left successfully. All changes were saved; another person can resume.');
  } catch(error) {
    recording.lastError=error.message;recording.verified=false;persistRecordingRecovery();
    alert('Handoff is NOT confirmed. '+error.message+' Retry before assuming someone else can continue.');
  } finally {recording.busy=false;renderRecordingStatus();}
}
async function refreshRecording() {
  if(recording.busy || recording.pending || !recording.row) return;
  recording.busy=true;
  try {
    if(recording.row.mine && recording.row.status==='live' && recording.verified) {
      await renewRecording();
    } else {
      const {data,sentAt}=await readRecording();
      applyLeagueData(data);adoptRecordingRow(data.game,sentAt);
      if(data.game) {restoreLiveSnapshot(data.game.state);if(data.game.status==='complete') displayGameOver();}
    }
  } finally {recording.busy=false;applyPitcherSelectionLockState();renderRecordingStatus();}
}
async function retryRecording() {
  if(recording.busy) return false;
  recording.busy=true;renderRecordingStatus();
  try {
    if(!recording.identityReady) await initializeRecordingIdentity();
    if(recording.pending) {
      // A definite league-CAS failure rolled back the entire finish transaction.
      // Recompute totals on the current league rather than replaying a stale snapshot.
      if(recording.pending.op==='finish' && recording.lastError.includes('LEAGUE_CHANGED')) {
        const {data}=await readRecording();
        if(!data.game.mine || data.game.epoch!==recording.pending.epoch || data.game.available) throw new Error('OWNERSHIP_LOST: Unconfirmed result retained for review.');
        adoptRecordingRow(data.game);
        recording.pending=null; await sendFinalResult();return true;
      }
      const op=recording.pending.op;
      const response=await sendPendingMutation();applyLeagueData(response.data);
      if(op==='league') {setConnectionMessage('League edit confirmed saved.');localStorage.removeItem(recoveryKey());update();refreshVisibleReadOnlyScreens();}
      else if(op==='leave') {
        game=null;recording.row=null;localStorage.removeItem(recoveryKey());showMainMenu();
        setConnectionMessage('Leave Recording confirmed. All changes were saved before control was released.');
      } else if(response.data.game) {
        restoreLiveSnapshot(response.data.game.state);
        if(response.data.game.status==='complete') {localStorage.removeItem(recoveryKey());displayGameOver();}
        else persistRecordingRecovery();
      }
    } else if(recording.row) {
      const {data,sentAt}=await readRecording();applyLeagueData(data);adoptRecordingRow(data.game,sentAt);
      if(data.game) {restoreLiveSnapshot(data.game.state);if(data.game.status==='complete') displayGameOver();}
      if(data.game?.mine && !data.game.available && data.game.status==='live') await renewRecording();
    } else {await refreshLeagueFromServer();}
    recording.lastError='';return true;
  } catch(error) {
    recording.lastError=error.message;recording.verified=false;persistRecordingRecovery();
    setConnectionMessage('Save/connection not confirmed. '+error.message);return false;
  } finally {recording.busy=false;applyPitcherSelectionLockState();renderRecordingStatus();renderLiveGameList();}
}
async function restoreRecordingRecovery() {
  const record=readJsonStorage(recoveryKey());
  if(!record) {renderRecoveryList();return;}
  recording.pending=record.pending || null;recording.lastError=record.lastError || '';
  recording.row=record.row || null;recording.verified=false;
  if(record.snapshot?.game) restoreLiveSnapshot(record.snapshot);
  if(recording.pending || recording.row) await retryRecording();
  renderRecoveryList();
}
function downloadJson(value,name) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function publicRecoveryCopy(record) {
  const copy=cloneJson(record);
  if(copy?.pending) delete copy.pending.token;
  return copy;
}
function exportRecordingRecovery() {
  const record={savedAt:new Date().toISOString(),pending:recording.pending,row:recording.row,snapshot:buildLiveGameSavePayload()};
  downloadJson(publicRecoveryCopy(record),'wiffle-recording-recovery.json');
}
async function resolveUnsentRecording() {
  if(recording.busy) return;
  if(!confirm('Keep a recovery file, then load the server version? Any unconfirmed change will NOT be automatically added to the server game. Compare it with the current recorder before entering anything again. This does not confirm a handoff.')) return;
  recording.busy=true;
  try {
    // Reading and archiving never writes a stale draft into a new recorder's game.
    const {data,sentAt}=await readRecording(recording.pending?.game_id || recording.row?.id || null);
    const archive={savedAt:new Date().toISOString(),pending:recording.pending,snapshot:buildLiveGameSavePayload()};
    localStorage.setItem('wbl-unresolved-'+crypto.randomUUID(),JSON.stringify(publicRecoveryCopy(archive)));
    exportRecordingRecovery();
    recording.pending=null;recording.lastError='';localStorage.removeItem(recoveryKey());
    applyLeagueData(data);adoptRecordingRow(data.game,sentAt);
    if(data.game) {restoreLiveSnapshot(data.game.state);if(data.game.status==='complete') displayGameOver();}
    else {game=null;recording.row=null;showMainMenu();}
    setConnectionMessage('Server version loaded. The unconfirmed copy is preserved for manual review.');
  } catch(error) {alert('Recovery could not be preserved/loaded. '+error.message);}
  finally {recording.busy=false;renderRecordingStatus();renderLiveGameList();}
}
async function recoverOtherTab(key) {
  if(recording.busy || recording.pending || game) return alert('Resolve the current recording first.');
  const token=key.slice(RECOVERY_PREFIX.length);
  const oldToken=recording.token;
  if(recording.unlock) recording.unlock();recording.identityReady=false;
  if(!await holdRecorderIdentity(token)) {
    await holdRecorderIdentity(oldToken);return alert('That recording is open in another tab. Continue there or use Leave Recording there first.');
  }
  sessionStorage.setItem('wbl-recorder-token-v3',token);await restoreRecordingRecovery();
}
function renderRecoveryList() {
  const box=document.getElementById('recoveryList');if(!box) return;
  box.replaceChildren();
  if(recording.pending && !game) {
    const p=document.createElement('p');p.textContent='An edit is not confirmed. Retry, or preserve it and load the server version.';box.append(p);
    for(const [label,fn] of [['Retry Save',retryRecording],['Download Recovery',exportRecordingRecovery],['Use Server Version',resolveUnsentRecording]]) {
      const b=document.createElement('button');b.textContent=label;b.onclick=fn;box.append(b);
    }
  }
  for(let i=0;i<localStorage.length;i++) {
    const key=localStorage.key(i);
    if(!key.startsWith(RECOVERY_PREFIX) || key===recoveryKey()) continue;
    const r=readJsonStorage(key); if(!r?.pending && !r?.row) continue;
    const b=document.createElement('button');
    b.textContent='Recover saved recording: '+(r.snapshot?.game?.team1?.name || 'League edit')+' • '+new Date(r.savedAt).toLocaleString();
    b.onclick=()=>recoverOtherTab(key);box.append(b);
  }
  const legacy=readJsonStorage('wbl-pre-handoff-backup');
  if(legacy?.wiggleLiveGameStateV1?.game) {
    const p=document.createElement('p');p.textContent='A game from the previous app is preserved on this device. It cannot be automatically merged with the new server recording. Download and reconcile it before recording that game again.';box.append(p);
    const b=document.createElement('button');b.textContent='Download Previous App Recovery';b.onclick=()=>downloadJson(legacy,'wiffle-before-handoff.json');box.append(b);
  }
  box.classList.toggle('hidden',!box.childNodes.length);
}
function renderLiveGameList() {
  const box=document.getElementById('liveGameList');if(!box) return;
  box.replaceChildren();
  const title=document.createElement('h3');title.textContent='In-progress Games';box.append(title);
  if(!liveGames.length) {const p=document.createElement('p');p.textContent='No in-progress games. Choose Start a Game below.';box.append(p);}
  for(const row of liveGames) {
    const card=document.createElement('div');card.className='live-game-row';
    const label=document.createElement('p');label.textContent=`${row.team1} ${row.score1} — ${row.team2} ${row.score2} · ${row.available?'Available to resume':'Being recorded'}`;
    const button=document.createElement('button');button.textContent=row.available?'Open / Resume Recording':'View Game';
    button.onclick=()=>openRecording(row.id);card.append(label,button);box.append(card);
  }
  renderRecoveryList();
}
function renderRecordingStatus() {
  const row=recording.row;
  const status=document.getElementById('recordingStatus');if(!status) return;
  const can=recordingCanAct();const pending=!!recording.pending;
  const owned=!!row?.mine && row.status==='live';
  let title='Viewing',detail='Scoring controls are disabled. The last saved state refreshes automatically.';
  if(row?.status==='complete') {title='Game saved';detail='Final result and season statistics were saved together.';}
  else if(pending) {title='Save not confirmed — scoring paused';detail='Do not hand off yet. Retry Save. If control changed, download recovery and compare with the server game.';}
  else if(recording.busy) {title='Saving / checking ownership…';detail='Wait for confirmation before the next play.';}
  else if(can) {title=game?._gameCompletePendingSave?'Finish save needed':'Recording on this tab';detail='All recorded changes saved to server. Leave Recording saves your place without ending the game.';}
  else if(owned && !row.available) {title='Reconnecting — scoring paused';detail='Ownership must be verified before scoring can continue.';}
  else if(row?.available) {title='Available to resume';detail='Resume Recording loads the server game and claims exclusive control.';}
  else if(row?.lease_until) {
    const seconds=Math.max(0,Math.ceil((Date.parse(row.lease_until)-Date.now()-serverClockOffset)/1000));
    detail=`Another tab/device is recording. Recovery is available after its lease expires (about ${seconds}s without renewal).`;
  }
  if(!navigator.onLine) {title='Offline — scoring paused';detail=pending?'One change is unconfirmed and preserved here. Reconnect before handing off.':'Viewing the last saved state. Reconnect to verify recording ownership.';}
  status.textContent=title;
  document.getElementById('recordingDetail').textContent=detail+(recording.lastError?' '+recording.lastError:'');
  const show=(id,visible,disabled=false)=>{const el=document.getElementById(id);el.classList.toggle('hidden',!visible);el.disabled=disabled;};
  show('leaveRecordingBtn',owned,!can);
  show('takeRecordingBtn',!!row?.available && row.status==='live' && !pending,recording.busy || !recording.identityReady || !navigator.onLine);
  document.getElementById('takeRecordingBtn').textContent=row?.lease_until?'Take Over Recording':'Resume Recording';
  show('retryRecordingBtn',pending || (owned&&!can),recording.busy || !navigator.onLine);
  show('resolveRecordingBtn',pending,recording.busy || !navigator.onLine);
  show('exportRecordingBtn',pending);
  show('viewBackBtn',!owned && !pending);
  const blocked=!can || !!game?._gameCompletePendingSave;
  document.querySelectorAll('#gameScreen button:not(#recordingPanel button),#gameScreen select').forEach(el=>{
    if(blocked) {el.disabled=true;return;}
    const handler=el.getAttribute('onclick')||'';
    if(el.id==='undoButton') el.disabled=!gameHistory.length;
    else if(el.id==='pitcherSelect' || el.id==='confirmPitcherButton' || handler==='endGameEarly()') el.disabled=false;
    else el.disabled=!!game?.pitcherSelectionRequired;
  });
  // A completed live draft can retry finishing without accepting another play.
  const end=document.querySelector('#gameScreen .end-game-button');
  if(end) {end.disabled=!can;end.textContent=game?._gameCompletePendingSave?'Retry Final Save':'End & Save Game';}
  const tag=document.getElementById('liveSyncStatusTag'); if(tag) {tag.classList.remove('hidden');tag.textContent=title;}
}

// Existing non-game features participate in a single version-checked league transaction.
for(const name of ['addTeam','addPlayer','removeTeam','removePlayer','addSeasonSub','removeSeasonSub',
  'removeSubAssignment','confirmSubAssignment','applySelectedScheduleChange','applyFiveTeamDayEdit',
  'forceRegenerateSchedule','endSeriesEarly','createPostseasonBracket','resetPostseason',
  'saveManualGameStatEditorCorrections','clearCurrentStatsOnly','resetSeason','restoreStatsBackupFromPayload']) {
  const original=window[name]; if(typeof original==='function') window[name]=(...args)=>runLeagueEdit(original,args);
}
window.addEventListener('offline',()=>{recording.verified=false;persistRecordingRecovery();renderRecordingStatus();});
window.addEventListener('online',()=>{if(!recording.pending) pollApp();renderRecordingStatus();});
document.addEventListener('visibilitychange',()=>{
  recording.verified=false;
  if(document.hidden) {if(recording.pending || recording.row?.mine) persistRecordingRecovery();}
  else pollApp();renderRecordingStatus();
});
window.addEventListener('pagehide',()=>{recording.verified=false;if(recording.pending || recording.row?.mine) persistRecordingRecovery();});
window.addEventListener('pageshow',()=>{recording.verified=false;pollApp();});
window.addEventListener('beforeunload',event=>{if(recording.pending){persistRecordingRecovery();event.preventDefault();event.returnValue='';}});
// A capture guard protects every inline scoring handler (including pitcher and picker changes).
for(const eventName of ['click','change']) document.addEventListener(eventName,event=>{
  if(!event.target.closest?.('#gameScreen') || event.target.closest('#recordingPanel')) return;
  if(!recordingCanAct()) {event.preventDefault();event.stopImmediatePropagation();renderRecordingStatus();}
},true);
setInterval(renderRecordingStatus,1000);
