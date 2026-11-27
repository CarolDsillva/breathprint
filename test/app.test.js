// End-to-end test of the front end: the real page and app.js in jsdom, with only the server's
// answers faked. Each test drives one section the way a user would and checks what they see.
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { dom } from './helpers/dom-env.js';

const { SAMPLE_FORECAST } = await import('../src/engine/index.js');
const { window } = dom;
const { document } = window;
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Let debounced recalculation (120 ms) and announcements (≤ 700 ms) finish. */
const settle = (ms = 200) => wait(ms);

// ---- fake server -------------------------------------------------------------------------
const days = [
  { date: '2026-12-01', pm25: SAMPLE_FORECAST, aqi: SAMPLE_FORECAST },
  { date: '2026-12-02', pm25: SAMPLE_FORECAST.map((v) => v / 2), aqi: SAMPLE_FORECAST },
];
const delhi = { name: 'Delhi', region: 'Delhi', country: 'India', lat: 28.6, lon: 77.2 };
/** Per-route answers; tests swap these to try other outcomes. */
const server = {
  places: () => ({ places: [delhi, { ...delhi, name: 'Delhi', region: 'New York', country: 'US' }] }),
  forecast: () => ({ timezone: 'Asia/Kolkata', days }),
  coach: () => ({ summary: 'आज हवा खराब है।', tips: ['खिड़कियां बंद रखें।', 'मेट्रो लें।'], source: 'gemini' }),
  whatif: () => ({ change: { activityId: 'school-run', mode: 'metro' }, description: 'metro', source: 'gemini' }),
  scan: () => ({ findings: [{ id: 'incense', evidence: 'sticks burning' }], summary: 'A puja corner.' }),
};
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(url, init = {}) {
  const path = new URL(String(url), 'http://localhost').pathname.replace('/api/', '');
  const answer = server[path]?.(init.body ? JSON.parse(init.body) : undefined);
  if (answer instanceof Error) return Promise.reject(answer);
  if (answer?.status) return Promise.resolve(reply(answer.body, answer.status));
  return Promise.resolve(reply(answer ?? { error: 'Not found.' }, answer ? 200 : 404));
}

/** Run a test with one route answering differently. */
async function withServer(route, answer, fn) {
  const original = server[route];
  server[route] = answer;
  try {
    await fn();
  } finally {
    server[route] = original;
  }
}

// ---- browser features jsdom lacks, for the photo path --------------------------------------
function fakePhotoSupport() {
  globalThis.createImageBitmap = async () => ({ width: 2048, height: 1536, close() {} });
  mock.method(window.HTMLCanvasElement.prototype, 'getContext', () => ({ drawImage() {} }));
  mock.method(window.HTMLCanvasElement.prototype, 'toBlob', function toBlob(callback) {
    callback(new window.Blob(['jpeg-bytes'], { type: 'image/jpeg' }));
  });
  mock.method(URL, 'createObjectURL', () => 'blob:preview');
  mock.method(URL, 'revokeObjectURL', () => {});
}

/** Choose a file in the photo input (jsdom's FileList cannot be built directly). */
function choosePhoto(name, type) {
  const file = new window.File(['x'], name, { type });
  Object.defineProperty($('scan-file'), 'files', { value: [file], configurable: true });
}

