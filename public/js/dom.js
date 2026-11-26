// @ts-check
/**
 * Tiny element builder. Text is always set with textContent, never parsed as HTML,
 * so user input and AI text cannot inject markup.
 * @param {string} tag
 * @param {Record<string, any> | null} [attrs]
 * @param {...(Node | string | number | null | undefined | false)} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    // Via the CSSOM: allowed under our strict Content-Security-Policy, unlike style="" attributes.
    else if (key === 'style') el.style.cssText = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key in el && typeof value !== 'string') /** @type {any} */ (el)[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
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
