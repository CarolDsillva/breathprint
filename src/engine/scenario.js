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

/** @typedef {import('./dose.js').Plan} Plan */
/** @typedef {import('./dose.js').Activity} Activity */

/**
 * Problems with a new transport mode for a trip.
 * @param {Plan} plan
 * @param {Activity} a
 * @param {keyof typeof MODES} modeId
 * @returns {string[]}
 */
function modeProblems(plan, a, modeId) {
  if (a.kind !== 'commute') return [`"${a.label}" is not a trip, so it has no transport mode.`];
  const mode = MODES[modeId];
  if (!mode) return ['Unknown transport mode.'];
  const problems = [];
  if ((a.distanceKm ?? 0) > mode.maxKm) problems.push(`${a.distanceKm} km is too far to ${mode.label.toLowerCase()}.`);
  if (modeId === 'metro' && !plan.home.metro) problems.push('You told us there is no metro near you.');
  if (modeId === 'bus' && !plan.home.bus) problems.push('You told us there is no bus near you.');
  return problems;
}

/**
 * True when the change would leave the activity exactly as planned.
 * @param {Activity} a
 * @param {Change} change
 */
function changesNothing(a, change) {
  return (
    (change.start === undefined || Math.abs(change.start - a.start) < 1e-9) &&
    (change.mode === undefined || change.mode === a.mode) &&
    (change.source === undefined || change.source === a.source)
  );
}

/**
 * Problems with where the moved activity lands: past midnight, clashes, sleeping hours.
 * @param {Plan} plan
 * @param {Activity} moved
 * @param {boolean} timeChanged
 * @returns {string[]}
 */
function timingProblems(plan, moved, timeChanged) {
  const hours = activityHours(moved);
  if (moved.start < 0 || moved.start + hours > 24) return ['The new time runs past midnight.'];
  const slot = { start: moved.start, hours };
  const clash = plan.activities.find(
    (o) =>
      o.id !== moved.id &&
      o.memberIds.some((id) => moved.memberIds.includes(id)) &&
      overlaps(slot, { start: o.start, hours: activityHours(o) }),
  );
  const problems = clash ? [`It would clash with "${clash.label}" at ${formatTime(clash.start)}.`] : [];
  const sleep = plan.sleep ?? DEFAULT_SLEEP;
  const asleep =
    isSleepHour(Math.floor(moved.start), sleep) || isSleepHour(Math.floor(moved.start + hours - 1e-6), sleep);
  if (timeChanged && moved.kind !== 'home' && asleep) problems.push('That time is during sleeping hours.');
  return problems;
}

/**
 * Reasons a change cannot be made, in plain words. Empty means it is feasible.
 * @param {Plan} plan
 * @param {Change} change
 * @returns {string[]}
 */
export function checkChange(plan, change) {
  const touchesHome = change.windows !== undefined || change.purifier !== undefined;
  if (!change.activityId) return touchesHome ? [] : ['The change does not say what to change.'];
  const a = plan.activities.find((x) => x.id === change.activityId);
  if (!a) return ['That activity is not in your plan.'];

  const problems = change.mode ? modeProblems(plan, a, change.mode) : [];
  if (change.source && a.kind !== 'home') problems.push(`"${a.label}" is not at home, so it has no smoke source.`);
  if (!touchesHome && changesNothing(a, change)) problems.push(`That is already how "${a.label}" is planned.`);
  if (problems.length) return problems;

  const moved = /** @type {Activity} */ (applyChange(plan, change).activities.find((x) => x.id === a.id));
  return timingProblems(plan, moved, typeof change.start === 'number');
}

/**
 * Plain-language description of a change, e.g. 'Move "Cricket" from 5:00 PM to 2:00 PM'.
 * @param {Plan} plan
 * @param {Change} change
 */
export function describeChange(plan, change) {
  const a = change.activityId ? plan.activities.find((x) => x.id === change.activityId) : undefined;
  const parts = a ? describeActivityChange(a, change) : [];
  if (change.windows)
    parts.push(change.windows === 'closed' ? 'Keep windows shut at home' : 'Open the windows at home');
  if (change.purifier !== undefined)
    parts.push(change.purifier ? 'Run an air purifier at home' : 'Turn off the air purifier');
  return parts.join('; ');
}

/**
 * @param {Activity} a
 * @param {Change} change
 * @returns {string[]}
 */
function describeActivityChange(a, change) {
  const parts = [];
  if (change.mode)
    parts.push(`Go by ${MODES[change.mode].label} instead of ${MODES[a.mode ?? 'bus'].label} for "${a.label}"`);
  if (typeof change.start === 'number')
    parts.push(`Move "${a.label}" from ${formatTime(a.start)} to ${formatTime(change.start)}`);
  if (change.source) parts.push(`"${a.label}": ${SOURCES[change.source].label.toLowerCase()}`);
  return parts;
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
