// @ts-check
import { AGE_GROUPS, WHO_24H_PM25 } from '/engine/constants.js';
import { formatTime } from '/engine/time.js';
import { fmt, fmt1, h } from './dom.js';

/** PM2.5 bands (µg/m³) with plain-language names, aligned with India's NAQI breakpoints. */
const BANDS = [
  { max: 30, name: 'Good' },
  { max: 60, name: 'Satisfactory' },
  { max: 90, name: 'Moderate' },
  { max: 120, name: 'Poor' },
  { max: 250, name: 'Very poor' },
  { max: Infinity, name: 'Severe' },
];

/** @param {number} pm */
export function band(pm) {
  const i = BANDS.findIndex((b) => pm <= b.max);
  return { index: i, name: BANDS[i].name };
}

/**
 * @param {HTMLElement} el
 * @param {(number | null)[]} pm
 */
export function renderAirStrip(el, pm) {
  const max = Math.max(60, ...pm.map((v) => v ?? 0));
  el.replaceChildren(
    ...pm.map((v, hour) => {
      const label = formatTime(hour).replace(':00', '');
      if (v === null) return h('li', { 'aria-label': `${label}: no data` }, h('span', { class: 'val' }, '–'), h('span', { class: 'hour', 'aria-hidden': 'true' }, hour));
      const b = band(v);
      return h('li', { 'aria-label': `${label}: ${Math.round(v)} micrograms, ${b.name}`, title: `${label}: ${Math.round(v)} µg/m³ (${b.name})` },
        h('span', { class: 'val', 'aria-hidden': 'true' }, Math.round(v)),
        h('span', { class: `bar band-${b.index}`, style: `height:${Math.max(3, (v / max) * 100)}%`, 'aria-hidden': 'true' }),
        h('span', { class: 'hour', 'aria-hidden': 'true' }, hour),
      );
    }),
  );
}

/**
 * Per-person cards plus the city-side ledger.
 * @param {HTMLElement} el
 * @param {any} plan
 * @param {any} day computeDay() result
 */
export function renderBudget(el, plan, day) {
  const worst = Math.max(...day.members.map((/** @type {any} */ m) => m.cigarettes), 1);
  el.replaceChildren(
    h('div', { class: 'budget-grid' },
      ...plan.members.map((/** @type {any} */ m, /** @type {number} */ i) => {
        const r = day.members[i];
        return h('article', { class: 'person', 'aria-labelledby': `p-${m.id}` },
          h('h3', { id: `p-${m.id}` }, m.name, m.sensitive || m.ageGroup === 'child' || m.ageGroup === 'senior' ? h('span', { class: 'tag' }, m.sensitive ? 'Sensitive' : AGE_GROUPS[m.ageGroup].label.split(' ')[0]) : null),
          h('p', { class: 'big' }, `≈ ${fmt1(r.cigarettes)}`, h('span', { class: 'sr-only' }, ' ')),
          h('p', { class: 'hint' }, `cigarettes' worth of smoke in the day · ${fmt(r.total)} µg PM2.5 inhaled`),
          h('div', { class: 'meter', role: 'img', 'aria-label': `${fmt1(r.cigarettes)} cigarette equivalents` }, h('span', { style: `width:${Math.min(100, (r.cigarettes / worst) * 100)}%` })),
          h('p', null, `${fmt1(r.whoMultiple)}× what the same breaths would carry at the WHO guideline (${WHO_24H_PM25} µg/m³).`),
          r.missingHours ? h('p', { class: 'hint' }, `${r.missingHours} hours had no forecast and were skipped.`) : null,
        );
      }),
    ),
    h('div', { class: 'city' },
      h('strong', null, 'What your trips add to the city that day: '),
      `${fmt1(day.emissions.co2 / 1000)} kg CO₂ and ${fmt(day.emissions.pm)} mg of PM2.5 from exhaust, brakes and tyres.`,
    ),
  );
}

/**
 * Impact chips: breathed and emitted, each with a clear direction word (not colour alone).
 * @param {{ dosePct: number, co2: number }} impact
 */
