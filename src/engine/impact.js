// @ts-check
/**
 * Scaling one family's choices up: across a smog season, and across a neighbourhood.
 * Both are "if every day / every family were like this one" estimates, labelled as such in the UI.
 */

/** North Indian smog season: 15 October to 28 February (inclusive). */
export const SMOG_SEASON = Object.freeze({ startMonth: 9, startDay: 15, endMonth: 1, endDay: 28 });

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days left in the smog season, counting today. 0 outside the season.
 * @param {Date} date
 */
export function smogSeasonDaysLeft(date) {
  const y = date.getFullYear();
  const today = Date.UTC(y, date.getMonth(), date.getDate());
  const { startMonth, startDay, endMonth, endDay } = SMOG_SEASON;
  // Season that ends in Feb of this year, or the one that started this October.
  const endThisYear = Date.UTC(y, endMonth, endDay);
  const startThisYear = Date.UTC(y, startMonth, startDay);
  let end;
  if (today <= endThisYear) end = endThisYear;
  else if (today >= startThisYear) end = Date.UTC(y + 1, endMonth, endDay);
  else return 0;
  return Math.round((end - today) / DAY_MS) + 1;
}

/**
 * Per-person savings if every remaining smog day were planned the smarter way.
 * @param {ReturnType<typeof import('./dose.js').computeDay>} before
 * @param {ReturnType<typeof import('./dose.js').computeDay>} after
 * @param {number} days
 */
export function seasonSavings(before, after, days) {
  const people = before.members.map((m, i) => ({
    memberId: m.memberId,
    cigarettesAvoided: Math.max(0, (m.cigarettes - after.members[i].cigarettes) * days),
    microgramsAvoided: Math.max(0, (m.total - after.members[i].total) * days),
  }));
  return {
    days,
    people,
    co2KgAvoided: Math.max(0, ((before.emissions.co2 - after.emissions.co2) * days) / 1000),
  };
}

/**
 * What a neighbourhood achieves if `families` households make the same switches for one day.
 * Emissions add up across families; so does the smoke each family avoids breathing.
 * @param {ReturnType<typeof import('./dose.js').computeDay>} before
 * @param {ReturnType<typeof import('./dose.js').computeDay>} after
 * @param {number} families
 */
export function communityRipple(before, after, families) {
  const n = Math.max(0, Math.min(1_000_000, Math.round(families)));
  return {
    families: n,
    co2KgAvoided: Math.max(0, ((before.emissions.co2 - after.emissions.co2) * n) / 1000),
    pmGramsNotEmitted: Math.max(0, ((before.emissions.pm - after.emissions.pm) * n) / 1000),
    pmGramsNotBreathed: Math.max(0, ((before.total - after.total) * n) / 1e6),
    cigarettesAvoided: Math.max(
      0,
      before.members.reduce((s, m, i) => s + m.cigarettes - after.members[i].cigarettes, 0) * n,
    ),
  };
}
