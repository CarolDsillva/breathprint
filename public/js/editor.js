// @ts-check
/** Section 02: editors for the people at home and their activities. */
import { AGE_GROUPS, INTENSITIES, KINDS, LIMITS, MODES, SOURCES } from '/engine/constants.js';
import { fromTimeValue, h, toTimeValue } from './dom.js';
import { planEdited, state, subscribe } from './state.js';

/** @typedef {import('./types.js').Plan} Plan */
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
const DEFAULT_WINDOW = Object.freeze({ from: 6, to: 21 });
const DEFAULT_TRIP = Object.freeze({ mode: /** @type {const} */ ('bus'), distanceKm: 5 });

/** Changing these fields changes which other fields an activity shows. */
const STRUCTURAL_FIELDS = new Set(['kind', 'flexible']);

let idCounter = 0;
/** @param {string} prefix */
const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

/**
 * @template {string} K
 * @param {Readonly<Record<K, string>>} labels
 * @param {string} selected
 */
function options(labels, selected) {
  return Object.entries(labels).map(([value, label]) =>
    h('option', { value, selected: value === selected }, /** @type {string} */ (label)),
  );
}

/**
 * Labelled control: the label text above the control.
 * @param {string} id
 * @param {string} text
 * @param {HTMLElement} control
 */
function field(id, text, control) {
  return h('label', { for: id }, h('span', { class: 'label' }, text), control);
}

/**
 * Value is one of the allowed keys.
 * @template {string} K
 * @param {string} value
 * @param {readonly K[] | Readonly<Record<K, unknown>>} allowed
 * @returns {value is K}
 */
function isOneOf(value, allowed) {
  return Array.isArray(allowed) ? allowed.includes(value) : Object.hasOwn(allowed, value);
}

/**
 * Apply one edited form field to an activity. Unknown or invalid values are ignored.
 * @param {Activity} a
 * @param {string} name
 * @param {HTMLInputElement | HTMLSelectElement} input
 */
function setActivityField(a, name, input) {
  const value = input.value;
  const checked = input instanceof HTMLInputElement && input.checked;
  switch (name) {
    case 'label':
      a.label = value;
      break;
    case 'kind':
      if (isOneOf(value, KINDS)) a.kind = value;
      break;
    case 'intensity':
      if (isOneOf(value, INTENSITIES)) a.intensity = value;
      break;
    case 'mode':
      if (isOneOf(value, MODES)) a.mode = value;
      break;
    case 'source':
      if (isOneOf(value, SOURCES)) a.source = value;
      break;
    case 'hours':
      a.hours = Number(value);
      break;
    case 'distanceKm':
      a.distanceKm = Number(value);
      break;
    case 'flexible':
      a.flexible = checked;
      break;
    case 'nearTraffic':
      a.nearTraffic = checked;
      break;
    case 'start': {
      const t = fromTimeValue(value);
      if (Number.isFinite(t)) a.start = t;
      break;
    }
    case 'windowFrom':
    case 'windowTo': {
      const t = fromTimeValue(value);
      if (!Number.isFinite(t)) break;
      const window = { ...DEFAULT_WINDOW, ...a.window };
      if (name === 'windowFrom') window.from = t;
      else window.to = t || 24; // "00:00" as an end time means midnight
      a.window = window;
      break;
    }
    case 'memberIds': {
      const id = input.dataset.value ?? '';
      a.memberIds = checked ? [...new Set([...a.memberIds, id])] : a.memberIds.filter((x) => x !== id);
      break;
    }
    default:
      return;
  }
  if (name === 'kind' && a.kind === 'commute') {
    a.mode ??= DEFAULT_TRIP.mode;
    a.distanceKm ??= DEFAULT_TRIP.distanceKm;
    a.flexible = false;
  }
  if (name === 'flexible' && a.flexible) a.window ??= { ...DEFAULT_WINDOW };
}

/**
 * Apply one edited form field to a person.
 * @param {Member} m
 * @param {string} name
 * @param {HTMLInputElement | HTMLSelectElement} input
 */
function setMemberField(m, name, input) {
  if (name === 'name') m.name = input.value;
  else if (name === 'ageGroup' && isOneOf(input.value, AGE_GROUPS)) m.ageGroup = input.value;
  else if (name === 'sensitive' && input instanceof HTMLInputElement) m.sensitive = input.checked;
}

/**
 * @param {Member} m
 * @param {number} index
 * @param {number} total
 */
