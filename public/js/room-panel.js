// @ts-check
/** Section 05: how long a purifier takes to make the bedroom safe, and whether it is big enough. */
import { PURIFIERS, SAMPLE_FORECAST, purifierPlan } from '/engine/index.js';
import { message } from './components.js';
import { byId, fmt, fmt1, h } from './dom.js';
import { state, subscribe } from './state.js';

/** @typedef {keyof typeof PURIFIERS} PurifierId */

const MAX_ROOM_SIDE_M = 20;
/** Night-time hours (the end of the forecast day) set the outdoor air while people sleep. */
const NIGHT_HOURS = 6;

/**
 * @param {HTMLElement} el
 * @param {ReturnType<typeof purifierPlan>} r
 * @param {string} purifierLabel
 */
function renderRoom(el, r, purifierLabel) {
  let verdict;
  if (r.minutes === null) {
    verdict = `This purifier cannot bring the room below ${r.target} µg/m³. It settles around ${fmt(r.steady)} µg/m³; shut the window or use a bigger purifier.`;
  } else if (r.minutes === 0) {
    verdict = `The room is already below ${r.target} µg/m³.`;
  } else {
    verdict = `About ${r.minutes} minutes to get below ${r.target} µg/m³; it then settles near ${fmt(r.steady)} µg/m³.`;
  }
  el.replaceChildren(
    h('p', { class: 'big' }, r.minutes === null ? 'Not enough' : `${r.minutes} min`),
    h('p', null, `${purifierLabel}: ${verdict}`),
    h(
      'p',
      { class: 'hint' },
      `Room volume ${fmt1(r.volume)} m³. Without a purifier it sits near ${fmt(r.start)} µg/m³. ` +
        `For 5 clean-air changes an hour you need a CADR of at least ${fmt(r.recommendedCadr)} m³/h ` +
        `(yours gives ${fmt1(r.purifierAch)} clean-air changes an hour).`,
    ),
  );
}

export function initRoomPanel() {
  const form = byId('room-form');
  const out = byId('room-out');
  const purifier = /** @type {HTMLSelectElement} */ (byId('room-purifier'));
  const windowOpen = /** @type {HTMLInputElement} */ (byId('room-open'));
  /** @param {string} id */
  const metres = (id) => Number(/** @type {HTMLInputElement} */ (byId(id)).value);

  purifier.replaceChildren(
    ...Object.entries(PURIFIERS).map(([id, p]) => h('option', { value: id, selected: id === 'medium' }, p.label)),
  );

  function run() {
    const [lengthM, widthM, heightM] = [metres('room-l'), metres('room-w'), metres('room-h-in')];
    if (![lengthM, widthM, heightM].every((d) => d > 0 && d <= MAX_ROOM_SIDE_M)) {
      out.replaceChildren(message('Enter room sizes between 1 and 20 metres.', true));
      return;
    }
    const known = /** @type {number[]} */ ((state.forecast ?? SAMPLE_FORECAST).filter((v) => v !== null));
    const outdoorPm = Math.max(...known.slice(-NIGHT_HOURS));
    const chosen = PURIFIERS[/** @type {PurifierId} */ (purifier.value)];
    renderRoom(
      out,
      purifierPlan({ lengthM, widthM, heightM, cadr: chosen.cadr, outdoorPm, windowsOpen: windowOpen.checked }),
      chosen.label,
    );
  }

  form.addEventListener('input', run);
  form.addEventListener('submit', (e) => e.preventDefault());
  subscribe((kind) => {
    if (kind === 'forecast') run();
  });
  run();
}
