// @ts-check
/**
 * Offline what-if parser: turns a plain question ("what if Aarav plays cricket at 3pm?") into
 * a Change. Used when Gemini is unavailable, and as a cross-check of Gemini's answer.
 */

const MODE_WORDS = /** @type {const} */ ([
  ['metro', /\b(metro|subway|train)\b/],
  ['bus', /\bbus\b/],
  ['car', /\b(car|cab|taxi|uber|ola|drive)\b/],
  ['auto', /\b(auto|rickshaw|tuk)\b/],
  ['two-wheeler', /\b(scooter|scooty|bike|motorbike|two[- ]?wheeler)\b/],
  ['cycle', /\b(cycle|cycling|bicycle)\b/],
  ['walk', /\b(walk|walking|on foot)\b/],
]);

const PART_OF_DAY = /** @type {const} */ ([
  [/\b(early morning|dawn|sunrise)\b/, 6],
  [/\bmorning\b/, 8],
  [/\b(noon|midday|lunch)\b/, 12],
  [/\bafternoon\b/, 14],
  [/\bevening\b/, 18],
  [/\bnight\b/, 20],
]);

/**
 * Read a clock time from text. Returns a decimal hour or null.
 * @param {string} text lower-case
 */
export function parseTime(text) {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/) ?? text.match(/\bat (\d{1,2})(?::(\d{2}))?\b/);
  if (m) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const suffix = m[3]?.replace(/\./g, '');
    if (h > 23 || min > 59) return null;
    if (suffix === 'pm' && h < 12) h += 12;
    if (suffix === 'am' && h === 12) h = 0;
    // "at 5" with no am/pm: assume daytime hours people plan around.
    if (!suffix && h >= 1 && h <= 6) h += 12;
    return h + Math.round(min / 30) * 0.5;
  }
  for (const [re, hour] of PART_OF_DAY) if (re.test(text)) return hour;
  return null;
}

/**
 * Pick the activity the question is about by word overlap with labels and member names.
 * @param {string} text lower-case
 * @param {import('./dose.js').Plan} plan
 */
export function matchActivity(text, plan) {
  const words = new Set(text.split(/[^a-z0-9\p{Script=Devanagari}]+/u).filter((w) => w.length > 2));
  /** @type {import('./dose.js').Activity | null} */
  let best = null;
  let bestScore = 0;
  for (const a of plan.activities) {
    const names = plan.members.filter((m) => a.memberIds.includes(m.id)).map((m) => m.name.toLowerCase());
    const tokens = [...a.label.toLowerCase().split(/[^a-z0-9\p{Script=Devanagari}]+/u), ...names].filter((w) => w.length > 2);
    let s = 0;
    for (const t of tokens) if (words.has(t)) s += names.includes(t) ? 1 : 2;
    if (a.kind === 'commute' && /\b(commute|trip|ride|go to|travel)\b/.test(text)) s += 1;
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  return best;
}

/**
 * @param {string} question
 * @param {import('./dose.js').Plan} plan
 * @returns {{ change: import('./scenario.js').Change | null, note: string }}
 */
export function parseWhatIf(question, plan) {
  const text = question.toLowerCase();
  /** @type {import('./scenario.js').Change} */
  const change = {};

  if (/\bpurifier\b/.test(text)) change.purifier = !/\b(no|without|off|turn off)\b.*purifier/.test(text);
  if (/\bwindows?\b/.test(text)) change.windows = /\b(close|closed|shut)\b/.test(text) ? 'closed' : 'open';

  const a = matchActivity(text, plan);
  if (a) {
    if (a.kind === 'commute') {
      const mode = MODE_WORDS.find(([, re]) => re.test(text));
      if (mode && mode[0] !== a.mode) change.mode = mode[0];
    }
    if (a.kind === 'home') {
      if (/\b(exhaust|chimney)\b/.test(text)) change.source = 'gas-cooking-exhaust';
      else if (/\b(skip|no|without|stop)\b/.test(text) && a.source && a.source !== 'none') change.source = 'none';
    }
    const t = parseTime(text);
    if (t !== null && !change.mode) change.start = t;
    if (change.mode || change.source || change.start !== undefined) change.activityId = a.id;
  }

  const understood = Object.keys(change).length > 0;
  return {
    change: understood ? change : null,
    note: understood
      ? 'Understood with the offline parser.'
      : 'Try naming an activity and a time or transport, e.g. "What if the school run is by metro?"',
  };
}
