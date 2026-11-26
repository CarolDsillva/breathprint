// @ts-check
import { MODES } from './constants.js';
import { activityHours } from './dose.js';
import { compareChange } from './scenario.js';

/**
 * @typedef {import('./scenario.js').Change} Change
 * @typedef {{
 *   id: string, type: 'shift' | 'mode' | 'windows' | 'purifier' | 'source',
 *   change: Change, title: string, why: string, costly: boolean,
 *   impact: { dosePct: number, weightedPct: number, co2: number, pm: number,
 *             perMember: { memberId: string, name: string, before: number, after: number, pct: number }[] }
 * }} Suggestion
 */

/** Minimum improvement (percent of weighted family dose) worth suggesting. */
const MIN_GAIN_PCT = 0.5;
/** A greener mode may raise the family dose by at most this much (percent). */
const MAX_DOSE_PENALTY_PCT = 3;

/** Smoke-source swaps worth suggesting, from worst to a cleaner option. */
const SOURCE_SWAPS = /** @type {const} */ ({
  'gas-cooking': 'gas-cooking-exhaust',
  'biomass-cooking': 'gas-cooking-exhaust',
  incense: 'none',
  'mosquito-coil': 'none',
});

/**
 * Score a feasible change: weighted dose saved first, emissions saved as a smaller bonus.
 * @param {ReturnType<typeof compareChange>} r
 */
function score(r) {
  if (!r.ok || !r.delta || !r.before) return -Infinity;
  const emitPct = r.before.emissions.co2 > 0 ? (-r.delta.co2 / r.before.emissions.co2) * 100 : 0;
  return -r.delta.weightedPct + 0.25 * emitPct;
}

/**
 * Turn a comparison into a suggestion.
 * @param {Suggestion['type']} type
 * @param {Change} change
 * @param {Exclude<ReturnType<typeof compareChange>, { ok: false }>} r
 * @param {string} why
 * @param {boolean} [costly]
 * @returns {Suggestion}
 */
function toSuggestion(type, change, r, why, costly = false) {
  const d = /** @type {NonNullable<typeof r.delta>} */ (r.delta);
  return {
    id: `${type}:${change.activityId ?? 'home'}`,
    type,
    change,
    title: r.description ?? '',
    why,
    costly,
    impact: { dosePct: d.dosePct, weightedPct: d.weightedPct, co2: d.co2, pm: d.pm, perMember: r.perMember ?? [] },
  };
}

/**
 * Best start time for a flexible activity inside its allowed window (half-hour steps).
 * @param {import('./dose.js').Plan} plan
 * @param {import('./dose.js').Forecast} pm
 * @param {import('./dose.js').Activity} a
 */
function bestShift(plan, pm, a) {
  const win = a.window ?? { from: 6, to: 21 };
  const hours = activityHours(a);
  let best = null;
  for (let s = win.from; s + hours <= win.to + 1e-9; s += 0.5) {
    if (Math.abs(s - a.start) < 1e-9) continue;
    /** @type {Change} */
    const change = { activityId: a.id, start: s };
    const r = compareChange(plan, pm, change);
    if (!r.ok) continue;
    if (!best || score(r) > score(best.r)) best = { change, r };
  }
  return best;
}

/**
 * Best alternative transport mode for a commute.
 * @param {import('./dose.js').Plan} plan
 * @param {import('./dose.js').Forecast} pm
 * @param {import('./dose.js').Activity} a
 */
function bestMode(plan, pm, a) {
  let best = null;
  for (const mode of /** @type {(keyof typeof MODES)[]} */ (Object.keys(MODES))) {
    if (mode === a.mode) continue;
    /** @type {Change} */
    const change = { activityId: a.id, mode };
    const r = compareChange(plan, pm, change);
    if (!r.ok || !r.delta) continue;
    if (r.delta.weightedPct > MAX_DOSE_PENALTY_PCT) continue;
    if (!best || score(r) > score(best.r)) best = { change, r };
  }
  return best;
}

/**
 * Why a transport swap helps, in words that fit the new mode.
 * @param {keyof typeof MODES | undefined} mode
 */
export function modeWhy(mode) {
  if (mode === 'walk' || mode === 'cycle') return 'No exhaust at all, and on a short trip you spend little time next to traffic.';
  if (mode === 'metro' || mode === 'bus') return 'Shared transport puts fewer exhaust pipes on the street, and a closed coach keeps road smoke out.';
  return 'A closed cabin on recirculation keeps most road smoke out.';
}

/**
 * Every useful single change to the plan, best first. Each is judged on its own.
 * @param {import('./dose.js').Plan} plan
 * @param {import('./dose.js').Forecast} pm
 * @returns {Suggestion[]}
 */
export function suggest(plan, pm) {
  /** @type {Suggestion[]} */
  const out = [];
  /**
   * @param {Suggestion['type']} type
   * @param {{ change: Change, r: ReturnType<typeof compareChange> } | null} found
   * @param {string} why
   * @param {boolean} [costly]
   */
  const push = (type, found, why, costly) => {
    if (!found || !found.r.ok || score(found.r) < MIN_GAIN_PCT) return;
    out.push(toSuggestion(type, found.change, /** @type {any} */ (found.r), why, costly));
  };

  for (const a of plan.activities) {
    if (a.flexible && a.kind !== 'commute') {
      push('shift', bestShift(plan, pm, a), 'The air is cleaner at that hour, so the same activity costs your lungs less.');
    }
    if (a.kind === 'commute' && a.mode) {
      const found = bestMode(plan, pm, a);
      push('mode', found, modeWhy(found?.change.mode));
    }
    if (a.kind === 'home' && a.source && a.source in SOURCE_SWAPS) {
      const change = { activityId: a.id, source: SOURCE_SWAPS[/** @type {keyof typeof SOURCE_SWAPS} */ (a.source)] };
      push('source', { change, r: compareChange(plan, pm, change) }, 'Indoor smoke adds to what already leaks in from outside.');
    }
  }
  if (plan.home.windows === 'open' && !plan.home.purifier) {
    const change = /** @type {Change} */ ({ windows: 'closed' });
    push('windows', { change, r: compareChange(plan, pm, change) }, 'Closed windows roughly halve the smog that drifts indoors on bad days.');
  }
  if (!plan.home.purifier) {
    const change = { purifier: true };
    push('purifier', { change, r: compareChange(plan, pm, change) }, 'A HEPA purifier (or a DIY box-fan filter) scrubs the air where your family spends most hours.', true);
  }
  // Largest drop in weighted family dose first; ties go to the bigger emissions cut.
  return out.sort((x, y) => x.impact.weightedPct - y.impact.weightedPct || x.impact.co2 - y.impact.co2);
}

/**
 * Build a cleaner day by applying the best free changes one after another, re-checking each
 * against the updated plan. Costly changes (buying a purifier) are left for the user to choose.
 * @param {import('./dose.js').Plan} plan
 * @param {import('./dose.js').Forecast} pm
 * @param {{ includeCostly?: boolean, maxSteps?: number }} [opts]
 */
export function optimizeDay(plan, pm, opts = {}) {
  const { includeCostly = false, maxSteps = 12 } = opts;
  let current = plan;
  /** @type {Suggestion[]} */
  const applied = [];
  const used = new Set();
  for (let step = 0; step < maxSteps; step++) {
    const next = suggest(current, pm).find((s) => !used.has(s.id) && (includeCostly || !s.costly));
    if (!next) break;
    const r = compareChange(current, pm, next.change);
    if (!r.ok || !r.plan) break;
    used.add(next.id);
    applied.push(next);
    current = r.plan;
  }
  return { plan: current, applied };
}
