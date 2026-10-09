// Directory is public. Private screens are rendered only after a server-validated grant.
const ACCESS_KEY='wbl-v4-access';
let directoryCursor=null,directoryMore=false,directoryBusy=false,directoryRequest=0;
let joinTarget=null,accessBusy=false,creationDraft=null;
const privateScreenTemplates=new Map();
function el(id) {return document.getElementById(id);}
function message(id,text) {el(id).textContent=text;}
function makeButton(text,fn) {const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;return b;}
function savedAccess() {return readJsonStorage(ACCESS_KEY,{});}
function rememberAccess(id,value) {const grants=savedAccess();if(value)grants[id]=value;else delete grants[id];localStorage.setItem(ACCESS_KEY,JSON.stringify(grants));}
function renderLeagueHeader() {message('activeLeagueTitle',leagueName);message('activeLeagueRules',`${leagueSettings.weeks} weeks • ${league.teams?.length || ''} teams • ${leagueSettings.innings} innings • ${leagueSettings.outs} outs per half-inning`);}
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
  rememberAccess(id,null);clearPrivateState();
  showDirectory();message('directoryMessage','Access expired or was revoked. Enter the league’s current code to reopen it. Unconfirmed saves remain scoped to that league on this device.');
}
function safeToSwitch() {
  if(accessBusy || recording.busy || recording.pending || leagueEditActive) {alert('Wait for the current request and resolve pending saves before switching leagues.');return false;}
  if(recording.row?.mine && recording.row.status==='live') {alert('Use Leave Recording before switching leagues so another device can resume.');return false;}
  return true;
}
function showDirectory() {hideAllScreens();el('directoryScreen').classList.remove('hidden');loadDirectory(false);}
function switchToDirectory() {if(!safeToSwitch())return;clearPrivateState();history.pushState(null,'',location.pathname+location.search);showDirectory();}
async function loadDirectory(append=false) {
  if(append&&directoryBusy)return;
  const request=++directoryRequest;directoryBusy=true;
  if(!append){directoryCursor=null;el('directoryList').replaceChildren();}
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
  const grant=savedAccess()[row.id];
  if(grant && Date.parse(grant.expires_at)>Date.now()) {
    try {await enterLeague(row.id,grant);return;}catch(error){rememberAccess(row.id,null);}
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
    await refreshLeagueFromServer();rememberAccess(id,grant);
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
  try{await wblRpc('wbl_leave_access',{});rememberAccess(LEAGUE_CODE,null);clearPrivateState();history.pushState(null,'',location.pathname+location.search);showDirectory();}
  catch(error){alert('Revocation was not confirmed. '+error.message);}finally{accessBusy=false;}
}
function readRules(prefix) {
  const s={weeks:Number(el(prefix+'Weeks').value),innings:Number(el(prefix+'Innings').value),outs:Number(el(prefix+'Outs').value)};
  if(!Number.isInteger(s.weeks)||s.weeks<1||s.weeks>52||!Number.isInteger(s.innings)||s.innings<1||s.innings>9||!Number.isInteger(s.outs)||s.outs<1||s.outs>6)throw new Error('Use 1–52 weeks, 1–9 innings and 1–6 outs.');return s;
}
function showCreateLeague() {if(accessBusy)return;hideAllScreens();el('createLeagueScreen').classList.remove('hidden');message('createMessage','');updateCreateTeams();el('createName').focus();}
function updateCreateTeams() {
  const box=el('createTeams'),n=Number(el('createTeamCount').value);
  const names=Array.from(box.querySelectorAll('input')).map(x=>x.value);box.replaceChildren();
  for(let i=0;i<n;i++){const label=document.createElement('label');label.textContent='Team '+(i+1);const input=document.createElement('input');input.required=true;input.maxLength=60;input.value=names[i]||'Team '+(i+1);input.name='team'+i;label.append(input);box.append(label);}
  message('createPostseason',n===4?'Four-team leagues support the existing double-elimination postseason.':'The existing postseason bracket supports exactly four teams. This league will use the regular-season schedule and standings.');
}
async function submitCreate(event) {
  event.preventDefault();if(accessBusy)return;accessBusy=true;el('createSubmit').disabled=true;
  try {
    const settings=readRules('create'),name=el('createName').value.trim(),code=el('createCode').value;
    const teams={teams:Array.from(el('createTeams').querySelectorAll('input')).map(x=>({name:x.value.trim(),players:[]}))};
    if(new Set(teams.teams.map(t=>t.name.toLowerCase())).size!==teams.teams.length)throw new Error('Use a different name for every team.');
    creationDraft=creationDraft||{op_id:crypto.randomUUID(),session_token:newRecorderToken()};
    const request={...creationDraft,name,code,teams,settings};message('createMessage','Creating league…');
    const response=await wblRpc('wbl_create',{p_request:request});
    const token=creationDraft.session_token;creationDraft=null;el('createCode').value='';
    alert(`Created ${name}.\n\nShared code: ${code}\n${settings.weeks} weeks • ${settings.innings} innings • ${settings.outs} outs\n\nSave this code privately. Everyone using it has full league access. This device remembers access for seven days.`);
    await enterLeague(response.league_id,{token,expires_at:response.expires_at});
  }catch(error){message('createMessage',error.message+' If a request was interrupted, retry with the same details in this tab.');if(error.definite)creationDraft=null;}
  finally{accessBusy=false;el('createSubmit').disabled=false;}
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
  if(!safeToSwitch()){history.pushState(null,'',LEAGUE_CODE?'#league='+encodeURIComponent(LEAGUE_CODE):location.pathname);return;}
  await openRoute();
});
async function openRoute() {
  const match=location.hash.match(/^#league=([^&]+)$/);
  if(!match){clearPrivateState();showDirectory();return;}
  let id;try{id=decodeURIComponent(match[1]);}catch{showDirectory();return;}
  if(!/^(6767|[a-f0-9-]{36})$/.test(id)){clearPrivateState();showDirectory();message('directoryMessage','Invalid league link. Find a league below.');return;}
  await requestOpenLeague({id,name:'League '+id.slice(0,8)});
}
