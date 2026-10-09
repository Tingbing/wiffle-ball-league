const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function context(files) {
 const ctx=vm.createContext({console,Math,Date,localStorage:{getItem(){return null}},createBaseRunner(player){return {player}},updatePitcherSelect(){},requirePitcherSelectionForCurrentHalfInning(){},showNotification(){},persistLiveGameAutosave(){},setLiveActionControlsBusy(){},finalizeCompletedGame(){return Promise.resolve(true)}});
 for(const f of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx,{filename:f});return ctx;
}
test('weekly schedules support 2–8 teams, partial/repeated cycles, and odd-team byes',()=>{
 const ctx=context(['core.state.js','core.schedule.js']);
 for(let n=2;n<=8;n++)for(const weeks of [1,7,52]) {
  ctx.n=n;ctx.weeks=weeks;
  const sched=vm.runInContext(`activeAccess={token:'test'};season.rules={weeks,innings:5,outs:3};generateScheduleForTeams(Array.from({length:n},(_,i)=>({name:'T'+i,players:['P'+i]})))`,ctx);
  assert.equal(sched.days.length,weeks);
  const byes=new Map(),pairs=new Map();
  for(const day of sched.days){const teams=day.games.flatMap(s=>[s.away,s.home]);assert.equal(teams.length,2*Math.floor(n/2));assert.equal(new Set(teams).size,teams.length);if(n%2){assert.ok(day.byeTeam);assert.ok(!teams.includes(day.byeTeam));byes.set(day.byeTeam,(byes.get(day.byeTeam)||0)+1);}for(const s of day.games){assert.equal(s.gamesInSeries.length,3);const k=[s.away,s.home].sort().join('|');pairs.set(k,(pairs.get(k)||0)+1);}}
  if(weeks>=n)assert.ok(Math.max(...pairs.values())-Math.min(...pairs.values())<=1);
  if(n%2 && weeks>=n)assert.ok(Math.max(...byes.values())-Math.min(...byes.values())<=1);
  ctx.sched=sched;assert.equal(vm.runInContext('isScheduleCurrentFormat(sched,sched.teamNames)',ctx),true);
 }
});
function rulesGame(innings,outs){
 const ctx=context(['core.state.js','app.game.state.js','app.game.rules.js']);ctx.innings=innings;ctx.outs=outs;
 vm.runInContext(`game={rules:{weeks:7,innings,outs},team1:{name:'A',players:['A1','A2']},team2:{name:'B',players:['B1']},batting:{name:'B',players:['B1']},fielding:{name:'A',players:['A1','A2']},team1Score:0,team2Score:0,inning:innings,halfInning:'bottom',outs,bases:{first:null,second:null,third:null},batterIndexByTeam:{A:0,B:0},overtime:normalizeOvertimeState()}`,ctx);return ctx;
}
for(const [innings,outs] of [[1,1],[5,3],[9,6]]) {
 test(`${innings}-inning/${outs}-out tied game enters overtime with valid outs and runner on second`,()=>{
  const ctx=rulesGame(innings,outs);assert.equal(vm.runInContext('endHalfInning(null)',ctx),'overtime');assert.equal(vm.runInContext('game.inning',ctx),innings+1);assert.equal(vm.runInContext('game.outs',ctx),Math.min(1,outs-1));assert.equal(vm.runInContext('game.bases.second.player',ctx),'A2');assert.equal(vm.runInContext('getLineScoreInningLabel(game.inning-1)',ctx),'OT1');assert.equal(vm.runInContext('endHalfInning(null)',ctx),'side-change');assert.equal(vm.runInContext('game.halfInning',ctx),'bottom');assert.equal(vm.runInContext('game.outs',ctx),Math.min(1,outs-1));
 });
 test(`${innings}-inning/${outs}-out non-tied game completes at its snapshotted boundary`,()=>{
  const ctx=rulesGame(innings,outs);vm.runInContext('leagueSettings={weeks:1,innings:3,outs:2};game.team1Score=4;',ctx);assert.equal(vm.runInContext('endHalfInning(null)',ctx),'finalizing');assert.equal(vm.runInContext('game.outs',ctx),outs);assert.equal(vm.runInContext('game.inning',ctx),innings);
 });
}
test('pitching innings retain the game denominator and old stats keep two-out definitions',()=>{
 const ctx=context(['core.state.js','app.game.runners.js']);ctx.stats={pitchOuts:7,outsPerInning:3};assert.equal(vm.runInContext('getPitchingInningsValue(stats)',ctx),7/3);ctx.stats={pitchOuts:7};assert.equal(vm.runInContext('getPitchingInningsValue(stats)',ctx),3.5);
});