function memberCard(m, index, total) {
  const id = `m-${m.id}`;
  const data = (/** @type {string} */ name) => ({ member: m.id, field: name });
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
          ...options(Object.fromEntries(Object.entries(AGE_GROUPS).map(([k, v]) => [k, v.label])), m.ageGroup),
        ),
      ),
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', checked: m.sensitive, dataset: data('sensitive') }),
        'Asthma, heart/lung condition or pregnancy',
      ),
    ),
    h(
      'div',
      { class: 'editor-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn link',
          dataset: { removeMember: m.id },
          disabled: total <= 1,
          'aria-label': `Remove ${m.name}`,
        },
        'Remove',
      ),
    ),
  );
}

/**
 * @param {Activity} a
 * @param {Member[]} members
 */
function activityCard(a, members) {
  const id = `a-${a.id}`;
  const data = (/** @type {string} */ name, /** @type {string} */ value = '') => ({
    activity: a.id,
    field: name,
    ...(value ? { value } : {}),
  });
  const isTrip = a.kind === 'commute';
  const input = (
    /** @type {string} */ suffix,
    /** @type {string} */ name,
    /** @type {Record<string, unknown>} */ attrs,
  ) => h('input', { class: 'input', id: `${id}-${suffix}`, dataset: data(name), ...attrs });
  const select = (
    /** @type {string} */ suffix,
    /** @type {string} */ name,
    /** @type {Readonly<Record<string, string>>} */ labels,
    /** @type {string} */ value,
  ) => h('select', { class: 'input', id: `${id}-${suffix}`, dataset: data(name) }, ...options(labels, value));
  const labelsOf = (/** @type {Readonly<Record<string, { label: string }>>} */ table) =>
    Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v.label]));

  return h(
    'div',
    { class: 'editor-item', role: 'group', 'aria-label': `Activity: ${a.label}` },
    h(
      'div',
      { class: 'grid' },
      field(
        `${id}-label`,
        'What',
        input('label', 'label', { type: 'text', maxlength: LIMITS.labelLength, value: a.label }),
      ),
      field(`${id}-kind`, 'Where', select('kind', 'kind', KIND_LABELS, a.kind)),
      field(
        `${id}-start`,
        isTrip ? 'Leave at' : 'Starts at',
        input('start', 'start', { type: 'time', step: 900, value: toTimeValue(a.start) }),
      ),
      isTrip
        ? field(`${id}-mode`, 'Transport', select('mode', 'mode', labelsOf(MODES), a.mode ?? DEFAULT_TRIP.mode))
        : field(
            `${id}-hours`,
            'Hours',
            input('hours', 'hours', { type: 'number', min: 0.25, max: 16, step: 0.25, value: a.hours }),
          ),
      isTrip
        ? field(
            `${id}-km`,
            'Distance (km)',
            input('km', 'distanceKm', {
              type: 'number',
              min: 0.1,
              max: 200,
              step: 0.5,
              value: a.distanceKm ?? DEFAULT_TRIP.distanceKm,
            }),
          )
        : field(`${id}-intensity`, 'Effort', select('intensity', 'intensity', INTENSITY_LABELS, a.intensity)),
      a.kind === 'home'
        ? field(`${id}-source`, 'Smoke source', select('source', 'source', labelsOf(SOURCES), a.source ?? 'none'))
        : null,
      a.kind === 'outdoor'
        ? h(
            'label',
            { class: 'check' },
            h('input', { type: 'checkbox', checked: a.nearTraffic, dataset: data('nearTraffic') }),
            'Next to busy traffic',
          )
        : null,
    ),
    h(
      'fieldset',
      { class: 'people' },
      h('legend', { class: 'label' }, 'Who'),
      ...members.map((m) =>
        h(
          'label',
          { class: 'check' },
          h('input', { type: 'checkbox', checked: a.memberIds.includes(m.id), dataset: data('memberIds', m.id) }),
          m.name,
        ),
      ),
    ),
    isTrip
      ? null
      : h(
          'div',
          { class: 'grid' },
          h(
            'label',
            { class: 'check' },
            h('input', { id: `${id}-flexible`, type: 'checkbox', checked: a.flexible, dataset: data('flexible') }),
            'Can move to another time',
          ),
          a.flexible
            ? field(
                `${id}-wfrom`,
                'Earliest',
                input('wfrom', 'windowFrom', {
                  type: 'time',
                  step: 1800,
                  value: toTimeValue(a.window?.from ?? DEFAULT_WINDOW.from),
                }),
              )
            : null,
          a.flexible
            ? field(
                `${id}-wto`,
                'Must end by',
                input('wto', 'windowTo', {
                  type: 'time',
                  step: 1800,
                  value: toTimeValue(a.window?.to ?? DEFAULT_WINDOW.to),
                }),
              )
            : null,
        ),
    h(
      'div',
      { class: 'editor-actions' },
      h(
        'button',
        { type: 'button', class: 'btn link', dataset: { removeActivity: a.id }, 'aria-label': `Remove ${a.label}` },
        'Remove',
      ),
    ),
  );
}

