// @ts-check
/**
 * Strict input validation shared by the browser and the server. Unknown fields are dropped,
 * strings are trimmed and stripped of control characters, numbers are range-checked.
 */
import { AGE_GROUPS, INTENSITIES, KINDS, LIMITS, MODES, SOURCES } from './constants.js';

/** @typedef {import('./dose.js').Plan} Plan */
/** @typedef {import('./dose.js').Member} Member */
/** @typedef {import('./dose.js').Activity} Activity */
/** @typedef {import('./dose.js').Home} Home */
/** @typedef {import('./scenario.js').Change} Change */
/**
 * Either a checked value or the reason it was rejected.
 * @template T
 * @typedef {{ value: T, error?: undefined } | { error: string, value?: undefined }} Checked
 */

const ID_RE = /^[a-z0-9_-]{1,24}$/i;
const RANGES = Object.freeze({
  start: [0, 23.99],
  hours: [0.25, 16],
  distanceKm: [0.1, 200],
  sleep: [0, 23.5],
  window: [0, 24],
  pm25: [0, 2000],
});

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

/**
 * A finite number within [min, max].
 * @param {unknown} v
 * @param {readonly number[]} range [min, max]
 * @returns {v is number}
 */
const inRange = (v, [min, max]) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

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
 * Check one family member: id, age group and a cleaned name.
 * @param {unknown} raw
 * @param {number} index
 * @returns {Checked<Member>}
 */
function readMember(raw, index) {
  if (!isObj(raw) || !isId(raw.id)) return { error: `Member ${index + 1} has an invalid id.` };
  if (!oneOf(raw.ageGroup, AGE_GROUPS)) return { error: `Member ${index + 1} has an unknown age group.` };
  const name = cleanText(raw.name, LIMITS.nameLength) || `Person ${index + 1}`;
  return { value: { id: raw.id, name, ageGroup: raw.ageGroup, sensitive: raw.sensitive === true } };
}

/**
 * Home settings with safe defaults (windows open, no purifier, transit nearby).
 * @param {unknown} raw
 * @returns {Home}
 */
function readHome(raw) {
  const h = isObj(raw) ? raw : {};
  return {
    windows: h.windows === 'closed' ? 'closed' : 'open',
    purifier: h.purifier === true,
    metro: h.metro !== false,
    bus: h.bus !== false,
  };
}

/**
 * Optional sleep window.
 * @param {unknown} raw
 * @returns {Checked<{ from: number, to: number } | undefined>}
 */
function readSleep(raw) {
  if (!isObj(raw)) return { value: undefined };
  const { from, to } = raw;
  if (inRange(from, RANGES.sleep) && inRange(to, RANGES.sleep)) return { value: { from, to } };
  return { error: 'Sleep hours must be between 0 and 23.5.' };
}

/**
 * How long an activity lasts: from the distance for trips, else the hours given.
 * @param {Record<string, unknown>} a
 * @param {string} label
 * @returns {Checked<Pick<Activity, 'hours' | 'mode' | 'distanceKm'>>}
 */
function readDuration(a, label) {
  if (a.kind !== 'commute') {
    return inRange(a.hours, RANGES.hours)
      ? { value: { hours: a.hours } }
      : { error: `${label}: duration must be 15 min to 16 h.` };
  }
  if (!oneOf(a.mode, MODES)) return { error: `${label}: choose a transport mode.` };
  if (!inRange(a.distanceKm, RANGES.distanceKm)) return { error: `${label}: distance must be 0.1–200 km.` };
  return { value: { mode: a.mode, distanceKm: a.distanceKm, hours: a.distanceKm / MODES[a.mode].speed } };
}

/**
 * The time window a flexible activity may move within.
 * @param {unknown} raw
 * @param {number} hours
 * @param {string} label
 * @returns {Checked<{ from: number, to: number } | undefined>}
 */
function readWindow(raw, hours, label) {
  if (!isObj(raw)) return { value: undefined };
  const { from, to } = raw;
  if (inRange(from, RANGES.window) && inRange(to, RANGES.window) && to - from >= hours) return { value: { from, to } };
  return { error: `${label}: the flexible window is shorter than the activity.` };
}

/**
 * Check one activity: id, kind, time, people, duration and kind-specific fields.
 * @param {unknown} raw
 * @param {number} index
 * @param {Set<string>} memberIds
 * @param {Set<string>} seenIds
 * @returns {Checked<Activity>}
 */
function readActivity(raw, index, memberIds, seenIds) {
  const where = `Activity ${index + 1}`;
  if (!isObj(raw) || !isId(raw.id) || seenIds.has(raw.id)) return { error: `${where} has a missing or duplicate id.` };
  seenIds.add(raw.id);
  const label = cleanText(raw.label, LIMITS.labelLength) || where;
  if (!oneOf(raw.kind, KINDS)) return { error: `${label}: unknown kind.` };
  if (!inRange(raw.start, RANGES.start)) return { error: `${label}: start time must be between 0 and 24.` };
  const people = knownMemberIds(raw.memberIds, memberIds);
  if (people.length === 0) return { error: `${label}: choose at least one person.` };

  const duration = readDuration(raw, label);
  if (duration.error !== undefined) return { error: duration.error };
  const flexible = raw.kind !== 'commute' && raw.flexible === true;
  const window = flexible ? readWindow(raw.window, duration.value.hours, label) : { value: undefined };
  if (window.error !== undefined) return { error: window.error };

  return {
    value: {
      id: raw.id,
      label,
      memberIds: people,
      start: raw.start,
      kind: raw.kind,
      intensity: oneOf(raw.intensity, INTENSITIES) ? raw.intensity : 'rest',
      flexible,
      ...duration.value,
      ...(window.value ? { window: window.value } : {}),
      ...kindExtras(raw),
    },
  };
}