export function impactChips(impact) {
  const chips = [];
  if (Math.abs(impact.dosePct) >= 0.5) {
    const less = impact.dosePct < 0;
    chips.push(h('span', { class: `chip ${less ? 'good' : 'bad'}` }, `Family breathes ${fmt1(Math.abs(impact.dosePct))}% ${less ? 'less' : 'more'}`));
  }
  if (Math.abs(impact.co2) >= 1) {
    const less = impact.co2 < 0;
    chips.push(h('span', { class: `chip ${less ? 'good' : 'bad'}` }, `City gets ${fmt(Math.abs(impact.co2))} g CO₂ ${less ? 'less' : 'more'}`));
  }
  if (!chips.length) chips.push(h('span', { class: 'chip neutral' }, 'Little difference'));
  return h('div', { class: 'chips' }, ...chips);
}

/**
 * @param {HTMLElement} el
 * @param {any[]} suggestions
 * @param {(s: any) => void} onTry
 */
export function renderSuggestions(el, suggestions, onTry) {
  if (!suggestions.length) {
    el.replaceChildren(h('li', null, 'Your day is already well planned for this day’s air. Nothing more to gain.'));
    return;
  }
  el.replaceChildren(
    ...suggestions.map((s) => {
      const people = s.impact.perMember.filter((/** @type {any} */ p) => p.pct <= -1).map((/** @type {any} */ p) => `${p.name} −${fmt1(Math.abs(p.pct))}%`);
      return h('li', null,
        h('span', { class: 'title' }, s.title, s.costly ? ' (one-time cost)' : ''),
        impactChips(s.impact),
        h('span', { class: 'hint' }, s.why, people.length ? ` Biggest gains: ${people.join(', ')}.` : ''),
        h('div', null, h('button', { type: 'button', class: 'secondary', onclick: () => onTry(s) }, 'Use this in my day')),
      );
    }),
  );
}

/**
 * Before/after table for a what-if or applied change.
 * @param {any} r compareChange() result
 * @param {string} heading
 */