/**
 * Wire up the people and activity editors.
 * @param {{ membersEl: HTMLElement, activitiesEl: HTMLElement, addMemberBtn: HTMLButtonElement, addActivityBtn: HTMLButtonElement }} els
 */
export function initEditor({ membersEl, activitiesEl, addMemberBtn, addActivityBtn }) {
  function renderMembers() {
    const { members } = state.plan;
    membersEl.replaceChildren(...members.map((m, i) => memberCard(m, i, members.length)));
    addMemberBtn.disabled = members.length >= LIMITS.members;
  }

  function renderActivities() {
    const { activities, members } = state.plan;
    activitiesEl.replaceChildren(...activities.map((a) => activityCard(a, members)));
    addActivityBtn.disabled = activities.length >= LIMITS.activities;
  }

  /** @param {string} id */
  function removeMember(id) {
    const plan = state.plan;
    plan.members = plan.members.filter((m) => m.id !== id);
    for (const a of plan.activities) a.memberIds = a.memberIds.filter((x) => x !== id);
    plan.activities = plan.activities.filter((a) => a.memberIds.length > 0);
    renderMembers();
    renderActivities();
    planEdited();
  }

  /** @param {Event} e */
  function onMemberEvent(e) {
    const target = /** @type {HTMLInputElement | HTMLSelectElement} */ (e.target);
    const { removeMember: removeId, member: memberId, field: name } = target.dataset;
    if (removeId && e.type === 'click') return removeMember(removeId);
    const member = state.plan.members.find((m) => m.id === memberId);
    if (!member || !name || e.type !== 'change') return;
    setMemberField(member, name, target);
    if (name === 'name') renderActivities(); // names appear in the "Who" checkboxes
    planEdited();
  }

  /** @param {Event} e */
  function onActivityEvent(e) {
    const target = /** @type {HTMLInputElement | HTMLSelectElement} */ (e.target);
    const { removeActivity: removeId, activity: activityId, field: name } = target.dataset;
    if (removeId && e.type === 'click') {
      state.plan.activities = state.plan.activities.filter((a) => a.id !== removeId);
      renderActivities();
      addActivityBtn.focus();
      return planEdited();
    }
    const activity = state.plan.activities.find((a) => a.id === activityId);
    if (!activity || !name || e.type !== 'change') return;
    setActivityField(activity, name, target);
    if (STRUCTURAL_FIELDS.has(name)) {
      const focusId = target.id;
      renderActivities();
      if (focusId) document.getElementById(focusId)?.focus();
    }
    planEdited();
  }

  membersEl.addEventListener('change', onMemberEvent);
  membersEl.addEventListener('click', onMemberEvent);
  activitiesEl.addEventListener('change', onActivityEvent);
  activitiesEl.addEventListener('click', onActivityEvent);

  addMemberBtn.addEventListener('click', () => {
    const id = newId('p');
    state.plan.members.push({
      id,
      name: `Person ${state.plan.members.length + 1}`,
      ageGroup: 'adult',
      sensitive: false,
    });
    renderMembers();
    renderActivities();
    document.getElementById(`m-${id}-name`)?.focus();
    planEdited();
  });

  addActivityBtn.addEventListener('click', () => {
    const id = newId('a');
    state.plan.activities.push({
      id,
      label: 'Evening walk',
      memberIds: [state.plan.members[0].id],
      start: 18,
      hours: 1,
      kind: 'outdoor',
      intensity: 'light',
      flexible: true,
      window: { ...DEFAULT_WINDOW },
    });
    renderActivities();
    document.getElementById(`a-${id}-label`)?.focus();
    planEdited();
  });

  subscribe((kind) => {
    if (kind === 'replaced') {
      renderMembers();
      renderActivities();
    }
  });
  renderMembers();
  renderActivities();
}