/**
 * The listed people who are really in the family, without duplicates.
 * @param {unknown} listed
 * @param {Set<string>} memberIds
 * @returns {string[]}
 */
function knownMemberIds(listed, memberIds) {
  if (!Array.isArray(listed)) return [];
  return [...new Set(listed.filter((id) => typeof id === 'string' && memberIds.has(id)))];
}

/**
 * Fields only some kinds have: a smoke source at home, traffic outdoors.
 * @param {Record<string, unknown>} raw
 * @returns {Pick<Activity, 'source' | 'nearTraffic'>}
 */
function kindExtras(raw) {
  if (raw.kind === 'home') return { source: oneOf(raw.source, SOURCES) ? raw.source : 'none' };
  if (raw.kind === 'outdoor') return { nearTraffic: raw.nearTraffic === true };
  return {};
}

/**
 * Check every item with `read`, collecting the good ones and the errors.
 * @template T
 * @param {unknown[]} items
 * @param {(item: unknown, index: number) => Checked<T>} read
 */
function readAll(items, read) {
  /** @type {T[]} */
  const values = [];
  /** @type {string[]} */
  const errors = [];
  items.forEach((item, i) => {
    const r = read(item, i);
    if (r.error !== undefined) errors.push(r.error);
    else values.push(r.value);
  });
  return { values, errors };
}

/**
 * Validate a whole family plan. Returns a clean copy or every problem found, in plain words.
 * @param {unknown} raw
 * @returns {{ ok: true, plan: Plan } | { ok: false, errors: string[] }}
 */
export function validatePlan(raw) {
  if (!isObj(raw)) return { ok: false, errors: ['Plan must be an object.'] };
  const membersIn = Array.isArray(raw.members) ? raw.members : [];
  const activitiesIn = Array.isArray(raw.activities) ? raw.activities : [];
  /** @type {string[]} */
  const errors = [];

  if (membersIn.length < 1 || membersIn.length > LIMITS.members) {
    errors.push(`Add between 1 and ${LIMITS.members} family members.`);
  }
  const members = readAll(membersIn.slice(0, LIMITS.members), readMember);
  errors.push(...members.errors);
  const memberIds = new Set(members.values.map((m) => m.id));
  if (memberIds.size !== members.values.length) errors.push('Member ids must be unique.');

  const sleep = readSleep(raw.sleep);
  if (sleep.error !== undefined) errors.push(sleep.error);

  if (activitiesIn.length > LIMITS.activities) errors.push(`At most ${LIMITS.activities} activities.`);
  const seenIds = new Set();
  const activities = readAll(activitiesIn.slice(0, LIMITS.activities), (a, i) =>
    readActivity(a, i, memberIds, seenIds),
  );
  errors.push(...activities.errors);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    plan: {
      members: members.values,
      home: readHome(raw.home),
      ...(sleep.value ? { sleep: sleep.value } : {}),
      activities: activities.values,
    },
  };
}

/**
 * Forecast: exactly 24 values, each a PM2.5 number in a plausible range or null.
 * @param {unknown} raw
 * @returns {raw is (number | null)[]}
 */
export function isForecast(raw) {
  return Array.isArray(raw) && raw.length === 24 && raw.every((v) => v === null || inRange(v, RANGES.pm25));
}

/**
 * Fields of a change that refer to one activity; empty if the activity is unknown.
 * @param {Record<string, unknown>} r
 * @param {Plan} plan
 * @returns {Change}
 */
function activityChangeFields(r, plan) {
  const { activityId, start, mode, source } = r;
  if (typeof activityId !== 'string' || !plan.activities.some((a) => a.id === activityId)) return {};
  return {
    activityId,
    ...(inRange(start, RANGES.start) ? { start: Math.round(start * 2) / 2 } : {}),
    ...(oneOf(mode, MODES) ? { mode } : {}),
    ...(oneOf(source, SOURCES) ? { source } : {}),
  };
}

/**
 * Validate a Change against a plan (shape only; feasibility is checked by checkChange).
 * @param {unknown} raw
 * @param {Plan} plan
 * @returns {Change | null}
 */
export function sanitizeChange(raw, plan) {
  if (!isObj(raw)) return null;
  /** @type {Change} */
  const change = {
    ...activityChangeFields(raw, plan),
    ...(raw.windows === 'open' || raw.windows === 'closed' ? { windows: raw.windows } : {}),
    ...(typeof raw.purifier === 'boolean' ? { purifier: raw.purifier } : {}),
  };
  const meaningful = ['start', 'mode', 'source', 'windows', 'purifier'].some((k) => k in change);
  return meaningful ? change : null;
}
