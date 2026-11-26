// @ts-check
import {
  SAMPLE_FORECAST,
  compareChange,
  computeDay,
  memberTimeline,
  optimizeDay,
  purifierPlan,
  PURIFIERS,
  samplePlan,
  suggest,
  validatePlan,
} from '/engine/index.js';
import { askWhatIf, getCoach, getForecast, searchPlaces } from './api.js';
import { byId, h } from './dom.js';
import { createEditor } from './editor.js';
import { comparisonCard, renderAirStrip, renderBudget, renderHourGrid, renderRoom, renderStats, renderSuggestions } from './render.js';

const STORAGE_KEY = 'breathprint:plan:v1';

/** App state. `plan` is the editable draft; the engine only ever sees validated copies. */
const state = {
  /** @type {any} */ plan: loadPlan(),
  /** @type {any | null} plan saved before "Apply all" */ original: null,
  /** @type {{ date: string, pm25: (number | null)[] }[]} */ days: [],
  /** @type {(number | null)[] | null} */ forecast: null,
  place: '',
};

const el = {
  placeForm: byId('place-form'), placeInput: /** @type {HTMLInputElement} */ (byId('place-input')), placeResults: byId('place-results'),
  geoBtn: byId('geo-btn'), sampleBtn: byId('sample-btn'), daySelect: /** @type {HTMLSelectElement} */ (byId('day-select')),
  airStatus: byId('air-status'), airStrip: byId('air-strip'),
  members: byId('members'), activities: byId('activities'), addMember: byId('add-member'), addActivity: byId('add-activity'),
  resultsStatus: byId('results-status'), stats: byId('stats'), hourGrid: byId('hour-grid'), placeChip: byId('place-chip'), budget: byId('budget'), suggestions: byId('suggestions'), budgetHeading: byId('budget-h'),
  applyAll: /** @type {HTMLButtonElement} */ (byId('apply-all')), undoAll: byId('undo-all'),
  coachBtn: /** @type {HTMLButtonElement} */ (byId('coach-btn')), coachLang: /** @type {HTMLSelectElement} */ (byId('coach-lang')), coachOut: byId('coach-out'),
  whatifForm: byId('whatif-form'), whatifInput: /** @type {HTMLInputElement} */ (byId('whatif-input')), whatifOut: byId('whatif-out'),
  roomForm: byId('room-form'), roomOut: byId('room-out'), roomPurifier: /** @type {HTMLSelectElement} */ (byId('room-purifier')),
};

/* ---------- persistence (per-browser convenience only) ---------- */

function loadPlan() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && validatePlan(saved).ok) return saved;
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

/* ---------- home settings ---------- */

function syncHomeControls() {
  /** @type {HTMLSelectElement} */ (byId('home-windows')).value = state.plan.home.windows;
  /** @type {HTMLInputElement} */ (byId('home-purifier')).checked = state.plan.home.purifier;
  /** @type {HTMLInputElement} */ (byId('home-metro')).checked = state.plan.home.metro;
  /** @type {HTMLInputElement} */ (byId('home-bus')).checked = state.plan.home.bus;
}

document.querySelector('.home-settings')?.addEventListener('change', (e) => {
  const t = /** @type {HTMLInputElement} */ (e.target);
  const key = t.dataset.home;
  if (!key) return;
  state.plan.home[key] = t.type === 'checkbox' ? t.checked : t.value;
  recompute();
});

/* ---------- forecast loading ---------- */

/**
 * @param {string} text
 * @param {boolean} [isError]
 */
function setAirStatus(text, isError = false) {
  el.airStatus.textContent = text;
  el.airStatus.classList.toggle('error', isError);
}

/**
 * @param {{ date: string, pm25: (number | null)[] }[]} days
 * @param {string} place
 */
