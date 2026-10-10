// Directory is public. Private screens are rendered only after a server-validated grant.
const ACCESS_KEY='wbl-v4-access';
const LAST_LEAGUE_KEY='wbl-v4-last-league';
let directoryCursor=null,directoryMore=false,directoryBusy=false,directoryRequest=0;
let joinTarget=null,accessBusy=false,creationDraft=null;
const privateScreenTemplates=new Map();
function el(id) {return document.getElementById(id);}
function message(id,text) {el(id).textContent=text;}
function makeButton(text,fn) {const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;return b;}
function savedAccess() {return readJsonStorage(ACCESS_KEY,{});}
function rememberAccess(id,value) {
  const grants=savedAccess();if(value)grants[id]=value;else delete grants[id];
  localStorage.setItem(ACCESS_KEY,JSON.stringify(grants));
  if(value)localStorage.setItem(LAST_LEAGUE_KEY,id);
  else if(localStorage.getItem(LAST_LEAGUE_KEY)===id)localStorage.removeItem(LAST_LEAGUE_KEY);
}
function renderLeagueHeader() {message('activeLeagueTitle',leagueName);message('activeLeagueRules',`${leagueSettings.weeks} weeks • ${league.teams?.length || 0} teams • ${leagueSettings.innings} innings • ${leagueSettings.outs} outs per half-inning`);}
function clearPrivateState() {
  accessGeneration++;stopRealtime();
  if(recording.unlock) recording.unlock();
  Object.assign(recording,{token:null,identityReady:false,unlock:null,row:null,verified:false,leaseDeadline:0,busy:false,actionRunning:false,pending:null,lastError:'',restoring:false});
  LEAGUE_CODE=null;activeAccess=null;leagueName='';leagueSettings={weeks:6,innings:3,outs:2};
  league={teams:[]};season=createEmptySeasonState();schedule={days:[],teamNames:[]};game=null;gameHistory=[];lastPlay=null;pendingBattingResult=null;playInputLock=false;activeGameLock=null;liveGames=[];leagueRevision=null;leagueEditActive=false;appConnected=false;
  for(const [id,html] of privateScreenTemplates) el(id).innerHTML=html;
  hideAllScreens();
}
function invalidateCurrentAccess() {
  if(!activeAccess) return;
  const id=LEAGUE_CODE;
  if(recording.pending) persistRecordingRecovery();
  rememberAccess(id,null);clearLeagueCache(id);clearPrivateState();
  showDirectory();message('directoryAccessMessage','Access was revoked. Enter the league’s current code to reopen it. Unconfirmed saves remain scoped to that league on this device.');
}
function safeToSwitch() {
  if(accessBusy || recording.busy || recording.pending || leagueEditActive) {alert('Wait for the current request and resolve pending saves before switching leagues.');return false;}
  if(recording.row?.mine && recording.row.status==='live') {alert('Use Leave Recording before switching leagues so another device can resume.');return false;}
  return true;
}
function showDirectory() {hideAllScreens();el('directoryScreen').classList.remove('hidden');loadDirectory(false);}
function switchToDirectory() {if(!safeToSwitch())return;localStorage.removeItem(LAST_LEAGUE_KEY);message('directoryAccessMessage','');clearPrivateState();history.pushState(null,'',location.pathname+location.search);showDirectory();}
async function loadDirectory(append=false) {
  if(append&&directoryBusy)return;
  const request=++directoryRequest;directoryBusy=true;
  if(!append){directoryCursor=null;directoryMore=false;el('directoryMore').classList.add('hidden');el('directoryList').replaceChildren();}
  message('directoryMessage','Loading leagues…');el('directoryMore').disabled=true;
  try {
    const data=await wblRpc('wbl_directory',{p_search:el('directorySearch').value.trim(),p_after:append?directoryCursor:null});
    if(request!==directoryRequest)return;
    for(const row of data.leagues) {
      const card=document.createElement('div');card.className='card directory-row';
      const title=document.createElement('h3');title.textContent=row.name;
      const small=document.createElement('small');small.textContent='League '+row.id.slice(0,8);
      card.append(title,small,makeButton(savedAccess()[row.id]?'Open league':'Join league',()=>requestOpenLeague(row)));el('directoryList').append(card);
    }
    directoryCursor=data.leagues.at(-1)||directoryCursor;directoryMore=data.more;
    message('directoryMessage',el('directoryList').childNodes.length?'':el('directorySearch').value.trim()?'No leagues match your search.':'No leagues yet. Create the first one.');
  } catch(error){if(request===directoryRequest)message('directoryMessage','Could not load leagues. '+error.message+' Use Retry.');}
  finally {if(request===directoryRequest){directoryBusy=false;el('directoryMore').disabled=false;el('directoryMore').classList.toggle('hidden',!directoryMore);}}
}
async function requestOpenLeague(row) {
  if(!safeToSwitch())return;
  message('directoryAccessMessage','');
  const grant=savedAccess()[row.id];
  if(grant) {
    accessBusy=true;
    try {await enterLeague(row.id,grant);return;}
    catch(error){
      if(/ACCESS_REQUIRED/.test(error.message))rememberAccess(row.id,null);
      else {
        message('directoryAccessMessage','Could not reopen your saved league. '+error.message+' Your access is still saved. ');
        el('directoryAccessMessage').append(makeButton('Retry opening league',()=>requestOpenLeague(row)));
        return;
      }
    }finally{accessBusy=false;}
  }
  joinTarget=row;hideAllScreens();el('joinScreen').classList.remove('hidden');message('joinTitle','Join '+row.name);message('joinMessage','');el('joinCode').value='';el('setupToken').value='';el('setupFields').open=false;el('joinCode').focus();
}
async function submitJoin(event) {
  event.preventDefault();if(accessBusy)return;accessBusy=true;el('joinSubmit').disabled=true;message('joinMessage','Verifying code…');
  const token=newRecorderToken();
  try {
    const setup=el('setupToken').value;
    const result=await wblRpc(setup?'wbl_setup':'wbl_join',setup?{p_league_id:joinTarget.id,p_setup_token:setup,p_code:el('joinCode').value,p_session_token:token}:{p_league_id:joinTarget.id,p_code:el('joinCode').value,p_session_token:token});
    el('joinCode').value='';el('setupToken').value='';
    await enterLeague(joinTarget.id,{token,expires_at:result.expires_at});
  }catch(error){message('joinMessage',error.message);}finally{accessBusy=false;el('joinSubmit').disabled=false;}
}
async function enterLeague(id,grant) {
  clearPrivateState();LEAGUE_CODE=id;activeAccess=grant;
  SEASON_STORAGE_KEY=leagueKey('season');SCHEDULE_STORAGE_KEY=leagueKey('schedule');SYNC_HEAD_KEY=leagueKey('head');ACTIVE_GAME_LOCK_KEY=leagueKey('lock');RECOVERY_PREFIX=leagueKey('recording')+':';
  try {
    await refreshLeagueFromServer();activeAccess={token:grant.token,expires_at:null};rememberAccess(id,activeAccess);
    if(id==='6767') archiveLegacyLocalData();
    try {await initializeRecordingIdentity();}catch(error){setConnectionMessage(error.message);}
    await restoreRecordingRecovery();startAppPolling();
    if(!game)showMainMenu();renderLeagueHeader();
    if(location.hash!=='#league='+encodeURIComponent(id))history.pushState(null,'','#league='+encodeURIComponent(id));
  }catch(error){clearPrivateState();showDirectory();throw error;}
}
async function leaveLeagueAccess() {
  if(!safeToSwitch() || !confirm('Revoke this device’s access to this league? You will need its code again.'))return;
  accessBusy=true;
  try{await wblRpc('wbl_leave_access',{});rememberAccess(LEAGUE_CODE,null);clearLeagueCache(LEAGUE_CODE);clearPrivateState();history.pushState(null,'',location.pathname+location.search);showDirectory();}
  catch(error){alert('Revocation was not confirmed. '+error.message);}finally{accessBusy=false;}
}
function readRules(prefix) {
  const s={weeks:Number(el(prefix+'Weeks').value),innings:Number(el(prefix+'Innings').value),outs:Number(el(prefix+'Outs').value)};
  if(!Number.isInteger(s.weeks)||s.weeks<1||s.weeks>52||!Number.isInteger(s.innings)||s.innings<1||s.innings>9||!Number.isInteger(s.outs)||s.outs<1||s.outs>6)throw new Error('Use 1–52 weeks, 1–9 innings and 1–6 outs.');return s;
}
const PENDING_CREATE_KEY='wbl-v5-pending-create';
function validateCreateDetails() {
  const name=el('createName').value.trim(),code=el('createCode').value;
  const nameError= !name || Array.from(name).length>80 || /[<>"\x00-\x1f]/.test(name) ? 'Enter a league name of 1–80 characters without markup or control characters.' : '';
  const bytes=new TextEncoder().encode(code).length;
  const codeError=bytes<8 || bytes>64 || !/[\p{L}]/u.test(code) || !/[\p{N}\p{P}\p{S}]/u.test(code) || [...code].every(c=>c===code[0]) ? 'Use 8–64 bytes with a letter and a number or symbol.' : '';
  for(const [id,error] of [['createName',nameError],['createCode',codeError]]) {message(id+'Error',error);el(id).setAttribute('aria-invalid',String(!!error));}
  if(nameError || codeError) {el(nameError?'createName':'createCode').focus();return null;}
  return {name,code};
}
function showCreateLeague() {
  if(accessBusy)return;
  if(localStorage.getItem(PENDING_CREATE_KEY)) {recoverPendingCreation();return;}
  creationDraft=null;el('createName').value='';el('createCode').value='';el('createCode').type='password';el('createCodeToggle').textContent='Show';el('createCodeToggle').setAttribute('aria-pressed','false');
  for(const id of ['createNameError','createCodeError','createMessage'])message(id,'');
  for(const [key,value] of [['Weeks',6],['Innings',3],['Outs',2]])el('create'+key).value=value;
  setCreateLocked(false);hideAllScreens();el('createLeagueScreen').classList.remove('hidden');el('createName').focus();
}
function toggleCreateCode() {const shown=el('createCode').type==='password';el('createCode').type=shown?'text':'password';el('createCodeToggle').textContent=shown?'Hide':'Show';el('createCodeToggle').setAttribute('aria-pressed',String(shown));}
function nextCreateStep(event) {
  event.preventDefault();if(accessBusy || !validateCreateDetails())return;
  hideAllScreens();el('createSettingsScreen').classList.remove('hidden');message('createLeagueContext',el('createName').value.trim());updateCreateSummary();el('createSettingsTitle').focus();
}
function backCreateStep() {if(accessBusy || creationDraft)return;hideAllScreens();el('createLeagueScreen').classList.remove('hidden');el('createName').focus();}
function cancelCreateLeague() {if(accessBusy || creationDraft)return;el('createCode').value='';el('createName').value='';showDirectory();}
function updateCreateSummary() {message('createSummary',`${el('createInnings').value} innings · ${el('createOuts').value} outs per half-inning · ${el('createWeeks').value}-week season`);}
function setCreateLocked(locked) {for(const id of ['createName','createCode','createWeeks','createInnings','createOuts','createBack'])el(id).disabled=locked;}
function clearCreationDraft() {creationDraft=null;localStorage.removeItem(PENDING_CREATE_KEY);el('createCode').value='';el('createCode').type='password';setCreateLocked(false);}
async function openCreatedLeague(response,token) {
  // Save the confirmed grant BEFORE loading the dashboard, so an interrupted read can recover.
  rememberAccess(response.league_id,{token,expires_at:null});clearCreationDraft();
  try {await enterLeague(response.league_id,{token,expires_at:null});}
  catch(error){showDirectory();message('directoryAccessMessage','Your league was created and this device’s access is saved. Could not open it. '+error.message+' ');el('directoryAccessMessage').append(makeButton('Open created league',()=>requestOpenLeague({id:response.league_id,name:'Your league'})));}
}
async function recoverPendingCreation() {
  const pending=readJsonStorage(PENDING_CREATE_KEY,null);if(!pending || accessBusy)return false;
  accessBusy=true;
  try {
    const result=await wblRpc('wbl_recover_creation',{p_op_id:pending.op_id,p_session_token:pending.session_token});
    if(result.league_id) {await openCreatedLeague(result,pending.session_token);return true;}
    if(!creationDraft) {clearCreationDraft();showDirectory();message('directoryAccessMessage','No completed creation was found. Start again and enter your code.');} else {hideAllScreens();el('createSettingsScreen').classList.remove('hidden');message('createMessage','Creation was not committed. Retry Create league with the same details.');}
    return false;
  }catch(error) {showDirectory();message('directoryAccessMessage','Could not confirm the previous creation. '+error.message+' ');el('directoryAccessMessage').append(makeButton('Retry creation recovery',recoverPendingCreation));return true;}
  finally {accessBusy=false;}
}
async function submitCreate(event) {
  event.preventDefault();if(accessBusy)return;
  const details=validateCreateDetails();if(!details)return;
  accessBusy=true;el('createSubmit').disabled=true;
  try {
    if(!creationDraft) {
      const settings=readRules('create');
      creationDraft={op_id:crypto.randomUUID(),session_token:newRecorderToken(),...details,settings,teams:{teams:[]}};
      // Recovery handle only: no code, name, or settings persisted.
      localStorage.setItem(PENDING_CREATE_KEY,JSON.stringify({op_id:creationDraft.op_id,session_token:creationDraft.session_token}));
    }
    setCreateLocked(true);message('createMessage','Creating league…');
    const response=await wblRpc('wbl_create',{p_request:creationDraft});
    await openCreatedLeague(response,creationDraft.session_token);
  }catch(error){
    message('createMessage',error.message+' Retry to confirm the same creation.');
    if(error.definite){creationDraft=null;localStorage.removeItem(PENDING_CREATE_KEY);setCreateLocked(false);}
  }finally {accessBusy=false;el('createSubmit').disabled=false;}
}
function clearLeagueCache(id) {
  const prefix='wbl-v4:'+id+':';
  if(id==='6767')for(const key of ['wbl-pre-handoff-backup','wiggleLeague','wiggleSeason','wiggleSchedule','wiggleSyncHeadV1','wiggleLiveGameStateV1','wiggleActiveGameLock'])localStorage.removeItem(key);
  for(const key of Object.keys(localStorage))if(key.startsWith(prefix))localStorage.removeItem(key);
}
function showLeagueSettings() {
  hideAllScreens();el('leagueSettingsScreen').classList.remove('hidden');el('settingsName').value=leagueName;
  for(const key of ['Weeks','Innings','Outs'])el('settings'+key).value=leagueSettings[key.toLowerCase()];
  const blocked=!!game||liveGames.length>0||season.games.length>0;
  for(const key of ['Weeks','Innings','Outs'])el('settings'+key).disabled=blocked;
  message('settingsMessage',blocked?'Rule and roster changes are blocked during active games or scored seasons. Finish games, download a backup, then reset the season to change rules.':'Changing rules clears the empty schedule. Configure team names and players under Configure Teams.');
}
async function submitSettings(event) {
  event.preventDefault();
  await runLeagueEdit(async()=>{
    const rules=readRules('settings');leagueName=el('settingsName').value.trim();
    if(JSON.stringify(rules)!==JSON.stringify(leagueSettings)) {leagueSettings=rules;season.rules=deepCloneJson(rules);schedule={days:[],teamNames:[]};}
  },[]);renderLeagueHeader();
}
async function changeSharedCode(event) {
  event.preventDefault();if(!safeToSwitch())return;
  if(!confirm('Change the shared code and revoke ALL device sessions? Saved game progress stays available. Everyone must enter the new code.'))return;
  accessBusy=true;
  try{await wblRpc('wbl_change_code',{p_code:el('newCode').value});el('newCode').value='';invalidateCurrentAccess();}
  catch(error){message('codeMessage',error.message);}finally{accessBusy=false;}
}
window.addEventListener('storage',event=>{if(event.key===ACCESS_KEY && activeAccess && !savedAccess()[LEAGUE_CODE])invalidateCurrentAccess();});
window.addEventListener('popstate',async()=>{
  if(!el('createSettingsScreen').classList.contains('hidden') || !el('createLeagueScreen').classList.contains('hidden')) {if(creationDraft){await recoverPendingCreation();return;}cancelCreateLeague();return;}
  if(!safeToSwitch()){history.pushState(null,'',LEAGUE_CODE?'#league='+encodeURIComponent(LEAGUE_CODE):location.pathname);return;}
  await openRoute();
});
async function openRoute({restoreLast=false}={}) {
  const match=location.hash.match(/^#league=([^&]+)$/);
  const last=restoreLast&&!location.hash?localStorage.getItem(LAST_LEAGUE_KEY):null;
  if(!match&&!(last&&savedAccess()[last])){clearPrivateState();showDirectory();return;}
  let id;try{id=match?decodeURIComponent(match[1]):last;}catch{clearPrivateState();showDirectory();return;}
  if(!/^(6767|[a-f0-9-]{36})$/.test(id)){clearPrivateState();showDirectory();message('directoryMessage','Invalid league link. Find a league below.');return;}
  await requestOpenLeague({id,name:'League '+id.slice(0,8)});
}
