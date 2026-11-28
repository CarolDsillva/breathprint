// @ts-check
/** Rendering for the breath-budget section: headline numbers, hour grid, people, choices, impact. */
import { AGE_GROUPS, formatTime, WHO_24H_PM25 } from '/engine/index.js';
import { band, impactChips } from './components.js';
import { fmt, fmt1, h } from './dom.js';

/** @typedef {import('./types.js').Plan} Plan */
/** @typedef {import('./types.js').Member} Member */
/** @typedef {import('./types.js').Forecast} Forecast */
/** @typedef {import('./types.js').DayResult} DayResult */
/** @typedef {import('./types.js').Suggestion} Suggestion */
/** @typedef {ReturnType<typeof import('/engine/dose.js').memberTimeline>} Timeline */

const KIND_NAMES = Object.freeze({
  sleep: 'asleep',
  home: 'at home',
  'indoor-away': 'indoors away',
  outdoor: 'outdoors',
  commute: 'travelling',
});

const LEGEND = [
  ['outdoor', 'Outdoors'],
  ['commute', 'Travelling'],
  ['indoor-away', 'School / office'],
  ['home', 'At home'],
  ['smoke', 'Indoor smoke'],
  ['sleep', 'Asleep'],
];

/** Below this cut (percent), the plan is already as clean as free changes can make it. */
const MIN_MEANINGFUL_CUT_PCT = 0.5;

/** @param {number} hour */
const shortHour = (hour) => formatTime(hour).replace(':00', '');

/**
 * One headline number with its label and explanation.
 * @param {string} label
 * @param {(Node | string)[]} value
 * @param {string} detail
 * @param {string} [tone]
 */
function stat(label, value, detail, tone = '') {
  return h(
    'div',
    { class: 'stat' },
    h('p', { class: 'k' }, label),
    h('p', { class: `v ${tone}` }, ...value),
    h('p', { class: 'd' }, detail),
  );
}

/**
 * Headline numbers: the day as planned, versus clean air, and with the smarter plan.
 * @param {HTMLElement} el
 * @param {DayResult} day
 * @param {DayResult} smarter
 */
export function renderStats(el, day, smarter) {
  const volume = day.members.reduce((sum, m) => sum + m.volume, 0);
  const whoMultiple = day.total / (WHO_24H_PM25 * volume);
  const cut = day.total > 0 ? ((day.total - smarter.total) / day.total) * 100 : 0;
  el.replaceChildren(
    stat(
      'Your family’s day, as planned',
      [fmt(day.total), h('small', null, 'µg')],
      `of PM2.5 inhaled from ${fmt1(volume)} m³ of air`,
    ),
    stat(
      'Compared with clean air',
      [`${fmt1(whoMultiple)}×`],
      `the dose of breathing the same air at the WHO guideline (${WHO_24H_PM25} µg/m³)`,
      'warn',
    ),
    cut >= MIN_MEANINGFUL_CUT_PCT
      ? stat(
          'With the smarter plan',
          [`−${Math.round(cut)}%`],
          `${fmt(smarter.total)} µg · trips ${fmt1(smarter.emissions.co2 / 1000)} kg CO₂ instead of ${fmt1(day.emissions.co2 / 1000)} kg`,
          'ok',
        )
      : stat('With the smarter plan', ['✓'], 'This is already the cleanest plan using free changes.', 'ok'),
  );
}

/**
 * Plain-language summary of when a person is outdoors or travelling, for screen readers.
 * @param {Member} member
 * @param {Timeline} timeline
 */
function describeTimeline(member, timeline) {
  const outside = timeline
    .map((slot, hour) => ({ slot, hour }))
    .filter(({ slot }) => slot.kind === 'outdoor' || slot.kind === 'commute')
    .map(({ slot, hour }) => `${KIND_NAMES[slot.kind]} at ${formatTime(hour)} (${slot.label})`);
  return `${member.name}: ${outside.length ? outside.join(', ') : 'indoors all day'}.`;
}

/**
 * Hour-by-hour grid: the air, then where each person is.
 * @param {HTMLElement} el
 * @param {Plan} plan
 * @param {Forecast} pm
 * @param {(plan: Plan, member: Member) => Timeline} timelineOf
 */
