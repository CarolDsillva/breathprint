// @ts-check
/** Section 04: ask about one change in plain words and compare before and after. */
import { compareChange } from '/engine/index.js';
import { askWhatIf } from './api.js';
import { comparisonCard, message, sourceNote } from './components.js';
import { byId, h } from './dom.js';
import { validInputs } from './state.js';

/** @typedef {import('./types.js').ChangeRequest} ChangeRequest */
/** @typedef {{ change: import('./types.js').Change | null, description: string, source: string }} WhatIfAnswer */

/** @param {{ apply: (request: ChangeRequest) => void }} deps */
export function initWhatIfPanel({ apply }) {
  const form = /** @type {HTMLFormElement} */ (byId('whatif-form'));
  const input = /** @type {HTMLInputElement} */ (byId('whatif-input'));
  const out = byId('whatif-out');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputs = validInputs();
    if (!inputs) {
      out.replaceChildren(message('Load a forecast and complete your day first.', true));
      return;
    }
    out.replaceChildren(message('Working it out…'));
    try {
      /** @type {WhatIfAnswer} */
      const answer = await askWhatIf(inputs.plan, input.value.trim());
      const { change } = answer;
      if (!change) {
        out.replaceChildren(h('p', null, answer.description));
        return;
      }
      const result = compareChange(inputs.plan, inputs.forecast, change);
      if (!result.ok) {
        out.replaceChildren(message(result.errors.join(' '), true));
        return;
      }
      out.replaceChildren(
        comparisonCard(result, result.description),
        h(
          'button',
          { type: 'button', class: 'btn', onclick: () => apply({ change, title: result.description }) },
          'Use this in my day',
        ),
        sourceNote(
          answer.source === 'gemini'
            ? 'Question understood by Gemini; numbers from the Breathprint engine.'
            : 'Question understood offline; numbers from the Breathprint engine.',
        ),
      );
    } catch (err) {
      out.replaceChildren(message(/** @type {Error} */ (err).message, true));
    }
  });

  byId('whatif-examples').addEventListener('click', (e) => {
    const question = /** @type {HTMLElement} */ (e.target).dataset.example;
    if (!question) return;
    input.value = question;
    form.requestSubmit();
  });
}
