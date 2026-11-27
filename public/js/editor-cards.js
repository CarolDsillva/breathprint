// @ts-check
/** Form cards for one person and one activity. Pure builders: no state, no listeners. */
import { AGE_GROUPS, LIMITS, MODES, SOURCES } from '/engine/constants.js';
import { h, toTimeValue } from './dom.js';
import { DEFAULT_TRIP, DEFAULT_WINDOW } from './editor-fields.js';

/** @typedef {import('./types.js').Activity} Activity */
/** @typedef {import('./types.js').Member} Member */

const KIND_LABELS = Object.freeze({
  outdoor: 'Outdoors (walk, play, market)',
  commute: 'Trip / commute',
  'indoor-away': 'Indoors away (school, office)',
  home: 'At home (cooking, puja…)',
});
const INTENSITY_LABELS = Object.freeze({
  rest: 'Sitting / resting',
  light: 'Light (walking, chores)',
  moderate: 'Moderate (brisk walk, cycling)',
  vigorous: 'Hard (running, sport)',
});

/**
 * Keys → labels of a table like MODES or SOURCES.
 * @param {Readonly<Record<string, { label: string }>>} table
 * @returns {Record<string, string>}
 */
const labelsOf = (table) => Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v.label]));

/**
 * @param {Readonly<Record<string, string>>} labels
 * @param {string} selected
 */
function options(labels, selected) {
  return Object.entries(labels).map(([value, label]) => h('option', { value, selected: value === selected }, label));
}

/**
 * Label text above its control.
 * @param {string} id
 * @param {string} text
 * @param {HTMLElement} control
 */
function field(id, text, control) {
  return h('label', { for: id }, h('span', { class: 'label' }, text), control);
}

/**
 * Checkbox with its label beside it.
 * @param {string} text
 * @param {Record<string, unknown>} attrs
 */
function checkbox(text, attrs) {
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', ...attrs }), text);
}

/**
 * @param {Record<string, string>} dataset
 * @param {string} ariaLabel
 * @param {boolean} [disabled]
 */
function removeButton(dataset, ariaLabel, disabled = false) {
  return h(
    'div',
    { class: 'editor-actions' },
    h('button', { type: 'button', class: 'btn link', dataset, disabled, 'aria-label': ariaLabel }, 'Remove'),
  );
}

/**
 * One person: name, age group, health sensitivity.
 * @param {Member} m
 * @param {number} index
 * @param {number} total
 */
export function memberCard(m, index, total) {
  const id = `m-${m.id}`;
  /** @param {string} name */
  const data = (name) => ({ member: m.id, field: name });
  return h(
    'div',
    { class: 'editor-item', role: 'group', 'aria-label': `Person ${index + 1}: ${m.name}` },
    h(
      'div',
      { class: 'grid' },
      field(
        `${id}-name`,
        'Name',
        h('input', {
          class: 'input',
          id: `${id}-name`,
          type: 'text',
          maxlength: LIMITS.nameLength,
          value: m.name,
          dataset: data('name'),
        }),
      ),
      field(
        `${id}-age`,
        'Age group',
        h(
          'select',
          { class: 'input', id: `${id}-age`, dataset: data('ageGroup') },
          ...options(labelsOf(AGE_GROUPS), m.ageGroup),
        ),
      ),
      checkbox('Asthma, heart/lung condition or pregnancy', { checked: m.sensitive, dataset: data('sensitive') }),
    ),
    removeButton({ removeMember: m.id }, `Remove ${m.name}`, total <= 1),
  );
}

/**
 * Builders for the controls of one activity card, sharing its id prefix and data attributes.
 * @param {Activity} a
 */
