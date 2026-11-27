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

const CLOCK_WITH_SUFFIX = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/;
const CLOCK_AFTER_AT = /\bat (\d{1,2})(?::(\d{2}))?\b/;

/**
 * Convert clock parts to a decimal hour rounded to the half hour, or null if impossible.
 * A bare "at 1"–"at 6" is read as afternoon: the hours families plan activities around.
 * @param {number} hour
 * @param {number} minute
 * @param {string | undefined} suffix "am", "pm" or none
 */
function toDecimalHour(hour, minute, suffix) {
  if (hour > 23 || minute > 59) return null;
  let h = hour;
  if (suffix === 'pm' && h < 12) h += 12;
  else if (suffix === 'am' && h === 12) h = 0;
  else if (!suffix && h >= 1 && h <= 6) h += 12;
  return h + Math.round(minute / 30) * 0.5;
}

/**
 * Read a clock time ("2pm", "7:30 am", "at 5") or a part of the day ("afternoon") from text.
 * @param {string} text lower-case
 * @returns {number | null} decimal hour
 */
export function parseTime(text) {
  const m = text.match(CLOCK_WITH_SUFFIX) ?? text.match(CLOCK_AFTER_AT);
  if (m) return toDecimalHour(Number(m[1]), m[2] ? Number(m[2]) : 0, m[3]?.replace(/\./g, ''));
  const part = PART_OF_DAY.find(([re]) => re.test(text));
  return part ? part[1] : null;
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
    const tokens = [...a.label.toLowerCase().split(/[^a-z0-9\p{Script=Devanagari}]+/u), ...names].filter(
      (w) => w.length > 2,
    );
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

/** @typedef {import('./scenario.js').Change} Change */

/**
 * Home-level changes: purifier on/off, windows open/shut.
 * @param {string} text lower-case
 * @returns {Change}
 */
function homeChange(text) {
  /** @type {Change} */
  const change = {};
  if (/\bpurifier\b/.test(text)) change.purifier = !/\b(no|without|off|turn off)\b.*purifier/.test(text);
  if (/\bwindows?\b/.test(text)) change.windows = /\b(close|closed|shut)\b/.test(text) ? 'closed' : 'open';
  return change;
}

/**
 * A new smoke source for an at-home activity: a chimney, or skipping the smoke entirely.
 * @param {string} text lower-case
 * @param {import('./dose.js').Activity} a
 * @returns {Change['source']}
 */
function sourceChange(text, a) {
  if (a.kind !== 'home') return undefined;
  if (/\b(exhaust|chimney)\b/.test(text)) return 'gas-cooking-exhaust';
  const skipping = /\b(skip|no|without|stop)\b/.test(text);
  return skipping && a.source && a.source !== 'none' ? 'none' : undefined;
}

/**
 * Changes to one activity: a new transport mode, smoke source or start time.
 * @param {string} text lower-case
 * @param {import('./dose.js').Activity} a
 * @returns {Change}
 */
function activityChange(text, a) {
  const modeWord = a.kind === 'commute' ? MODE_WORDS.find(([, re]) => re.test(text)) : undefined;
  const mode = modeWord && modeWord[0] !== a.mode ? modeWord[0] : undefined;
  const source = sourceChange(text, a);
  const start = mode ? null : parseTime(text);
  if (!mode && !source && start === null) return {};
  return {
    activityId: a.id,
    ...(mode ? { mode } : {}),
    ...(source ? { source } : {}),
    ...(start !== null ? { start } : {}),
  };
}

/**
 * Understand a what-if question without AI.
 * @param {string} question
 * @param {import('./dose.js').Plan} plan
 * @returns {{ change: Change | null, note: string }}
 */
export function parseWhatIf(question, plan) {
  const text = question.toLowerCase();
  const activity = matchActivity(text, plan);
  /** @type {Change} */
  const change = { ...homeChange(text), ...(activity ? activityChange(text, activity) : {}) };
  const understood = Object.keys(change).length > 0;
  return {
    change: understood ? change : null,
    note: understood
      ? 'Understood with the offline parser.'
      : 'Try naming an activity and a time or transport, e.g. "What if the school run is by metro?"',
  };
}
