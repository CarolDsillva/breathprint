// @ts-check
/** Section 01: find a place, load its hourly PM2.5 forecast and pick the day to plan. */
import { formatTime, SAMPLE_FORECAST, samplePlan } from '/engine/index.js';
import { getForecast, searchPlaces } from './api.js';
import { band, errorMessage, statusLine } from './components.js';
import { byId, formById, h, inputById, selectById } from './dom.js';
import { replacePlan, setForecast, state } from './state.js';

/** @typedef {import('./types.js').ForecastDay} ForecastDay */
/** @typedef {import('./types.js').Place} Place */
/** @typedef {import('./types.js').Forecast} Forecast */

/** A day needs at least this many forecast hours to plan around. */
const MIN_HOURS = 12;
/** From this hour on, default to planning tomorrow. */
const PLAN_TOMORROW_FROM = 18;

/**
 * The 24-bar forecast strip. Each bar has a spoken label with the value and band name.
 * @param {HTMLElement} el
 * @param {Forecast} pm
 */
export function renderAirStrip(el, pm) {
  const max = Math.max(60, ...pm.map((v) => v ?? 0));
  el.replaceChildren(
    ...pm.map((v, hour) => {
      const label = formatTime(hour).replace(':00', '');
      if (v === null) {
        return h(
          'li',
          { 'aria-label': `${label}: no data` },
          h('span', { class: 'val' }, '–'),
          h('span', { class: 'hour', 'aria-hidden': 'true' }, hour),
        );
      }
      const b = band(v);
      return h(
        'li',
        {
          'aria-label': `${label}: ${Math.round(v)} micrograms, ${b.name}`,
          title: `${label}: ${Math.round(v)} µg/m³ (${b.name})`,
        },
        h('span', { class: 'val', 'aria-hidden': 'true' }, Math.round(v)),
        h('span', {
          class: `bar band-${b.index}`,
          style: `height:${Math.max(3, (v / max) * 100)}%`,
          'aria-hidden': 'true',
        }),
        h('span', { class: 'hour', 'aria-hidden': 'true' }, hour),
      );
    }),
  );
}

/** Elements of this section, found once when the panel starts. */
function findElements() {
  return {
    form: formById('place-form'),
    input: inputById('place-input'),
    results: byId('place-results'),
    daySelect: selectById('day-select'),
    status: byId('air-status'),
    strip: byId('air-strip'),
    placeChip: byId('place-chip'),
  };
}

/** @type {ReturnType<typeof findElements>} */
let ui;

/**
 * Show a message in this section's status line.
 * @param {string} text
 * @param {boolean} [isError]
 */
const say = (text, isError = false) => statusLine(ui.status)(text, isError);

/** Show the chosen day's forecast and hand it to the rest of the app. */
function selectDay() {
  const day = state.days[Number(ui.daySelect.value)] ?? state.days[0];
  const known = day.pm25.filter((v) => v !== null);
  say(
    `${state.place}, ${day.date}: PM2.5 from ${Math.round(Math.min(...known))} to ${Math.round(Math.max(...known))} µg/m³.`,
  );
  renderAirStrip(ui.strip, day.pm25);
  setForecast(day.pm25);
}

/** @param {number} i @param {ForecastDay} day */
const dayLabel = (i, day) => `${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : day.date} (${day.date})`;

/**
 * Offer the forecast days that have enough data. After 6 PM, default to planning tomorrow.
 * @param {ForecastDay[]} days
 * @param {string} place
 */
function useDays(days, place) {
  state.days = days.filter((d) => d.pm25.filter((v) => v !== null).length >= MIN_HOURS);
  state.place = place;
  ui.placeChip.textContent = `◉ ${place}`;
  ui.placeChip.hidden = false;
  ui.daySelect.replaceChildren(...state.days.map((d, i) => h('option', { value: String(i) }, dayLabel(i, d))));
  ui.daySelect.disabled = state.days.length < 2;
  if (!state.days.length) return say(`No usable forecast for ${place}. Try a nearby city or the sample day.`, true);
  ui.daySelect.value = state.days.length > 1 && new Date().getHours() >= PLAN_TOMORROW_FROM ? '1' : '0';
  selectDay();
}

/**
 * Fetch a place's forecast and offer its days.
 * @param {number} lat
 * @param {number} lon
 * @param {string} label
 */
async function loadForecast(lat, lon, label) {
  say(`Loading the smog forecast for ${label}…`);
  try {
    const forecast = await getForecast(lat, lon);
    useDays(forecast.days, label);
  } catch (err) {
    say(errorMessage(err), true);
  }
}

/**
 * Use the place the user chose from the search results.
 * @param {Place} place
 */
function pickPlace(place) {
  ui.results.replaceChildren();
  loadForecast(place.lat, place.lon, [place.name, place.region].filter(Boolean).join(', '));
}

/**
 * Search for a place; load it directly if there is one match, otherwise let the user choose.
 * @param {string} query
 */
async function searchPlace(query) {
  say('Searching…');
  try {
    /** @type {{ places: Place[] }} */
    const { places } = await searchPlaces(query);
    if (!places.length) {
      ui.results.replaceChildren();
      return say(`No place called "${query}" found. Check the spelling or try a bigger city nearby.`, true);
    }
    if (places.length === 1) return pickPlace(places[0]);
    say(`Found ${places.length} places. Choose yours.`);
    const choices = places.map((p) =>
      h(
        'button',
        { type: 'button', class: 'btn', onclick: () => pickPlace(p) },
        [p.name, p.region, p.country].filter(Boolean).join(', '),
      ),
    );
    ui.results.replaceChildren(...choices);
    choices[0].focus();
  } catch (err) {
    say(errorMessage(err), true);
  }
}

function useMyLocation() {
  if (!('geolocation' in navigator))
    return say('Your browser cannot share location. Search for your city instead.', true);
  say('Asking your browser for your location…');
  navigator.geolocation.getCurrentPosition(
    (pos) => loadForecast(pos.coords.latitude, pos.coords.longitude, 'your location'),
    () => say('Location was not shared. Search for your city instead.', true),
    { maximumAge: 600_000, timeout: 10_000 },
  );
}

/** Wire up place search, geolocation, the sample day and the day picker. */
export function initForecastPanel() {
  ui = findElements();
  ui.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = ui.input.value.trim();
    if (query.length >= 2) searchPlace(query);
  });
  byId('geo-btn').addEventListener('click', useMyLocation);
  byId('sample-btn').addEventListener('click', () => {
    replacePlan(samplePlan());
    useDays([{ date: 'typical December day', pm25: SAMPLE_FORECAST }], 'Delhi (sample)');
  });
  ui.daySelect.addEventListener('change', selectDay);
}
