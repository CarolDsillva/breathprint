// @ts-check
/**
 * Smoke Detective: turns what was spotted in a room (by Gemini vision, or ticked by hand on the
 * checklist) into concrete fixes. Where a finding maps to the plan, the engine computes its
 * impact; otherwise it is practical advice. The model only picks ids from this fixed list.
 */

/**
 * @typedef {'gas-stove-no-exhaust' | 'chimney-present' | 'biomass-stove' | 'incense' | 'mosquito-coil'
 *   | 'window-open' | 'door-gap' | 'purifier-present' | 'ac-unit' | 'plants' | 'smoking' | 'dust-carpet'} FindingId
 */

/** @type {Readonly<Record<FindingId, { label: string, advice: string }>>} */
export const FINDINGS = Object.freeze({
  'gas-stove-no-exhaust': { label: 'Gas stove with no chimney or exhaust fan', advice: 'Fit a ducted chimney or exhaust fan and run it while cooking and for 10 minutes after. Cook with lids on.' },
  'chimney-present': { label: 'Kitchen chimney or exhaust fan', advice: 'Good. Make sure it vents outside (not recirculating) and clean its filter monthly.' },
  'biomass-stove': { label: 'Wood, coal or dung stove (chulha)', advice: 'This is the biggest indoor source. Switching to LPG or induction cuts indoor smoke by over 80%.' },
  incense: { label: 'Incense, dhoop or agarbatti', advice: 'Use an electric diya or a single short stick near an open window, and keep children away from the smoke.' },
  'mosquito-coil': { label: 'Mosquito coil', advice: 'One coil can equal the smoke of dozens of cigarettes. Use a net or a plug-in liquid vaporiser instead.' },
  'window-open': { label: 'Window left open', advice: 'On bad-air hours keep windows shut; air the room for 10 minutes in the early afternoon, when the air is cleanest.' },
  'door-gap': { label: 'Gaps under doors or around windows', advice: 'Seal gaps with weather strip or a rolled towel: a cheap way to keep smog out at night.' },
  'purifier-present': { label: 'Air purifier', advice: 'Run it on high for 30 minutes before sleep with the door shut. Change the HEPA filter as the maker says.' },
  'ac-unit': { label: 'Air conditioner', advice: 'Most ACs do not filter PM2.5. Do not rely on one as a purifier; keep its filter clean.' },
  plants: { label: 'Indoor plants', advice: 'Nice to have, but plants remove almost no PM2.5 at home scale. They are not a substitute for a filter.' },
  smoking: { label: 'Signs of smoking indoors', advice: 'Indoor smoking adds more PM2.5 than the worst smog day. Smoke outside, away from doors and windows.' },
  'dust-carpet': { label: 'Dusty floors or carpets', advice: 'Wet-mop instead of sweeping: dry brooms throw fine dust back into the air.' },
});

export const FINDING_IDS = /** @type {FindingId[]} */ (Object.keys(FINDINGS));

/**
 * Turn findings into fixes. A fix has a `change` when the plan can show its impact.
 * @param {FindingId[]} found
 * @param {import('./dose.js').Plan} plan
 * @returns {{ id: FindingId, label: string, advice: string, change?: import('./scenario.js').Change, note?: string }[]}
 */
export function findingsToFixes(found, plan) {
  const ids = [...new Set(found)].filter((id) => Object.hasOwn(FINDINGS, id));
  const bySource = (/** @type {string} */ src) => plan.activities.find((a) => a.kind === 'home' && a.source === src);
  return ids.map((id) => {
    const base = { id, ...FINDINGS[id] };
    switch (id) {
      case 'gas-stove-no-exhaust': {
        const a = bySource('gas-cooking');
        return a ? { ...base, change: { activityId: a.id, source: 'gas-cooking-exhaust' } } : { ...base, note: 'Add your cooking time to the plan to see the impact.' };
      }
      case 'biomass-stove': {
        const a = bySource('biomass-cooking');
        return a ? { ...base, change: { activityId: a.id, source: 'gas-cooking-exhaust' } } : { ...base, note: 'Add cooking with a wood/coal stove to the plan to see the impact.' };
      }
      case 'incense':
      case 'mosquito-coil': {
        const a = bySource(id);
        return a ? { ...base, change: { activityId: a.id, source: 'none' } } : base;
      }
      case 'window-open':
        return plan.home.windows === 'open' && !plan.home.purifier ? { ...base, change: { windows: 'closed' } } : base;
      case 'purifier-present':
        return plan.home.purifier ? base : { ...base, change: { purifier: true }, note: 'Your plan says you have no purifier. Update it to see your real numbers.' };
      default:
        return base;
    }
  });
}

/**
 * Validate a model's scan answer: keep known ids only, with short cleaned evidence.
 * @param {unknown} raw
 * @returns {{ findings: { id: FindingId, evidence: string }[], summary: string } | null}
 */
export function sanitizeScan(raw) {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = /** @type {Record<string, any>} */ (raw);
  const clean = (/** @type {unknown} */ v, /** @type {number} */ max) =>
    // eslint-disable-next-line no-control-regex
    typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max) : '';
  const list = Array.isArray(r.findings) ? r.findings : [];
  /** @type {{ id: FindingId, evidence: string }[]} */
  const findings = [];
  for (const f of list) {
    if (findings.length >= 8) break;
    if (typeof f?.id !== 'string' || !Object.hasOwn(FINDINGS, f.id)) continue;
    if (findings.some((x) => x.id === f.id)) continue;
    findings.push({ id: /** @type {FindingId} */ (f.id), evidence: clean(f.evidence, 140) });
  }
  return { findings, summary: clean(r.summary, 300) };
}
