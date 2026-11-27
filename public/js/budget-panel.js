// @ts-check
/** Section 03: the family's breath budget, the choices that change it, and their wider impact. */
import { compareChange, computeDay, memberTimeline, optimizeDay, suggest, validatePlan } from '/engine/index.js';
import { seasonSavings, smogSeasonDaysLeft } from '/engine/impact.js';
import { renderBudget, renderHourGrid, renderSeason, renderStats, renderSuggestions } from './budget-view.js';
import { byId } from './dom.js';
import { initRipplePanel } from './ripple-panel.js';
import { replacePlan, restoreOriginal, state, subscribe, validInputs } from './state.js';

/** @typedef {import('./types.js').DayResult} DayResult */
/** @typedef {import('./types.js').ChangeRequest} ChangeRequest */

/** Wait this long after an edit before recalculating, so typing stays smooth. */
const RECALC_DELAY_MS = 120;
const MAX_SUGGESTIONS = 6;

/**
 * Wire up the budget section.
 * @returns {{ apply: (request: ChangeRequest) => void }} apply a chosen change to the plan
 */
export function initBudgetPanel() {
  const status = byId('results-status');
  const heading = byId('budget-h');
  const undo = byId('undo-all');
  const ripple = initRipplePanel();
  let timer = 0;

  /**
   * @param {string} text
   * @param {boolean} [isError]
   */
  const say = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle('error', isError);
  };

  function render() {
    undo.hidden = !state.original;
    if (!state.forecast) return say('Load a forecast in step 01 to see your family’s budget.');
    const checked = validatePlan(state.plan);
    if (!checked.ok) return say(`Please fix: ${checked.errors.slice(0, 3).join(' ')}`, true);
    const { plan } = checked;
    const pm = state.forecast;

    const day = computeDay(plan, pm);
    const smarter = computeDay(optimizeDay(plan, pm).plan, pm);
    const top = [...day.members].sort((a, b) => b.cigarettes - a.cigarettes)[0];
    const topName = plan.members.find((m) => m.id === top.memberId)?.name;
    say(`Updated. ${topName} breathes the most on this day: about ${top.cigarettes.toFixed(1)} cigarettes' worth.`);

    // Season and neighbourhood totals compare the family's own plan with the smarter one,
    // even after some changes have been applied.
    const original = state.original ? validatePlan(state.original) : null;
    const baseline = original?.ok ? computeDay(original.plan, pm) : day;

    renderStats(byId('stats'), day, smarter);
    renderSeason(byId('season-out'), plan, seasonSavings(baseline, smarter, smogSeasonDaysLeft(new Date())));
    ripple.show(baseline, smarter);
    renderHourGrid(byId('hour-grid'), plan, pm, memberTimeline);
    renderBudget(byId('budget'), plan, day);
    renderSuggestions(byId('suggestions'), suggest(plan, pm).slice(0, MAX_SUGGESTIONS), apply);
  }

  /** @param {ChangeRequest} request */
  function apply({ change, title }) {
    const inputs = validInputs();
    if (!inputs) return;
    const result = compareChange(inputs.plan, inputs.forecast, change);
    if (!result.ok) return;
    replacePlan(result.plan, { keepOriginal: true });
    say(`Done: ${title}. ${status.textContent}`);
    heading.focus();
  }

  subscribe((kind) => {
    window.clearTimeout(timer);
    // A swapped plan renders at once (the editors re-render too); edits are debounced.
    if (kind === 'replaced') render();
    else timer = window.setTimeout(render, RECALC_DELAY_MS);
  });

  byId('apply-all').addEventListener('click', () => {
    const inputs = validInputs();
    if (!inputs) return;
    const before = computeDay(inputs.plan, inputs.forecast);
    const { plan, applied } = optimizeDay(inputs.plan, inputs.forecast);
    if (!applied.length) return say('No free changes left to apply.');
    const after = computeDay(plan, inputs.forecast);
    replacePlan(plan, { keepOriginal: true });
    const pct = Math.round(((before.total - after.total) / before.total) * 100);
    const co2 = Math.round(before.emissions.co2 - after.emissions.co2);
    say(
      `Applied ${applied.length} free changes: your family breathes ${pct}% less smog${co2 > 0 ? ` and your trips emit ${co2} g less CO₂` : ''}.`,
    );
    heading.focus();
  });

  undo.addEventListener('click', () => {
    if (restoreOriginal()) heading.focus();
  });

  render();
  return { apply };
}
