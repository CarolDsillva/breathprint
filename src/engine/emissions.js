// @ts-check
import { MODES } from './constants.js';

/**
 * Emissions a single commute adds to the city's air.
 * Private vehicles are counted once however many people ride; shared transit is per passenger.
 * @param {import('./dose.js').Activity} a
 * @returns {{ co2: number, pm: number }} grams of CO₂, milligrams of PM2.5
 */
export function commuteEmissions(a) {
  if (a.kind !== 'commute' || !a.mode || !a.distanceKm) return { co2: 0, pm: 0 };
  const mode = MODES[a.mode];
  const riders = mode.perVehicle ? 1 : Math.max(1, a.memberIds.length);
  return { co2: mode.co2 * a.distanceKm * riders, pm: mode.pm * a.distanceKm * riders };
}

/**
 * Total transport emissions for the day's plan.
 * @param {import('./dose.js').Plan} plan
 */
export function planEmissions(plan) {
  /** @type {Record<string, { co2: number, pm: number }>} */
  const byActivity = {};
  let co2 = 0;
  let pm = 0;
  for (const a of plan.activities) {
    const e = commuteEmissions(a);
    if (e.co2 === 0 && e.pm === 0) continue;
    byActivity[a.id] = e;
    co2 += e.co2;
    pm += e.pm;
  }
  return { co2, pm, byActivity };
}
