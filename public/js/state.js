// @ts-check
/**
 * App state and change notifications. The plan here is the editable draft; anything that
 * computes with it validates a copy first (see validInputs).
 */
import { samplePlan, validatePlan } from '/engine/index.js';

/** @typedef {import('./types.js').Plan} Plan */
/** @typedef {import('./types.js').Forecast} Forecast */
/** @typedef {import('./types.js').ForecastDay} ForecastDay */

/**
 * What changed: the whole plan was swapped (re-render editors), it was edited in place,
 * or a new forecast arrived.
 * @typedef {'replaced' | 'edited' | 'forecast'} ChangeKind
 */

const STORAGE_KEY = 'breathprint:plan:v1';

export const state = {
  /** @type {Plan} */
  plan: loadPlan(),
  /** @type {Plan | null} the family's own plan, kept while suggested changes are applied */
  original: null,
  /** @type {ForecastDay[]} */
  days: [],
  /** @type {Forecast | null} */
  forecast: null,
  place: '',
};

/** @type {Set<(kind: ChangeKind) => void>} */
const listeners = new Set();

/**
 * Call `listener` whenever the plan or forecast changes.
 * @param {(kind: ChangeKind) => void} listener
 */
export function subscribe(listener) {
  listeners.add(listener);
}

/**
 * Save the plan (unless only the forecast changed) and notify every listener.
 * @param {ChangeKind} kind
 */
function emit(kind) {
  if (kind !== 'forecast') savePlan();
  for (const listener of listeners) listener(kind);
}

/**
 * The plan saved in this browser, or the sample family if there is none or it is invalid.
 * @returns {Plan}
 */
export function loadPlan() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    const checked = validatePlan(saved);
    if (checked.ok) return saved;
  } catch {
    // Storage unavailable or corrupt: start from the sample family.
  }
  return samplePlan();
}

function savePlan() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.plan));
  } catch {
    // Private mode or storage full: the app still works for this visit.
  }
}

/**
 * Swap in a new plan. With `keepOriginal`, the family's own plan is remembered so the
 * change can be undone.
 * @param {Plan} plan
 * @param {{ keepOriginal?: boolean }} [options]
 */
export function replacePlan(plan, { keepOriginal = false } = {}) {
  state.original = keepOriginal ? (state.original ?? structuredClone(state.plan)) : null;
  state.plan = plan;
  emit('replaced');
}

/** Go back to the family's own plan. Returns false if there is nothing to undo. */
export function restoreOriginal() {
  if (!state.original) return false;
  state.plan = state.original;
  state.original = null;
  emit('replaced');
  return true;
}

/** The draft plan was edited by hand: the undo point no longer applies. */
export function planEdited() {
  state.original = null;
  emit('edited');
}

/**
 * Use a new forecast and notify listeners.
 * @param {Forecast} forecast
 */
export function setForecast(forecast) {
  state.forecast = forecast;
  emit('forecast');
}

/**
 * The validated plan and the forecast, or null if either is missing or invalid.
 * @returns {{ plan: Plan, forecast: Forecast } | null}
 */
export function validInputs() {
  if (!state.forecast) return null;
  const checked = validatePlan(state.plan);
  return checked.ok ? { plan: checked.plan, forecast: state.forecast } : null;
}
