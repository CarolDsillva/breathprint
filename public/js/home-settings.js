// @ts-check
/** Home and neighbourhood settings (windows, purifier, nearby transit). */
import { byId } from './dom.js';
import { planEdited, state, subscribe } from './state.js';

export function initHomeSettings() {
  const windows = /** @type {HTMLSelectElement} */ (byId('home-windows'));
  const purifier = /** @type {HTMLInputElement} */ (byId('home-purifier'));
  const metro = /** @type {HTMLInputElement} */ (byId('home-metro'));
  const bus = /** @type {HTMLInputElement} */ (byId('home-bus'));

  function sync() {
    windows.value = state.plan.home.windows;
    purifier.checked = state.plan.home.purifier;
    metro.checked = state.plan.home.metro;
    bus.checked = state.plan.home.bus;
  }

  windows.addEventListener('change', () => {
    state.plan.home.windows = windows.value === 'closed' ? 'closed' : 'open';
    planEdited();
  });
  for (const [box, key] of /** @type {const} */ ([
    [purifier, 'purifier'],
    [metro, 'metro'],
    [bus, 'bus'],
  ])) {
    box.addEventListener('change', () => {
      state.plan.home[key] = box.checked;
      planEdited();
    });
  }

  subscribe((kind) => {
    if (kind === 'replaced') sync();
  });
  sync();
}
