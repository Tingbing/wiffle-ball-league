// Real browser acceptance against an isolated synthetic league only.
// This server replaces backend config in the RESPONSE; source production config stays intact.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const staging = 'https://axyywkipikyahayzipbu.supabase.co';
// Public anon key, never a service-role/admin key. Custom grants protect private RPCs.
const anon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4eXl3a2lwaWt5YWhheXppcGJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NjMwNDIsImV4cCI6MjEwNzEzOTA0Mn0.ZVy5fgy0f7azXXe8n9_1aj0e_l6-ebsC4QJSW0Nne-s';
const errors = [], productionRequests = [], results = [];
let browser, server;
async function capture(page,name) {await page.screenshot({path:'tests/'+name+'.png',fullPage:true});const data=await page.screenshot({type:'jpeg',quality:55,fullPage:true});console.log('SCREENSHOT '+name+' '+data.toString('base64'));}
const check = (name) => { results.push(name); console.log('PASS ' + name); };
async function idle(page) {
  await page.waitForFunction(() => !accessBusy && !leagueEditActive && !recording.busy && !recording.pending && !gameStartInProgress, null, {timeout:30000});
}
async function click(page, selector) { if(selector.includes('#mainMenu button[data-wbl-click=') && /76e1a211d391|a53ca03881a7|5e9db9692103/.test(selector))await page.locator('#leagueMenuButton').click(); await page.locator(selector).click(); await idle(page); }
async function owned(page) { await page.waitForFunction(() => recordingCanAct(), null, {timeout:30000}); }
async function main(page) {
  await page.locator('#mainMenu').waitFor({state:'visible',timeout:30000});
  await idle(page);
}
async function join(page, id, code) {
  await page.goto('http://127.0.0.1:4173/app.html#league=' + id);
  await page.locator('#joinScreen').waitFor({state:'visible'});
  await page.locator('#joinCode').fill(code);
  await page.locator('#joinSubmit').click();
  await main(page);
}
async function play(page, result) {
  await owned(page);
  await click(page, '#confirmPitcherButton');await page.waitForFunction(()=>recordingCanAct()&&!isPitcherSelectionBlockingPlayInput());
  const action=require('node:crypto').createHash('sha256').update("click:recordBattingResult('"+result+"')").digest('hex').slice(0,12); await click(page, '#gameScreen button[data-wbl-click="'+action+'"]');
}
(async () => {
  server = http.createServer((req, res) => {
    const filename = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if(!filename.startsWith(root + path.sep) || !/\.(html|js|css)$/.test(filename)) { res.writeHead(404); return res.end(); }
    try {
      let data = fs.readFileSync(filename, 'utf8');
      if(filename.endsWith('.html'))data=data.replace(/connect-src https:\/\/hunqtklytyorvmztgpqt.supabase.co/g,'connect-src https://axyywkipikyahayzipbu.supabase.co');
      if(path.basename(filename) === 'app.boot.js') {
        data = data.replace(/const SUPABASE_URL = "[^"]+";/, `const SUPABASE_URL = "${staging}";`)
          .replace(/const SUPABASE_ANON_KEY = "[^"]+";/, `const SUPABASE_ANON_KEY = "${anon}";`);
      }
      res.setHeader('content-type', filename.endsWith('.html') ? 'text/html' : filename.endsWith('.css') ? 'text/css' : 'application/javascript');
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(4173,'127.0.0.1',resolve));
  browser = await chromium.launch();
  const desktop = await browser.newContext({viewport:{width:1280,height:900}});
  const phone = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  for(const context of [desktop,phone]) {
    context.on('page', page => {
      page.on('pageerror', error => errors.push(error.message));page.on('console',msg=>{if(/Content Security Policy|violates.*directive/.test(msg.text()))errors.push(msg.text());});
      page.on('dialog', dialog => dialog.accept());
      page.on('request', request => { if(request.url().includes('hunqtklytyorvmztgpqt')) productionRequests.push(request.url()); });
    });
    await context.route('https://hunqtklytyorvmztgpqt.supabase.co/**', route => route.abort());
  }
  const m=await phone.newPage();await m.goto('http://127.0.0.1:4173/app.html');
  await click(m,'#directoryScreen button[data-wbl-click="f610aeac471a"]');await m.locator('#createName').fill('Cancelled setup');await m.locator('#createCode').fill('Cancelled8!');
  await m.locator('#createCodeToggle').click();assert.equal(await m.locator('#createCode').getAttribute('type'),'text');await m.locator('#createCodeToggle').click();
  await capture(m,'setup-phone-details');await click(m,'#createNext');await capture(m,'setup-phone-settings');
  assert.ok(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await click(m,'#createBack');await click(m,'#createLeagueScreen .secondary');
  assert.equal(await m.locator('#createCode').inputValue(),'');assert.equal(await m.evaluate(()=>localStorage.getItem(PENDING_CREATE_KEY)),null);await m.close();
  check('Phone wizard fits viewport; show/hide and Cancel discard draft without creation');
  const a = await desktop.newPage();
  await a.goto('http://127.0.0.1:4173/app.html');
  await a.waitForFunction(() => !directoryBusy && document.querySelector('#directoryList').children.length > 0);
  assert.equal(await a.locator('#mainMenu').isVisible(),false);
  assert.equal(await a.locator('#gameScreen').isVisible(),false);
  await a.locator('#directoryMore').click();
  await a.waitForFunction(() => !directoryBusy);
  assert.ok(await a.locator('#directoryList > div').count() > 20);
  check('Public directory, cursor pagination and private screen gate');
  await a.locator('#directorySearch').fill('No matching league '+crypto.randomUUID());
  await a.locator('#directorySearch').press('Enter');
  await a.waitForFunction(()=>!directoryBusy);
  assert.match(await a.locator('#directoryMessage').textContent(),/No leagues match/);
  await a.route(staging+'/rest/v1/rpc/wbl_directory',route=>route.abort(),{times:1});
  await a.locator('#directorySearch').fill('');
  await a.locator('#directorySearch').press('Enter');
  await a.waitForFunction(()=>!directoryBusy);
  assert.match(await a.locator('#directoryMessage').textContent(),/Could not load leagues/);
  await a.locator('#directoryScreen button[data-wbl-click="5b6d12f1c358"]').click();
  await a.waitForFunction(()=>!directoryBusy);
  assert.ok(await a.locator('#directoryList > div').count()>0);
  check('Directory no-results and network-error states recover with Retry');
  const name = 'Browser Acceptance ' + crypto.randomUUID().slice(0,8), code = 'Browser8!';
  await click(a, '#directoryScreen button[data-wbl-click="f610aeac471a"]');
  await a.locator('#createName').fill(name);
  await a.locator('#createName').focus(); await a.keyboard.press('Tab');
  assert.equal(await a.evaluate(()=>document.activeElement.id),'createCode');
  await a.locator('#createCode').fill('AAAAAAAA');
  let creates=0;
  a.on('request',r=>{if(r.url().endsWith('/wbl_create'))creates++;});
  await click(a,'#createNext');
  assert.match(await a.locator('#createCodeError').textContent(),/letter and a number or symbol/);
  assert.equal(creates,0);
  await a.locator('#createCode').fill(code);
  await click(a,'#createNext');
  assert.equal(await a.locator('#createSettingsScreen').isVisible(),true);
  assert.equal(creates,0);
  await click(a,'#createBack');
  assert.equal(await a.locator('#createCode').inputValue(),code);
  await click(a,'#createNext');
  await a.locator('#createWeeks').fill('7');await a.locator('#createInnings').fill('5');await a.locator('#createOuts').fill('3');
  await capture(a,'setup-settings');
  await click(a,'#createBack');await a.evaluate(()=>{document.getElementById('createCode').type='password';});await capture(a,'setup-details');await click(a,'#createNext');
  assert.equal(await a.locator('#createTeams').count(),0);
  assert.equal(creates,0);
  assert.ok(!await a.evaluate(code=>Object.values(localStorage).some(v=>v.includes(code)),code));
  check('Two creation views, inline validation, Back preservation, no teams/code persistence or early writes');
  // Commit to staging, then lose the successful response. Refresh must recover without another creation.
  await a.route(staging+'/rest/v1/rpc/wbl_create',async route=>{await route.fetch();await route.abort();},{times:1});
  await a.locator('#createSubmit').click();await idle(a);
  assert.ok(await a.evaluate(()=>!!localStorage.getItem(PENDING_CREATE_KEY)));
  await a.reload();await main(a);
  assert.equal(creates,1);
  const id = await a.evaluate(() => LEAGUE_CODE);
  assert.match(id,/^[a-f0-9-]{36}$/);
  assert.equal(await a.locator('#activeLeagueTitle').textContent(),name);
  assert.match(await a.locator('#activeLeagueRules').textContent(),/7 weeks.*0 teams.*5 innings.*3 outs/);
  assert.deepEqual(await a.evaluate(()=>({teams:league.teams.length,days:schedule.days.length,games:season.games.length})),{teams:0,days:0,games:0});
  await capture(a,'setup-empty-league');
  for(const fn of ['showSeasonStats','showRankings','showSchedule','showPostseason']) {await a.evaluate(fn=>window[fn](),fn);await idle(a);await a.evaluate(()=>showMainMenu());}
  check('Lost creation response recovers on refresh exactly once; empty league screens remain usable');
  await click(a,'#leagueReadyState button');
  await capture(a,'setup-empty-teams');
  assert.equal(await a.locator('#addPlayerButton').isEnabled(),false);
  for(let t=1;t<=3;t++) {await a.locator('#teamName').fill('Team '+t);await click(a,'#teamConfigScreen button[data-wbl-click="4b5fa1fd4dda"]');}
  assert.equal(await a.evaluate(()=>league.teams.length),3);
  await a.evaluate(async()=>{const original=window.prompt;window.prompt=()=>"O'Connor & Sons";try{await renameTeam(2);}finally{window.prompt=original;}});await idle(a);
  assert.equal(await a.evaluate(()=>league.teams[2].name),"O'Connor & Sons");
  await click(a,'#teamConfigScreen button[data-wbl-click="916694482531"]');
  check('Teams added inside league one at a time; editing names persists safely');
  assert.equal(await a.evaluate(id=>savedAccess()[id].expires_at,id),null);
  // A grant saved by the previous release may carry an old expiry date.
  await a.evaluate(id=>{const grants=savedAccess();grants[id].expires_at='2000-01-01T00:00:00Z';localStorage.setItem(ACCESS_KEY,JSON.stringify(grants));},id);
  await a.goto('http://127.0.0.1:4173/app.html'); await main(a);
  assert.equal(await a.evaluate(()=>LEAGUE_CODE),id);
  assert.equal(await a.evaluate(id=>savedAccess()[id].expires_at,id),null);
  check('Last league automatically reopens without a code, including old locally expired grants');
  await a.route(staging+'/rest/v1/rpc/wbl_read',route=>route.abort(),{times:1});
  await a.goto('http://127.0.0.1:4173/app.html');
  await a.locator('#directoryAccessMessage button').waitFor({state:'visible'}); await idle(a);
  assert.match(await a.locator('#directoryAccessMessage').textContent(),/access is still saved/);
  assert.ok(await a.evaluate(id=>!!savedAccess()[id],id));
  assert.equal(await a.locator('#joinScreen').isVisible(),false);
  await a.locator('#directoryAccessMessage button').click(); await main(a);
  check('Failed reopening keeps saved access and Retry opens without asking for a code');
  const reopened=await desktop.newPage();
  await reopened.goto('http://127.0.0.1:4173/app.html'); await main(reopened);
  assert.equal(await reopened.evaluate(()=>LEAGUE_CODE),id); await reopened.close();
  check('A new tab in the same device profile reopens the saved league');
  await click(a,'#mainMenu button[data-wbl-click="76e1a211d391"]');
  await a.goto('http://127.0.0.1:4173/app.html');
  await a.locator('#directoryScreen').waitFor({state:'visible'}); await idle(a);
  assert.ok(await a.evaluate(id=>!!savedAccess()[id],id));
  await a.goto('http://127.0.0.1:4173/app.html#league='+id); await main(a);
  check('Switch league keeps access and respects a deliberate return to the directory');
  await click(a, '#mainMenu .menu-button[data-wbl-click="9e69d2212de1"]');
  for(let team=0;team<3;team++) for(let player=1;player<=2;player++) {
    await a.locator('#teamSelect').selectOption(String(team));
    await a.locator('#playerName').fill(`Player ${team+1}-${player}`);
    await click(a,'#teamConfigScreen button[data-wbl-click="ba9344494226"]');
  }
  assert.deepEqual(await a.evaluate(() => league.teams.map(t=>t.players.length)),[2,2,2]);
  await a.locator('#seasonSubName').fill('Browser Substitute');
  await click(a,'#teamConfigScreen button[data-wbl-click="5ae4c927470d"]');
  await click(a,'#teamConfigScreen button[data-wbl-click="916694482531"]');
  await click(a,'#mainMenu button[data-wbl-click="479799de6c39"]');
  // Rebuild action is a real management control; if not needed, schedule already exists.
  const rebuild = a.locator('#scheduleScreen button[data-wbl-click="3dd3fb4ce125"]');
  if(await rebuild.count()) await click(a,'#scheduleScreen button[data-wbl-click="3dd3fb4ce125"]');
  assert.equal(await a.evaluate(() => schedule.days.length),7);
  check('Roster edits and seven-week odd-team schedule persist');
  await click(a,'#scheduleScreen button[data-wbl-click="916694482531"]');
  await a.reload(); await main(a);
  assert.deepEqual(await a.evaluate(() => league.teams.map(t=>t.players.length)),[2,2,2]);
  assert.equal(await a.evaluate(() => schedule.days.length),7);
  check('Reload restores league-scoped roster, rules and schedule');
  const b = await phone.newPage();
  await b.goto('http://127.0.0.1:4173/app.html#league=' + id);
  await b.locator('#joinCode').fill('Wrongcode8!');
  await b.locator('#joinSubmit').click(); await idle(b);
  assert.equal(await b.locator('#mainMenu').isVisible(),false);
  assert.ok((await b.locator('#joinMessage').textContent()).length>0);
  await b.locator('#joinCode').fill(code);
  await b.locator('#joinSubmit').click(); await main(b);
  assert.equal(await b.locator('#activeLeagueTitle').textContent(),name);
  assert.ok(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  check('Phone code gate, successful join and main-menu width');
  await click(a,'#mainMenu button[data-wbl-click="33d31c517791"]');
  await click(a,'#openSubAssignBtn');
  await a.locator('#subScopeSelect').selectOption('game');
  await click(a,'#subAssignCard button[data-wbl-click="45370f8c9887"]');
  assert.match(await a.locator('#subAssignmentSummary').textContent(),/Browser Substitute/);
  await click(a,'#startScheduledGameBtn');
  await a.locator('#gameScreen').waitFor({state:'visible'}); await owned(a);
  assert.deepEqual(await a.evaluate(() => game.rules),{weeks:7,innings:5,outs:3,maxPlayers:2,seriesLength:3});
  assert.ok(await a.evaluate(() => [game.team1,game.team2].some(t=>t.players.includes('Browser Substitute'))));
  check('Game-only substitution survives server save and enters active roster');
  const gameId = await a.evaluate(() => recording.row.id);
  await b.reload(); await main(b);
  await b.locator('#liveGameList button').click();
  await b.locator('#gameScreen').waitFor({state:'visible'});
  assert.equal(await b.evaluate(() => recording.row.mine),false);
  assert.equal(await b.locator("#gameScreen button[data-wbl-click=\"0e85202558d7\"]").isDisabled(),true);
  check('Two devices show one recorder and a read-only phone viewer');
  const duplicateTab=await desktop.newPage();
  await duplicateTab.goto('http://127.0.0.1:4173/app.html#league='+id);
  await main(duplicateTab);
  await duplicateTab.locator('#liveGameList button').click();
  await duplicateTab.locator('#gameScreen').waitFor({state:'visible'});
  assert.equal(await duplicateTab.evaluate(()=>recording.row.mine),false);
  const identities=await Promise.all([a.evaluate(()=>recording.token),duplicateTab.evaluate(()=>recording.token)]);
  assert.notEqual(identities[0],identities[1]);
  assert.equal(await duplicateTab.locator("#gameScreen button[data-wbl-click=\"0e85202558d7\"]").isDisabled(),true);
  await duplicateTab.close();
  check('Two tabs sharing a remembered grant retain distinct recorder identities');
  await play(a,'single');
  assert.equal(await a.evaluate(() => !!game.bases.first),true);
  await click(a,'#undoButton');
  assert.equal(await a.evaluate(() => !!game.bases.first),false);
  await play(a,'HR');
  const score = await a.evaluate(() => game.team1Score + game.team2Score);
  assert.equal(score,1);
  await a.locator('#pitcherSelect').selectOption('1');
  await idle(a);
  assert.equal(await a.evaluate(() => game.currentPitcher.pitcherIndex),1);
  check('Pitcher change persists through scoring controls');
  let intercepted, releaseSave;
  const saveArrived = new Promise(resolve=>intercepted=resolve);
  const saveReleased = new Promise(resolve=>releaseSave=resolve);
  let dropped=false;
  const dropAcknowledgment = async route => {
    const body=route.request().postDataJSON();
    if(!dropped && body.p_request?.op==='save') {
      dropped=true; await route.fetch(); intercepted(); await saveReleased; await route.abort();
    } else await route.continue();
  };
  await a.route(staging+'/rest/v1/rpc/wbl_mutate',dropAcknowledgment);
  await a.locator("#gameScreen button[data-wbl-click=\"0e85202558d7\"]").click();
  await saveArrived; releaseSave();
  await a.waitForFunction(()=>!recording.busy && !!recording.pending);
  assert.equal(await a.evaluate(()=>recordingCanAct()),false);
  assert.equal(await a.locator('#leaveRecordingBtn').isDisabled(),true);
  await a.unroute(staging+'/rest/v1/rpc/wbl_mutate',dropAcknowledgment);
  await click(a,'#retryRecordingBtn'); await owned(a);
  assert.equal(await a.evaluate(()=>game.team1Score+game.team2Score),2);
  await click(a,'#undoButton');
  assert.equal(await a.evaluate(()=>game.team1Score+game.team2Score),1);
  check('Lost acknowledgment pauses scoring/handoff; retry saves exactly once');
  await desktop.setOffline(true);
  await a.waitForFunction(()=>!recordingCanAct());
  assert.equal(await a.locator("#gameScreen button[data-wbl-click=\"0e85202558d7\"]").isDisabled(),true);
  await desktop.setOffline(false); await owned(a);
  check('Offline browser pauses scoring and reconnect verifies ownership');
  await click(a,'#gameScreen button[data-wbl-click="1bf90d1391f0"]');
  await click(a,'#gameScreen button[data-wbl-click="fb6da20fe2f2"]');
  await click(a,'#undoButton');
  await play(a,'K'); await play(a,'out'); await play(a,'out');
  assert.equal(await a.evaluate(() => game.outs),0);
  check('Browser scoring, error/undo and three-out half-inning progression');
  await click(a,'#leaveRecordingBtn');
  await b.waitForFunction(() => !recording.row?.mine && !recording.busy);
  await click(b,'#takeRecordingBtn'); await owned(b);
  assert.equal(await b.evaluate(() => recording.row.id),gameId);
  await a.waitForFunction(() => !recording.row?.mine, null,{timeout:15000});
  check('Recorder handoff preserves game and disables former recorder');
  await play(b,'HR'); await play(b,'HR');
  await b.locator('#gameScreen .end-game-button').click();
  await b.locator('#gameOverScreen').waitFor({state:'visible',timeout:30000}); await idle(b);
  assert.equal(await b.evaluate(() => season.games.length),1);
  assert.deepEqual(await b.evaluate(() => season.games[0].rules),{weeks:7,innings:5,outs:3,maxPlayers:2,seriesLength:3});
  check('Phone finishes game and persists immutable rules and season stats');
  await click(b,'#gameOverScreen button[data-wbl-click="916694482531"]');
  await click(b,'#mainMenu button[data-wbl-click="a53ca03881a7"]');
  assert.equal(await b.locator('#settingsOuts').isDisabled(),true);
  await click(b,'#leagueSettingsScreen button[data-wbl-click="916694482531"]');
  await b.reload(); await main(b);
  assert.equal(await b.evaluate(() => season.games.length),1);
  await click(b,'#mainMenu button[data-wbl-click="7536c2b5b9d1"]');
  assert.ok((await b.locator('#seasonStatsContainer').textContent()).length>0);
  await click(b,'#seasonStatsScreen button[data-wbl-click="840c6a173c01"]');
  assert.match(await b.locator('#pastGameDetails').textContent(),/Browser Substitute/);
  assert.equal(await b.locator('#pastGameDetails table').count(),5);
  await click(b,'#pastGameLogScreen button[data-wbl-click="7536c2b5b9d1"]');
  await click(b,'#seasonStatsScreen button[data-wbl-click="31ff9779a448"]');
  assert.ok((await b.locator('#rankingsContainer').textContent()).length>0);
  await click(b,'#rankingsScreen button[data-wbl-click="7536c2b5b9d1"]');
  check('Phone box score and rankings render saved substitute and pitching lines');
  check('Scored-season rules lock and persisted stats render after reload');
  const restored=await b.evaluate(async()=>{
    const original=JSON.stringify({season,schedule});const backup=createStatsBackupPayload();
    const revisionBefore=leagueRevision;const succeeded=await restoreStatsBackupFromPayload(backup);
    const signature=g=>({id:g.id,team1:g.team1Name,team2:g.team2Name,score1:g.team1Score,score2:g.team2Score,rules:g.rules,lines:g.playerStats.length});
    const same=succeeded===true && leagueRevision>revisionBefore && JSON.stringify(season.games.map(signature))===JSON.stringify(backup.season.games.map(signature));
    const before=JSON.stringify({season,schedule});await restoreStatsBackupFromPayload({...backup,leagueCode:'another-league'});
    const cross=before===JSON.stringify({season,schedule});
    await restoreStatsBackupFromPayload({...backup,code:'Disallowed8!'});
    const fields=before===JSON.stringify({season,schedule});
    await restoreStatsBackupFromPayload({...backup,leagueSnapshot:{teams:[{name:'<img src=x onerror="window.injected=true">',players:[]}]}});
    return {same,cross,fields,injected:!!window.injected};
  });await idle(b);assert.deepEqual(restored,{same:true,cross:true,fields:true,injected:false});
  check('Synthetic backup restores through server; foreign-league, credential and markup imports rejected');
  await click(b,'#seasonStatsScreen button[data-wbl-click="916694482531"]');
  const previousWinner=await b.evaluate(()=>{const g=season.games[0];return g.team1Score>g.team2Score?g.team1Name:g.team2Name;});
  await click(b,'#mainMenu button[data-wbl-click="33d31c517791"]');await click(b,'#startScheduledGameBtn');await owned(b);
  if(await b.evaluate(w=>game.batting.name!==w,previousWinner))for(const outcome of ['K','out','out'])await play(b,outcome);
  await play(b,'HR');await b.locator('#gameScreen .end-game-button').click();await b.locator('#gameOverScreen').waitFor({state:'visible'});await idle(b);
  assert.equal(await b.evaluate(()=>season.games.length),2);
  assert.deepEqual(await b.evaluate(()=>{const s=schedule.days[0].games[0];return {played:s.gamesInSeries.filter(g=>g.result).length,unused:s.gamesInSeries.filter(g=>g.skipped).length};}),{played:2,unused:1});
  assert.equal(await b.evaluate(w=>season.teamRecords[w].wins,previousWinner),1);
  await a.reload();await main(a);assert.equal(await a.evaluate(()=>season.games.length),2);
  await a.locator('#leagueMenuButton').click();await capture(a,'setup-series-clinched');
  check('Real browser best-of3 clinches 2-0; unused game excluded; one series win and two games survive another-device reload');
  await click(b,'#gameOverScreen button[data-wbl-click="916694482531"]');
  await click(b,'#mainMenu button[data-wbl-click="a53ca03881a7"]');
  await b.locator('#newCode').fill('Changed9!');
  await b.locator('#leagueSettingsScreen button').filter({hasText:'Change code'}).click();
  await b.locator('#directoryScreen').waitFor({state:'visible'});
  await a.waitForFunction(() => !activeAccess, null,{timeout:15000});
  assert.equal(await a.locator('#gameScreen').isVisible(),false);
  await join(b,id,'Changed9!');
  await click(b,'#mainMenu button[data-wbl-click="5e9db9692103"]');
  await b.locator('#directoryScreen').waitFor({state:'visible'});
  await b.reload();
  assert.equal(await b.locator('#mainMenu').isVisible(),false);
  assert.equal(await b.evaluate(id=>savedAccess()[id],id),undefined);
  assert.equal(await b.evaluate(()=>localStorage.getItem(LAST_LEAGUE_KEY)),null);
  assert.equal(await b.evaluate(id=>Object.keys(localStorage).filter(k=>k.startsWith('wbl-v4:'+id+':')).length,id),0);
  await b.goto('http://127.0.0.1:4173/app.html#league='+id);
  await b.locator('#joinScreen').waitFor({state:'visible'});
  check('Code rotation revokes both sessions and device leave survives reload');
  // A second materially different league exercises isolated caches, routes and overtime.
  await a.locator('#directoryScreen button[data-wbl-click="f610aeac471a"] ').click();
  await a.locator('#createName').fill(name+' B');
  await a.locator('#createCode').fill(code);
  await click(a,'#createNext');
  for(const key of ['Weeks','Innings','Outs']) await a.locator('#create'+key).fill('1');await a.locator('#createSeriesLength').selectOption('1');
  await a.locator('#createSubmit').click(); await main(a);
  const idB=await a.evaluate(()=>LEAGUE_CODE);
  await click(a,'#mainMenu .menu-button[data-wbl-click="9e69d2212de1"]');
  for(let team=0;team<2;team++){await a.locator('#teamName').fill('Team '+(team+1));await click(a,'#teamConfigScreen button[data-wbl-click="4b5fa1fd4dda"]');}
  for(let team=0;team<2;team++) {
    await a.locator('#teamSelect').selectOption(String(team));
    await a.locator('#playerName').fill('B Player '+team);
    await click(a,'#teamConfigScreen button[data-wbl-click="ba9344494226"]');
  }
  await click(a,'#teamConfigScreen button[data-wbl-click="916694482531"]');
  await click(a,'#mainMenu button[data-wbl-click="479799de6c39"]');
  await click(a,'#scheduleScreen button[data-wbl-click="3dd3fb4ce125"]');
  await click(a,'#scheduleScreen button[data-wbl-click="916694482531"]');
  await click(a,'#mainMenu button[data-wbl-click="76e1a211d391"]');
  await a.locator('#directorySearch').fill(name+' B');
  await a.locator('#directorySearch').press('Enter');
  await a.waitForFunction(()=>!directoryBusy);
  assert.equal(await a.locator('#directoryList > div').count(),1);
  assert.equal(await a.locator('#directoryList button').textContent(),'Open league');
  await a.locator('#directoryList button').focus();
  await a.keyboard.press('Enter'); await main(a);
  assert.equal(await a.evaluate(()=>LEAGUE_CODE),idB);
  check('Directory search and keyboard Open restore a distinct second league');
  await join(a,id,'Changed9!');
  let readReady,releaseRead;
  const readArrived=new Promise(resolve=>readReady=resolve);
  const readReleased=new Promise(resolve=>releaseRead=resolve);
  const delayedA = async route => {
    if(route.request().postDataJSON().p_league_id===id) {
      const response=await route.fetch(); readReady(); await readReleased; await route.fulfill({response});
    } else await route.continue();
  };
  await a.route(staging+'/rest/v1/rpc/wbl_read',delayedA);
  await a.evaluate(()=>{window.delayedReadResult=null;refreshLeagueFromServer().then(()=>window.delayedReadResult='accepted').catch(e=>window.delayedReadResult=e.message);});
  await readArrived;
  await click(a,'#mainMenu button[data-wbl-click="76e1a211d391"]');
  await a.locator('#directoryList button').click(); await main(a);
  assert.equal(await a.evaluate(()=>LEAGUE_CODE),idB);
  releaseRead();
  await a.waitForFunction(()=>window.delayedReadResult!==null);
  assert.match(await a.evaluate(()=>window.delayedReadResult),/old response ignored/);
  assert.deepEqual(await a.evaluate(()=>leagueSettings),{weeks:1,innings:1,outs:1,maxPlayers:2,seriesLength:1});
  assert.equal(await a.evaluate(()=>season.games.length),0);
  await a.unroute(staging+'/rest/v1/rpc/wbl_read',delayedA);
  await a.goBack(); await a.locator('#directoryScreen').waitFor({state:'visible'});
  await a.goBack(); await main(a); assert.equal(await a.evaluate(()=>LEAGUE_CODE),id);
  await a.goForward(); await a.locator('#directoryScreen').waitFor({state:'visible'});
  await a.goForward(); await main(a); assert.equal(await a.evaluate(()=>LEAGUE_CODE),idB);
  check('Delayed former-league read is discarded; back/forward keeps caches isolated');
  await join(b,idB,code);
  await Promise.all([click(a,'#mainMenu button[data-wbl-click="33d31c517791"]'),click(b,'#mainMenu button[data-wbl-click="33d31c517791"]')]);
  await Promise.all([click(a,'#startScheduledGameBtn'),click(b,'#startScheduledGameBtn')]);
  const ownership=await Promise.all([a.evaluate(()=>!!recording.row?.mine),b.evaluate(()=>!!recording.row?.mine)]);
  assert.equal(ownership.filter(Boolean).length,1);
  const recorder=ownership[0]?a:b,viewer=ownership[0]?b:a;
  await owned(recorder);
  if(!await viewer.locator('#gameScreen').isVisible()) await viewer.locator('#liveGameList button').click();
  assert.equal(await viewer.evaluate(()=>recording.row.mine),false);
  check('Simultaneous browser Start creates one game and one active recorder');
  await play(recorder,'K'); await play(recorder,'K');
  assert.equal(await recorder.evaluate(()=>game.inning),2);
  assert.equal(await recorder.evaluate(()=>game.outs),0);
  assert.equal(await recorder.evaluate(()=>!!game.bases.second),true);
  await play(recorder,'HR'); await play(recorder,'K'); await play(recorder,'K');
  await recorder.locator('#gameOverScreen').waitFor({state:'visible'}); await idle(recorder);
  assert.deepEqual(await recorder.evaluate(()=>season.games[0].rules),{weeks:1,innings:1,outs:1,maxPlayers:2,seriesLength:1});
  assert.equal(await recorder.evaluate(()=>season.games.length),1);
  assert.ok(await recorder.evaluate(()=>schedule.days[0].games[0].result));
  check('Best-of1 one-inning/one-out overtime completes and clinches with snapshot rules');
  await a.reload();await main(a);await click(a,'#mainMenu button[data-wbl-click="76e1a211d391"]');
  await click(a,'#directoryScreen button[data-wbl-click="f610aeac471a"]');await a.locator('#createName').fill(name+' Best5');await a.locator('#createCode').fill(code);await click(a,'#createNext');
  for(const key of ['Weeks','Innings','Outs'])await a.locator('#create'+key).fill('1');await a.locator('#createSeriesLength').selectOption('5');await a.locator('#createSubmit').click();await main(a);const idC=await a.evaluate(()=>LEAGUE_CODE);
  await click(a,'#mainMenu .menu-button[data-wbl-click="9e69d2212de1"]');
  for(let i=0;i<2;i++){await a.locator('#teamName').fill(i?'Five B':'Five A');await click(a,'#teamConfigScreen button[data-wbl-click="4b5fa1fd4dda"]');await a.locator('#teamSelect').selectOption(String(i));await a.locator('#playerName').fill(i?'Five B1':'Five A1');await click(a,'#teamConfigScreen button[data-wbl-click="ba9344494226"]');}
  await click(a,'#teamConfigScreen button[data-wbl-click="916694482531"]');await click(a,'#mainMenu button[data-wbl-click="479799de6c39"]');await click(a,'#scheduleScreen button[data-wbl-click="3dd3fb4ce125"]');await click(a,'#scheduleScreen button[data-wbl-click="916694482531"]');
  for(let i=0;i<5;i++){
    await click(a,'#mainMenu button[data-wbl-click="33d31c517791"]');await click(a,'#startScheduledGameBtn');await owned(a);
    const winner=i%2?'Five B':'Five A';const awayWins=await a.evaluate(w=>game.batting.name===w,winner);
    for(const outcome of awayWins?['HR','out','out']:['out','HR','out'])await play(a,outcome);
    await a.locator('#gameOverScreen').waitFor({state:'visible'});await idle(a);assert.equal(await a.evaluate(()=>season.games.length),i+1);
    assert.equal(await a.evaluate(()=>!!schedule.days[0].games[0].result),i===4);
    await click(a,'#gameOverScreen button[data-wbl-click="916694482531"]');
  }
  await join(b,idC,code);assert.equal(await b.evaluate(()=>season.games.length),5);
  assert.deepEqual(await b.evaluate(()=>{const x=season.playerStats['Five A|Five A1'],y=season.playerStats['Five B|Five B1'];return {a:[x.atBats,x.hits,x.homeRuns,x.rbis,x.runsScored,x.pitchOuts,x.runsAllowed],b:[y.atBats,y.hits,y.homeRuns,y.rbis,y.runsScored,y.pitchOuts,y.runsAllowed],wins:season.teamRecords['Five A'].wins};}),{a:[8,3,3,3,3,5,2],b:[7,2,2,2,2,5,3],wins:1});
  await b.locator('#leagueMenuButton').click();await capture(b,'setup-best5-phone');
  check('Real two-step best-of5 browser series stays in progress at 2-2, clinches 3-2 and preserves independently expected player/team totals on another device');
  await click(b,'#mainMenu button[data-wbl-click="7536c2b5b9d1"]');await click(b,'#manualGameStatEditorHubBtn');
  const editId=await b.evaluate(()=>season.games[0].id);await b.locator('#manualGameStatEditorSelect').selectOption(editId);
  const field=b.locator('#manualGameStatEditorContainer input[data-stat-field="pitchOuts"]').first();const editIndex=Number(await field.getAttribute('data-stat-index'));await field.fill('2');
  await b.locator('#manualGameStatEditorContainer button').filter({hasText:'Save Corrections'}).click();await idle(b);
  assert.equal(await b.evaluate(i=>season.games[0].playerStats[i].pitchOuts,editIndex),2);
  assert.equal(await b.evaluate(i=>getPitchingInningsValue(season.games[0].playerStats[i]),editIndex),2);
  await b.locator('#manualGameStatEditorContainer input[data-stat-field="pitchOuts"]').first().fill('1');await b.locator('#manualGameStatEditorContainer button').filter({hasText:'Save Corrections'}).click();await idle(b);
  await a.reload();await main(a);assert.equal(await a.evaluate(()=>season.games.length),5);assert.equal(await a.evaluate(i=>getPitchingInningsValue(season.games[0].playerStats[i]),editIndex),1);
  check('Real manual correction rebuilds actual-out workload with saved rules and persists once; restoring original count leaves five game logs');

  assert.deepEqual(productionRequests,[],'Browser must never contact production');
  assert.deepEqual(errors,[],'No uncaught browser exceptions');
  fs.writeFileSync(path.join(root,'tests/BROWSER_RESULTS.md'),'# Browser acceptance — 2026-10-10\n\nReal isolated staging backend; desktop and 390px phone Chromium.\n\n'+results.map(r=>'- PASS: '+r).join('\n')+'\n\nNo production requests or uncaught exceptions/CSP violations.\n');
  console.log(`Browser acceptance passed: ${results.length} checks; no production requests.`);
})().catch(error => { console.error(error); process.exitCode=1; }).finally(async () => {
  if(browser) await browser.close();
  if(server) await new Promise(resolve=>server.close(resolve));
});
