// Real HTTPS acceptance. Staging configuration comes from the existing test runner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID,randomBytes} from 'node:crypto';
const root=new URL('..',import.meta.url).pathname;
const source=fs.readFileSync(root+'/tests/browser.cjs','utf8');
const url=source.match(/const staging = '([^']+)'/)[1],key=source.match(/const anon = '([^']+)'/)[1];
assert.ok(url.includes('axyywkipikyahayzipbu'));
const ids=[],results=[],token=()=>randomBytes(32).toString('hex');
const pass=n=>{results.push(n);console.log('PASS '+n);};
async function rpc(name,args){const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(30000)});return {status:r.status,data:await r.json()};}
const ok=r=>{assert.equal(r.status,200);assert.ok(!r.data.error,r.data.error);return r.data;};
const deny=r=>assert.ok(r.status>=400||r.data.error,'Invalid request was accepted');
function engine(l){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'0',classList:{add(){},remove(){}}});return nodes.get(id);};
 const c=vm.createContext({console,Math,Date,document:{getElementById:node},localStorage:{getItem(){return null;}},showNotification(){},updatePitcherSelect(){},updateGameScreen(){},requirePitcherSelectionForCurrentHalfInning(){},keepLiveGameSectionsEnabled(){},persistLiveGameAutosave(){},updatePublicAccessUI(){},showGameOver(){}});
 for(const f of ['core.state.js','core.schedule.js','core.stats.js','app.game.state.js','app.game.runners.js','app.game.rules.js','app.game.play.js','app.game.save.js','app.game.views.js'])vm.runInContext(fs.readFileSync(root+'/'+f,'utf8'),c,{filename:f});
 c.eval=s=>vm.runInContext(s,c);c.data=s=>JSON.parse(JSON.stringify(c.eval(s)));c.l=l;
 c.eval('finalizeCompletedGame=()=>{game._gameCompletePendingSave=true;return true;};leagueSettings=l.settings;league=l.teams_json;season=l.season_json;schedule=l.schedule_json;');
 c.play=result=>{c.result=result;c.eval("constBatter=game.batting.players[getCurrentBatterIndex()];pendingBattingResult={result,batter:constBatter,batterKey:getGameStatsKey(game.batting,constBatter)};recordPitchingResult('clean');");};
 return c;
}
for(const n of [1,3,5]){
 const access=token(),rules={weeks:2,innings:1,outs:1,maxPlayers:3,seriesLength:n};
 const request={op_id:randomUUID(),session_token:access,name:'SERIES ACCEPTANCE '+randomUUID(),code:'Series8!',settings:rules,teams:{teams:[{name:'A',players:['A1']},{name:'B',players:['B1']}]}};
 for(const bad of [0,2,4,2.5,10])deny(await rpc('wbl_create',{p_request:{...request,settings:{...rules,seriesLength:bad}}}));
 const created=ok(await rpc('wbl_create',{p_request:request}));ids.push(created.league_id);fs.writeFileSync('/tmp/wbl-series-cleanup.json',JSON.stringify(ids),{mode:0o600});
 const read=async(t=access)=>ok(await rpc('wbl_read',{p_league_id:created.league_id,p_access_token:t})).league;
 let l=await read();
 const mutate=body=>rpc('wbl_mutate',{p_request:{league_id:l.id,access_token:access,op_id:randomUUID(),...body}});
 const edit=(base,teams=base.teams_json,settings=base.settings,sched=base.schedule_json)=>mutate({op:'league',league_revision:base.revision,name:base.name,settings,teams,season:{...base.season_json,rules:settings},schedule:sched});
 deny(await rpc('wbl_read',{p_league_id:l.id,p_access_token:token()}));
 if(n===1){
  let t=structuredClone(l.teams_json);t.teams[0].players.push('A2');l=ok(await edit(l,t)).data.league;
  const a=structuredClone(l.teams_json),b=structuredClone(l.teams_json);a.teams[0].players.push('A3');b.teams[0].players.push('A4');
  const concurrent=await Promise.all([edit(l,a),edit(l,b)]);assert.equal(concurrent.filter(r=>r.status===200&&!r.data.error).length,1);l=await read();assert.equal(l.teams_json.teams[0].players.length,3);
  const over=structuredClone(l.teams_json);over.teams[0].players.push('Overflow');deny(await edit(l,over));deny(await edit(l,l.teams_json,{...rules,maxPlayers:2}));assert.equal((await read()).teams_json.teams[0].players.length,3);
  pass('Real API: below/exact/over cap, concurrent additions, safe reduction and raw roster preservation');
 }
 const c=engine(l);const sched=c.data('generateWeeklySchedule(league.teams,2)');l=ok(await edit(l,l.teams_json,l.settings,sched)).data.league;
 const malformed=structuredClone(l.schedule_json);malformed.days[0].games[0].bestOf=2;deny(await edit(l,l.teams_json,l.settings,malformed));
 const device=token();ok(await rpc('wbl_join',{p_league_id:l.id,p_code:request.code,p_session_token:device}));
 for(let day=0;day<2;day++){
  const winners=day===0?Array((n+1)/2).fill('A'):Array.from({length:n},(_,i)=>i%2?'B':'A');
  for(let index=0;index<winners.length;index++){
   const e=engine(l);e.day=day;e.index=index;e.gid=randomUUID();e.eval("ref={dayIndex:day,seriesIndex:0,seriesGameIndex:index};series=schedule.days[day].games[0];game={rules:{...leagueSettings},team1:league.teams.find(t=>t.name===series.away),team2:league.teams.find(t=>t.name===series.home),team1Score:0,team2Score:0,inning:1,halfInning:'top',outs:0,halfInningRuns:0,bases:{first:null,second:null,third:null},gameStats:{},currentInningPitchers:{},batterIndexByTeam:{},lineScore:{},overtime:normalizeOvertimeState(),_gameInstanceId:'scheduled-'+day+'-0-'+index,_scheduleRef:ref,_postseasonRef:null};game.batting=game.team1;game.fielding=game.team2;for(const t of [game.team1,game.team2])for(const name of t.players)game.gameStats[getPlayerKey(t.name,name)]=createEmptyStats(t.name,name);");
   const state=e.data('({game,gameHistory,lastPlay,pendingBattingResult,uiState:{}})'),recorder=token();
   const bad=structuredClone(state);bad.game.team1.players=Array(4).fill('Overflow');deny(await mutate({op:'start',game_id:e.gid,token:recorder,league_revision:l.revision,state:bad}));
   let g=ok(await mutate({op:'start',game_id:e.gid,token:recorder,league_revision:l.revision,state})).data.game;
   const tied=structuredClone(state);tied.game._gameCompletePendingSave=true;deny(await mutate({op:'finish',game_id:e.gid,token:recorder,epoch:g.epoch,revision:g.revision,league_revision:l.revision,state:tied,season:l.season_json,schedule:l.schedule_json}));
   if(winners[index]===e.eval('game.team1.name')){e.play('HR');e.play('out');e.play('out');}else{e.play('out');e.play('HR');e.play('out');}
   assert.equal(e.eval('game._gameCompletePendingSave'),true);e.l=l;const final=e.data('buildFinalLeagueSnapshot(l)');
   const req={op:'finish',op_id:randomUUID(),game_id:e.gid,token:recorder,epoch:g.epoch,revision:g.revision,league_revision:l.revision,state:e.data('({game,gameHistory,lastPlay,pendingBattingResult,uiState:{}})'),season:final.season,schedule:final.schedule};
   const result=ok(await mutate(req));l=result.data.league;ok(await mutate(req));assert.deepEqual((await read(device)).season_json,l.season_json);
   if(index<winners.length-1)assert.equal(l.schedule_json.days[day].games[0].result,null);
  }
  const series=l.schedule_json.days[day].games[0];assert.equal(series.result.winner,'A');assert.equal(series.gamesInSeries.filter(x=>x.result).length,winners.length);assert.equal(series.gamesInSeries.filter(x=>x.skipped).length,n-winners.length);
  if(winners.length<n){
   const invalid=structuredClone(l.schedule_json);invalid.days[day].games[0].gamesInSeries[winners.length].result={type:'win',winner:'B',loser:'A'};deny(await edit(l,l.teams_json,l.settings,invalid));
  }
 }
 assert.equal(l.season_json.games.length,(n+1)/2+n);assert.equal(l.season_json.teamRecords.A.wins,2);assert.equal(l.season_json.teamRecords.B.losses,2);
 deny(await edit(l,l.teams_json,{...rules,innings:2}));const before=JSON.stringify(l.season_json);assert.equal(JSON.stringify((await read()).season_json),before);
 pass('Real API best-of '+n+': sweep/split clinch, unused exclusion, idempotent saves, other-device stats, ties/tampered payloads rejected');
}
fs.writeFileSync('tests/SERIES_BACKEND_RESULTS.md','# Real series backend acceptance\n\nIsolated HTTPS PostgREST; no production requests.\n\n'+results.map(r=>'- PASS: '+r).join('\n')+'\n');
console.log(results.length+' grouped real backend checks passed.');
