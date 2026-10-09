// Run ONLY against the isolated test project. Publishable key supplied by environment.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const url=process.env.WBL_TEST_URL,key=process.env.WBL_TEST_KEY;
if(!url || !url.includes('axyywkipikyahayzipbu') || !key)throw new Error('An isolated test URL and publishable key are required.');
const results=[],token=()=>randomBytes(32).toString('hex');
async function api(path,args={},method='POST') {
 const response=await fetch(url+path,{method,headers:{apikey:key,'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(args),signal:AbortSignal.timeout(30000)});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data={message:text};}return {status:response.status,data};
}
async function rpc(name,args) {return api('/rest/v1/rpc/'+name,args);}
function success(r){assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(!r.data.error,JSON.stringify(r.data));return r.data;}
function denied(r){assert.ok(r.status>=400 || r.data.error,JSON.stringify(r.data));}
function pass(name){results.push(name);console.log('PASS '+name);}
const code='Synthetic8!',settings={weeks:7,innings:5,outs:3};
const aToken=token(),bToken=token();
const draft=(name,t)=>({op_id:randomUUID(),session_token:t,name,code,settings,teams:{teams:[{name:name+' Away',players:['One']},{name:name+' Home',players:['Two']},{name:name+' Bye',players:['Three']}]}});
const aDraft=draft('TEST A',aToken),bDraft=draft('TEST B',bToken);
const a=success(await rpc('wbl_create',{p_request:aDraft})),b=success(await rpc('wbl_create',{p_request:bDraft}));
assert.notEqual(a.league_id,b.league_id);pass('atomic creation of two independent custom leagues');
const retry=success(await rpc('wbl_create',{p_request:aDraft}));assert.equal(retry.league_id,a.league_id);pass('idempotent creation retry');
const duplicate=success(await rpc('wbl_create',{p_request:draft('TEST A',token())}));assert.notEqual(duplicate.league_id,a.league_id);pass('duplicate names remain independent');
denied(await rpc('wbl_create',{p_request:draft('RATE LIMIT',token())}));pass('server-side creation throttling');
const directory=success(await rpc('wbl_directory',{p_search:'TEST A'}));assert.equal(directory.leagues.length,2);for(const row of directory.leagues)assert.deepEqual(Object.keys(row).sort(),['created_at','id','name']);pass('directory search exposes minimal listing only');
denied(await rpc('wbl_read',{}));denied(await rpc('wbl_read',{p_league_id:a.league_id,p_access_token:token()}));pass('missing and forged access denied');
denied(await rpc('wbl_join',{p_league_id:a.league_id,p_code:'incorrect',p_session_token:token()}));pass('incorrect code denied');
const otherDevice=token();success(await rpc('wbl_join',{p_league_id:a.league_id,p_code:code,p_session_token:otherDevice}));pass('correct code grants another device access');
const read=(id,t,gameId=null,recorder=null)=>rpc('wbl_read',{p_league_id:id,p_access_token:t,p_game_id:gameId,p_token:recorder});
const adata=success(await read(a.league_id,aToken));assert.deepEqual(adata.league.settings,settings);
denied(await read(b.league_id,aToken));denied(await read(a.league_id,bToken));pass('same code in two leagues does not authorize ID substitution');
const mutate=(id,t,req)=>rpc('wbl_mutate',{p_request:{league_id:id,access_token:t,op_id:randomUUID(),...req}});
denied(await mutate(b.league_id,aToken,{op:'league',league_revision:1,teams:adata.league.teams_json,season:adata.league.season_json,schedule:adata.league.schedule_json,settings,name:'stolen'}));pass('cross-league write denied');
for(const relation of ['season_data','season_data_public','league_members','league','sessions','credentials'])denied(await api('/rest/v1/'+relation+'?select=*',{},'GET'));
denied(await rpc('wbl_read',{p_game_id:null,p_token:null}));pass('legacy RPC, table and view routes cannot bypass access');
function gameState(l,gid) {
 const [team1,team2]=l.teams_json.teams;
 return {game:{rules:l.settings,team1,team2,batting:team1,fielding:team2,_gameInstanceId:'manual-'+gid,_scheduleRef:null,_postseasonRef:null,team1Score:0,team2Score:0,inning:1,halfInning:'top',outs:0,bases:{first:null,second:null,third:null},gameStats:{}},gameHistory:[],lastPlay:null,pendingBattingResult:null,uiState:{}};
}
const gid=randomUUID(),recorder=token(),state=gameState(adata.league,gid);
let g=success(await mutate(a.league_id,aToken,{op:'start',game_id:gid,token:recorder,league_revision:1,state})).data.game;
const secondGid=randomUUID();denied(await mutate(a.league_id,otherDevice,{op:'start',game_id:secondGid,token:token(),league_revision:1,state:gameState(adata.league,secondGid)}));
denied(await mutate(a.league_id,otherDevice,{op:'claim',game_id:gid,token:token(),epoch:g.epoch,revision:g.revision}));pass('one active game and one recorder per league');
const bdata=success(await read(b.league_id,bToken));const bgid=randomUUID();success(await mutate(b.league_id,bToken,{op:'start',game_id:bgid,token:token(),league_revision:1,state:gameState(bdata.league,bgid)}));pass('independent leagues record simultaneously');
denied(await read(b.league_id,aToken,gid,recorder));assert.equal(success(await read(b.league_id,bToken,gid,recorder)).game,null);pass('game IDs cannot cross league boundaries');
const req={op:'save',op_id:randomUUID(),game_id:gid,token:recorder,epoch:g.epoch,revision:g.revision,state:structuredClone(state)};req.state.game.team1Score=1;
g=success(await mutate(a.league_id,aToken,req)).data.game;
assert.equal(success(await mutate(a.league_id,aToken,req)).receipt.op_id,req.op_id);pass('save receipt deduplicates interrupted request retries');
denied(await mutate(a.league_id,aToken,{...req,op_id:randomUUID()}));pass('stale game revision rejected');
const altered=structuredClone(g.state);altered.game.rules.outs=6;denied(await mutate(a.league_id,aToken,{op:'save',game_id:gid,token:recorder,epoch:g.epoch,revision:g.revision,state:altered}));pass('game rule snapshots are immutable');
denied(await mutate(a.league_id,aToken,{op:'league',league_revision:1,settings:{...settings,outs:4},name:'TEST A',teams:adata.league.teams_json,season:adata.league.season_json,schedule:adata.league.schedule_json}));pass('league edits blocked during live games');
const oldEpoch=g.epoch;
g=success(await mutate(a.league_id,aToken,{op:'leave',game_id:gid,token:recorder,epoch:g.epoch,revision:g.revision})).data.game;
const nextRecorder=token();g=success(await mutate(a.league_id,otherDevice,{op:'claim',game_id:gid,token:nextRecorder,epoch:g.epoch,revision:g.revision})).data.game;
denied(await mutate(a.league_id,aToken,{op:'leave',game_id:gid,token:recorder,epoch:oldEpoch,revision:g.revision}));pass('atomic handoff and stale release protection');
const finalState=structuredClone(g.state);finalState.game.team1Score=1;finalState.game.team2Score=0;finalState.game._gameCompletePendingSave=true;
const nextSeason=structuredClone(adata.league.season_json);nextSeason.games=[{id:'manual-'+gid,rules:settings,team1Name:state.game.team1.name,team2Name:state.game.team2.name,team1Score:1,team2Score:0,scheduleRef:null,postseasonRef:null,playerStats:[]}];
g=success(await mutate(a.league_id,otherDevice,{op:'finish',game_id:gid,token:nextRecorder,epoch:g.epoch,revision:g.revision,league_revision:1,state:finalState,season:nextSeason,schedule:adata.league.schedule_json})).data.game;
assert.equal(g.status,'complete');const finished=success(await read(a.league_id,aToken));assert.deepEqual(finished.league.season_json.games[0].rules,settings);pass('completed game retains custom rules across another device read');
denied(await mutate(a.league_id,aToken,{op:'league',league_revision:2,name:'TEST A',settings:{...settings,outs:4},teams:adata.league.teams_json,season:nextSeason,schedule:adata.league.schedule_json}));pass('scored season prevents rule reinterpretation');
success(await rpc('wbl_leave_access',{p_league_id:a.league_id,p_access_token:aToken}));denied(await read(a.league_id,aToken));success(await read(a.league_id,otherDevice));pass('explicit revocation affects only that device grant');
success(await rpc('wbl_change_code',{p_league_id:a.league_id,p_access_token:otherDevice,p_code:'Changed9!'}));denied(await read(a.league_id,otherDevice));denied(await rpc('wbl_create',{p_request:aDraft}));pass('code change revokes all sessions and creation retry cannot restore them');
denied(await rpc('wbl_join',{p_league_id:a.league_id,p_code:code,p_session_token:token()}));success(await rpc('wbl_join',{p_league_id:a.league_id,p_code:'Changed9!',p_session_token:token()}));pass('old code denied and new code works');
writeFileSync('/tmp/wbl-test-ids.json',JSON.stringify({a,b,aToken,bToken,otherDevice,gid,bgid}));
writeFileSync('tests/BACKEND_RESULTS.md',`# Isolated backend results\n\nRun against the free staging project, using real PostgREST HTTP requests with its publishable key. Production was not used.\n\n${results.map(x=>'- PASS: '+x).join('\n')}\n`);
console.log(`${results.length} backend checks passed.`);
