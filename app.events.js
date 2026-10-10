// Static, reviewed handlers. No eval, inline scripts, or user-supplied JavaScript.
const wblHandlers={
"f610aeac471a":function(event){showCreateLeague()},
"a126523bc1e4":function(event){event.preventDefault();loadDirectory(false)},
"5b6d12f1c358":function(event){loadDirectory(false)},
"a28d114a3677":function(event){loadDirectory(true)},
"b4a3f4ce2a2e":function(event){if(!accessBusy)showDirectory()},
"c31db9250cd8":function(event){submitJoin(event)},
"a4ac163ecc33":function(event){nextCreateStep(event)},
"390f85c1b13d":function(event){toggleCreateCode()},
"f1124699b8b1":function(event){cancelCreateLeague()},
"154bb5c1d45d":function(event){submitCreate(event)},
"2c1b7613e6cf":function(event){updateCreateSummary()},
"6fb7aad68347":function(event){backCreateStep()},
"916694482531":function(event){showMainMenu()},
"3c1b94318db3":function(event){submitSettings(event)},
"7ca28eebc840":function(event){changeSharedCode(event)},
"25b814330aae":function(event){window.location.reload()},
"76e1a211d391":function(event){switchToDirectory()},
"a53ca03881a7":function(event){showLeagueSettings()},
"5e9db9692103":function(event){leaveLeagueAccess()},
"9e69d2212de1":function(event){showTeamConfig()},
"2d5f475fe602":function(event){manualResaveAllStats()},
"33d31c517791":function(event){showGameSetup()},
"7536c2b5b9d1":function(event){showSeasonStats()},
"479799de6c39":function(event){showSchedule()},
"0eabfada4050":function(event){showPostseason()},
"4b5fa1fd4dda":function(event){addTeam()},
"ba9344494226":function(event){addPlayer()},
"5ae4c927470d":function(event){addSeasonSub()},
"1c13ec0c027e":function(event){populateScheduleSeriesSelect()},
"bea7c97490b0":function(event){populateScheduleGameSelect()},
"b08e46628ded":function(event){toggleSubAssignCard(true)},
"cac07d0535e2":function(event){startSelectedScheduledGame()},
"3becb01ee70f":function(event){resetSeason()},
"045f114f889b":function(event){populateSubTeamSelect()},
"66f4760beab3":function(event){populateSubReplacePlayerSelect()},
"45370f8c9887":function(event){confirmSubAssignment()},
"7f0eff023b00":function(event){toggleSubAssignCard(false)},
"2e7ebcd493f3":function(event){startGame()},
"2345955291ae":function(event){leaveRecording()},
"33bd8c87a643":function(event){takeRecording()},
"98662861be11":function(event){retryRecording()},
"fec9fd3877fd":function(event){resolveUnsentRecording()},
"7397f52226db":function(event){exportRecordingRecovery()},
"789517d1d06d":function(event){endGameEarly()},
"ea041ace3a0b":function(event){undoLastAction()},
"1bf90d1391f0":function(event){showErrorPicker()},
"fb6da20fe2f2":function(event){confirmError()},
"86f098fd849d":function(event){cancelError()},
"9ad4cf752069":function(event){showOutPicker()},
"a03dfaa890fe":function(event){confirmRunnerOut()},
"9c87c13f6de0":function(event){cancelRunnerOut()},
"63cc94a4065b":function(event){updatePitcherDisplay()},
"5eb3f3a72a47":function(event){confirmCurrentPitcherSelection()},
"f714c854e26d":function(event){recordBattingResult('single')},
"130acd2b4d85":function(event){recordBattingResult('double')},
"b4469250922c":function(event){recordBattingResult('triple')},
"0e85202558d7":function(event){recordBattingResult('HR')},
"86f9b272a9f0":function(event){recordBattingResult('walk')},
"366d811fc9e3":function(event){recordBattingResult('HBP')},
"f86239258cb6":function(event){recordBattingResult('K')},
"a4076b1d16b6":function(event){recordBattingResult('out')},
"7c3e4fa4503a":function(event){recordBattingResult('doublePlay')},
"1bb13bdc1344":function(event){executeManualRunnerMove()},
"aa68fb117273":function(event){clearBases()},
"31ff9779a448":function(event){showRankings()},
"840c6a173c01":function(event){showPastGameLog()},
"f16260b267db":function(event){showManualGameStatEditor()},
"54d83c85372c":function(event){showPlayerStats()},
"2414c00b696e":function(event){showTeamStats()},
"5e743aa58eac":function(event){downloadStatsBackupJson()},
"bc6ea7433f7d":function(event){openStatsRestorePicker()},
"4050eb948563":function(event){handleStatsRestoreFile(event)},
"b8ff4e7730a5":function(event){return removePlayer(...JSON.parse(this.getAttribute('data-wbl-args')));},
"0f5f77e9d383":function(event){return renameTeam(...JSON.parse(this.getAttribute('data-wbl-args')));},
"64b8f2f5cf6c":function(event){return removeTeam(...JSON.parse(this.getAttribute('data-wbl-args')));},
"b9b98b77753c":function(event){return removeSeasonSub(...JSON.parse(this.getAttribute('data-wbl-args')));},
"ce51b52976c7":function(event){return removeSubAssignment(...JSON.parse(this.getAttribute('data-wbl-args')));},
"dd63c331babe":function(event){return removeSubAssignment(...JSON.parse(this.getAttribute('data-wbl-args')));},
"3dd3fb4ce125":function(event){forceRegenerateSchedule()},
"a1fef1c5242b":function(event){return endSeriesEarly(...JSON.parse(this.getAttribute('data-wbl-args')));},
"631a70834f72":function(event){refreshChangeScheduleControls()},
"d7b1e05a3d4b":function(event){applySelectedScheduleChange()},
"f344d513a8f6":function(event){createPostseasonBracket()},
"1d924e3b4166":function(event){resetPostseason()}
};
for(const eventName of ['click','change','input','submit','keydown','focus','blur']) {
  document.addEventListener(eventName,event=>{
    const target=event.target.closest('[data-wbl-'+eventName+']');if(!target)return;
    const handler=wblHandlers[target.getAttribute('data-wbl-'+eventName)];
    if(handler)handler.call(target,event);
  },eventName==='focus'||eventName==='blur');
}