function useDays(days, place) {
  // Keep only days with enough data to plan around.
  state.days = days.filter((d) => d.pm25.filter((v) => v !== null).length >= 12);
  state.place = place;
  el.placeChip.textContent = `◉ ${place}`;
  el.placeChip.hidden = false;
  el.daySelect.replaceChildren(
    ...state.days.map((d, i) => h('option', { value: String(i) }, `${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.date} (${d.date})`)),
  );
  el.daySelect.disabled = state.days.length < 2;
  if (!state.days.length) {
    setAirStatus(`No usable forecast for ${place}. Try a nearby city or the sample day.`, true);
    return;
  }
  // Planning ahead: after 6 PM default to tomorrow.
  el.daySelect.value = state.days.length > 1 && new Date().getHours() >= 18 ? '1' : '0';
  selectDay();
}

function selectDay() {
  const day = state.days[Number(el.daySelect.value)] ?? state.days[0];
  state.forecast = day.pm25;
  const valid = /** @type {number[]} */ (day.pm25.filter((v) => v !== null));
  setAirStatus(`${state.place}, ${day.date}: PM2.5 from ${Math.round(Math.min(...valid))} to ${Math.round(Math.max(...valid))} µg/m³.`);
  renderAirStrip(el.airStrip, day.pm25);
  recompute();
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {string} label
 */
async function loadForecast(lat, lon, label) {
  setAirStatus(`Loading the smog forecast for ${label}…`);
  try {
    const fc = await getForecast(lat, lon);
    useDays(fc.days, label);
  } catch (err) {
    setAirStatus(/** @type {Error} */ (err).message, true);
  }
}

el.placeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = el.placeInput.value.trim();
  if (q.length < 2) return;
  setAirStatus('Searching…');
  try {
    const { places } = await searchPlaces(q);
    if (!places.length) {
      el.placeResults.replaceChildren();
      setAirStatus(`No place called "${q}" found. Check the spelling or try a bigger city nearby.`, true);
      return;
    }
    if (places.length === 1) return pickPlace(places[0]);
    setAirStatus(`Found ${places.length} places. Choose yours.`);
    el.placeResults.replaceChildren(
      ...places.map((/** @type {any} */ p) =>
        h('button', { type: 'button', class: 'secondary', onclick: () => pickPlace(p) }, [p.name, p.region, p.country].filter(Boolean).join(', '))),
    );
    /** @type {HTMLElement | null} */ (el.placeResults.firstElementChild)?.focus();
  } catch (err) {
    setAirStatus(/** @type {Error} */ (err).message, true);
  }
});

/** @param {{ name: string, region: string, lat: number, lon: number }} p */
function pickPlace(p) {
  el.placeResults.replaceChildren();
  loadForecast(p.lat, p.lon, [p.name, p.region].filter(Boolean).join(', '));
}

el.geoBtn.addEventListener('click', () => {
  if (!('geolocation' in navigator)) return setAirStatus('Your browser cannot share location. Search for your city instead.', true);
  setAirStatus('Asking your browser for your location…');
  navigator.geolocation.getCurrentPosition(
    (pos) => loadForecast(pos.coords.latitude, pos.coords.longitude, 'your location'),
    () => setAirStatus('Location was not shared. Search for your city instead.', true),
    { maximumAge: 600_000, timeout: 10_000 },
  );
});

el.sampleBtn.addEventListener('click', () => {
  state.plan = samplePlan();
  state.original = null;
  editor.render();
  syncHomeControls();
  useDays([{ date: 'typical December day', pm25: SAMPLE_FORECAST }], 'Delhi (sample)');
});

el.daySelect.addEventListener('change', selectDay);

/* ---------- budget & suggestions ---------- */

let recomputeTimer = 0;
function recompute() {
  window.clearTimeout(recomputeTimer);
  recomputeTimer = window.setTimeout(runBudget, 120);
}

