// @ts-check
/**
 * Strict input validation shared by the browser and the server. Unknown fields are dropped,
 * strings are trimmed and stripped of control characters, numbers are range-checked.
 */
import { AGE_GROUPS, INTENSITIES, KINDS, LIMITS, MODES, SOURCES } from './constants.js';

const ID_RE = /^[a-z0-9_-]{1,24}$/i;

/**
 * A short id of letters, digits, "_" or "-".
 * @param {unknown} v
 * @returns {v is string}
 */
const isId = (v) => typeof v === 'string' && ID_RE.test(v);

/**
 * A plain object whose fields still need checking.
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Control characters and angle brackets: never needed in names, labels or AI text. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_CHARS = /[\u0000-\u001f\u007f<>]/g;

/**
 * Remove control characters and angle brackets, trim and cap length.
 * @param {unknown} v
 * @param {number} max
 */
export function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(UNSAFE_CHARS, '').trim().slice(0, max);
}

/**
 * A finite number within [min, max].
 * @param {unknown} v
 * @param {number} min
 * @param {number} max
 * @returns {v is number}
 */
const num = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/**
 * One of the allowed keys.
 * @template {string} K
 * @param {unknown} v
 * @param {readonly K[] | Readonly<Record<K, unknown>>} allowed
 * @returns {v is K}
 */
const oneOf = (v, allowed) =>
  typeof v === 'string' &&
  (Array.isArray(allowed) ? allowed.includes(/** @type {K} */ (v)) : Object.hasOwn(allowed, v));

/**
 * @param {unknown} raw
 * @returns {{ ok: true, plan: import('./dose.js').Plan } | { ok: false, errors: string[] }}
 */
