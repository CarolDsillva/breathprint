// @ts-check
import { DEFAULT_SLEEP, MODES, SOURCES } from './constants.js';
import { activityHours, computeDay } from './dose.js';
import { formatTime, isSleepHour, overlaps } from './time.js';

/**
 * A change to try on a plan. Every field is optional; at least one must be set.
 * @typedef {{
 *   activityId?: string, start?: number, mode?: keyof typeof MODES,
 *   source?: keyof typeof SOURCES, windows?: 'open' | 'closed', purifier?: boolean
 * }} Change
 */

/**
 * Apply a change to a copy of the plan. A new commute mode keeps the arrival time fixed.
 * @param {import('./dose.js').Plan} plan
 * @param {Change} change
 * @returns {import('./dose.js').Plan}
 */
export function applyChange(plan, change) {
  const next = structuredClone(plan);
  if (change.windows) next.home.windows = change.windows;
  if (typeof change.purifier === 'boolean') next.home.purifier = change.purifier;
  const a = change.activityId ? next.activities.find((x) => x.id === change.activityId) : undefined;
  if (!a) return next;
  if (change.mode && a.kind === 'commute') {
    const end = a.start + activityHours(a);
    a.mode = change.mode;
    a.start = Math.max(0, round2(end - activityHours(a)));
  }
  if (typeof change.start === 'number') a.start = change.start;
  if (change.source && a.kind === 'home') a.source = change.source;
  return next;
}

/**
 * Reasons a change cannot be made, in plain words. Empty means it is feasible.
 * @param {import('./dose.js').Plan} plan
 * @param {Change} change
 * @returns {string[]}
 */
export function checkChange(plan, change) {
  const errors = [];
  const hasHome = change.windows !== undefined || change.purifier !== undefined;
  if (!change.activityId && !hasHome) errors.push('The change does not say what to change.');
  if (!change.activityId) return errors;

  const a = plan.activities.find((x) => x.id === change.activityId);
  if (!a) return ['That activity is not in your plan.'];
  if (change.mode) {
    if (a.kind !== 'commute') errors.push(`"${a.label}" is not a trip, so it has no transport mode.`);
    else if (!MODES[change.mode]) errors.push('Unknown transport mode.');
    else {
      const mode = MODES[change.mode];
      if ((a.distanceKm ?? 0) > mode.maxKm)
        errors.push(`${a.distanceKm} km is too far to ${mode.label.toLowerCase()}.`);
      if (change.mode === 'metro' && !plan.home.metro) errors.push('You told us there is no metro near you.');
      if (change.mode === 'bus' && !plan.home.bus) errors.push('You told us there is no bus near you.');
    }
  }
  if (change.source && a.kind !== 'home') errors.push(`"${a.label}" is not at home, so it has no smoke source.`);
  const same =
    (change.start === undefined || Math.abs(change.start - a.start) < 1e-9) &&
    (change.mode === undefined || change.mode === a.mode) &&
    (change.source === undefined || change.source === a.source) &&
    !hasHome;
  if (same) errors.push(`That is already how "${a.label}" is planned.`);
  if (errors.length) return errors;

  const moved = applyChange(plan, change).activities.find((x) => x.id === a.id);
  if (!moved) return errors;
  const hours = activityHours(moved);
  if (moved.start < 0 || moved.start + hours > 24) return ['The new time runs past midnight.'];
  const others = plan.activities.filter((o) => o.id !== a.id && o.memberIds.some((id) => moved.memberIds.includes(id)));
  const clash = others.find((o) =>
    overlaps({ start: moved.start, hours }, { start: o.start, hours: activityHours(o) }),
  );
  if (clash) errors.push(`It would clash with "${clash.label}" at ${formatTime(clash.start)}.`);
  if (typeof change.start === 'number' && moved.kind !== 'home') {
    const sleep = plan.sleep ?? DEFAULT_SLEEP;
    if (isSleepHour(Math.floor(moved.start), sleep) || isSleepHour(Math.floor(moved.start + hours - 1e-6), sleep)) {
      errors.push('That time is during sleeping hours.');
    }
  }
  return errors;
}

/**
 * Plain-language description of a change, e.g. 'Move "Cricket" to 2:00 PM'.
 * @param {import('./dose.js').Plan} plan
 * @param {Change} change
 */
export function describeChange(plan, change) {
  const a = change.activityId ? plan.activities.find((x) => x.id === change.activityId) : undefined;
  const parts = [];
  if (a && change.mode)
    parts.push(`Go by ${MODES[change.mode].label} instead of ${MODES[a.mode ?? 'bus'].label} for "${a.label}"`);
  if (a && typeof change.start === 'number')
    parts.push(`Move "${a.label}" from ${formatTime(a.start)} to ${formatTime(change.start)}`);
  if (a && change.source) parts.push(`"${a.label}": ${SOURCES[change.source].label.toLowerCase()}`);
  if (change.windows)
    parts.push(change.windows === 'closed' ? 'Keep windows shut at home' : 'Open the windows at home');
  if (change.purifier === true) parts.push('Run an air purifier at home');
  if (change.purifier === false) parts.push('Turn off the air purifier');
  return parts.join('; ');
}

/**
 * @typedef {{ memberId: string, name: string, before: number, after: number, pct: number }} MemberDelta
 * @typedef {{ dosePct: number, weightedPct: number, co2: number, pm: number }} Delta
 * @typedef {{
 *   ok: true, errors: string[], description: string, plan: import('./dose.js').Plan,
 *   before: ReturnType<typeof computeDay>, after: ReturnType<typeof computeDay>,
 *   delta: Delta, perMember: MemberDelta[]
 * }} Comparison a feasible change, with its effect on every family member
 * @typedef {{ ok: false, errors: string[] }} Rejection a change that cannot be made, with reasons
 */

/**
 * Compare the plan before and after a change.
 * @param {import('./dose.js').Plan} plan
 * @param {import('./dose.js').Forecast} pm
 * @param {Change} change
 * @returns {Comparison | Rejection}
 */
export function compareChange(plan, pm, change) {
  const errors = checkChange(plan, change);
  if (errors.length) return { ok: false, errors };
  const after = applyChange(plan, change);
  const b = computeDay(plan, pm);
  const c = computeDay(after, pm);
  return {
    ok: true,
    errors: [],
    description: describeChange(plan, change),
    plan: after,
    before: b,
    after: c,
    delta: {
      dosePct: pct(b.total, c.total),
      weightedPct: pct(b.weighted, c.weighted),
      co2: c.emissions.co2 - b.emissions.co2,
      pm: c.emissions.pm - b.emissions.pm,
    },
    perMember: plan.members.map((m, i) => ({
      memberId: m.id,
      name: m.name,
      before: b.members[i].total,
      after: c.members[i].total,
      pct: pct(b.members[i].total, c.members[i].total),
    })),
  };
}

/**
 * Percentage change from a to b (negative = less).
 * @param {number} a
 * @param {number} b
 */
export function pct(a, b) {
  return a === 0 ? 0 : ((b - a) / a) * 100;
}

/** @param {number} n */
function round2(n) {
  return Math.round(n * 100) / 100;
}
