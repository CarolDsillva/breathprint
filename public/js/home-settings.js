// @ts-check
/** Home and neighbourhood settings (windows, purifier, nearby transit). */
import { inputById, selectById } from './dom.js';
import { planEdited, state, subscribe } from './state.js';

/** Wire up the home settings and keep them in step with the plan. */
export function initHomeSettings() {
  const windows = selectById('home-windows');
  const purifier = inputById('home-purifier');
  const metro = inputById('home-metro');
  const bus = inputById('home-bus');

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
