// @ts-check
/**
 * Single-room, well-mixed mass-balance model for indoor PM2.5 with a purifier.
 *
 *   dC/dt = P·a·C_out − (a + k + CADR/V)·C
 *
 * a = air changes per hour from leaks, P = penetration of outdoor particles, k = deposition
 * rate, CADR = purifier clean-air delivery rate (m³/h), V = room volume (m³).
 */

export const PURIFIERS = Object.freeze({
  none: { label: 'No purifier', cadr: 0 },
  diy: { label: 'DIY box fan + 4 MERV-13 filters', cadr: 600 },
  small: { label: 'Small HEPA purifier (~150 m³/h)', cadr: 150 },
  medium: { label: 'Medium HEPA purifier (~300 m³/h)', cadr: 300 },
  large: { label: 'Large HEPA purifier (~500 m³/h)', cadr: 500 },
});

export const ROOM_DEFAULTS = Object.freeze({
  penetration: 0.8,
  deposition: 0.2,
  /** Typical leakage of a closed room in an Indian apartment, air changes per hour. */
  achClosed: 0.7,
  achOpen: 4,
});

/**
 * @typedef {{
 *   lengthM: number, widthM: number, heightM: number, cadr: number, outdoorPm: number,
 *   startPm?: number, targetPm?: number, windowsOpen?: boolean
 * }} RoomInput
 */

/**
 * Indoor PM2.5 the room settles at, and how long the purifier takes to get below the target.
 * @param {RoomInput} input
 */
export function purifierPlan(input) {
  const volume = input.lengthM * input.widthM * input.heightM;
  const a = input.windowsOpen ? ROOM_DEFAULTS.achOpen : ROOM_DEFAULTS.achClosed;
  const P = ROOM_DEFAULTS.penetration;
  const k = ROOM_DEFAULTS.deposition;
  const removal = a + k + input.cadr / volume; // per hour
  const steady = (P * a * input.outdoorPm) / removal;
  const start = input.startPm ?? (P * a * input.outdoorPm) / (a + k);
  const target = input.targetPm ?? 35;

  let minutes = null;
  if (start <= target) minutes = 0;
  else if (steady < target) minutes = Math.ceil((-Math.log((target - steady) / (start - steady)) / removal) * 60);

  // Clean-air changes per hour the purifier alone gives; 5 or more is the usual advice.
  const purifierAch = input.cadr / volume;
  const recommendedCadr = Math.ceil(volume * 5);
  /** @param {number} t hours */
  const at = (t) => steady + (start - steady) * Math.exp(-removal * t);
  const curve = [0, 0.25, 0.5, 1, 2].map((t) => ({ minutes: t * 60, pm: at(t) }));
  return { volume, steady, start, target, minutes, purifierAch, recommendedCadr, curve };
}