export function comparisonCard(r, heading) {
  return h('div', { class: 'compare' },
    h('p', null, h('strong', null, heading)),
    impactChips(r.delta),
    h('table', null,
      h('caption', { class: 'sr-only' }, 'PM2.5 inhaled before and after the change'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Person'), h('th', { scope: 'col' }, 'Now (µg)'), h('th', { scope: 'col' }, 'With change (µg)'), h('th', { scope: 'col' }, 'Change'))),
      h('tbody', null, ...r.perMember.map((/** @type {any} */ p) =>
        h('tr', null, h('th', { scope: 'row' }, p.name), h('td', null, fmt(p.before)), h('td', null, fmt(p.after)), h('td', null, Math.abs(p.pct) < 0.05 ? 'no change' : `${p.pct < 0 ? '−' : '+'}${fmt1(Math.abs(p.pct))}%`)))),
    ),
    h('p', { class: 'hint' }, `Trips: ${fmt(r.before.emissions.co2)} g → ${fmt(r.after.emissions.co2)} g CO₂.`),
  );
}

/**
 * @param {HTMLElement} el
 * @param {ReturnType<typeof import('/engine/room.js').purifierPlan>} r
 * @param {string} purifierLabel
 */
export function renderRoom(el, r, purifierLabel) {
  const time = r.minutes === null
    ? `This purifier cannot bring the room below ${r.target} µg/m³. It settles around ${fmt(r.steady)} µg/m³; shut the window or use a bigger purifier.`
    : r.minutes === 0
      ? `The room is already below ${r.target} µg/m³.`
      : `About ${r.minutes} minutes to get below ${r.target} µg/m³; it then settles near ${fmt(r.steady)} µg/m³.`;
  el.replaceChildren(
    h('p', { class: 'big' }, r.minutes === null ? 'Not enough' : `${r.minutes} min`),
    h('p', null, `${purifierLabel}: ${time}`),
    h('p', { class: 'hint' }, `Room volume ${fmt1(r.volume)} m³. Without a purifier it sits near ${fmt(r.start)} µg/m³. For 5 clean-air changes an hour you need a CADR of at least ${fmt(r.recommendedCadr)} m³/h (yours gives ${fmt1(r.purifierAch)} clean-air changes an hour).`),
  );
}

const KIND_NAMES = { sleep: 'asleep', home: 'at home', 'indoor-away': 'indoors away', outdoor: 'outdoors', commute: 'travelling' };

/**
 * Headline numbers: the family's day as planned, versus clean air, and with the smarter plan.
 * @param {HTMLElement} el
 * @param {any} day computeDay() of the current plan
 * @param {any} smarter computeDay() of the optimised plan
 */
export function renderStats(el, day, smarter) {
  const volume = day.members.reduce((/** @type {number} */ s, /** @type {any} */ m) => s + m.volume, 0);
  const who = day.total / (WHO_24H_PM25 * volume);
  const cut = day.total > 0 ? ((day.total - smarter.total) / day.total) * 100 : 0;
  const stat = (/** @type {string} */ k, /** @type {Node[]} */ v, /** @type {string} */ d, /** @type {string} */ cls = '') =>
    h('div', { class: 'stat' }, h('p', { class: 'k' }, k), h('p', { class: `v ${cls}` }, ...v), h('p', { class: 'd' }, d));
  el.replaceChildren(
    stat('Your family’s day, as planned', [fmt(day.total), h('small', null, 'µg')], `of PM2.5 inhaled from ${fmt1(volume)} m³ of air`),
    stat('Compared with clean air', [`${fmt1(who)}×`], `the dose of breathing the same air at the WHO guideline (${WHO_24H_PM25} µg/m³)`, 'warn'),
    cut >= 0.5
      ? stat('With the smarter plan', [`−${Math.round(cut)}%`], `${fmt(smarter.total)} µg · trips ${fmt1(smarter.emissions.co2 / 1000)} kg CO₂ instead of ${fmt1(day.emissions.co2 / 1000)} kg`, 'ok')
      : stat('With the smarter plan', ['✓'], 'This is already the cleanest plan using free changes.', 'ok'),
  );
}

/**
 * Hour-by-hour grid: the air, then where each person is.
 * Each row also carries a plain-text description for screen readers.
 * @param {HTMLElement} el
 * @param {any} plan
 * @param {(number | null)[]} pm
 * @param {(plan: any, member: any) => { kind: string, label: string, smoke: boolean }[]} timeline
 */
export function renderHourGrid(el, plan, pm, timeline) {
  const cells = [h('span', { class: 'rowlabel', 'aria-hidden': 'true' }, '')];
  for (let i = 0; i < 24; i++) cells.push(h('span', { class: 'tick', 'aria-hidden': 'true' }, i % 3 === 0 ? formatTime(i).replace(':00', '').toLowerCase() : ''));
  cells.push(h('span', { class: 'rowlabel', 'aria-hidden': 'true' }, 'Air'));
  for (const v of pm) cells.push(h('span', { class: `cell ${v === null ? '' : `band-${band(v).index}`}`, 'aria-hidden': 'true', title: v === null ? 'no data' : `${Math.round(v)} µg/m³` }));

  /** @type {string[]} */
  const descriptions = [];
  for (const m of plan.members) {
    const t = timeline(plan, m);
    cells.push(h('span', { class: 'rowlabel', 'aria-hidden': 'true', title: m.name }, m.name));
    t.forEach((s, hour) => cells.push(h('span', { class: `cell ${s.kind}${s.smoke ? ' smoke' : ''}`, 'aria-hidden': 'true', title: `${formatTime(hour)} · ${s.label}` })));
    const outside = t.map((s, hour) => ({ s, hour })).filter(({ s }) => s.kind === 'outdoor' || s.kind === 'commute');
    descriptions.push(`${m.name}: ${outside.length ? outside.map(({ s, hour }) => `${KIND_NAMES[s.kind]} at ${formatTime(hour)} (${s.label})`).join(', ') : 'indoors all day'}.`);
  }
  el.replaceChildren(
    h('div', { class: 'subpanel-head' }, h('h3', null, 'Your day, hour by hour'), h('p', { class: 'label' }, 'PM2.5 forecast vs where each person is')),
    h('div', { class: 'hour-grid', role: 'img', 'aria-label': `Hour-by-hour plan. ${descriptions.join(' ')}` }, ...cells),
    h('div', { class: 'legend', 'aria-hidden': 'true' },
      ...[['outdoor', 'Outdoors'], ['commute', 'Travelling'], ['indoor-away', 'School / office'], ['home', 'At home'], ['smoke', 'Indoor smoke'], ['sleep', 'Asleep']]
        .map(([k, l]) => h('span', null, h('i', { class: `cell ${k}` }), l))),
  );
}
