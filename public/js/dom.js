// @ts-check
/** @typedef {Node | string | number | null | undefined | false} Child */

/**
 * Set one attribute or property on an element.
 * @param {HTMLElement} el
 * @param {string} key
 * @param {unknown} value
 */
function setAttr(el, key, value) {
  if (key === 'class') el.className = String(value);
  // Via the CSSOM: allowed under our strict Content-Security-Policy, unlike style="" attributes.
  else if (key === 'style') el.style.cssText = String(value);
  else if (key === 'dataset') Object.assign(el.dataset, value);
  // Properties such as `checked`, `disabled` and `onclick` are set directly, not as attributes.
  else if (key in el && typeof value !== 'string') Reflect.set(el, key, value);
  else el.setAttribute(key, value === true ? '' : String(value));
}

/**
 * Tiny element builder. Text is always set with textContent, never parsed as HTML,
 * so user input and AI text cannot inject markup. Null, undefined and false are skipped,
 * which keeps conditional attributes and children readable.
 * @param {string} tag
 * @param {Record<string, unknown> | null} [attrs]
 * @param {...Child} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value !== undefined && value !== null && value !== false) setAttr(el, key, value);
  }
  for (const child of children) {
    if (child !== undefined && child !== null && child !== false)
      el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/**
 * Get an element by id and check it is the expected kind, failing loudly if the page and the
 * code disagree. The check replaces type casts: the element really is a `T` at runtime.
 * @template {HTMLElement} T
 * @param {string} id
 * @param {new () => T} kind e.g. HTMLInputElement
 * @returns {T}
 */
export function elementById(id, kind) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  if (!(el instanceof kind)) throw new Error(`#${id} is a <${el.tagName.toLowerCase()}>, not a ${kind.name}`);
  return el;
}

/**
 * Get any element by id.
 * @param {string} id
 */
export const byId = (id) => elementById(id, HTMLElement);

/**
 * Get an <input> by id.
 * @param {string} id
 */
export const inputById = (id) => elementById(id, HTMLInputElement);

/**
 * Get a <select> by id.
 * @param {string} id
 */
export const selectById = (id) => elementById(id, HTMLSelectElement);

/**
 * Get a <button> by id.
 * @param {string} id
 */
export const buttonById = (id) => elementById(id, HTMLButtonElement);

/**
 * Get a <form> by id.
 * @param {string} id
 */
export const formById = (id) => elementById(id, HTMLFormElement);

/**
 * Convert a decimal hour to the "HH:MM" value of an <input type="time">, e.g. 7.5 → "07:30".
 * @param {number} t
 */
export function toTimeValue(t) {
  const total = Math.round(t * 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Convert an "HH:MM" time value to a decimal hour, e.g. "19:15" → 19.25 (NaN if malformed).
 * @param {string} v
 */
export function fromTimeValue(v) {
  const [hh, mm] = v.split(':').map(Number);
  return Number.isFinite(hh) && Number.isFinite(mm) ? hh + mm / 60 : NaN;
}

/**
 * Whole number with Indian digit grouping, e.g. 123456 → "1,23,456".
 * @param {number} n
 */
export const fmt = (n) => Math.round(n).toLocaleString('en-IN');

/**
 * Number to one decimal place, e.g. 2.25 → "2.3".
 * @param {number} n
 */
export const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString('en-IN');
