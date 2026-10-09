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
const check = (name) => { results.push(name); console.log('PASS ' + name); };
async function idle(page) {
  await page.waitForFunction(() => !accessBusy && !leagueEditActive && !recording.busy && !recording.pending && !gameStartInProgress, null, {timeout:30000});
}
async function click(page, selector) { await page.locator(selector).click(); await idle(page); }
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
  if(await page.evaluate(() => game.pitcherSelectionRequired)) await click(page, '#confirmPitcherButton');
  await click(page, `#gameScreen button[onclick="recordBattingResult('${result}')"]`);
}
(async () => {
  server = http.createServer((req, res) => {
    const filename = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if(!filename.startsWith(root + path.sep) || !/\.(html|js|css)$/.test(filename)) { res.writeHead(404); return res.end(); }
    try {
      let data = fs.readFileSync(filename, 'utf8');
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
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      page.on('request', request => { if(request.url().includes('hunqtklytyorvmztgpqt')) productionRequests.push(request.url()); });
    });
    await context.route('https://hunqtklytyorvmztgpqt.supabase.co/**', route => route.abort());
  }
  const a = await desktop.newPage();
  await a.goto('http://127.0.0.1:4173/app.html');
  await a.waitForFunction(() => !directoryBusy && document.querySelector('#directoryList').children.length > 0);
  assert.equal(await a.locator('#mainMenu').isVisible(),false);
  assert.equal(await a.locator('#gameScreen').isVisible(),false);
  await a.locator('#directoryMore').click();
  await a.waitForFunction(() => !directoryBusy);
  assert.ok(await a.locator('#directoryList > div').count() > 20);
  check('Public directory, cursor pagination and private screen gate');
  const name = 'Browser Acceptance ' + crypto.randomUUID().slice(0,8), code = 'Browser8!';
  await click(a, '#directoryScreen button[onclick="showCreateLeague()"]');
  await a.locator('#createName').fill(name);
  await a.locator('#createCode').fill(code);
  await a.locator('#createTeamCount').fill('3');
  await a.locator('#createTeamCount').dispatchEvent('change');
  await a.locator('#createWeeks').fill('7');
  await a.locator('#createInnings').fill('5');
  await a.locator('#createOuts').fill('3');
  await a.locator('#createSubmit').click();
  await main(a);
  const id = await a.evaluate(() => LEAGUE_CODE);
  assert.match(id,/^[a-f0-9-]{36}$/);
  assert.equal(await a.locator('#activeLeagueTitle').textContent(),name);
  assert.match(await a.locator('#activeLeagueRules').textContent(),/7 weeks.*3 teams.*5 innings.*3 outs/);
  check('UI creates custom three-team league and retains validated access');
  await click(a, '#mainMenu button[onclick="showTeamConfig()"]');
  for(let team=0;team<3;team++) for(let player=1;player<=2;player++) {
    await a.locator('#teamSelect').selectOption(String(team));
    await a.locator('#playerName').fill(`Player ${team+1}-${player}`);
    await click(a,'#teamConfigScreen button[onclick="addPlayer()"]');
  }
  assert.deepEqual(await a.evaluate(() => league.teams.map(t=>t.players.length)),[2,2,2]);
  await a.locator('#seasonSubName').fill('Browser Substitute');
  await click(a,'#teamConfigScreen button[onclick="addSeasonSub()"]');
  await click(a,'#teamConfigScreen button[onclick="showMainMenu()"]');
  await click(a,'#mainMenu button[onclick="showSchedule()"]');
  // Rebuild action is a real management control; if not needed, schedule already exists.
  const rebuild = a.locator('#scheduleScreen button[onclick="forceRegenerateSchedule()"]');
  if(await rebuild.count()) await click(a,'#scheduleScreen button[onclick="forceRegenerateSchedule()"]');
  assert.equal(await a.evaluate(() => schedule.days.length),7);
  check('Roster edits and seven-week odd-team schedule persist');
  await click(a,'#scheduleScreen button[onclick="showMainMenu()"]');
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
  await click(a,'#mainMenu button[onclick="showGameSetup()"]');
  await click(a,'#openSubAssignBtn');
  await a.locator('#subScopeSelect').selectOption('game');
  await click(a,'#subAssignCard button[onclick="confirmSubAssignment()"]');
  assert.match(await a.locator('#subAssignmentSummary').textContent(),/Browser Substitute/);
  await click(a,'#startScheduledGameBtn');
  await a.locator('#gameScreen').waitFor({state:'visible'}); await owned(a);
  assert.deepEqual(await a.evaluate(() => game.rules),{weeks:7,innings:5,outs:3});
  assert.ok(await a.evaluate(() => [game.team1,game.team2].some(t=>t.players.includes('Browser Substitute'))));
  check('Game-only substitution survives server save and enters active roster');
  const gameId = await a.evaluate(() => recording.row.id);
  await b.reload(); await main(b);
  await b.locator('#liveGameList button').click();
  await b.locator('#gameScreen').waitFor({state:'visible'});
  assert.equal(await b.evaluate(() => recording.row.mine),false);
  assert.equal(await b.locator("#gameScreen button[onclick=\"recordBattingResult('HR')\"]").isDisabled(),true);
  check('Two devices show one recorder and a read-only phone viewer');
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
  await a.locator("#gameScreen button[onclick=\"recordBattingResult('HR')\"]").click();
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
  assert.equal(await a.locator("#gameScreen button[onclick=\"recordBattingResult('HR')\"]").isDisabled(),true);
  await desktop.setOffline(false); await owned(a);
  check('Offline browser pauses scoring and reconnect verifies ownership');
  await click(a,'#gameScreen button[onclick="showErrorPicker()"]');
  await click(a,'#gameScreen button[onclick="confirmError()"]');
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
  await play(b,'HR');
  await b.locator('#gameScreen .end-game-button').click();
  await b.locator('#gameOverScreen').waitFor({state:'visible',timeout:30000}); await idle(b);
  assert.equal(await b.evaluate(() => season.games.length),1);
  assert.deepEqual(await b.evaluate(() => season.games[0].rules),{weeks:7,innings:5,outs:3});
  check('Phone finishes game and persists immutable rules and season stats');
  await click(b,'#gameOverScreen button[onclick="showMainMenu()"]');
  await click(b,'#mainMenu button[onclick="showLeagueSettings()"]');
  assert.equal(await b.locator('#settingsOuts').isDisabled(),true);
  await click(b,'#leagueSettingsScreen button[onclick="showMainMenu()"]');
  await b.reload(); await main(b);
  assert.equal(await b.evaluate(() => season.games.length),1);
  await click(b,'#mainMenu button[onclick="showSeasonStats()"]');
  assert.ok((await b.locator('#seasonStatsContainer').textContent()).length>0);
  await click(b,'#seasonStatsScreen button[onclick="showPastGameLog()"]');
  assert.match(await b.locator('#pastGameDetails').textContent(),/Browser Substitute/);
  assert.equal(await b.locator('#pastGameDetails table').count(),5);
  await click(b,'#pastGameLogScreen button[onclick="showSeasonStats()"]');
  await click(b,'#seasonStatsScreen button[onclick="showRankings()"]');
  assert.ok((await b.locator('#rankingsContainer').textContent()).length>0);
  await click(b,'#rankingsScreen button[onclick="showSeasonStats()"]');
  check('Phone box score and rankings render saved substitute and pitching lines');
  check('Scored-season rules lock and persisted stats render after reload');
  await click(b,'#seasonStatsScreen button[onclick="showMainMenu()"]');
  await click(b,'#mainMenu button[onclick="showLeagueSettings()"]');
  await b.locator('#newCode').fill('Changed9!');
  await b.locator('#leagueSettingsScreen button').filter({hasText:'Change code'}).click();
  await b.locator('#directoryScreen').waitFor({state:'visible'});
  await a.waitForFunction(() => !activeAccess, null,{timeout:15000});
  assert.equal(await a.locator('#gameScreen').isVisible(),false);
  await join(b,id,'Changed9!');
  await click(b,'#mainMenu button[onclick="leaveLeagueAccess()"]');
  await b.locator('#directoryScreen').waitFor({state:'visible'});
  await b.reload();
  assert.equal(await b.locator('#mainMenu').isVisible(),false);
  check('Code rotation revokes both sessions and device leave survives reload');
  // A second materially different league exercises isolated caches, routes and overtime.
  await a.locator('#directoryScreen button[onclick="showCreateLeague()"] ').click();
  await a.locator('#createName').fill(name+' B');
  await a.locator('#createCode').fill(code);
  await a.locator('#createTeamCount').fill('2');
  await a.locator('#createTeamCount').dispatchEvent('change');
  for(const key of ['Weeks','Innings','Outs']) await a.locator('#create'+key).fill('1');
  await a.locator('#createSubmit').click(); await main(a);
  const idB=await a.evaluate(()=>LEAGUE_CODE);
  await click(a,'#mainMenu button[onclick="showTeamConfig()"]');
  for(let team=0;team<2;team++) {
    await a.locator('#teamSelect').selectOption(String(team));
    await a.locator('#playerName').fill('B Player '+team);
    await click(a,'#teamConfigScreen button[onclick="addPlayer()"]');
  }
  await click(a,'#teamConfigScreen button[onclick="showMainMenu()"]');
  await click(a,'#mainMenu button[onclick="showSchedule()"]');
  await click(a,'#scheduleScreen button[onclick="forceRegenerateSchedule()"]');
  await click(a,'#scheduleScreen button[onclick="showMainMenu()"]');
  await click(a,'#mainMenu button[onclick="switchToDirectory()"]');
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
  await click(a,'#mainMenu button[onclick="switchToDirectory()"]');
  await a.locator('#directoryList button').click(); await main(a);
  assert.equal(await a.evaluate(()=>LEAGUE_CODE),idB);
  releaseRead();
  await a.waitForFunction(()=>window.delayedReadResult!==null);
  assert.match(await a.evaluate(()=>window.delayedReadResult),/old response ignored/);
  assert.deepEqual(await a.evaluate(()=>leagueSettings),{weeks:1,innings:1,outs:1});
  assert.equal(await a.evaluate(()=>season.games.length),0);
  await a.unroute(staging+'/rest/v1/rpc/wbl_read',delayedA);
  await a.goBack(); await a.locator('#directoryScreen').waitFor({state:'visible'});
  await a.goBack(); await main(a); assert.equal(await a.evaluate(()=>LEAGUE_CODE),id);
  await a.goForward(); await a.locator('#directoryScreen').waitFor({state:'visible'});
  await a.goForward(); await main(a); assert.equal(await a.evaluate(()=>LEAGUE_CODE),idB);
  check('Delayed former-league read is discarded; back/forward keeps caches isolated');
  await join(b,idB,code);
  await Promise.all([click(a,'#mainMenu button[onclick="showGameSetup()"]'),click(b,'#mainMenu button[onclick="showGameSetup()"]')]);
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
  assert.deepEqual(await recorder.evaluate(()=>season.games[0].rules),{weeks:1,innings:1,outs:1});
  assert.equal(await recorder.evaluate(()=>season.games.length),1);
  check('One-inning/one-out browser overtime and natural completion use snapshot rules');
  assert.deepEqual(productionRequests,[],'Browser must never contact production');
  assert.deepEqual(errors,[],'No uncaught browser exceptions');
  console.log(`Browser acceptance passed: ${results.length} checks; no production requests.`);
})().catch(error => { console.error(error); process.exitCode=1; }).finally(async () => {
  if(browser) await browser.close();
  if(server) await new Promise(resolve=>server.close(resolve));
});