export function renderHourGrid(el, plan, pm, timelineOf) {
  const hidden = { 'aria-hidden': 'true' };
  const cells = [h('span', { class: 'rowlabel', ...hidden }, '')];
  for (let hour = 0; hour < 24; hour++) {
    cells.push(h('span', { class: 'tick', ...hidden }, hour % 3 === 0 ? shortHour(hour).toLowerCase() : ''));
  }
  cells.push(h('span', { class: 'rowlabel', ...hidden }, 'Air'));
  for (const v of pm) {
    cells.push(
      h('span', {
        class: `cell ${v === null ? '' : `band-${band(v).index}`}`,
        ...hidden,
        title: v === null ? 'no data' : `${Math.round(v)} µg/m³`,
      }),
    );
  }

  const descriptions = [];
  for (const member of plan.members) {
    const timeline = timelineOf(plan, member);
    cells.push(h('span', { class: 'rowlabel', ...hidden, title: member.name }, member.name));
    timeline.forEach((slot, hour) => {
      cells.push(
        h('span', {
          class: `cell ${slot.kind}${slot.smoke ? ' smoke' : ''}`,
          ...hidden,
          title: `${formatTime(hour)} · ${slot.label}`,
        }),
      );
    });
    descriptions.push(describeTimeline(member, timeline));
  }

  el.replaceChildren(
    h(
      'div',
      { class: 'subpanel-head' },
      h('h3', null, 'Your day, hour by hour'),
      h('p', { class: 'label' }, 'PM2.5 forecast vs where each person is'),
    ),
    h(
      'div',
      { class: 'hour-grid', role: 'img', 'aria-label': `Hour-by-hour plan. ${descriptions.join(' ')}` },
      ...cells,
    ),
    h(
      'div',
      { class: 'legend', ...hidden },
      ...LEGEND.map(([kind, label]) => h('span', null, h('i', { class: `cell ${kind}` }), label)),
    ),
  );
}

/**
 * Short tag for people who need extra protection.
 * @param {Member} member
 */
function protectionTag(member) {
  if (member.sensitive) return h('span', { class: 'tag' }, 'Sensitive');
  if (member.ageGroup === 'child' || member.ageGroup === 'senior') {
    return h('span', { class: 'tag' }, AGE_GROUPS[member.ageGroup].label.split(' ')[0]);
  }
  return null;
}

/**
 * Per-person cards plus what the family's trips add to the city.
 * @param {HTMLElement} el
 * @param {Plan} plan
 * @param {DayResult} day
 */
export function renderBudget(el, plan, day) {
  const worst = Math.max(...day.members.map((m) => m.cigarettes), 1);
  const cards = plan.members.map((member, i) => {
    const r = day.members[i];
    return h(
      'article',
      { class: 'person', 'aria-labelledby': `p-${member.id}` },
      h('h3', { id: `p-${member.id}` }, member.name, protectionTag(member)),
      h('p', { class: 'big' }, `≈ ${fmt1(r.cigarettes)}`),
      h('p', { class: 'hint' }, `cigarettes' worth of smoke in the day · ${fmt(r.total)} µg PM2.5 inhaled`),
      h(
        'div',
        { class: 'meter', role: 'img', 'aria-label': `${fmt1(r.cigarettes)} cigarette equivalents` },
        h('span', { style: `width:${Math.min(100, (r.cigarettes / worst) * 100)}%` }),
      ),
      h(
        'p',
        null,
        `${fmt1(r.whoMultiple)}× what the same breaths would carry at the WHO guideline (${WHO_24H_PM25} µg/m³).`,
      ),
      r.missingHours ? h('p', { class: 'hint' }, `${r.missingHours} hours had no forecast and were skipped.`) : null,
    );
  });
  el.replaceChildren(
    h('div', { class: 'budget-grid' }, ...cards),
    h(
      'div',
      { class: 'city' },
      h('strong', null, 'What your trips add to the city that day: '),
      `${fmt1(day.emissions.co2 / 1000)} kg CO₂ and ${fmt(day.emissions.pm)} mg of PM2.5 from exhaust, brakes and tyres.`,
    ),
  );
}

