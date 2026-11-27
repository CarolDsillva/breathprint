// @ts-check
/** Section 02: editors for the people at home and their activities. */
import { LIMITS } from '/engine/constants.js';
import { activityCard, memberCard } from './editor-cards.js';
import { DEFAULT_WINDOW, setActivityField, setMemberField } from './editor-fields.js';
import { planEdited, state, subscribe } from './state.js';

/** @typedef {import('./editor-fields.js').FormControl} FormControl */
/** @typedef {import('./types.js').Plan} Plan */
/**
 * @typedef {{ membersEl: HTMLElement, activitiesEl: HTMLElement,
 *   addMemberBtn: HTMLButtonElement, addActivityBtn: HTMLButtonElement }} EditorElements
 */

/** Changing these fields changes which other fields an activity shows. */
const STRUCTURAL_FIELDS = new Set(['kind', 'flexible']);

let idCounter = 0;
/** @param {string} prefix */
const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

/**
 * Remove a person, and any activity nobody is left doing.
 * @param {Plan} plan
 * @param {string} id
 */
function removeMemberFrom(plan, id) {
  plan.members = plan.members.filter((m) => m.id !== id);
  for (const a of plan.activities) a.memberIds = a.memberIds.filter((x) => x !== id);
  plan.activities = plan.activities.filter((a) => a.memberIds.length > 0);
}

/**
 * Add a new adult and return their id.
 * @param {Plan} plan
 */
function addMemberTo(plan) {
  const id = newId('p');
  plan.members.push({ id, name: `Person ${plan.members.length + 1}`, ageGroup: 'adult', sensitive: false });
  return id;
}

/**
 * Add a flexible evening walk for the first person and return its id.
 * @param {Plan} plan
 */
function addActivityTo(plan) {
  const id = newId('a');
  plan.activities.push({
    id,
    label: 'Evening walk',
    memberIds: [plan.members[0].id],
    start: 18,
    hours: 1,
    kind: 'outdoor',
    intensity: 'light',
    flexible: true,
    window: { ...DEFAULT_WINDOW },
  });
  return id;
}

/** @param {EditorElements} ui */
function renderMembers(ui) {
  const { members } = state.plan;
  ui.membersEl.replaceChildren(...members.map((m, i) => memberCard(m, i, members.length)));
  ui.addMemberBtn.disabled = members.length >= LIMITS.members;
}

/** @param {EditorElements} ui */
function renderActivities(ui) {
  const { activities, members } = state.plan;
  ui.activitiesEl.replaceChildren(...activities.map((a) => activityCard(a, members)));
  ui.addActivityBtn.disabled = activities.length >= LIMITS.activities;
}

/**
 * Handle clicks and changes inside the people list.
 * @param {EditorElements} ui
 * @param {Event} e
 */
function onMemberEvent(ui, e) {
  const control = /** @type {FormControl} */ (e.target);
  const { removeMember: removeId, member: memberId, field: name } = control.dataset;
  if (removeId && e.type === 'click') {
    removeMemberFrom(state.plan, removeId);
    renderMembers(ui);
    renderActivities(ui);
    return planEdited();
  }
  const member = state.plan.members.find((m) => m.id === memberId);
  if (!member || !name || e.type !== 'change') return;
  setMemberField(member, name, control);
  if (name === 'name') renderActivities(ui); // names appear in the "Who" checkboxes
  planEdited();
}

/**
 * Handle clicks and changes inside the activities list.
 * @param {EditorElements} ui
 * @param {Event} e
 */
function onActivityEvent(ui, e) {
  const control = /** @type {FormControl} */ (e.target);
  const { removeActivity: removeId, activity: activityId, field: name } = control.dataset;
  if (removeId && e.type === 'click') {
    state.plan.activities = state.plan.activities.filter((a) => a.id !== removeId);
    renderActivities(ui);
    ui.addActivityBtn.focus();
    return planEdited();
  }
  const activity = state.plan.activities.find((a) => a.id === activityId);
  if (!activity || !name || e.type !== 'change') return;
  setActivityField(activity, name, control);
  if (STRUCTURAL_FIELDS.has(name)) {
    renderActivities(ui);
    if (control.id) document.getElementById(control.id)?.focus(); // keep the user's place
  }
  planEdited();
}

/**
 * Wire up the people and activity editors.
 * @param {EditorElements} ui
 */
export function initEditor(ui) {
  const renderAll = () => {
    renderMembers(ui);
    renderActivities(ui);
  };
  for (const type of ['change', 'click']) {
    ui.membersEl.addEventListener(type, (e) => onMemberEvent(ui, e));
    ui.activitiesEl.addEventListener(type, (e) => onActivityEvent(ui, e));
  }
  ui.addMemberBtn.addEventListener('click', () => {
    const id = addMemberTo(state.plan);
    renderAll();
    document.getElementById(`m-${id}-name`)?.focus();
    planEdited();
  });
  ui.addActivityBtn.addEventListener('click', () => {
    const id = addActivityTo(state.plan);
    renderActivities(ui);
    document.getElementById(`a-${id}-label`)?.focus();
    planEdited();
  });
  subscribe((kind) => {
    if (kind === 'replaced') renderAll();
  });
  renderAll();
}
