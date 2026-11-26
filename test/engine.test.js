import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGE_GROUPS,
  CIGARETTE_EXPOSURE,
  MODES,
  SAMPLE_FORECAST,
  activityHours,
  applyChange,
  checkChange,
  compareChange,
  computeDay,
  memberDose,
  memberWeight,
  optimizeDay,
  planEmissions,
  samplePlan,
  suggest,
} from '../src/engine/index.js';
import { formatTime, isSleepHour, overlaps, segments } from '../src/engine/time.js';

const flat = (v) => new Array(24).fill(v);

/** One adult resting at home with windows shut, nothing else. */
const homeOnly = () => ({
  members: [{ id: 'a', name: 'A', ageGroup: 'adult', sensitive: false }],
  home: { windows: 'closed', purifier: false, metro: true, bus: true },
  sleep: { from: 22, to: 6 },
  activities: [],
});

describe('time helpers', () => {
  it('splits intervals across clock hours', () => {
    assert.deepEqual(segments(7.5, 1), [{ hour: 7, fraction: 0.5 }, { hour: 8, fraction: 0.5 }]);
    assert.deepEqual(segments(23.5, 2), [{ hour: 23, fraction: 0.5 }], 'clipped at midnight');
  });
  it('detects overlaps and sleep hours, including windows that wrap midnight', () => {
    assert.equal(overlaps({ start: 7, hours: 1 }, { start: 7.5, hours: 1 }), true);
    assert.equal(overlaps({ start: 7, hours: 1 }, { start: 8, hours: 1 }), false, 'touching is not overlapping');
    assert.equal(isSleepHour(23, { from: 22, to: 6 }), true);
    assert.equal(isSleepHour(12, { from: 22, to: 6 }), false);
    assert.equal(isSleepHour(2, { from: 1, to: 7 }), true);
  });
  it('formats times for people', () => {
    assert.equal(formatTime(0), '12:00 AM');
    assert.equal(formatTime(7.5), '7:30 AM');
    assert.equal(formatTime(14), '2:00 PM');
  });
});

describe('dose model', () => {
  it('matches a hand calculation for a resting day at home', () => {
    const r = memberDose(homeOnly(), homeOnly().members[0], flat(100));
    const rates = AGE_GROUPS.adult.rates;
    // 8 h asleep + 16 h resting, indoor air = 100 × 0.5 (closed windows)
    const expected = 50 * (8 * rates.sleep + 16 * rates.rest);
    assert.ok(Math.abs(r.total - expected) < 1e-6);
    assert.ok(Math.abs(r.cigarettes - (50 * 24) / CIGARETTE_EXPOSURE) < 1e-9);
    assert.equal(r.missingHours, 0);
  });

  it('scales linearly with outdoor pollution when there is no indoor smoke', () => {
    const p = samplePlan();
    p.activities = p.activities.filter((a) => a.kind !== 'home');
    const a = computeDay(p, flat(100)).total;
    const b = computeDay(p, flat(200)).total;
    assert.ok(Math.abs(b - 2 * a) < 1e-6);
  });

  it('returns zero dose in clean air and skips missing hours', () => {
    const p = homeOnly();
    assert.equal(computeDay(p, flat(0)).total, 0);
    const gaps = flat(100);
    gaps[3] = null;
    gaps[4] = null;
    assert.equal(memberDose(p, p.members[0], gaps).missingHours, 2);
  });

  it('charges more for hard exercise outdoors than for rest indoors', () => {
    const p = homeOnly();
    p.activities = [{ id: 'run', label: 'Run', memberIds: ['a'], start: 7, hours: 1, kind: 'outdoor', intensity: 'vigorous' }];
    const withRun = computeDay(p, flat(100)).total;
    const without = computeDay(homeOnly(), flat(100)).total;
    // 1 h vigorous outdoors (100 × 3.0) replaces 1 h resting indoors (50 × 0.31)
    assert.ok(Math.abs(withRun - without - (300 - 50 * AGE_GROUPS.adult.rates.rest)) < 1e-6);
  });

  it('adds indoor smoke from cooking and incense', () => {
    const p = homeOnly();
    p.activities = [{ id: 'c', label: 'Cook', memberIds: ['a'], start: 19, hours: 1, kind: 'home', intensity: 'light', source: 'gas-cooking' }];
    const smoky = computeDay(p, flat(100)).total;
    p.activities[0].source = 'gas-cooking-exhaust';
    assert.ok(computeDay(p, flat(100)).total < smoky);
  });

  it('weights children, elders and sensitive people higher', () => {
    assert.ok(memberWeight({ ageGroup: 'child', sensitive: false }) > memberWeight({ ageGroup: 'adult', sensitive: false }));
    assert.ok(memberWeight({ ageGroup: 'adult', sensitive: true }) > memberWeight({ ageGroup: 'adult', sensitive: false }));
  });

  it('derives commute time from distance and mode speed', () => {
    assert.equal(activityHours({ kind: 'commute', mode: 'metro', distanceKm: 16, hours: 9 }), 16 / MODES.metro.speed);
    assert.equal(activityHours({ kind: 'outdoor', hours: 2 }), 2);
  });
});

