// @ts-check
import { AGE_GROUPS, INTENSITIES, LIMITS, MODES, SOURCES } from '/engine/constants.js';
import { fromTimeValue, h, toTimeValue } from './dom.js';

const KIND_LABELS = { outdoor: 'Outdoors (walk, play, market)', commute: 'Trip / commute', 'indoor-away': 'Indoors away (school, office)', home: 'At home (cooking, puja…)' };
const INTENSITY_LABELS = { sleep: 'Sleeping', rest: 'Sitting / resting', light: 'Light (walking, chores)', moderate: 'Moderate (brisk walk, cycling)', vigorous: 'Hard (running, sport)' };

/** Fields whose change alters which other fields are shown. */
const STRUCTURAL = new Set(['kind', 'flexible']);

let seq = 0;
/** @param {string} prefix */
const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * @param {Record<string, string>} options
 * @param {string} selected
 */
function options(options, selected) {
  return Object.entries(options).map(([value, label]) => h('option', { value, selected: value === selected }, label));
}

/**
 * Wire up the people and activities editors.
 * @param {{ getPlan: () => any, setPlan: (p: any) => void, onChange: () => void,
 *           membersEl: HTMLElement, activitiesEl: HTMLElement, addMemberBtn: HTMLElement, addActivityBtn: HTMLElement }} ctx
 */