const change = (el, value) => {
  if (value !== undefined) el.value = value;
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const input = (el, value) => {
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const submit = (formId) => $(formId).requestSubmit();
/** The photo form: jsdom's required-file check cannot see files attached in tests, so send submit directly. */
const submitPhoto = () => $('scan-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
const statsValue = () => $('stats').querySelectorAll('.v')[0]?.textContent;

/** Offline support is registered when the browser has it; a failed registration is ignored. */
const registrations = [];

before(async () => {
  localStorage.clear();
  mock.method(globalThis, 'fetch', fakeFetch);
  fakePhotoSupport();
  Object.defineProperty(globalThis.navigator, 'serviceWorker', {
    value: { register: async (url) => (registrations.push(url), Promise.reject(new Error('private window'))) },
    configurable: true,
  });
  await import('../public/js/app.js');
});
after(() => mock.restoreAll());

describe('starting up', () => {
  it('registers offline support without failing when registration is refused', () => {
    assert.deepEqual(registrations, ['/sw.js']);
  });

  it('asks for a forecast before showing a budget', () => {
    assert.match($('results-status').textContent, /Load a forecast/);
    assert.equal($('members').children.length, 4, 'sample family in the editor');
    assert.match($('room-out').textContent, /min/, 'room calculator works from the start');
  });
});

describe('01 · finding the air', () => {
  it('searches places, lets the user choose one and loads the forecast', async () => {
    input($('place-input'), 'Delhi');
    submit('place-form');
    await settle();
    const choices = $('place-results').querySelectorAll('button');
    assert.equal(choices.length, 2);
    assert.equal(document.activeElement, choices[0], 'focus moves to the first choice');
    choices[0].click();
    await settle();
    assert.match($('air-status').textContent, /Delhi, Delhi, 2026-12-0\d: PM2.5 from/);
    assert.equal($('air-strip').children.length, 24);
    assert.equal($('place-chip').hidden, false);
    assert.equal($('day-select').options.length, 2);
    assert.ok(statsValue(), 'budget appears');
  });

  it('switches between today and tomorrow', async () => {
    change($('day-select'), '1');
    await settle();
    assert.match($('air-status').textContent, /2026-12-02/);
    change($('day-select'), '0');
    await settle();
  });

  it('loads a single match directly and explains when nothing is found', async () => {
    await withServer(
      'places',
      () => ({ places: [delhi] }),
      async () => {
        input($('place-input'), 'Delhi');
        submit('place-form');
        await settle();
        assert.equal($('place-results').children.length, 0);
        assert.match($('air-status').textContent, /PM2.5 from/);
      },
    );
    await withServer(
      'places',
      () => ({ places: [] }),
      async () => {
        input($('place-input'), 'Nowhere');
        submit('place-form');
        await settle();
        assert.match($('air-status').textContent, /No place called "Nowhere"/);
        assert.ok($('air-status').classList.contains('error'));
      },
    );
  });

  it('reports server errors, empty forecasts and short searches', async () => {
    await withServer(
      'places',
      () => ({ status: 429, body: { error: 'Too many requests, please wait a minute.' } }),
      async () => {
        input($('place-input'), 'Delhi');
        submit('place-form');
        await settle();
        assert.match($('air-status').textContent, /Too many requests/);
      },
    );
    await withServer(
      'forecast',
      () => ({ timezone: 'UTC', days: [{ date: 'x', pm25: Array(24).fill(null) }] }),
      async () => {
        input($('place-input'), 'Delhi');
        submit('place-form');
        await settle();
        $('place-results').querySelector('button').click();
        await settle();
        assert.match($('air-status').textContent, /No usable forecast/);
      },
    );
    await withServer(
      'forecast',
      () => new TypeError('offline'),
      async () => {
        $('place-results').replaceChildren();
        input($('place-input'), 'Delhi');
        submit('place-form');
        await settle();
        $('place-results').querySelector('button').click();
        await settle();
        assert.match($('air-status').textContent, /Could not reach the server/);
      },
    );
    input($('place-input'), 'D');
    submit('place-form');
    await settle();
    assert.match($('air-status').textContent, /Could not reach the server/, 'one letter is ignored');
  });

  it('uses the browser location when shared, and explains when it is not', async () => {
    // The app reads the global navigator (Node has its own), so fake location there.
    const nav = globalThis.navigator;
    $('geo-btn').click();
    assert.match($('air-status').textContent, /cannot share location/);

    const located = { getCurrentPosition: (ok) => ok({ coords: { latitude: 28.6, longitude: 77.2 } }) };
    Object.defineProperty(nav, 'geolocation', { value: located, configurable: true });
    $('geo-btn').click();
    await settle();
    assert.match($('air-status').textContent, /your location/);

    const denied = { getCurrentPosition: (_ok, fail) => fail(new Error('denied')) };
    Object.defineProperty(nav, 'geolocation', { value: denied, configurable: true });
    $('geo-btn').click();
    assert.match($('air-status').textContent, /Location was not shared/);
  });

  it('loads the sample Delhi day without the network', async () => {
    $('sample-btn').click();
    await settle();
    assert.match($('air-status').textContent, /Delhi \(sample\)/);
    assert.equal(statsValue(), '6,801µg');
  });
});

describe('02 · the family editor', () => {
  it('adds, edits and removes people', async () => {
    $('add-member').click();
    await settle();
    assert.equal($('members').children.length, 5);
    const newName = document.activeElement;
    assert.match(newName.id, /^m-p.+-name$/, 'focus moves to the new name');
    change(newName, 'Nani');
    const id = newName.id.replace(/-name$/, '');
    change($(`${id}-age`), 'senior');
    const sensitive = newName.closest('.editor-item').querySelector('input[type=checkbox]');
    sensitive.checked = true;
    change(sensitive);
    await settle();
    assert.ok($('activities').textContent.includes('Nani'), 'new name shows in the "Who" lists');
    $('members')
      .querySelector(`[data-remove-member="${id.slice(2)}"]`)
      .click();
    await settle();
    assert.equal($('members').children.length, 4);
  });

  it('turns an activity into a trip, keeping focus where the user was', async () => {
    const kind = $('a-walk-kind');
    kind.focus();
    change(kind, 'commute');
    await settle();
    assert.ok($('a-walk-mode') && $('a-walk-distanceKm'));
    assert.equal(document.activeElement.id, 'a-walk-kind');
    change($('a-walk-kind'), 'outdoor');
    change($('a-walk-start'), '07:00');
    await settle();
  });

  it('adds and removes activities', async () => {
    const before = $('activities').children.length;
    $('add-activity').click();
    await settle();
    assert.equal($('activities').children.length, before + 1);
    assert.match(document.activeElement.id, /-label$/);
    const removeButtons = $('activities').querySelectorAll('[data-remove-activity]');
    removeButtons[removeButtons.length - 1].click();
    await settle();
    assert.equal($('activities').children.length, before);
    assert.equal(document.activeElement, $('add-activity'));
  });

  it('removing the only person in an activity removes the activity too', async () => {
    $('sample-btn').click();
    await settle();
    $('members').querySelector('[data-remove-member="priya"]').click();
    await settle();
    assert.ok(!$('activities').textContent.includes('Office commute'));
    $('sample-btn').click();
    await settle();
  });

  it('shows what to fix when the plan is invalid', async () => {
    change($('a-cricket-hours'), '0');
    await settle();
    assert.match($('results-status').textContent, /Please fix: Cricket practice: duration/);
    assert.ok($('results-status').classList.contains('error'));
    change($('a-cricket-hours'), '1.5');
    await settle();
    assert.ok(!$('results-status').classList.contains('error'));
  });

  it('home settings change the budget', async () => {
    const before = statsValue();
    change($('home-windows'), 'closed');
    await settle();
    assert.notEqual(statsValue(), before);
    $('home-purifier').checked = true;
    change($('home-purifier'));
    $('home-metro').checked = false;
    change($('home-metro'));
    await settle();
    $('sample-btn').click();
    await settle();
    assert.equal($('home-windows').value, 'open', 'controls follow a replaced plan');
  });
});

describe('03 · budget, choices and impact', () => {
  it('applies all free changes, then undoes them', async () => {
    $('apply-all').click();
    await settle();
    assert.match($('results-status').textContent, /Applied 6 free changes: your family breathes 35% less smog/);
    assert.equal(document.activeElement, $('budget-h'));
    assert.equal($('undo-all').hidden, false);
    assert.match($('season-out').textContent, /cigarettes' worth for Aarav/);
    $('apply-all').click();
    await settle();
    assert.match($('results-status').textContent, /No free changes left/);
    $('undo-all').click();
    await settle();
    assert.equal($('undo-all').hidden, true);
    assert.equal(statsValue(), '6,801µg');
  });

  it('applies one suggestion with its button', async () => {
    $('suggestions').querySelector('button').click();
    await settle();
    assert.match($('results-status').textContent, /^Done: /);
    $('undo-all').click();
    await settle();
  });

  it('multiplies savings across the neighbourhood and announces the result', async () => {
    input($('families'), '0');
    assert.match($('ripple-out').textContent, /between 1 and 100,000/);
    input($('families'), '250');
    assert.match($('ripple-out').textContent, /less CO₂ from trips/);
    await settle(900);
    assert.match($('ripple-announce').textContent, /^250 families: about [\d,]+ cigarettes' worth/);
    input($('families'), '0');
    await settle(900);
    assert.match($('ripple-announce').textContent, /between 1 and 100,000/);
    input($('families'), '100');
  });
});

describe('family briefing', () => {
  it('shows the Gemini briefing in the chosen language and announces it', async () => {
    change($('coach-lang'), 'hi');
    $('coach-btn').click();
    await settle();
    assert.equal($('coach-out').querySelector('.coach-text').getAttribute('lang'), 'hi');
    assert.match($('coach-out').textContent, /Written by Gemini/);
    assert.equal($('coach-out').hasAttribute('aria-busy'), false);
    assert.match($('briefing-announce').textContent, /briefing ready/);
  });

  it('labels offline briefings and reports errors', async () => {
    await withServer(
      'coach',
      () => ({ summary: 's', tips: ['t'], source: 'template' }),
      async () => {
        $('coach-btn').click();
        await settle();
        assert.match($('coach-out').textContent, /Written offline/);
      },
    );
    await withServer(
      'coach',
      () => ({ status: 502, body: { error: 'AI is busy.' } }),
      async () => {
        $('coach-btn').click();
        await settle();
        assert.match($('coach-out').textContent, /AI is busy/);
        assert.match($('briefing-announce').textContent, /AI is busy/);
      },
    );
  });
});

describe('04 · what if', () => {
  it('compares a Gemini-understood change and lets the user apply it', async () => {
    $('whatif-examples').querySelector('button').click();
    await settle();
    assert.ok($('whatif-out').querySelector('table'));
    assert.match($('whatif-out').textContent, /understood by Gemini/);
    assert.match($('whatif-announce').textContent, /city gets 90 g CO₂ less/);
    $('whatif-out').querySelector('button').click();
    await settle();
    assert.match($('results-status').textContent, /^Done: Go by Metro/);
    $('undo-all').click();
    await settle();
  });

  it('explains questions it could not use', async () => {
    const ask = async (question) => {
      input($('whatif-input'), question);
      submit('whatif-form');
      await settle();
    };
    await withServer(
      'whatif',
      () => ({ change: null, description: 'Try naming an activity.', source: 'offline' }),
      () => ask('hello'),
    );
    assert.match($('whatif-out').textContent, /Try naming an activity/);
    await withServer(
      'whatif',
      () => ({ change: { activityId: 'office-trip', mode: 'walk' }, description: 'walk', source: 'offline' }),
      () => ask('walk to office'),
    );
    assert.match($('whatif-out').textContent, /too far to walk/);
    await withServer(
      'whatif',
      () => ({ change: { activityId: 'cricket', start: 14 }, description: 'x', source: 'offline' }),
      () => ask('cricket at 2pm'),
    );
    assert.match($('whatif-out').textContent, /understood offline/);
    await withServer(
      'whatif',
      () => new TypeError('offline'),
      () => ask('anything'),
    );
    assert.match($('whatif-announce').textContent, /Could not reach the server/);
  });
});

describe('05 · clean room', () => {
  it('says when the room is already clean on a good-air day', async () => {
    const clean = [{ date: '2026-12-03', pm25: Array(24).fill(20), aqi: Array(24).fill(20) }];
    await withServer(
      'forecast',
      () => ({ timezone: 'UTC', days: clean }),
      async () => {
        input($('place-input'), 'Delhi');
        submit('place-form');
        await settle();
        $('place-results').querySelector('button').click();
        await settle();
        assert.match($('room-out').textContent, /already below 35/);
      },
    );
    $('sample-btn').click();
    await settle();
  });

  it('recalculates as the room changes and announces the result', async () => {
    change($('room-purifier'), 'large');
    input($('room-l'), '5');
    await settle(900);
    assert.match($('room-announce').textContent, /Large HEPA purifier.*about \d+ minutes/);
    change($('room-purifier'), 'none');
    input($('room-l'), '5');
    await settle(900);
    assert.match($('room-out').textContent, /Not enough/);
    assert.match($('room-announce').textContent, /not enough/);
    input($('room-l'), '50');
    await settle(900);
    assert.match($('room-out').textContent, /between 1 and 20 metres/);
    input($('room-l'), '4');
    $('room-form').requestSubmit();
  });
});

describe('06 · smoke detective', () => {
  it('shows fixes for ticked checklist items, with their impact', async () => {
    submit('checklist-form');
    assert.match($('scan-status').textContent, /Tick at least one/);
    for (const id of ['gas-stove-no-exhaust', 'plants']) {
      $('checklist').querySelector(`input[value="${id}"]`).checked = true;
    }
    submit('checklist-form');
    await settle();
    assert.match($('scan-status').textContent, /fixes for 2 items/);
    assert.equal($('scan-out').querySelectorAll('li').length, 2);
    assert.ok($('scan-out').querySelector('.chip'));
    $('scan-out').querySelector('button').click();
    await settle();
    assert.match($('results-status').textContent, /^Done: /);
    $('undo-all').click();
    await settle();
  });

  it('checks the chosen photo before sending it', async () => {
    Object.defineProperty($('scan-file'), 'files', { value: [], configurable: true });
    submitPhoto();
    assert.match($('scan-status').textContent, /Choose a photo first/);
    choosePhoto('room.gif', 'image/gif');
    submitPhoto();
    assert.match($('scan-status').textContent, /JPEG, PNG or WebP/);
  });

  it('shrinks the photo, scans it with Gemini and ticks what was found', async () => {
    choosePhoto('room.jpg', 'image/jpeg');
    submitPhoto();
    await settle(300);
    assert.equal($('scan-preview').hidden, false);
    assert.equal($('scan-status').textContent, 'A puja corner.');
    assert.equal($('checklist').querySelector('input[value="incense"]').checked, true);
    assert.match($('scan-out').textContent, /Seen: sticks burning/);
    assert.equal($('scan-btn').disabled, false);
  });

  it('suggests a better photo when nothing is found, and reports failures', async () => {
    await withServer(
      'scan',
      () => ({ findings: [], summary: '' }),
      async () => {
        submitPhoto();
        await settle(300);
        assert.match($('scan-status').textContent, /Found 0 items/);
        assert.match($('scan-out').textContent, /Try a wider shot/);
      },
    );
    await withServer(
      'scan',
      () => ({ status: 503, body: { error: 'Photo scanning needs the AI service.' } }),
      async () => {
        submitPhoto();
        await settle(300);
        assert.match($('scan-status').textContent, /needs the AI service\. You can use the checklist/);
      },
    );
  });
});

describe('when inputs are missing', () => {
  it('asks for a forecast before briefings and what-ifs', async () => {
    change($('a-cricket-hours'), '0');
    await settle();
    $('coach-btn').click();
    assert.match($('coach-out').textContent, /Load a forecast and complete your day first/);
    submit('whatif-form');
    assert.match($('whatif-out').textContent, /Load a forecast and complete your day first/);
    submit('checklist-form');
    $('checklist').querySelector('input').checked = true;
    submit('checklist-form');
    assert.match($('scan-status').textContent, /Fix your family plan above first/);
  });
});
