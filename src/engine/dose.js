// @ts-check
import {
  AGE_GROUPS,
  CIGARETTE_EXPOSURE,
  DEFAULT_SLEEP,
  MODES,
  PLACE_RATIO,
  SENSITIVE_WEIGHT_BONUS,
  SOURCES,
  WHO_24H_PM25,
} from './constants.js';
import { isSleepHour, segments } from './time.js';
import { planEmissions } from './emissions.js';

/**
 * @typedef {{ id: string, name: string, ageGroup: keyof typeof AGE_GROUPS, sensitive: boolean }} Member
 * @typedef {{
 *   id: string, label: string, memberIds: string[], start: number, hours: number,
 *   kind: 'home' | 'indoor-away' | 'outdoor' | 'commute',
 *   intensity: 'sleep' | 'rest' | 'light' | 'moderate' | 'vigorous',
 *   mode?: keyof typeof MODES, distanceKm?: number, source?: keyof typeof SOURCES,
 *   nearTraffic?: boolean, flexible?: boolean, window?: { from: number, to: number }
 * }} Activity
 * @typedef {{ windows: 'open' | 'closed', purifier: boolean, metro: boolean, bus: boolean }} Home
 * @typedef {{ members: Member[], home: Home, sleep?: { from: number, to: number }, activities: Activity[] }} Plan
 * @typedef {(number | null)[]} Forecast 24 hourly PM2.5 values in µg/m³ (null = missing)
 */

/**
 * Duration of an activity in hours. A commute's duration follows from distance and mode speed.
 * @param {Activity} a
 */
export function activityHours(a) {
  if (a.kind === 'commute' && a.mode && a.distanceKm) return a.distanceKm / MODES[a.mode].speed;
  return a.hours;
}

/**
 * Ratio of indoor to outdoor PM2.5 at home: purifier, closed or open windows.
 * @param {Home} home
 */
export function homeRatio(home) {
  if (home.purifier) return PLACE_RATIO['home-purifier'];
  return home.windows === 'open' ? PLACE_RATIO['home-open'] : PLACE_RATIO['home-closed'];
}

/**
 * Where a person is during an activity: PM2.5 ratio to outdoor, extra indoor PM2.5, and effort.
 * @param {Activity} a
 * @param {Home} home
 * @returns {{ ratio: number, add: number, intensity: Activity['intensity'] }}
 */
export function activityEnvironment(a, home) {
  switch (a.kind) {
    case 'commute': {
      const mode = MODES[a.mode ?? 'bus'];
      return { ratio: mode.ratio, add: 0, intensity: mode.intensity };
    }
    case 'outdoor':
      return { ratio: a.nearTraffic ? PLACE_RATIO.roadside : PLACE_RATIO.outdoor, add: 0, intensity: a.intensity };
    case 'indoor-away':
      return { ratio: PLACE_RATIO['indoor-away'], add: 0, intensity: a.intensity };
    default:
      return { ratio: homeRatio(home), add: SOURCES[a.source ?? 'none'].add, intensity: a.intensity };
  }
}

/**
 * How much this person counts when ranking choices (children, elders, sensitive higher).
 * @param {Member} m
 */
export function memberWeight(m) {
  return AGE_GROUPS[m.ageGroup].weight + (m.sensitive ? SENSITIVE_WEIGHT_BONUS : 0);
}

/**
 * Inhaled PM2.5 for one person over the day.
 * @param {Plan} plan
 * @param {Member} member
 * @param {Forecast} pm
 */
export function memberDose(plan, member, pm) {
  const rates = AGE_GROUPS[member.ageGroup].rates;
  const sleep = plan.sleep ?? DEFAULT_SLEEP;
  const covered = new Array(24).fill(0);
  const hourly = new Array(24).fill(0);
  /** @type {Record<string, number>} */
  const byActivity = {};
  let exposure = 0; // µg/m³ × hours
  let volume = 0; // m³ breathed
  const missing = new Set();

  for (const a of plan.activities) {
    if (!a.memberIds.includes(member.id)) continue;
    const env = activityEnvironment(a, plan.home);
    const rate = rates[env.intensity];
    let dose = 0;
    for (const { hour, fraction } of segments(a.start, activityHours(a))) {
      const frac = Math.min(fraction, 1 - covered[hour]);
      if (frac <= 0) continue;
      covered[hour] += frac;
      volume += rate * frac;
      const ambient = pm[hour];
      if (ambient == null) {
        missing.add(hour);
        continue;
      }
      const c = ambient * env.ratio + env.add;
      dose += c * rate * frac;
      exposure += c * frac;
      hourly[hour] += c * rate * frac;
    }
    byActivity[a.id] = dose;
  }

  // Time not covered by an activity is spent at home: asleep or resting.
  const homeR = homeRatio(plan.home);
  let homeDose = 0;
  for (let hour = 0; hour < 24; hour++) {
    const rest = 1 - covered[hour];
    if (rest <= 1e-9) continue;
    const rate = rates[isSleepHour(hour, sleep) ? 'sleep' : 'rest'];
    volume += rate * rest;
    const ambient = pm[hour];
    if (ambient == null) {
      missing.add(hour);
      continue;
    }
    const c = ambient * homeR;
    homeDose += c * rate * rest;
    exposure += c * rest;
    hourly[hour] += c * rate * rest;
  }

  const total = Object.values(byActivity).reduce((s, v) => s + v, 0) + homeDose;
  return {
    memberId: member.id,
    total,
    homeDose,
    byActivity,
    hourly,
    volume,
    exposure,
    cigarettes: exposure / CIGARETTE_EXPOSURE,
    /** How many times the dose of breathing the same air volume at the WHO guideline. */
    whoMultiple: volume > 0 ? total / (WHO_24H_PM25 * volume) : 0,
    missingHours: missing.size,
  };
}

/**
 * Whole-family day: per-person dose, weighted family score and transport emissions.
 * @param {Plan} plan
 * @param {Forecast} pm
 */
export function computeDay(plan, pm) {
  const members = plan.members.map((m) => memberDose(plan, m, pm));
  const total = members.reduce((s, r) => s + r.total, 0);
  const weighted = plan.members.reduce((s, m, i) => s + members[i].total * memberWeight(m), 0);
  return { members, total, weighted, emissions: planEmissions(plan) };
}

/**
 * What one person is mostly doing in each clock hour, for the hour-by-hour view.
 * @param {Plan} plan
 * @param {Member} member
 * @returns {{ kind: Activity['kind'] | 'sleep', label: string, smoke: boolean }[]}
 */
export function memberTimeline(plan, member) {
  const sleep = plan.sleep ?? DEFAULT_SLEEP;
  /** @type {{ share: number, slot: { kind: Activity['kind'] | 'sleep', label: string, smoke: boolean } }[]} */
  const best = Array.from({ length: 24 }, (_, hour) => {
    const asleep = isSleepHour(hour, sleep);
    return { share: 0, slot: { kind: asleep ? 'sleep' : 'home', label: asleep ? 'Asleep' : 'At home', smoke: false } };
  });
  for (const a of plan.activities) {
    if (!a.memberIds.includes(member.id)) continue;
    for (const { hour, fraction } of segments(a.start, activityHours(a))) {
      // An activity shows in an hour once it fills a fifth of it, so short trips stay visible.
      if (fraction >= 0.2 && fraction > best[hour].share) {
        best[hour] = {
          share: fraction,
          slot: { kind: a.kind, label: a.label, smoke: a.kind === 'home' && (a.source ?? 'none') !== 'none' },
        };
      }
    }
  }
  return best.map((b) => b.slot);
}
