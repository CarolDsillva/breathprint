// @ts-check
/**
 * What-if questions: Gemini turns free text (English, Hindi, Hinglish) into one structured
 * change; the offline parser takes over if Gemini is off, fails, or proposes something the
 * plan cannot do. The engine, not the model, computes the before/after numbers.
 */
import { MODES, SOURCES } from '../../engine/constants.js';
import { parseWhatIf } from '../../engine/intent.js';
import { checkChange, describeChange } from '../../engine/scenario.js';
import { sanitizeChange } from '../../engine/validate.js';
import { WHATIF_SYSTEM } from './prompts.js';

/** @typedef {import('../../engine/dose.js').Plan} Plan */
/** @typedef {import('../../engine/scenario.js').Change} Change */
/** @typedef {{ change: Change | null, description: string, source: 'gemini' | 'offline' }} WhatIfAnswer */

/**
 * Drop null fields from the model's answer ("null" means "does not change").
 * @param {unknown} raw
 */
function stripNulls(raw) {
  if (typeof raw !== 'object' || raw === null) return raw;
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null));
}

/**
 * The plan, described to the model with only the fields it needs.
 * @param {Plan} plan
 * @param {string} question
 */
function whatIfPrompt(plan, question) {
  const activities = plan.activities.map((a) => ({
    id: a.id,
    label: a.label,
    kind: a.kind,
    start: a.start,
    mode: a.mode,
    source: a.source,
    people: a.memberIds,
  }));
  return [
    `ACTIVITIES: ${JSON.stringify(activities)}`,
    `PEOPLE: ${JSON.stringify(plan.members.map((m) => ({ id: m.id, name: m.name })))}`,
    `MODES: ${Object.keys(MODES).join(', ')}`,
    `SOURCES: ${Object.keys(SOURCES).join(', ')}`,
    `QUESTION: ${JSON.stringify(question)}`,
  ].join('\n');
}

/**
 * Ask Gemini to map the question to a change; accept it only if it is valid for this plan.
 * @param {import('./client.js').AiClient} ai
 * @param {Plan} plan
 * @param {string} question
 * @returns {Promise<Change | null>}
 */
async function askGemini(ai, plan, question) {
  try {
    const raw = await ai.generateJson({ system: WHATIF_SYSTEM, prompt: whatIfPrompt(plan, question), maxTokens: 200 });
    const change = sanitizeChange(stripNulls(raw), plan);
    return change && checkChange(plan, change).length === 0 ? change : null;
  } catch {
    return null;
  }
}

/**
 * Understand a what-if question about the plan.
 * @param {import('./client.js').AiClient} ai
 * @param {Plan} plan
 * @param {string} question
 * @returns {Promise<WhatIfAnswer>}
 */
export async function interpretWhatIf(ai, plan, question) {
  const fromGemini = ai.enabled ? await askGemini(ai, plan, question) : null;
  if (fromGemini) return { change: fromGemini, description: describeChange(plan, fromGemini), source: 'gemini' };

  const parsed = parseWhatIf(question, plan);
  const change = parsed.change ? sanitizeChange(parsed.change, plan) : null;
  return change
    ? { change, description: describeChange(plan, change), source: 'offline' }
    : { change: null, description: parsed.note, source: 'offline' };
}
