// @ts-check
/**
 * Family briefing: a short plan written from the engine's numbers, by Gemini when available,
 * otherwise by a deterministic template. Gemini only rephrases these facts.
 */
import { computeDay, memberWeight } from '../../engine/dose.js';
import { optimizeDay, suggest } from '../../engine/optimizer.js';
import { cleanText } from '../../engine/validate.js';
import { BRIEFING_SYSTEM } from './prompts.js';

/** @typedef {import('../../engine/dose.js').Plan} Plan */
/** @typedef {import('../../engine/dose.js').Forecast} Forecast */
/** @typedef {{ summary: string, tips: string[] }} Briefing */

export const LANGUAGES = /** @type {const} */ ({ en: 'English', hi: 'Hindi' });

/** @typedef {keyof typeof LANGUAGES} Language */

const MAX_TIPS = 4;

/** @param {number} n */
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Compact, model-friendly facts about the day, all computed by the engine.
 * @param {Plan} plan
 * @param {Forecast} pm
 */
export function buildFacts(plan, pm) {
  const day = computeDay(plan, pm);
  const smarter = computeDay(optimizeDay(plan, pm).plan, pm);
  const known = /** @type {number[]} */ (pm.filter((v) => v !== null));
  const cleanest = Math.min(...known);
  return {
    airThatDay: { worstPm25: Math.max(...known), cleanestPm25: cleanest, cleanestHour: pm.indexOf(cleanest) },
    people: plan.members.map((m, i) => ({
      name: m.name,
      group: m.ageGroup,
      sensitive: m.sensitive,
      priority: memberWeight(m),
      inhaledMicrograms: Math.round(day.members[i].total),
      cigaretteEquivalent: round1(day.members[i].cigarettes),
      timesWhoGuideline: round1(day.members[i].whoMultiple),
    })),
    transportCo2Grams: Math.round(day.emissions.co2),
    suggestions: suggest(plan, pm)
      .slice(0, 5)
      .map((s) => ({
        action: s.title,
        why: s.why,
        familyDoseChangePercent: round1(s.impact.dosePct),
        co2ChangeGrams: Math.round(s.impact.co2),
        costsMoney: s.costly,
      })),
    ifAllFreeChangesApplied: {
      familyDoseChangePercent: round1(((smarter.total - day.total) / day.total) * 100),
      co2ChangeGrams: Math.round(smarter.emissions.co2 - day.emissions.co2),
    },
  };
}

/** @typedef {ReturnType<typeof buildFacts>} Facts */

/**
 * Deterministic briefing used when Gemini is off or fails.
 * @param {Facts} facts
 * @returns {Briefing}
 */
export function templateBriefing(facts) {
  const top = [...facts.people].sort((a, b) => b.priority * b.inhaledMicrograms - a.priority * a.inhaledMicrograms)[0];
  const summary =
    `The air peaks at ${facts.airThatDay.worstPm25} µg/m³ and is cleanest around ${facts.airThatDay.cleanestHour}:00. ` +
    `${top.name} needs the most protection, breathing about ${top.cigaretteEquivalent} cigarettes' worth of smoke. ` +
    `Applying the free changes cuts the family's dose by ${Math.abs(facts.ifAllFreeChangesApplied.familyDoseChangePercent)}%.`;
  const tips = facts.suggestions.slice(0, MAX_TIPS).map((s) => {
    const gains = [];
    if (s.familyDoseChangePercent < 0) gains.push(`${Math.abs(s.familyDoseChangePercent)}% less PM2.5 breathed`);
    if (s.co2ChangeGrams < 0) gains.push(`${Math.abs(s.co2ChangeGrams)} g less CO₂ emitted`);
    return `${s.action}${s.costsMoney ? ' (one-time cost)' : ''}: ${gains.join(', ') || 'a small gain'}.`;
  });
  return { summary, tips };
}

/**
 * Keep only well-formed, length-capped briefing text from the model.
 * @param {unknown} raw
 * @returns {Briefing | null}
 */
export function sanitizeBriefing(raw) {
  if (typeof raw !== 'object' || raw === null) return null;
  const { summary, tips } = /** @type {{ summary?: unknown, tips?: unknown }} */ (raw);
  const cleanSummary = cleanText(summary, 500);
  const cleanTips = Array.isArray(tips)
    ? tips
        .map((t) => cleanText(t, 300))
        .filter(Boolean)
        .slice(0, MAX_TIPS)
    : [];
  return cleanSummary && cleanTips.length ? { summary: cleanSummary, tips: cleanTips } : null;
}

/**
 * Write the family briefing in the chosen language.
 * @param {import('./client.js').AiClient} ai
 * @param {Plan} plan
 * @param {Forecast} pm
 * @param {Language} language
 * @returns {Promise<Briefing & { source: 'gemini' | 'template' }>}
 */
export async function writeBriefing(ai, plan, pm, language) {
  const facts = buildFacts(plan, pm);
  if (ai.enabled) {
    try {
      const raw = await ai.generateJson({
        system: BRIEFING_SYSTEM,
        prompt: `Write the reply in ${LANGUAGES[language]}.\nDATA:\n${JSON.stringify(facts)}`,
      });
      const clean = sanitizeBriefing(raw);
      if (clean) return { ...clean, source: 'gemini' };
    } catch {
      // Fall through to the deterministic briefing.
    }
  }
  return { ...templateBriefing(facts), source: 'template' };
}