export function createEditor(ctx) {
  const { membersEl, activitiesEl } = ctx;

  function renderMembers() {
    const plan = ctx.getPlan();
    membersEl.replaceChildren(
      ...plan.members.map((/** @type {any} */ m, /** @type {number} */ i) => {
        const id = `m-${m.id}`;
        return h('div', { class: 'editor-item', role: 'group', 'aria-label': `Person ${i + 1}: ${m.name}` },
          h('div', { class: 'grid' },
            h('label', { for: `${id}-name` }, h('span', { class: 'label' }, 'Name'), h('input', { class: 'input', id: `${id}-name`, type: 'text', maxlength: LIMITS.nameLength, value: m.name, dataset: { member: m.id, field: 'name' } })),
            h('label', { for: `${id}-age` }, h('span', { class: 'label' }, 'Age group'), h('select', { class: 'input', id: `${id}-age`, dataset: { member: m.id, field: 'ageGroup' } },
              ...options(Object.fromEntries(Object.entries(AGE_GROUPS).map(([k, v]) => [k, v.label])), m.ageGroup))),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: m.sensitive, dataset: { member: m.id, field: 'sensitive' } }), 'Asthma, heart/lung condition or pregnancy'),
          ),
          h('div', { class: 'editor-actions' },
            h('button', { type: 'button', class: 'link', dataset: { removeMember: m.id }, disabled: plan.members.length <= 1, 'aria-label': `Remove ${m.name}` }, 'Remove'),
          ),
        );
      }),
    );
    /** @type {HTMLButtonElement} */ (ctx.addMemberBtn).disabled = plan.members.length >= LIMITS.members;
  }

  function renderActivities() {
    const plan = ctx.getPlan();
    activitiesEl.replaceChildren(...plan.activities.map((/** @type {any} */ a) => activityItem(a, plan)));
    /** @type {HTMLButtonElement} */ (ctx.addActivityBtn).disabled = plan.activities.length >= LIMITS.activities;
  }

  /**
   * @param {any} a
   * @param {any} plan
   */
  function activityItem(a, plan) {
    const id = `a-${a.id}`;
    const d = { activity: a.id };
    const isTrip = a.kind === 'commute';
    return h('div', { class: 'editor-item', role: 'group', 'aria-label': `Activity: ${a.label}` },
      h('div', { class: 'grid' },
        h('label', { for: `${id}-label` }, h('span', { class: 'label' }, 'What'), h('input', { class: 'input', id: `${id}-label`, type: 'text', maxlength: LIMITS.labelLength, value: a.label, dataset: { ...d, field: 'label' } })),
        h('label', { for: `${id}-kind` }, h('span', { class: 'label' }, 'Where'), h('select', { class: 'input', id: `${id}-kind`, dataset: { ...d, field: 'kind' } }, ...options(KIND_LABELS, a.kind))),
        h('label', { for: `${id}-start` }, h('span', { class: 'label' }, isTrip ? 'Leave at' : 'Starts at'), h('input', { class: 'input', id: `${id}-start`, type: 'time', step: 900, value: toTimeValue(a.start), dataset: { ...d, field: 'start' } })),
        isTrip
          ? h('label', { for: `${id}-mode` }, h('span', { class: 'label' }, 'Transport'), h('select', { class: 'input', id: `${id}-mode`, dataset: { ...d, field: 'mode' } },
            ...options(Object.fromEntries(Object.entries(MODES).map(([k, v]) => [k, v.label])), a.mode ?? 'bus')))
          : h('label', { for: `${id}-hours` }, h('span', { class: 'label' }, 'Hours'), h('input', { class: 'input', id: `${id}-hours`, type: 'number', min: 0.25, max: 16, step: 0.25, value: a.hours, dataset: { ...d, field: 'hours' } })),
        isTrip
          ? h('label', { for: `${id}-km` }, h('span', { class: 'label' }, 'Distance (km)'), h('input', { class: 'input', id: `${id}-km`, type: 'number', min: 0.1, max: 200, step: 0.5, value: a.distanceKm ?? 5, dataset: { ...d, field: 'distanceKm' } }))
          : h('label', { for: `${id}-intensity` }, h('span', { class: 'label' }, 'Effort'), h('select', { class: 'input', id: `${id}-intensity`, dataset: { ...d, field: 'intensity' } },
            ...options(Object.fromEntries(INTENSITIES.filter((x) => x !== 'sleep').map((k) => [k, INTENSITY_LABELS[k]])), a.intensity))),
        a.kind === 'home'
          ? h('label', { for: `${id}-source` }, h('span', { class: 'label' }, 'Smoke source'), h('select', { class: 'input', id: `${id}-source`, dataset: { ...d, field: 'source' } },
            ...options(Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.label])), a.source ?? 'none')))
          : null,
        a.kind === 'outdoor'
          ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: a.nearTraffic, dataset: { ...d, field: 'nearTraffic' } }), 'Next to busy traffic')
          : null,
      ),
      h('fieldset', { class: 'people' },
        h('legend', { class: 'label' }, 'Who'),
        ...plan.members.map((/** @type {any} */ m) =>
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: a.memberIds.includes(m.id), dataset: { ...d, field: 'memberIds', value: m.id } }), m.name)),
      ),
      isTrip
        ? null
        : h('div', { class: 'grid' },
          h('label', { class: 'check' }, h('input', { class: 'input', id: `${id}-flexible`, type: 'checkbox', checked: a.flexible, dataset: { ...d, field: 'flexible' } }), 'Can move to another time'),
          a.flexible ? h('label', { for: `${id}-wfrom` }, h('span', { class: 'label' }, 'Earliest'), h('input', { class: 'input', id: `${id}-wfrom`, type: 'time', step: 1800, value: toTimeValue(a.window?.from ?? 6), dataset: { ...d, field: 'windowFrom' } })) : null,
          a.flexible ? h('label', { for: `${id}-wto` }, h('span', { class: 'label' }, 'Must end by'), h('input', { class: 'input', id: `${id}-wto`, type: 'time', step: 1800, value: toTimeValue(a.window?.to ?? 21), dataset: { ...d, field: 'windowTo' } })) : null,
        ),
      h('div', { class: 'editor-actions' },
        h('button', { type: 'button', class: 'link', dataset: { removeActivity: a.id }, 'aria-label': `Remove ${a.label}` }, 'Remove'),
      ),
    );
  }

  /** @param {Event} e */
  function onMemberEvent(e) {
    const t = /** @type {HTMLInputElement} */ (e.target);
    const plan = ctx.getPlan();
    if (t.dataset.removeMember && e.type === 'click') {
      const id = t.dataset.removeMember;
      plan.members = plan.members.filter((/** @type {any} */ m) => m.id !== id);
      for (const a of plan.activities) a.memberIds = a.memberIds.filter((/** @type {string} */ x) => x !== id);
      plan.activities = plan.activities.filter((/** @type {any} */ a) => a.memberIds.length > 0);
      return refreshAll();
    }
    const m = plan.members.find((/** @type {any} */ x) => x.id === t.dataset.member);
    if (!m || !t.dataset.field) return;
    m[t.dataset.field] = t.type === 'checkbox' ? t.checked : t.value;
    if (t.dataset.field === 'name' && e.type === 'change') renderActivities();
    ctx.onChange();
  }

  /** @param {Event} e */
  function onActivityEvent(e) {
    const t = /** @type {HTMLInputElement} */ (e.target);
    const plan = ctx.getPlan();
    if (t.dataset.removeActivity && e.type === 'click') {
      plan.activities = plan.activities.filter((/** @type {any} */ a) => a.id !== t.dataset.removeActivity);
      renderActivities();
      /** @type {HTMLElement} */ (ctx.addActivityBtn).focus();
      return ctx.onChange();
    }
    const a = plan.activities.find((/** @type {any} */ x) => x.id === t.dataset.activity);
    const field = t.dataset.field;
    if (!a || !field) return;
    switch (field) {
      case 'start': { const v = fromTimeValue(t.value); if (Number.isFinite(v)) a.start = v; break; }
      case 'windowFrom': case 'windowTo': {
        const v = fromTimeValue(t.value);
        if (Number.isFinite(v)) a.window = { from: 6, to: 21, ...a.window, [field === 'windowFrom' ? 'from' : 'to']: v || (field === 'windowTo' ? 24 : 0) };
        break;
      }
      case 'hours': case 'distanceKm': a[field] = Number(t.value); break;
      case 'memberIds':
        a.memberIds = t.checked ? [...new Set([...a.memberIds, t.dataset.value])] : a.memberIds.filter((/** @type {string} */ x) => x !== t.dataset.value);
        break;
      case 'flexible': case 'nearTraffic': a[field] = t.checked; break;
      default: a[field] = t.value;
    }
    if (field === 'kind' && a.kind === 'commute') { a.mode ??= 'bus'; a.distanceKm ??= 5; a.flexible = false; }
    if (field === 'flexible' && a.flexible) a.window ??= { from: 6, to: 21 };
    if (STRUCTURAL.has(field) && e.type === 'change') {
      const focusId = t.id;
      renderActivities();
      if (focusId) document.getElementById(focusId)?.focus();
    }
    ctx.onChange();
  }

  function refreshAll() {
    renderMembers();
    renderActivities();
    ctx.onChange();
  }

  membersEl.addEventListener('change', onMemberEvent);
  membersEl.addEventListener('click', onMemberEvent);
  activitiesEl.addEventListener('change', onActivityEvent);
  activitiesEl.addEventListener('click', onActivityEvent);

  ctx.addMemberBtn.addEventListener('click', () => {
    const plan = ctx.getPlan();
    const id = newId('p');
    plan.members.push({ id, name: `Person ${plan.members.length + 1}`, ageGroup: 'adult', sensitive: false });
    refreshAll();
    document.getElementById(`m-${id}-name`)?.focus();
  });
  ctx.addActivityBtn.addEventListener('click', () => {
    const plan = ctx.getPlan();
    const id = newId('a');
    plan.activities.push({ id, label: 'Evening walk', memberIds: [plan.members[0].id], start: 18, hours: 1, kind: 'outdoor', intensity: 'light', flexible: true, window: { from: 6, to: 21 } });
    renderActivities();
    document.getElementById(`a-${id}-label`)?.focus();
    ctx.onChange();
  });

  return { render: () => { renderMembers(); renderActivities(); } };
}
