import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isForecast, parseWhatIf, purifierPlan, sanitizeChange, samplePlan, validatePlan } from '../src/engine/index.js';
import { parseTime } from '../src/engine/intent.js';
import { cleanText } from '../src/engine/validate.js';

describe('validatePlan', () => {
  it('accepts the sample plan and derives commute duration', () => {
    const r = validatePlan(samplePlan());
    assert.equal(r.ok, true);
    const trip = r.plan.activities.find((a) => a.id === 'school-run');
    assert.equal(trip.hours, 6 / 25);
  });

  it('strips markup and control characters from names and labels', () => {
    const p = samplePlan();
    p.members[0].name = '<img src=x onerror=alert(1)>Priya\u0007';
    const r = validatePlan(p);
    assert.equal(r.ok, true);
    // eslint-disable-next-line no-control-regex -- checks that the BEL character was removed
    assert.doesNotMatch(r.plan.members[0].name, /[<>\u0007]/);
  });

  it('drops unknown fields', () => {
    const p = samplePlan();
    p.members[0].__proto__polluted = 1;
    p.activities[0].evil = 'x';
    const r = validatePlan(p);
    assert.equal('evil' in r.plan.activities[0], false);
    assert.equal('__proto__polluted' in r.plan.members[0], false);
  });

  it('rejects bad input with readable errors', () => {
    assert.equal(validatePlan(null).ok, false);
    assert.equal(validatePlan({ members: [], activities: [] }).ok, false);
    const p = samplePlan();
    p.activities[0].start = 30;
    p.activities[1].mode = 'rocket';
    p.activities[2].memberIds = ['ghost'];
    const r = validatePlan(p);
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 3);
    assert.match(r.errors.join(' '), /start time/);
  });

  it('caps the number of members and activities', () => {
    const p = samplePlan();
    p.members = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, name: 'x', ageGroup: 'adult' }));
    assert.equal(validatePlan(p).ok, false);
  });

  it('cleans text to a fixed length', () => {
    assert.equal(cleanText('  hi  ', 10), 'hi');
    assert.equal(cleanText('a'.repeat(100), 5), 'aaaaa');
    assert.equal(cleanText(42, 5), '');
  });
});

describe('isForecast', () => {
  it('needs 24 plausible values', () => {
    assert.equal(isForecast(new Array(24).fill(50)), true);
    assert.equal(isForecast([...new Array(23).fill(50), null]), true);
    assert.equal(isForecast(new Array(23).fill(50)), false);
    assert.equal(isForecast([...new Array(23).fill(50), -1]), false);
    assert.equal(isForecast([...new Array(23).fill(50), '50']), false);
  });
});

describe('sanitizeChange', () => {
  it('keeps only known activities, modes and sources', () => {
    const p = samplePlan();
    assert.deepEqual(sanitizeChange({ activityId: 'school-run', mode: 'metro', extra: 1 }, p), { activityId: 'school-run', mode: 'metro' });
    assert.equal(sanitizeChange({ activityId: 'nope', mode: 'metro' }, p), null);
    assert.equal(sanitizeChange({ activityId: 'school-run', mode: 'teleport' }, p), null);
    assert.deepEqual(sanitizeChange({ windows: 'closed' }, p), { windows: 'closed' });
    assert.deepEqual(sanitizeChange({ activityId: 'cricket', start: 14.2 }, p), { activityId: 'cricket', start: 14 });
  });
});

describe('offline what-if parser', () => {
  const plan = samplePlan();
  it('reads clock times and parts of the day', () => {
    assert.equal(parseTime('at 2pm'), 14);
    assert.equal(parseTime('at 7:30 am'), 7.5);
    assert.equal(parseTime('12 am'), 0);
    assert.equal(parseTime('in the afternoon'), 14);
    assert.equal(parseTime('no time here'), null);
  });
  it('maps questions to changes', () => {
    assert.deepEqual(parseWhatIf('What if Aarav plays cricket at 2pm?', plan).change, { activityId: 'cricket', start: 14 });
    assert.deepEqual(parseWhatIf('School run by metro?', plan).change, { activityId: 'school-run', mode: 'metro' });
    assert.deepEqual(parseWhatIf('use the chimney while cooking dinner', plan).change, { activityId: 'cooking', source: 'gas-cooking-exhaust' });
    assert.deepEqual(parseWhatIf('what if we keep the windows shut', plan).change, { windows: 'closed' });
    assert.deepEqual(parseWhatIf('buy a purifier', plan).change, { purifier: true });
  });
  it('explains when it cannot understand', () => {
    const r = parseWhatIf('hello there', plan);
    assert.equal(r.change, null);
    assert.match(r.note, /Try naming/);
  });
});

describe('clean-room calculator', () => {
  const room = { lengthM: 4, widthM: 3.5, heightM: 2.8, outdoorPm: 280 };
  it('gives a finite time for a big enough purifier', () => {
    const r = purifierPlan({ ...room, cadr: 300 });
    assert.ok(r.minutes > 0 && r.minutes < 60);
    assert.ok(r.steady < 35);
    assert.equal(r.recommendedCadr, Math.ceil(r.volume * 5));
  });
  it('says when no purifier can reach the target', () => {
    assert.equal(purifierPlan({ ...room, cadr: 0 }).minutes, null);
    assert.equal(purifierPlan({ ...room, cadr: 150, windowsOpen: true }).minutes, null);
  });
  it('bigger purifiers clean faster', () => {
    assert.ok(purifierPlan({ ...room, cadr: 500 }).minutes < purifierPlan({ ...room, cadr: 300 }).minutes);
  });
});
