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
 * Get an element by id or fail loudly during development.
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
export function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return /** @type {T} */ (el);
}

/** @param {number} t decimal hour → "HH:MM" for <input type="time"> */
export function toTimeValue(t) {
  const total = Math.round(t * 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** @param {string} v "HH:MM" → decimal hour */
export function fromTimeValue(v) {
  const [hh, mm] = v.split(':').map(Number);
  return Number.isFinite(hh) && Number.isFinite(mm) ? hh + mm / 60 : NaN;
}

/** @param {number} n */
export const fmt = (n) => Math.round(n).toLocaleString('en-IN');

/** @param {number} n */
export const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString('en-IN');
