// @ts-check
/** Section 01: find a place, load its hourly PM2.5 forecast and pick the day to plan. */
import { SAMPLE_FORECAST, samplePlan } from '/engine/index.js';
import { formatTime } from '/engine/time.js';
import { getForecast, searchPlaces } from './api.js';
import { band } from './components.js';
import { byId, h } from './dom.js';
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

/** Wire up place search, geolocation, the sample day and the day picker. */
export function initForecastPanel() {
  const form = /** @type {HTMLFormElement} */ (byId('place-form'));
  const input = /** @type {HTMLInputElement} */ (byId('place-input'));
  const results = byId('place-results');
  const daySelect = /** @type {HTMLSelectElement} */ (byId('day-select'));
  const status = byId('air-status');
  const strip = byId('air-strip');
  const placeChip = byId('place-chip');

  /**
   * @param {string} text
   * @param {boolean} [isError]
   */
  const say = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle('error', isError);
  };

  function selectDay() {
    const day = state.days[Number(daySelect.value)] ?? state.days[0];
    const known = /** @type {number[]} */ (day.pm25.filter((v) => v !== null));
    say(
      `${state.place}, ${day.date}: PM2.5 from ${Math.round(Math.min(...known))} to ${Math.round(Math.max(...known))} µg/m³.`,
    );
    renderAirStrip(strip, day.pm25);
    setForecast(day.pm25);
  }

  /**
   * @param {ForecastDay[]} days
   * @param {string} place
   */
  function useDays(days, place) {
    state.days = days.filter((d) => d.pm25.filter((v) => v !== null).length >= MIN_HOURS);
    state.place = place;
    placeChip.textContent = `◉ ${place}`;
    placeChip.hidden = false;
    daySelect.replaceChildren(
      ...state.days.map((d, i) =>
        h('option', { value: String(i) }, `${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.date} (${d.date})`),
      ),
    );
    daySelect.disabled = state.days.length < 2;
    if (!state.days.length) {
      say(`No usable forecast for ${place}. Try a nearby city or the sample day.`, true);
      return;
    }
    daySelect.value = state.days.length > 1 && new Date().getHours() >= PLAN_TOMORROW_FROM ? '1' : '0';
    selectDay();
  }

  /**
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
      say(/** @type {Error} */ (err).message, true);
    }
  }

  /** @param {Place} place */
  function pickPlace(place) {
    results.replaceChildren();
    loadForecast(place.lat, place.lon, [place.name, place.region].filter(Boolean).join(', '));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (query.length < 2) return;
    say('Searching…');
    try {
      /** @type {{ places: Place[] }} */
      const { places } = await searchPlaces(query);
      if (!places.length) {
        results.replaceChildren();
        say(`No place called "${query}" found. Check the spelling or try a bigger city nearby.`, true);
        return;
      }
      if (places.length === 1) return pickPlace(places[0]);
      say(`Found ${places.length} places. Choose yours.`);
      results.replaceChildren(
        ...places.map((p) =>
          h(
            'button',
            { type: 'button', class: 'btn', onclick: () => pickPlace(p) },
            [p.name, p.region, p.country].filter(Boolean).join(', '),
          ),
        ),
      );
      /** @type {HTMLElement | null} */ (results.firstElementChild)?.focus();
    } catch (err) {
      say(/** @type {Error} */ (err).message, true);
    }
  });

  byId('geo-btn').addEventListener('click', () => {
    if (!('geolocation' in navigator))
      return say('Your browser cannot share location. Search for your city instead.', true);
    say('Asking your browser for your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => loadForecast(pos.coords.latitude, pos.coords.longitude, 'your location'),
      () => say('Location was not shared. Search for your city instead.', true),
      { maximumAge: 600_000, timeout: 10_000 },
    );
  });

  byId('sample-btn').addEventListener('click', () => {
    replacePlan(samplePlan());
    useDays([{ date: 'typical December day', pm25: SAMPLE_FORECAST }], 'Delhi (sample)');
  });

  daySelect.addEventListener('change', selectDay);
}