/**
 * The ranked choices, each with both impacts and a button to apply it.
 * @param {HTMLElement} el
 * @param {Suggestion[]} suggestions
 * @param {(suggestion: Suggestion) => void} onUse
 */
export function renderSuggestions(el, suggestions, onUse) {
  if (!suggestions.length) {
    el.replaceChildren(h('li', null, 'Your day is already well planned for this day’s air. Nothing more to gain.'));
    return;
  }
  el.replaceChildren(
    ...suggestions.map((s) => {
      const gains = s.impact.perMember.filter((p) => p.pct <= -1).map((p) => `${p.name} −${fmt1(Math.abs(p.pct))}%`);
      return h(
        'li',
        null,
        h('span', { class: 'title' }, s.title, s.costly ? ' (one-time cost)' : ''),
        impactChips(s.impact),
        h('span', { class: 'hint' }, s.why, gains.length ? ` Biggest gains: ${gains.join(', ')}.` : ''),
        h('div', null, h('button', { type: 'button', class: 'btn', onclick: () => onUse(s) }, 'Use this in my day')),
      );
    }),
  );
}

/**
 * Smog-season savings per person and the trip emissions kept out of the air.
 * @param {HTMLElement} el
 * @param {Plan} plan
 * @param {ReturnType<typeof import('/engine/impact.js').seasonSavings>} season
 */
export function renderSeason(el, plan, season) {
  if (season.days === 0) {
    el.replaceChildren(
      h('p', { class: 'hint' }, 'The smog season (15 Oct to 28 Feb) is over. Keep this plan for next winter.'),
    );
    return;
  }
  const nameOf = (/** @type {string} */ id) => plan.members.find((m) => m.id === id)?.name ?? id;
  const people = season.people.filter((p) => p.cigarettesAvoided >= 1);
  const parts = [
    h('p', null, `If every day until 28 Feb (${season.days} days) looks like this one, the smarter plan spares:`),
    people.length
      ? h(
          'ul',
          { class: 'impact-list' },
          ...people.map((p) =>
            h(
              'li',
              null,
              h('span', { class: 'num' }, `≈ ${fmt(p.cigarettesAvoided)}`),
              ` cigarettes' worth for ${nameOf(p.memberId)}`,
            ),
          ),
        )
      : h('p', { class: 'hint' }, 'Your plan is already close to the cleanest it can be.'),
  ];
  if (season.co2KgAvoided >= 0.1)
    parts.push(h('p', null, `…and keeps ${fmt1(season.co2KgAvoided)} kg of CO₂ out of your city's air.`));
  parts.push(h('p', { class: 'hint' }, 'Estimate: assumes each remaining day has similar air and the same routine.'));
  el.replaceChildren(...parts);
}

/**
 * Neighbourhood totals for one day.
 * @param {HTMLElement} el
 * @param {ReturnType<typeof import('/engine/impact.js').communityRipple>} ripple
 */
export function renderRipple(el, ripple) {
  if (ripple.co2KgAvoided < 0.01 && ripple.cigarettesAvoided < 0.05) {
    el.replaceChildren(h('p', { class: 'hint' }, 'Apply some changes first: there is nothing to multiply yet.'));
    return;
  }
  const line = (/** @type {string} */ num, /** @type {string} */ text) =>
    h('li', null, h('span', { class: 'num' }, num), text);
  el.replaceChildren(
    h(
      'ul',
      { class: 'impact-list' },
      line(
        `≈ ${fmt(ripple.cigarettesAvoided)}`,
        ` cigarettes' worth of smoke not breathed (${fmt1(ripple.pmGramsNotBreathed)} g of PM2.5)`,
      ),
      line(`${fmt1(ripple.co2KgAvoided)} kg`, ' less CO₂ from trips'),
      line(`${fmt1(ripple.pmGramsNotEmitted)} g`, ' less PM2.5 from exhaust, brakes and tyres'),
    ),
    h('p', { class: 'hint' }, 'In one day. Share your plan with neighbours and your society’s WhatsApp group.'),
  );
}
