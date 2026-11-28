// @ts-check
/** Small UI pieces shared by several panels. */
import { fmt, fmt1, h } from './dom.js';

/** @typedef {import('./types.js').Comparison} Comparison */

/**
 * A status line: `say(text)` shows a message there, `say(text, true)` marks it as a problem.
 * @param {HTMLElement} el usually a role="status" paragraph
 * @returns {(text: string, isError?: boolean) => void}
 */
export function statusLine(el) {
  return (text, isError = false) => {
    el.textContent = text;
    el.classList.toggle('error', isError);
  };
}

/**
 * The message of anything thrown, for showing to the user.
 * @param {unknown} err
 */
export const errorMessage = (err) => (err instanceof Error ? err.message : String(err));

/** PM2.5 bands (µg/m³) with plain-language names, aligned with India's NAQI breakpoints. */
const BANDS = [
  { max: 30, name: 'Good' },
  { max: 60, name: 'Satisfactory' },
  { max: 90, name: 'Moderate' },
  { max: 120, name: 'Poor' },
  { max: 250, name: 'Very poor' },
  { max: Infinity, name: 'Severe' },
];

/** Changes smaller than these are shown as "little difference". */
const MIN_VISIBLE_DOSE_PCT = 0.5;
const MIN_VISIBLE_CO2_G = 1;

/**
 * The air-quality band a PM2.5 value falls in.
 * @param {number} pm
 */
export function band(pm) {
  const index = BANDS.findIndex((b) => pm <= b.max);
  return { index, name: BANDS[index].name };
}

/**
 * Signed percentage for tables, e.g. "−4.5%", "+1.2%", "no change".
 * @param {number} pct
 */
export function signedPct(pct) {
  if (Math.abs(pct) < 0.05) return 'no change';
  return `${pct < 0 ? '−' : '+'}${fmt1(Math.abs(pct))}%`;
}

/**
 * Chip for one side of the ledger, with a direction word (never colour alone).
 * @param {number} value negative = less
 * @param {(amount: string, direction: string) => string} label
 * @param {(n: number) => string} format
 */
function chip(value, label, format) {
  const less = value < 0;
  return h('span', { class: `chip ${less ? 'good' : 'bad'}` }, label(format(Math.abs(value)), less ? 'less' : 'more'));
}

/**
 * Both impacts of a change: what the family breathes and what the trips emit.
 * @param {{ dosePct: number, co2: number }} impact
 */
export function impactChips(impact) {
  const chips = [];
  if (Math.abs(impact.dosePct) >= MIN_VISIBLE_DOSE_PCT) {
    chips.push(chip(impact.dosePct, (n, dir) => `Family breathes ${n}% ${dir}`, fmt1));
  }
  if (Math.abs(impact.co2) >= MIN_VISIBLE_CO2_G) {
    chips.push(chip(impact.co2, (n, dir) => `City gets ${n} g CO₂ ${dir}`, fmt));
  }
  if (!chips.length) chips.push(h('span', { class: 'chip neutral' }, 'Little difference'));
  return h('div', { class: 'chips' }, ...chips);
}

/**
 * Before/after card for one change, per family member.
 * @param {Comparison} result
 * @param {string} heading
 */
export function comparisonCard(result, heading) {
  const head = h(
    'tr',
    null,
    ...['Person', 'Now (µg)', 'With change (µg)', 'Change'].map((c) => h('th', { scope: 'col' }, c)),
  );
  const rows = result.perMember.map((p) =>
    h(
      'tr',
      null,
      h('th', { scope: 'row' }, p.name),
      h('td', null, fmt(p.before)),
      h('td', null, fmt(p.after)),
      h('td', null, signedPct(p.pct)),
    ),
  );
  return h(
    'div',
    { class: 'compare' },
    h('p', null, h('strong', null, heading)),
    impactChips(result.delta),
    h(
      'table',
      null,
      h('caption', { class: 'sr-only' }, 'PM2.5 inhaled before and after the change'),
      h('thead', null, head),
      h('tbody', null, ...rows),
    ),
    h(
      'p',
      { class: 'hint' },
      `Trips: ${fmt(result.before.emissions.co2)} g → ${fmt(result.after.emissions.co2)} g CO₂.`,
    ),
  );
}

/**
 * A short line saying who did the AI part.
 * @param {string} text
 */
export function sourceNote(text) {
  return h('p', { class: 'source-note' }, text);
}

/**
 * Message paragraph; `error` styles it as a problem.
 * @param {string} text
 * @param {boolean} [error]
 */
export function message(text, error = false) {
  return h('p', { class: error ? 'error' : 'status' }, text);
}

/**
 * Tell screen-reader users what changed, in one short sentence. The region is a hidden
 * role="status" element; clearing it first makes repeated messages announce again.
 * @param {HTMLElement} region
 * @param {string} text
 */
export function announce(region, text) {
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = text;
  }, 50);
}

/**
 * Short spoken summary of a change's two impacts, e.g. "family breathes 3.8% less; city gets 90 g CO₂ less".
 * @param {{ dosePct: number, co2: number }} impact
 */
export function impactSummary(impact) {
  const parts = [];
  if (Math.abs(impact.dosePct) >= MIN_VISIBLE_DOSE_PCT) {
    parts.push(`family breathes ${fmt1(Math.abs(impact.dosePct))}% ${impact.dosePct < 0 ? 'less' : 'more'}`);
  }
  if (Math.abs(impact.co2) >= MIN_VISIBLE_CO2_G) {
    parts.push(`city gets ${fmt(Math.abs(impact.co2))} g CO₂ ${impact.co2 < 0 ? 'less' : 'more'}`);
  }
  return parts.join('; ') || 'little difference';
}
