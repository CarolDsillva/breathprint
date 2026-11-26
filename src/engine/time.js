// @ts-check
/** Time helpers. Times are decimal hours on a 0–24 clock (7.5 = 7:30 AM). */

/**
 * Split an interval into per-clock-hour pieces.
 * @param {number} start decimal hour, 0 ≤ start < 24
 * @param {number} duration hours, > 0 (clipped at midnight)
 * @returns {{ hour: number, fraction: number }[]}
 */
export function segments(start, duration) {
  const end = Math.min(24, start + duration);
  /** @type {{ hour: number, fraction: number }[]} */
  const out = [];
  let t = start;
  while (t < end - 1e-9) {
    const hour = Math.floor(t + 1e-9);
    const next = Math.min(end, hour + 1);
    out.push({ hour, fraction: next - t });
    t = next;
  }
  return out;
}

/**
 * Whether two intervals overlap.
 * @param {{ start: number, hours: number }} a
 * @param {{ start: number, hours: number }} b
 */
export function overlaps(a, b) {
  return a.start < b.start + b.hours - 1e-9 && b.start < a.start + a.hours - 1e-9;
}

/**
 * Whether an hour falls inside the sleep window (which may wrap midnight).
 * @param {number} hour
 * @param {{ from: number, to: number }} sleep
 */
export function isSleepHour(hour, sleep) {
  return sleep.from > sleep.to ? hour >= sleep.from || hour < sleep.to : hour >= sleep.from && hour < sleep.to;
}

/**
 * Format a decimal hour as "7:30 AM".
 * @param {number} t
 */
export function formatTime(t) {
  const total = Math.round(t * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}
