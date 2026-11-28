// @ts-check
/**
 * Reference values used by the Breathprint engine.
 *
 * All figures are rounded population averages from published sources (see docs/science.md).
 * They are estimates for comparing choices, not a medical measurement.
 */

/** WHO 2021 24-hour PM2.5 guideline, µg/m³. */
export const WHO_24H_PM25 = 15;

/**
 * Berkeley Earth rule of thumb: breathing 22 µg/m³ of PM2.5 for 24 hours carries roughly
 * the health burden of smoking one cigarette. Expressed as µg/m³ × hours.
 */
export const CIGARETTE_EXPOSURE = 22 * 24;

/** Intensity levels a person can be at during an activity. */
export const INTENSITIES = /** @type {const} */ (['sleep', 'rest', 'light', 'moderate', 'vigorous']);

/** @typedef {typeof INTENSITIES[number]} Intensity */

/**
 * Breathing (ventilation) rate in m³/hour by age group and intensity.
 * US EPA Exposure Factors Handbook 2011, Table 6-2 (means, rounded).
 * `weight` raises the priority of more vulnerable people when the optimiser ranks choices.
 */
export const AGE_GROUPS = Object.freeze({
  child: {
    label: 'Child (5–11)',
    weight: 1.5,
    rates: { sleep: 0.27, rest: 0.29, light: 0.66, moderate: 1.32, vigorous: 2.5 },
  },
  teen: {
    label: 'Teen (12–17)',
    weight: 1.2,
    rates: { sleep: 0.29, rest: 0.3, light: 0.74, moderate: 1.6, vigorous: 2.9 },
  },
  adult: {
    label: 'Adult (18–64)',
    weight: 1,
    rates: { sleep: 0.3, rest: 0.31, light: 0.72, moderate: 1.6, vigorous: 3.0 },
  },
  senior: {
    label: 'Senior (65+)',
    weight: 1.3,
    rates: { sleep: 0.3, rest: 0.29, light: 0.72, moderate: 1.5, vigorous: 2.8 },
  },
});

/** Extra priority for someone with asthma, heart or lung conditions, or pregnancy. */
export const SENSITIVE_WEIGHT_BONUS = 0.5;

/**
 * Ratio of PM2.5 in a place to the outdoor (ambient) level.
 * Typical indoor/outdoor ratios from field studies in Indian and global cities.
 */
export const PLACE_RATIO = Object.freeze({
  outdoor: 1.0,
  roadside: 1.3,
  'indoor-away': 0.6, // school, office, mall
  'home-open': 0.8,
  'home-closed': 0.5,
  'home-purifier': 0.25,
});

/**
 * Transport modes. `ratio` is in-transit PM2.5 relative to ambient (Delhi on-road studies find
 * open vehicles ~1.3–1.5× ambient, closed AC cabins and metro ~0.5–0.6×).
 * `co2` is grams per km and `pm` is mg of PM2.5 per km (exhaust + brake/tyre wear), indicative
 * Indian fleet averages. `perVehicle` means the figure is shared by everyone riding together;
 * otherwise it is per passenger (shared transit).
 */
/**
 * @typedef {{
 *   label: string, ratio: number, intensity: Intensity, speed: number,
 *   co2: number, pm: number, perVehicle: boolean, maxKm: number
 * }} Mode
 */
export const MODES = Object.freeze(
  /** @satisfies {Record<string, Mode>} */ ({
    walk: { label: 'Walk', ratio: 1.3, intensity: 'light', speed: 5, co2: 0, pm: 0, perVehicle: false, maxKm: 2.5 },
    cycle: { label: 'Cycle', ratio: 1.3, intensity: 'moderate', speed: 14, co2: 0, pm: 0, perVehicle: false, maxKm: 8 },
    'two-wheeler': {
      label: 'Two-wheeler',
      ratio: 1.5,
      intensity: 'rest',
      speed: 25,
      co2: 45,
      pm: 15,
      perVehicle: true,
      maxKm: 60,
    },
    auto: {
      label: 'Auto-rickshaw (CNG)',
      ratio: 1.4,
      intensity: 'rest',
      speed: 20,
      co2: 60,
      pm: 8,
      perVehicle: true,
      maxKm: 30,
    },
    car: {
      label: 'Car (windows up, recirculate)',
      ratio: 0.6,
      intensity: 'rest',
      speed: 22,
      co2: 140,
      pm: 10,
      perVehicle: true,
      maxKm: 200,
    },
    bus: { label: 'Bus', ratio: 1.1, intensity: 'rest', speed: 18, co2: 25, pm: 5, perVehicle: false, maxKm: 60 },
    metro: { label: 'Metro', ratio: 0.6, intensity: 'rest', speed: 32, co2: 15, pm: 0.5, perVehicle: false, maxKm: 80 },
  }),
);

/**
 * Indoor sources add to the room's PM2.5 while the activity runs (µg/m³ above background).
 * Typical peak-to-average values from household air pollution studies.
 */
export const SOURCES = Object.freeze({
  none: { label: 'No smoke source', add: 0 },
  'gas-cooking': { label: 'Gas cooking, no exhaust', add: 60 },
  'gas-cooking-exhaust': { label: 'Gas cooking with exhaust/chimney', add: 15 },
  'biomass-cooking': { label: 'Wood/coal/dung stove', add: 400 },
  incense: { label: 'Incense / dhoop', add: 90 },
  'mosquito-coil': { label: 'Mosquito coil', add: 110 },
});

/** Activity kinds. `home` activities use the household's home setting plus any source. */
export const KINDS = /** @type {const} */ (['home', 'indoor-away', 'outdoor', 'commute']);

/** Default sleeping hours for everyone (24-hour clock). */
export const DEFAULT_SLEEP = Object.freeze({ from: 22, to: 6 });

/** Hard limits that keep input (and compute cost) bounded. */
export const LIMITS = Object.freeze({ members: 8, activities: 24, labelLength: 40, nameLength: 30 });
