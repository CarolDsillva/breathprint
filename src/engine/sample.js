// @ts-check
/**
 * Demo data: a four-person Delhi household on a typical December smog day.
 * The forecast follows the usual winter pattern (worst at night and early morning when the
 * air is still and cold; cleanest in the early afternoon when sunlight mixes it).
 */

/** @type {import('./dose.js').Forecast} */
export const SAMPLE_FORECAST = [
  260, 270, 275, 280, 285, 290, 295, 300, 290, 260, 220, 180, 150, 130, 120, 125, 145, 190, 240, 270, 285, 290, 280,
  270,
];

/** @returns {import('./dose.js').Plan} */
export function samplePlan() {
  return {
    members: [
      { id: 'priya', name: 'Priya', ageGroup: 'adult', sensitive: false },
      { id: 'rohan', name: 'Rohan', ageGroup: 'adult', sensitive: false },
      { id: 'aarav', name: 'Aarav', ageGroup: 'child', sensitive: true },
      { id: 'dadi', name: 'Dadi', ageGroup: 'senior', sensitive: false },
    ],
    home: { windows: 'open', purifier: false, metro: true, bus: true },
    sleep: { from: 22, to: 6 },
    activities: [
      {
        id: 'walk',
        label: 'Morning walk',
        memberIds: ['dadi'],
        start: 6,
        hours: 1,
        kind: 'outdoor',
        intensity: 'light',
        nearTraffic: true,
        flexible: true,
        window: { from: 6, to: 18 },
      },
      {
        id: 'school-run',
        label: 'School run',
        memberIds: ['rohan', 'aarav'],
        start: 7.25,
        hours: 0.25,
        kind: 'commute',
        intensity: 'rest',
        mode: 'two-wheeler',
        distanceKm: 6,
        flexible: false,
      },
      {
        id: 'school',
        label: 'School',
        memberIds: ['aarav'],
        start: 7.5,
        hours: 6,
        kind: 'indoor-away',
        intensity: 'light',
        flexible: false,
      },
      {
        id: 'office-trip',
        label: 'Office commute',
        memberIds: ['priya'],
        start: 8.5,
        hours: 0.5,
        kind: 'commute',
        intensity: 'rest',
        mode: 'auto',
        distanceKm: 12,
        flexible: false,
      },
      {
        id: 'office',
        label: 'Office',
        memberIds: ['priya'],
        start: 9.25,
        hours: 8.5,
        kind: 'indoor-away',
        intensity: 'rest',
        flexible: false,
      },
      {
        id: 'cricket',
        label: 'Cricket practice',
        memberIds: ['aarav'],
        start: 17,
        hours: 1.5,
        kind: 'outdoor',
        intensity: 'vigorous',
        flexible: true,
        window: { from: 14, to: 19 },
      },
      {
        id: 'puja',
        label: 'Evening puja',
        memberIds: ['dadi'],
        start: 18.5,
        hours: 0.5,
        kind: 'home',
        intensity: 'rest',
        source: 'incense',
        flexible: false,
      },
      {
        id: 'cooking',
        label: 'Cooking dinner',
        memberIds: ['dadi', 'rohan'],
        start: 19,
        hours: 1,
        kind: 'home',
        intensity: 'light',
        source: 'gas-cooking',
        flexible: false,
      },
    ],
  };
}
