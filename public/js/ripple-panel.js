// @ts-check
/** Neighbourhood ripple: what N families achieve together by making the same switches. */
import { communityRipple } from '/engine/impact.js';
import { renderRipple } from './budget-view.js';
import { announce } from './components.js';
import { byId, fmt, fmt1, h } from './dom.js';

/** @typedef {import('./types.js').DayResult} DayResult */

const MAX_FAMILIES = 100_000;
/** Wait for typing to pause before speaking the new totals. */
const ANNOUNCE_DELAY_MS = 700;
const RANGE_MESSAGE = 'Enter between 1 and 100,000 families.';

/**
 * Wire up the families input.
 * @returns {{ show: (baseline: DayResult, smarter: DayResult) => void }} redraw with new day results
 */
export function initRipplePanel() {
  const families = /** @type {HTMLInputElement} */ (byId('families'));
  const out = byId('ripple-out');
  const status = byId('ripple-announce');
  /** @type {{ baseline: DayResult, smarter: DayResult } | null} */
  let days = null;
  let timer = 0;

  /** @param {boolean} speak announce the totals (only when the user changes the number) */
  function update(speak) {
    if (!days) return;
    const n = Number(families.value);
    const ripple = n >= 1 && n <= MAX_FAMILIES ? communityRipple(days.baseline, days.smarter, n) : null;
    if (ripple) renderRipple(out, ripple);
    else out.replaceChildren(h('p', { class: 'error' }, RANGE_MESSAGE));
    if (!speak) return;
    const spoken = ripple
      ? `${fmt(n)} families: about ${fmt(ripple.cigarettesAvoided)} cigarettes' worth of smoke not breathed ` +
        `and ${fmt1(ripple.co2KgAvoided)} kg less CO₂ a day.`
      : RANGE_MESSAGE;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => announce(status, spoken), ANNOUNCE_DELAY_MS);
  }

  families.addEventListener('input', () => update(true));
  return {
    show(baseline, smarter) {
      days = { baseline, smarter };
      update(false);
    },
  };
}
