// @ts-check
/** Family briefing: a short plan from the numbers above, written by Gemini (or offline). */
import { getCoach } from './api.js';
import { message, sourceNote } from './components.js';
import { byId, h } from './dom.js';
import { validInputs } from './state.js';

export function initBriefingPanel() {
  const button = /** @type {HTMLButtonElement} */ (byId('coach-btn'));
  const language = /** @type {HTMLSelectElement} */ (byId('coach-lang'));
  const out = byId('coach-out');

  button.addEventListener('click', async () => {
    const inputs = validInputs();
    if (!inputs) {
      out.replaceChildren(message('Load a forecast and complete your day first.', true));
      return;
    }
    button.disabled = true;
    out.replaceChildren(message('Writing your family briefing…'));
    try {
      /** @type {{ summary: string, tips: string[], source: string }} */
      const briefing = await getCoach(inputs.plan, inputs.forecast, language.value);
      out.replaceChildren(
        h(
          'div',
          { class: 'coach-text', lang: language.value },
          h('p', null, briefing.summary),
          h('ul', null, ...briefing.tips.map((tip) => h('li', null, tip))),
        ),
        sourceNote(
          briefing.source === 'gemini'
            ? 'Written by Gemini from the numbers above.'
            : 'Written offline from the numbers above (AI not configured).',
        ),
      );
    } catch (err) {
      out.replaceChildren(message(/** @type {Error} */ (err).message, true));
    } finally {
      button.disabled = false;
    }
  });
}
