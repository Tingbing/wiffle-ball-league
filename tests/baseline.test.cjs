// Existing-behavior checks. No network requests or production writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function context(files) {
  const ctx = vm.createContext({ console, Math, Date,
    localStorage: { getItem() { return null; } },
    updatePitcherSelect() {}, requirePitcherSelectionForCurrentHalfInning() {},
    showNotification() {}, persistLiveGameAutosave() {}, setLiveActionControlsBusy() {},
    finalizeCompletedGame() { return Promise.resolve(true); },
    createBaseRunner(player) { return { player }; }
  });
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  return ctx;
}

for (const count of [4, 5]) test(`${count}-team schedule preserves round robin and avoids double booking`, () => {
  const ctx = context(['core.state.js', 'core.schedule.js']);
  ctx.input = Array.from({ length: count }, (_, i) => ({ name: `Team ${i + 1}`, players: [`Player ${i}`] }));
  for (let sample = 0; sample < 50; sample++) {
    const schedule = vm.runInContext('generateScheduleForTeams(input)', ctx);
    assert.equal(schedule.days.length, count === 4 ? 6 : 5);
    const pairs = new Map(), byes = new Map();
    for (const day of schedule.days) {
      const participating = day.games.flatMap(series => [series.away, series.home]);
      assert.equal(new Set(participating).size, 4);
      assert.equal(day.games.length, 2);
      for (const series of day.games) {
        assert.equal(series.gamesInSeries.length, 3);
        const pair = [series.away, series.home].sort().join('|');
        pairs.set(pair, (pairs.get(pair) || 0) + 1);
      }
      for (const team of ctx.input) if (!participating.includes(team.name)) byes.set(team.name, (byes.get(team.name) || 0) + 1);
    }
    assert.equal(pairs.size, count * (count - 1) / 2);
    assert.ok([...pairs.values()].every(n => n === (count === 4 ? 2 : 1)));
    if (count === 5) {
      assert.equal(byes.size, 5);
      assert.ok([...byes.values()].every(n => n === 1));
    }
    ctx.generated = schedule;
    assert.equal(vm.runInContext('isScheduleCurrentFormat(generated,input.map(t=>t.name))', ctx), true);
  }
});

function gameContext() {
  const ctx = context(['core.state.js', 'app.game.state.js', 'app.game.rules.js']);
  vm.runInContext(`
    game = {
      team1: { name:'A', players:['A1','A2'] }, team2: { name:'B', players:['B1','B2'] },
      batting: { name:'B', players:['B1','B2'] }, fielding: { name:'A', players:['A1','A2'] },
      team1Score:0, team2Score:0, inning:3, halfInning:'bottom', outs:2,
      bases:{first:null,second:null,third:null}, halfInningRuns:0,
      batterIndexByTeam:{A:0,B:0}, overtime:normalizeOvertimeState()
    };
  `, ctx);
  return ctx;
}

test('a tied third inning starts overtime once with one out and the prior batter on second', () => {
  const ctx = gameContext();
  assert.equal(vm.runInContext('endHalfInning(null)', ctx), 'overtime');
  assert.equal(vm.runInContext('game.inning', ctx), 4);
  assert.equal(vm.runInContext('game.outs', ctx), 1);
  assert.equal(vm.runInContext('game.bases.second.player', ctx), 'A2');
  assert.equal(vm.runInContext('getLiveInningLabel()', ctx), 'Top of OT 1 | A Batting');
  vm.runInContext('game.outs=0; game.bases.second=null;', ctx);
  assert.equal(vm.runInContext('startOvertimeHalfInning()', ctx), false);
  assert.equal(vm.runInContext('game.outs', ctx), 0);
});

test('a non-tied final half keeps the completed game recoverable while final save is pending', () => {
  const ctx = gameContext();
  vm.runInContext('game.team1Score=2;', ctx);
  assert.equal(vm.runInContext('endHalfInning(null)', ctx), 'finalizing');
  assert.equal(vm.runInContext('game.inning', ctx), 3);
  assert.equal(vm.runInContext('game.halfInning', ctx), 'bottom');
  assert.equal(vm.runInContext('game._gameCompletePendingSave', ctx), true);
});