function runBudget() {
  savePlan();
  if (!state.forecast) {
    el.resultsStatus.textContent = 'Load a forecast in step 1 to see your family’s budget.';
    return;
  }
  const checked = validatePlan(state.plan);
  if (!checked.ok) {
    el.resultsStatus.textContent = `Please fix: ${checked.errors.slice(0, 3).join(' ')}`;
    el.resultsStatus.classList.add('error');
    return;
  }
  el.resultsStatus.classList.remove('error');
  const day = computeDay(checked.plan, state.forecast);
  const top = [...day.members].sort((a, b) => b.cigarettes - a.cigarettes)[0];
  const topName = checked.plan.members.find((m) => m.id === top.memberId)?.name;
  el.resultsStatus.textContent = `Updated. ${topName} breathes the most today: about ${top.cigarettes.toFixed(1)} cigarettes' worth.`;
  renderStats(el.stats, day, computeDay(optimizeDay(checked.plan, state.forecast).plan, state.forecast));
  renderHourGrid(el.hourGrid, checked.plan, state.forecast, memberTimeline);
  renderBudget(el.budget, checked.plan, day);
  renderSuggestions(el.suggestions, suggest(checked.plan, state.forecast).slice(0, 6), applySuggestion);
}

/** @param {any} s */
function applySuggestion(s) {
  const checked = validatePlan(state.plan);
  if (!checked.ok || !state.forecast) return;
  const r = compareChange(checked.plan, state.forecast, s.change);
  if (!r.ok) return;
  state.original ??= structuredClone(state.plan);
  state.plan = r.plan;
  el.undoAll.hidden = false;
  editor.render();
  syncHomeControls();
  runBudget();
  el.resultsStatus.textContent = `Done: ${s.title}. ${el.resultsStatus.textContent}`;
  el.budgetHeading.focus();
}

el.applyAll.addEventListener('click', () => {
  const checked = validatePlan(state.plan);
  if (!checked.ok || !state.forecast) return;
  const before = computeDay(checked.plan, state.forecast);
  const { plan, applied } = optimizeDay(checked.plan, state.forecast);
  if (!applied.length) {
    el.resultsStatus.textContent = 'No free changes left to apply.';
    return;
  }
  const after = computeDay(plan, state.forecast);
  state.original ??= structuredClone(state.plan);
  state.plan = plan;
  el.undoAll.hidden = false;
  editor.render();
  syncHomeControls();
  runBudget();
  const pct = Math.round(((before.total - after.total) / before.total) * 100);
  const co2 = Math.round(before.emissions.co2 - after.emissions.co2);
  el.resultsStatus.textContent = `Applied ${applied.length} free changes: your family breathes ${pct}% less smog${co2 > 0 ? ` and your trips emit ${co2} g less CO₂` : ''}.`;
  el.budgetHeading.focus();
});

el.undoAll.addEventListener('click', () => {
  if (!state.original) return;
  state.plan = state.original;
  state.original = null;
  el.undoAll.hidden = true;
  editor.render();
  syncHomeControls();
  runBudget();
  el.budgetHeading.focus();
});

/* ---------- AI briefing ---------- */

el.coachBtn.addEventListener('click', async () => {
  const checked = validatePlan(state.plan);
  if (!checked.ok || !state.forecast) {
    el.coachOut.replaceChildren(h('p', { class: 'error' }, 'Load a forecast and complete your day first.'));
    return;
  }
  el.coachBtn.disabled = true;
  el.coachOut.replaceChildren(h('p', { class: 'status' }, 'Writing your family briefing…'));
  try {
    const r = await getCoach(checked.plan, state.forecast, el.coachLang.value);
    el.coachOut.replaceChildren(
      h('div', { class: 'coach-text', lang: el.coachLang.value },
        h('p', null, r.summary),
        h('ul', null, ...r.tips.map((/** @type {string} */ t) => h('li', null, t))),
      ),
      h('p', { class: 'source-note' }, r.source === 'gemini' ? 'Written by Gemini from the numbers above.' : 'Written offline from the numbers above (AI not configured).'),
    );
  } catch (err) {
    el.coachOut.replaceChildren(h('p', { class: 'error' }, /** @type {Error} */ (err).message));
  } finally {
    el.coachBtn.disabled = false;
  }
});