function closeLeagueMenu(focus=false) {
  const b=el('leagueMenuButton'),items=el('leagueMenuItems');if(!b||!items)return;
  items.classList.add('hidden');b.setAttribute('aria-expanded','false');if(focus)b.focus();
}
document.addEventListener('click',e=>{
  const b=el('leagueMenuButton'),items=el('leagueMenuItems');if(!b||!items)return;
  if(e.target.closest('#leagueMenuButton')){const open=b.getAttribute('aria-expanded')!=='true';items.classList.toggle('hidden',!open);b.setAttribute('aria-expanded',String(open));if(open)items.querySelector('button').focus();}
  else if(e.target.closest('#leagueMenuItems button')||!e.target.closest('.league-menu'))closeLeagueMenu();
});
document.addEventListener('keydown',e=>{
  const b=el('leagueMenuButton'),items=el('leagueMenuItems');if(!b||!items)return;
  if(e.target===b&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();items.classList.remove('hidden');b.setAttribute('aria-expanded','true');const buttons=[...items.querySelectorAll('button')];buttons[e.key==='ArrowUp'?buttons.length-1:0].focus();return;}
  if(items.classList.contains('hidden'))return;
  if(e.key==='Escape'){e.preventDefault();closeLeagueMenu(true);}
  if(e.target.closest('#leagueMenuItems')&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=[...items.querySelectorAll('button')];const i=buttons.indexOf(document.activeElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}
  if(e.key==='Tab')closeLeagueMenu();
});
