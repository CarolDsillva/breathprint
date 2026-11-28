// @ts-check
/** How each editor form field updates the plan. One small setter per field. */
import { AGE_GROUPS, INTENSITIES, KINDS, MODES, SOURCES } from '/engine/index.js';
import { fromTimeValue } from './dom.js';

/** @typedef {import('./types.js').Activity} Activity */
/** @typedef {import('./types.js').Member} Member */
/** @typedef {HTMLInputElement | HTMLSelectElement} FormControl */

export const DEFAULT_WINDOW = Object.freeze({ from: 6, to: 21 });
export const DEFAULT_TRIP = Object.freeze({ mode: /** @type {const} */ ('bus'), distanceKm: 5 });

/**
 * Value is one of the allowed keys.
 * @template {string} K
 * @param {string} value
 * @param {readonly K[] | Readonly<Record<K, unknown>>} allowed
 * @returns {value is K}
 */
function isOneOf(value, allowed) {
  return Array.isArray(allowed) ? allowed.includes(value) : Object.hasOwn(allowed, value);
}

/** @param {FormControl} control */
const isChecked = (control) => control instanceof HTMLInputElement && control.checked;

/**
 * Set one end of an activity's flexible window from a "HH:MM" value.
 * @param {Activity} a
 * @param {'from' | 'to'} end
 * @param {string} value
 */
function setWindowEnd(a, end, value) {
  const t = fromTimeValue(value);
  if (!Number.isFinite(t)) return;
  // "00:00" as an end time means midnight.
  a.window = { ...DEFAULT_WINDOW, ...a.window, [end]: end === 'to' ? t || 24 : t };
}

/**
 * Add or remove one person from an activity.
 * @param {Activity} a
 * @param {FormControl} control carries the person's id in data-value
 */
function toggleMember(a, control) {
  const id = control.dataset.value ?? '';
  a.memberIds = isChecked(control) ? [...new Set([...a.memberIds, id])] : a.memberIds.filter((x) => x !== id);
}

/** @type {Readonly<Record<string, (a: Activity, control: FormControl) => void>>} */
const ACTIVITY_SETTERS = Object.freeze({
  label: (a, c) => {
    a.label = c.value;
  },
  kind: (a, c) => {
    if (isOneOf(c.value, KINDS)) a.kind = c.value;
  },
  intensity: (a, c) => {
    if (isOneOf(c.value, INTENSITIES)) a.intensity = c.value;
  },
  mode: (a, c) => {
    if (isOneOf(c.value, MODES)) a.mode = c.value;
  },
  source: (a, c) => {
    if (isOneOf(c.value, SOURCES)) a.source = c.value;
  },
  hours: (a, c) => {
    a.hours = Number(c.value);
  },
  distanceKm: (a, c) => {
    a.distanceKm = Number(c.value);
  },
  flexible: (a, c) => {
    a.flexible = isChecked(c);
  },
  nearTraffic: (a, c) => {
    a.nearTraffic = isChecked(c);
  },
  start: (a, c) => {
    const t = fromTimeValue(c.value);
    if (Number.isFinite(t)) a.start = t;
  },
  windowFrom: (a, c) => setWindowEnd(a, 'from', c.value),
  windowTo: (a, c) => setWindowEnd(a, 'to', c.value),
  memberIds: toggleMember,
});

/**
 * Apply one edited form field to an activity. Unknown fields and invalid values are ignored.
 * Turning an activity into a trip gives it a transport mode and distance; making it flexible
 * gives it a time window.
 * @param {Activity} a
 * @param {string} name
 * @param {FormControl} control
 */
export function setActivityField(a, name, control) {
  // Own keys only: a field named like a built-in ("__proto__", "toString") is just unknown.
  if (!Object.hasOwn(ACTIVITY_SETTERS, name)) return;
  ACTIVITY_SETTERS[name](a, control);
  if (name === 'kind' && a.kind === 'commute') {
    a.mode ??= DEFAULT_TRIP.mode;
    a.distanceKm ??= DEFAULT_TRIP.distanceKm;
    a.flexible = false;
  }
  if (name === 'flexible' && a.flexible) a.window ??= { ...DEFAULT_WINDOW };
}

/**
 * Apply one edited form field to a person.
 * @param {Member} m
 * @param {string} name
 * @param {FormControl} control
 */
export function setMemberField(m, name, control) {
  if (name === 'name') m.name = control.value;
  else if (name === 'ageGroup' && isOneOf(control.value, AGE_GROUPS)) m.ageGroup = control.value;
  else if (name === 'sensitive') m.sensitive = isChecked(control);
}
