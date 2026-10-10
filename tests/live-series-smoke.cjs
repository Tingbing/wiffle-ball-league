// Bounded synthetic smoke test against verified deployed bytes; never opens real leagues.
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const url='https://tingbing.github.io/wiffle-ball-league/app.html';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const results=[];let browser;
const pass=s=>{results.push(s);console.log('PASS '+s);};
async function bytesMatch(){for(const file of ['app.html','app.boot.js','core.schedule.js','app.game.views.js']){const r=await fetch(new URL(file,url)+'?smoke='+Date.now());if(!r.ok||hash(await r.text())!==hash(fs.readFileSync(file,'utf8')))return false;}return true;}
async function idle(p){await p.waitForFunction(()=>!accessBusy&&!leagueEditActive&&!recording.busy&&!recording.pending&&!gameStartInProgress);}
async function click(p,s){await p.locator(s).click();await idle(p);}
async function main(p){await p.locator('#mainMenu').waitFor({state:'visible'});await idle(p);}
async function play(p,r){await p.waitForFunction(()=>recordingCanAct());await click(p,'#confirmPitcherButton');await p.waitForFunction(()=>recordingCanAct()&&!isPitcherSelectionBlockingPlayInput());const action=hash("click:recordBattingResult('"+r+"')").slice(0,12);await click(p,'#gameScreen button[data-wbl-click="'+action+'"]');}
(async()=>{
 let ready=false;for(let i=0;i<30;i++){if(await bytesMatch()){ready=true;break;}await new Promise(r=>setTimeout(r,5000));}assert.ok(ready,'Deployed bytes do not match the tested commit');pass('HTTPS deployed app/config/schedule/stats hashes match the tested checkout');
 browser=await chromium.launch();const context=await browser.newContext({viewport:{width:390,height:844}}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
 await p.goto(url);await p.waitForFunction(()=>!directoryBusy);await click(p,'#directoryScreen button[data-wbl-click="f610aeac471a"]');
 await p.locator('#createName').fill('ROLLOUT SMOKE '+crypto.randomUUID());await p.locator('#createCode').fill('Smoke8!!');await click(p,'#createNext');await p.locator('#createWeeks').waitFor({state:'visible'});
 for(const key of ['Weeks','Innings','Outs'])await p.locator('#create'+key).fill('1');await p.locator('#createMaxPlayers').fill('3');await p.locator('#createSeriesLength').selectOption('1');await p.locator('#createSubmit').click();await main(p);
 await click(p,'#mainMenu .menu-button[data-wbl-click="9e69d2212de1"]');
 for(let i=0;i<2;i++){await p.locator('#teamName').fill('Smoke '+(i?'B':'A'));await click(p,'#teamConfigScreen button[data-wbl-click="4b5fa1fd4dda"]');await p.locator('#teamSelect').selectOption(String(i));await p.locator('#playerName').fill('Smoke Player '+i);await click(p,'#teamConfigScreen button[data-wbl-click="ba9344494226"]');}
 await click(p,'#teamConfigScreen button[data-wbl-click="916694482531"]');await click(p,'#mainMenu button[data-wbl-click="479799de6c39"]');await click(p,'#scheduleScreen button[data-wbl-click="3dd3fb4ce125"]');await click(p,'#scheduleScreen button[data-wbl-click="916694482531"]');
 await click(p,'#mainMenu button[data-wbl-click="33d31c517791"]');await click(p,'#startScheduledGameBtn');for(const r of ['HR','out','out'])await play(p,r);await p.locator('#gameOverScreen').waitFor({state:'visible'});await idle(p);await click(p,'#gameOverScreen button[data-wbl-click="916694482531"]');
 await p.reload();await main(p);assert.equal(await p.evaluate(()=>season.games.length),1);assert.ok(await p.evaluate(()=>schedule.days[0].games[0].result));assert.equal(await p.evaluate(()=>Object.values(season.teamRecords).reduce((n,r)=>n+r.wins,0)),1);assert.deepEqual(await p.evaluate(()=>leagueSettings),{weeks:1,innings:1,outs:1,maxPlayers:3,seriesLength:1});pass('Live two-step creation, under-cap rosters, best-of1 scoring/clinch and remembered access survive reload');
 await p.locator('#leagueMenuButton').click();await p.screenshot({path:'tests/live-series-dashboard.png',fullPage:true});console.log('SCREENSHOT live-series-dashboard '+(await p.screenshot({type:'jpeg',quality:55,fullPage:true})).toString('base64'));
 await click(p,'#leagueMenuItems button[data-wbl-click="5e9db9692103"]');await p.locator('#directoryScreen').waitFor({state:'visible'});await p.reload();assert.equal(await p.evaluate(()=>Object.keys(savedAccess()).length),0);assert.deepEqual(errors,[]);pass('Live explicit Leave revokes the synthetic device and clears remembered access; no browser exceptions');
 fs.writeFileSync('tests/LIVE_SERIES_RESULTS.md','# Production smoke\n\nSynthetic rollout league only; cleanup is performed separately using its exact generated identity.\n\n'+results.map(r=>'- PASS: '+r).join('\n')+'\n');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
