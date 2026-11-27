// @ts-check
/** Section 04: ask about one change in plain words and compare before and after. */
import { compareChange } from '/engine/index.js';
import { askWhatIf } from './api.js';
import { announce, comparisonCard, impactSummary, message, sourceNote } from './components.js';
import { byId, h } from './dom.js';
import { validInputs } from './state.js';

/** @typedef {import('./types.js').ChangeRequest} ChangeRequest */
/** @typedef {import('./types.js').Plan} Plan */
/** @typedef {import('./types.js').Forecast} Forecast */
/** @typedef {{ change: import('./types.js').Change | null, description: string, source: string }} WhatIfAnswer */

/**
 * Turn the server's answer into what to show and what to say.
 * @param {WhatIfAnswer} answer
 * @param {{ plan: Plan, forecast: Forecast }} inputs
 * @param {(request: ChangeRequest) => void} apply
 * @returns {{ view: HTMLElement[], spoken: string }}
 */
function answerView(answer, inputs, apply) {
  const { change } = answer;
  if (!change) return { view: [h('p', null, answer.description)], spoken: answer.description };
  const result = compareChange(inputs.plan, inputs.forecast, change);
  if (!result.ok) {
    const reasons = result.errors.join(' ');
    return { view: [message(reasons, true)], spoken: reasons };
  }
  const useButton = h(
    'button',
    { type: 'button', class: 'btn', onclick: () => apply({ change, title: result.description }) },
    'Use this in my day',
  );
  const note = sourceNote(
    answer.source === 'gemini'
      ? 'Question understood by Gemini; numbers from the Breathprint engine.'
      : 'Question understood offline; numbers from the Breathprint engine.',
  );
  return {
    view: [comparisonCard(result, result.description), useButton, note],
    spoken: `${result.description}: ${impactSummary(result.delta)}. Details in the table below.`,
  };
}

/** @param {{ apply: (request: ChangeRequest) => void }} deps */
export function initWhatIfPanel({ apply }) {
  const form = /** @type {HTMLFormElement} */ (byId('whatif-form'));
  const input = /** @type {HTMLInputElement} */ (byId('whatif-input'));
  const out = byId('whatif-out');
  const status = byId('whatif-announce');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputs = validInputs();
    if (!inputs) {
      out.replaceChildren(message('Load a forecast and complete your day first.', true));
      return announce(status, 'Load a forecast and complete your day first.');
    }
    out.setAttribute('aria-busy', 'true');
    out.replaceChildren(message('Working it out…'));
    try {
      const { view, spoken } = answerView(await askWhatIf(inputs.plan, input.value.trim()), inputs, apply);
      out.replaceChildren(...view);
      announce(status, spoken);
    } catch (err) {
      const text = /** @type {Error} */ (err).message;
      out.replaceChildren(message(text, true));
      announce(status, text);
    } finally {
      out.removeAttribute('aria-busy');
    }
  });

  byId('whatif-examples').addEventListener('click', (e) => {
    const question = /** @type {HTMLElement} */ (e.target).dataset.example;
    if (!question) return;
    input.value = question;
    form.requestSubmit();
  });
}