function activityControls(a) {
  const prefix = `a-${a.id}`;
  /** @param {string} name @param {string} [value] */
  const data = (name, value) => ({ activity: a.id, field: name, ...(value ? { value } : {}) });
  return {
    prefix,
    data,
    /** @param {string} name field name, also the end of the control's id @param {string} text @param {Record<string, unknown>} attrs */
    input: (name, text, attrs) =>
      field(
        `${prefix}-${name}`,
        text,
        h('input', { class: 'input', id: `${prefix}-${name}`, dataset: data(name), ...attrs }),
      ),
    /** @param {string} name @param {string} text @param {Readonly<Record<string, string>>} labels @param {string} value */
    select: (name, text, labels, value) =>
      field(
        `${prefix}-${name}`,
        text,
        h('select', { class: 'input', id: `${prefix}-${name}`, dataset: data(name) }, ...options(labels, value)),
      ),
  };
}

/**
 * The fields that depend on the activity kind: trips have transport and distance, other
 * activities have hours and effort; home activities have a smoke source, outdoor ones traffic.
 * @param {Activity} a
 * @param {ReturnType<typeof activityControls>} c
 */
function kindFields(a, c) {
  if (a.kind === 'commute') {
    return [
      c.select('mode', 'Transport', labelsOf(MODES), a.mode ?? DEFAULT_TRIP.mode),
      c.input('distanceKm', 'Distance (km)', {
        type: 'number',
        min: 0.1,
        max: 200,
        step: 0.5,
        value: a.distanceKm ?? DEFAULT_TRIP.distanceKm,
      }),
    ];
  }
  return [
    c.input('hours', 'Hours', { type: 'number', min: 0.25, max: 16, step: 0.25, value: a.hours }),
    c.select('intensity', 'Effort', INTENSITY_LABELS, a.intensity),
    a.kind === 'home' ? c.select('source', 'Smoke source', labelsOf(SOURCES), a.source ?? 'none') : null,
    a.kind === 'outdoor'
      ? checkbox('Next to busy traffic', { checked: a.nearTraffic, dataset: c.data('nearTraffic') })
      : null,
  ];
}

/**
 * "Can move" and, when ticked, the earliest start and latest end.
 * @param {Activity} a
 * @param {ReturnType<typeof activityControls>} c
 */
function flexibleFields(a, c) {
  const window = { ...DEFAULT_WINDOW, ...a.window };
  return h(
    'div',
    { class: 'grid' },
    checkbox('Can move to another time', {
      id: `${c.prefix}-flexible`,
      checked: a.flexible,
      dataset: c.data('flexible'),
    }),
    a.flexible
      ? c.input('windowFrom', 'Earliest', { type: 'time', step: 1800, value: toTimeValue(window.from) })
      : null,
    a.flexible ? c.input('windowTo', 'Must end by', { type: 'time', step: 1800, value: toTimeValue(window.to) }) : null,
  );
}

/**
 * One activity: what, where, when, how long, who, and whether it can move.
 * @param {Activity} a
 * @param {Member[]} members
 */
export function activityCard(a, members) {
  const c = activityControls(a);
  const isTrip = a.kind === 'commute';
  return h(
    'div',
    { class: 'editor-item', role: 'group', 'aria-label': `Activity: ${a.label}` },
    h(
      'div',
      { class: 'grid' },
      c.input('label', 'What', { type: 'text', maxlength: LIMITS.labelLength, value: a.label }),
      c.select('kind', 'Where', KIND_LABELS, a.kind),
      c.input('start', isTrip ? 'Leave at' : 'Starts at', {
        type: 'time',
        step: 900,
        value: toTimeValue(a.start),
      }),
      ...kindFields(a, c),
    ),
    h(
      'fieldset',
      { class: 'people' },
      h('legend', { class: 'label' }, 'Who'),
      ...members.map((m) =>
        checkbox(m.name, { checked: a.memberIds.includes(m.id), dataset: c.data('memberIds', m.id) }),
      ),
    ),
    isTrip ? null : flexibleFields(a, c),
    removeButton({ removeActivity: a.id }, `Remove ${a.label}`),
  );
}