/* ---------- what-if ---------- */

el.whatifForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const checked = validatePlan(state.plan);
  const question = el.whatifInput.value.trim();
  if (!checked.ok || !state.forecast) {
    el.whatifOut.replaceChildren(h('p', { class: 'error' }, 'Load a forecast and complete your day first.'));
    return;
  }
  el.whatifOut.replaceChildren(h('p', { class: 'status' }, 'Working it out…'));
  try {
    const r = await askWhatIf(checked.plan, question);
    if (!r.change) {
      el.whatifOut.replaceChildren(h('p', null, r.description));
      return;
    }
    const cmp = compareChange(checked.plan, state.forecast, r.change);
    if (!cmp.ok) {
      el.whatifOut.replaceChildren(h('p', { class: 'error' }, cmp.errors.join(' ')));
      return;
    }
    el.whatifOut.replaceChildren(
      comparisonCard(cmp, cmp.description ?? r.description),
      h('button', { type: 'button', class: 'secondary', onclick: () => applySuggestion({ change: r.change, title: cmp.description }) }, 'Use this in my day'),
      h('p', { class: 'source-note' }, r.source === 'gemini' ? 'Question understood by Gemini; numbers from the Breathprint engine.' : 'Question understood offline; numbers from the Breathprint engine.'),
    );
  } catch (err) {
    el.whatifOut.replaceChildren(h('p', { class: 'error' }, /** @type {Error} */ (err).message));
  }
});

document.querySelector('.examples')?.addEventListener('click', (e) => {
  const q = /** @type {HTMLElement} */ (e.target).dataset.example;
  if (!q) return;
  el.whatifInput.value = q;
  /** @type {HTMLFormElement} */ (el.whatifForm).requestSubmit();
});

/* ---------- clean-room calculator ---------- */

el.roomPurifier.replaceChildren(
  ...Object.entries(PURIFIERS).map(([k, v]) => h('option', { value: k, selected: k === 'medium' }, v.label)),
);

function runRoom() {
  const num = (/** @type {string} */ id) => Number(/** @type {HTMLInputElement} */ (byId(id)).value);
  const dims = [num('room-l'), num('room-w'), num('room-h-in')];
  if (dims.some((d) => !(d > 0 && d <= 20))) {
    el.roomOut.replaceChildren(h('p', { class: 'error' }, 'Enter room sizes between 1 and 20 metres.'));
    return;
  }
  const valid = /** @type {number[]} */ ((state.forecast ?? SAMPLE_FORECAST).filter((v) => v !== null));
  const outdoorPm = Math.max(...valid.slice(-6)); // evening/night air, when people sleep
  const p = PURIFIERS[/** @type {keyof typeof PURIFIERS} */ (el.roomPurifier.value)];
  const r = purifierPlan({ lengthM: dims[0], widthM: dims[1], heightM: dims[2], cadr: p.cadr, outdoorPm, windowsOpen: /** @type {HTMLInputElement} */ (byId('room-open')).checked });
  renderRoom(el.roomOut, r, p.label);
}
el.roomForm.addEventListener('input', runRoom);
el.roomForm.addEventListener('submit', (e) => e.preventDefault());

/* ---------- start ---------- */

const editor = createEditor({
  getPlan: () => state.plan,
  setPlan: (p) => { state.plan = p; },
  onChange: () => { state.original = null; el.undoAll.hidden = true; recompute(); },
  membersEl: el.members,
  activitiesEl: el.activities,
  addMemberBtn: el.addMember,
  addActivityBtn: el.addActivity,
});
editor.render();
syncHomeControls();
runRoom();
runBudget();