export function validatePlan(raw) {
  /** @type {string[]} */
  const errors = [];
  if (!isObj(raw)) return { ok: false, errors: ['Plan must be an object.'] };
  const r = /** @type {Record<string, unknown>} */ (raw);

  const membersIn = Array.isArray(r.members) ? r.members : [];
  if (membersIn.length < 1 || membersIn.length > LIMITS.members)
    errors.push(`Add between 1 and ${LIMITS.members} family members.`);
  /** @type {import('./dose.js').Member[]} */
  const members = [];
  for (const [i, m] of membersIn.slice(0, LIMITS.members).entries()) {
    if (!isObj(m) || !isId(m.id)) {
      errors.push(`Member ${i + 1} has an invalid id.`);
      continue;
    }
    if (!oneOf(m.ageGroup, AGE_GROUPS)) {
      errors.push(`Member ${i + 1} has an unknown age group.`);
      continue;
    }
    const name = cleanText(m.name, LIMITS.nameLength) || `Person ${i + 1}`;
    members.push({ id: m.id, name, ageGroup: m.ageGroup, sensitive: m.sensitive === true });
  }
  const memberIds = new Set(members.map((m) => m.id));
  if (memberIds.size !== members.length) errors.push('Member ids must be unique.');

  const h = isObj(r.home) ? r.home : {};
  /** @type {import('./dose.js').Home} */
  const home = {
    windows: h.windows === 'closed' ? 'closed' : 'open',
    purifier: h.purifier === true,
    metro: h.metro !== false,
    bus: h.bus !== false,
  };

  let sleep;
  if (isObj(r.sleep)) {
    if (num(r.sleep.from, 0, 23.5) && num(r.sleep.to, 0, 23.5)) sleep = { from: r.sleep.from, to: r.sleep.to };
    else errors.push('Sleep hours must be between 0 and 23.5.');
  }

  const actsIn = Array.isArray(r.activities) ? r.activities : [];
  if (actsIn.length > LIMITS.activities) errors.push(`At most ${LIMITS.activities} activities.`);
  /** @type {import('./dose.js').Activity[]} */
  const activities = [];
  const seen = new Set();
  for (const [i, a] of actsIn.slice(0, LIMITS.activities).entries()) {
    const where = `Activity ${i + 1}`;
    if (!isObj(a) || !isId(a.id) || seen.has(a.id)) {
      errors.push(`${where} has a missing or duplicate id.`);
      continue;
    }
    seen.add(a.id);
    const label = cleanText(a.label, LIMITS.labelLength) || where;
    if (!oneOf(a.kind, KINDS)) {
      errors.push(`${label}: unknown kind.`);
      continue;
    }
    if (!num(a.start, 0, 23.99)) {
      errors.push(`${label}: start time must be between 0 and 24.`);
      continue;
    }
    const ids = Array.isArray(a.memberIds)
      ? a.memberIds.filter((/** @type {unknown} */ id) => typeof id === 'string' && memberIds.has(id))
      : [];
    if (ids.length === 0) {
      errors.push(`${label}: choose at least one person.`);
      continue;
    }
    const intensity = oneOf(a.intensity, INTENSITIES) ? a.intensity : 'rest';
    /** @type {import('./dose.js').Activity} */
    const out = {
      id: a.id,
      label,
      memberIds: [...new Set(ids)],
      start: a.start,
      hours: 1,
      kind: a.kind,
      intensity,
      flexible: a.flexible === true,
    };
    if (a.kind === 'commute') {
      if (!oneOf(a.mode, MODES)) {
        errors.push(`${label}: choose a transport mode.`);
        continue;
      }
      if (!num(a.distanceKm, 0.1, 200)) {
        errors.push(`${label}: distance must be 0.1–200 km.`);
        continue;
      }
      out.mode = a.mode;
      out.distanceKm = a.distanceKm;
      out.hours = a.distanceKm / MODES[/** @type {keyof typeof MODES} */ (a.mode)].speed;
      out.flexible = false;
    } else {
      if (!num(a.hours, 0.25, 16)) {
        errors.push(`${label}: duration must be 15 min to 16 h.`);
        continue;
      }
      out.hours = a.hours;
    }
    if (a.kind === 'home') out.source = oneOf(a.source, SOURCES) ? a.source : 'none';
    if (a.kind === 'outdoor') out.nearTraffic = a.nearTraffic === true;
    if (out.flexible && isObj(a.window)) {
      if (num(a.window.from, 0, 24) && num(a.window.to, 0, 24) && a.window.to - a.window.from >= out.hours)
        out.window = { from: a.window.from, to: a.window.to };
      else errors.push(`${label}: the flexible window is shorter than the activity.`);
    }
    activities.push(out);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, plan: { members, home, ...(sleep ? { sleep } : {}), activities } };
}

/**
 * Forecast: exactly 24 values, each a PM2.5 number in a plausible range or null.
 * @param {unknown} raw
 * @returns {raw is (number | null)[]}
 */
export function isForecast(raw) {
  return Array.isArray(raw) && raw.length === 24 && raw.every((v) => v === null || num(v, 0, 2000));
}

/**
 * Validate a Change against a plan (shape only; feasibility is checked by checkChange).
 * @param {unknown} raw
 * @param {import('./dose.js').Plan} plan
 * @returns {import('./scenario.js').Change | null}
 */
export function sanitizeChange(raw, plan) {
  if (!isObj(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  /** @type {import('./scenario.js').Change} */
  const c = {};
  if (typeof r.activityId === 'string' && plan.activities.some((a) => a.id === r.activityId))
    c.activityId = r.activityId;
  if (c.activityId && num(r.start, 0, 23.99)) c.start = Math.round(r.start * 2) / 2;
  if (c.activityId && oneOf(r.mode, MODES)) c.mode = r.mode;
  if (c.activityId && oneOf(r.source, SOURCES)) c.source = r.source;
  if (r.windows === 'open' || r.windows === 'closed') c.windows = r.windows;
  if (typeof r.purifier === 'boolean') c.purifier = r.purifier;
  const meaningful = c.start !== undefined || c.mode || c.source || c.windows || c.purifier !== undefined;
  return meaningful ? c : null;
}
