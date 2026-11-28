// @ts-check
/** Family briefing: a short plan from the numbers above, written by Gemini (or offline). */
import { getBriefing } from './api.js';
import { announce, errorMessage, message, sourceNote } from './components.js';
import { buttonById, byId, h, selectById } from './dom.js';
import { validInputs } from './state.js';

/** @typedef {{ summary: string, tips: string[], source: string }} Briefing */

/**
 * The briefing text and a note saying who wrote it.
 * @param {Briefing} briefing
 * @param {string} language
 */
function briefingView(briefing, language) {
  return [
    h(
      'div',
      { class: 'briefing-text', lang: language },
      h('p', null, briefing.summary),
      h('ul', null, ...briefing.tips.map((tip) => h('li', null, tip))),
    ),
    sourceNote(
      briefing.source === 'gemini'
        ? 'Written by Gemini from the numbers above.'
        : 'Written offline from the numbers above (AI not configured).',
    ),
  ];
}

/** Wire up the family briefing: button, language choice and output. */
export function initBriefingPanel() {
  const button = buttonById('briefing-btn');
  const language = selectById('briefing-lang');
  const out = byId('briefing-out');
  const status = byId('briefing-announce');

  button.addEventListener('click', async () => {
    const inputs = validInputs();
    if (!inputs) {
      out.replaceChildren(message('Load a forecast and complete your day first.', true));
      return announce(status, 'Load a forecast and complete your day first.');
    }
    button.disabled = true;
    out.setAttribute('aria-busy', 'true');
    out.replaceChildren(message('Writing your family briefing…'));
    announce(status, 'Writing your family briefing.');
    try {
      /** @type {Briefing} */
      const briefing = await getBriefing(inputs.plan, inputs.forecast, language.value);
      out.replaceChildren(...briefingView(briefing, language.value));
      announce(status, 'Family briefing ready, below the button.');
    } catch (err) {
      const text = errorMessage(err);
      out.replaceChildren(message(text, true));
      announce(status, text);
    } finally {
      out.removeAttribute('aria-busy');
      button.disabled = false;
    }
  });
}