describe('emissions', () => {
  it('counts a private vehicle once and shared transit per passenger', () => {
    const base = { id: 't', label: 'Trip', start: 8, hours: 1, kind: 'commute', intensity: 'rest', distanceKm: 10 };
    const car = planEmissions({ activities: [{ ...base, mode: 'car', memberIds: ['a', 'b'] }] });
    const bus = planEmissions({ activities: [{ ...base, mode: 'bus', memberIds: ['a', 'b'] }] });
    assert.equal(car.co2, MODES.car.co2 * 10);
    assert.equal(bus.co2, MODES.bus.co2 * 10 * 2);
  });
  it('treats walking and cycling as zero-emission', () => {
    const e = planEmissions({ activities: [{ id: 'w', label: 'W', memberIds: ['a'], start: 8, hours: 0.2, kind: 'commute', intensity: 'light', mode: 'walk', distanceKm: 1 }] });
    assert.equal(e.co2, 0);
    assert.equal(e.pm, 0);
  });
});

describe('scenarios', () => {
  it('keeps the arrival time when changing transport mode', () => {
    const p = samplePlan();
    const before = p.activities.find((a) => a.id === 'school-run');
    const end = before.start + activityHours(before);
    const after = applyChange(p, { activityId: 'school-run', mode: 'metro' }).activities.find((a) => a.id === 'school-run');
    assert.ok(Math.abs(after.start + activityHours(after) - end) < 0.01);
    assert.equal(p.activities.find((a) => a.id === 'school-run').mode, 'two-wheeler', 'original plan is untouched');
  });

  it('rejects impossible changes with a reason', () => {
    const p = samplePlan();
    assert.match(checkChange(p, { activityId: 'cricket', start: 10 }).join(), /clash with "School"/);
    assert.match(checkChange(p, { activityId: 'office-trip', mode: 'walk' }).join(), /too far/);
    assert.match(checkChange(p, { activityId: 'cricket', mode: 'metro' }).join(), /not a trip/);
    assert.match(checkChange(p, { activityId: 'nope', start: 10 }).join(), /not in your plan/);
    assert.match(checkChange(p, { activityId: 'cricket', start: 17 }).join(), /already/);
    assert.match(checkChange({ ...p, home: { ...p.home, metro: false } }, { activityId: 'school-run', mode: 'metro' }).join(), /no metro/);
    assert.match(checkChange(p, { activityId: 'walk', start: 23 }).join(), /sleeping|midnight/);
  });

  it('reports both sides of the ledger for a what-if', () => {
    const r = compareChange(samplePlan(), SAMPLE_FORECAST, { activityId: 'office-trip', mode: 'metro' });
    assert.equal(r.ok, true);
    assert.ok(r.delta.co2 < 0, 'metro emits less than an auto-rickshaw');
    assert.ok(r.delta.dosePct < 0, 'and Priya breathes less in a closed metro coach');
    assert.equal(r.perMember.length, 4);
  });
});

describe('optimiser', () => {
  it('moves flexible outdoor activities to the cleanest allowed hours', () => {
    const s = suggest(samplePlan(), SAMPLE_FORECAST).find((x) => x.change.activityId === 'cricket');
    assert.ok(s, 'cricket should be moved');
    assert.equal(s.change.start, 14, 'cleanest window that fits after school');
    assert.ok(s.impact.weightedPct < 0);
  });

  it('never suggests changes that make the family breathe more', () => {
    for (const s of suggest(samplePlan(), SAMPLE_FORECAST)) {
      assert.ok(s.impact.weightedPct <= 3, s.title);
    }
  });

  it('builds a cleaner, valid day using only free changes by default', () => {
    const p = samplePlan();
    const { plan, applied } = optimizeDay(p, SAMPLE_FORECAST);
    assert.ok(applied.length >= 3);
    assert.ok(applied.every((s) => !s.costly), 'purifier purchase is left to the family');
    assert.ok(computeDay(plan, SAMPLE_FORECAST).total < computeDay(p, SAMPLE_FORECAST).total * 0.8);
    assert.ok(computeDay(plan, SAMPLE_FORECAST).emissions.co2 < computeDay(p, SAMPLE_FORECAST).emissions.co2);
  });

  it('in clean outdoor air only suggests fixes for indoor smoke and emissions', () => {
    const types = new Set(suggest(samplePlan(), flat(0)).map((s) => s.type));
    assert.equal(types.has('shift'), false);
    assert.equal(types.has('windows'), false);
    assert.equal(types.has('purifier'), false);
    assert.ok(types.has('source'), 'cooking smoke still matters indoors');
  });
});

describe('timeline', () => {
  it('shows what each person mostly does each hour', async () => {
    const { memberTimeline } = await import('../src/engine/index.js');
    const p = samplePlan();
    const aarav = memberTimeline(p, p.members.find((m) => m.id === 'aarav'));
    assert.equal(aarav.length, 24);
    assert.equal(aarav[2].kind, 'sleep');
    assert.equal(aarav[10].kind, 'indoor-away');
    assert.equal(aarav[17].kind, 'outdoor');
    const dadi = memberTimeline(p, p.members.find((m) => m.id === 'dadi'));
    assert.equal(dadi[19].smoke, true, 'cooking without exhaust');
  });
});
