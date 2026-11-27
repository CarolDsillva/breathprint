// Front-end logic that does not need a server: editor field rules, app state and undo,
// DOM helpers, screen-reader announcements and the API client.
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { dom } from './helpers/dom-env.js';

const { setActivityField, setMemberField, DEFAULT_WINDOW } = await import('../public/js/editor-fields.js');
const state = await import('../public/js/state.js');
const { h, fromTimeValue, toTimeValue, fmt, fmt1, byId } = await import('../public/js/dom.js');
const components = await import('../public/js/components.js');
const api = await import('../public/js/api.js');
const { samplePlan, SAMPLE_FORECAST } = await import('../src/engine/index.js');

const { document } = dom.window;

/** A form control with a value (and optional checked state / data-value). */
function control({ value = '', checked = false, dataValue } = {}) {
  const el = document.createElement('input');
  el.value = value;
  el.checked = checked;
  if (dataValue) el.dataset.value = dataValue;
  return el;
}

describe('editor field rules', () => {
  const walk = () => structuredClone(samplePlan().activities.find((a) => a.id === 'walk'));

  it('sets text, numbers, times and booleans', () => {
    const a = walk();
    setActivityField(a, 'label', control({ value: 'Park walk' }));
    setActivityField(a, 'hours', control({ value: '1.5' }));
    setActivityField(a, 'start', control({ value: '07:30' }));
    setActivityField(a, 'nearTraffic', control({ checked: false }));
    assert.deepEqual([a.label, a.hours, a.start, a.nearTraffic], ['Park walk', 1.5, 7.5, false]);
  });

  it('ignores values outside the allowed lists and unknown fields', () => {
    const a = walk();
    setActivityField(a, 'kind', control({ value: 'spaceship' }));
    setActivityField(a, 'intensity', control({ value: 'extreme' }));
    setActivityField(a, 'start', control({ value: 'not a time' }));
    setActivityField(a, '__proto__', control({ value: 'x' }));
    assert.equal(a.kind, 'outdoor');
    assert.equal(a.intensity, 'light');
    assert.equal(a.start, 6);
  });

  it('gives a new trip a mode and distance, and makes it fixed in time', () => {
    const a = walk();
    setActivityField(a, 'kind', control({ value: 'commute' }));
    assert.equal(a.kind, 'commute');
    assert.equal(a.mode, 'bus');
    assert.equal(a.distanceKm, 5);
    assert.equal(a.flexible, false);
  });

  it('keeps flexible windows sensible, treating 00:00 as midnight', () => {
    const a = { ...walk(), flexible: false, window: undefined };
    setActivityField(a, 'flexible', control({ checked: true }));
    assert.deepEqual(a.window, DEFAULT_WINDOW);
    setActivityField(a, 'windowTo', control({ value: '00:00' }));
    setActivityField(a, 'windowFrom', control({ value: '09:00' }));
    assert.deepEqual(a.window, { from: 9, to: 24 });
  });

  it('adds and removes people from an activity without duplicates', () => {
    const a = walk();
    setActivityField(a, 'memberIds', control({ checked: true, dataValue: 'aarav' }));
    setActivityField(a, 'memberIds', control({ checked: true, dataValue: 'aarav' }));
    assert.deepEqual(a.memberIds, ['dadi', 'aarav']);
    setActivityField(a, 'memberIds', control({ checked: false, dataValue: 'dadi' }));
    assert.deepEqual(a.memberIds, ['aarav']);
  });

  it('edits people', () => {
    const m = structuredClone(samplePlan().members[0]);
    setMemberField(m, 'name', control({ value: 'Asha' }));
    setMemberField(m, 'ageGroup', control({ value: 'senior' }));
    setMemberField(m, 'ageGroup', control({ value: 'robot' }));
    setMemberField(m, 'sensitive', control({ checked: true }));
    assert.deepEqual([m.name, m.ageGroup, m.sensitive], ['Asha', 'senior', true]);
  });
});

describe('app state', () => {
  const events = [];
  state.subscribe((kind) => events.push(kind));
  beforeEach(() => {
    events.length = 0;
    state.replacePlan(samplePlan());
    events.length = 0;
  });

  it('remembers the original plan while changes are applied, and can undo', () => {
    const original = state.state.plan;
    const changed = { ...samplePlan(), home: { ...samplePlan().home, windows: 'closed' } };
    state.replacePlan(changed, { keepOriginal: true });
    state.replacePlan({ ...changed }, { keepOriginal: true });
    assert.deepEqual(state.state.original, original, 'keeps a copy of the first original');
    assert.equal(state.restoreOriginal(), true);
    assert.deepEqual(state.state.plan, original);
    assert.equal(state.state.plan.home.windows, 'open');
    assert.equal(state.restoreOriginal(), false, 'nothing left to undo');
    assert.deepEqual(events, ['replaced', 'replaced', 'replaced']);
  });

  it('forgets the undo point when the plan is edited by hand', () => {
    state.replacePlan(samplePlan(), { keepOriginal: true });
    state.planEdited();
    assert.equal(state.state.original, null);
    assert.equal(events.at(-1), 'edited');
  });

  it('saves the plan in the browser', () => {
    state.state.plan.members[0].name = 'Saved';
    state.planEdited();
    assert.match(localStorage.getItem('breathprint:plan:v1'), /"Saved"/);
  });

  it('only offers valid inputs to the calculators', () => {
    state.state.forecast = null;
    assert.equal(state.validInputs(), null, 'no forecast yet');
    state.setForecast(SAMPLE_FORECAST);
    assert.equal(events.at(-1), 'forecast');
    assert.ok(state.validInputs());
    state.state.plan.activities[0].start = 99;
    assert.equal(state.validInputs(), null, 'invalid plan');
  });
});

describe('DOM helpers', () => {
  it('builds elements with text only, skipping empty values', () => {
    const el = h('p', { class: 'x', hidden: false, title: null, dataset: { id: '7' } }, '<b>hi</b>', null, false, 3);
    assert.equal(el.className, 'x');
    assert.equal(el.hasAttribute('hidden'), false);
    assert.equal(el.dataset.id, '7');
    assert.equal(el.innerHTML, '&lt;b&gt;hi&lt;/b&gt;3', 'text is escaped, never parsed');
  });

  it('sets styles through the CSSOM and properties directly', () => {
    let clicked = false;
    const button = h('button', { style: 'width:10px', disabled: true, onclick: () => (clicked = true) });
    assert.equal(button.style.width, '10px');
    assert.equal(button.disabled, true);
    button.disabled = false;
    button.click();
    assert.equal(clicked, true);
  });

  it('converts times and formats numbers', () => {
    assert.equal(toTimeValue(7.5), '07:30');
    assert.equal(fromTimeValue('19:15'), 19.25);
    assert.ok(Number.isNaN(fromTimeValue('nope')));
    assert.equal(fmt(1234.6), '1,235');
    assert.equal(fmt1(2.25), '2.3');
  });

  it('fails loudly on a missing element id', () => {
    assert.equal(byId('main').id, 'main');
    assert.throws(() => byId('no-such-element'), /Missing #no-such-element/);
  });
});

describe('announcements and messages', () => {
  it('announces in a status region, even when the text repeats', async () => {
    const region = document.createElement('p');
    region.textContent = 'Ready';
    components.announce(region, 'Ready');
    assert.equal(region.textContent, '', 'cleared first so it is read again');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(region.textContent, 'Ready');
  });

  it('styles messages and notes', () => {
    assert.equal(components.message('Oops', true).className, 'error');
    assert.equal(components.message('Working').className, 'status');
    assert.equal(components.sourceNote('By Gemini').className, 'source-note');
    assert.equal(components.signedPct(-4.46), '−4.5%');
    assert.equal(components.signedPct(0.01), 'no change');
  });
});

describe('API client', () => {
  afterEach(() => mock.restoreAll());

  it('returns JSON and sends plans as JSON', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('{"places":[]}', { status: 200 }));
    assert.deepEqual(await api.searchPlaces('Delhi & co'), { places: [] });
    assert.match(String(fetchMock.mock.calls[0].arguments[0]), /q=Delhi%20%26%20co/);
    await api.askWhatIf({ a: 1 }, 'q');
    const init = fetchMock.mock.calls[1].arguments[1];
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { plan: { a: 1 }, question: 'q' });
  });

  it('turns server and network failures into friendly errors', async () => {
    mock.method(
      globalThis,
      'fetch',
      async () => new Response('{"error":"Too many requests, please wait a minute."}', { status: 429 }),
    );
    await assert.rejects(api.getForecast(28.6, 77.2), /Too many requests/);
    mock.method(globalThis, 'fetch', async () => new Response('oops', { status: 500 }));
    await assert.rejects(api.getCoach({}, [], 'en'), /Request failed \(500\)/);
    mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('offline');
    });
    await assert.rejects(api.scanPhoto('abc', 'image/jpeg'), /Could not reach the server/);
  });
});

describe('rendering edge cases', () => {
  it('shows gaps in the forecast strip and explains empty impact', async () => {
    const { renderAirStrip } = await import('../public/js/forecast-panel.js');
    const view = await import('../public/js/budget-view.js');
    const engine = await import('../src/engine/index.js');
    const strip = document.createElement('ol');
    renderAirStrip(strip, [null, ...SAMPLE_FORECAST.slice(1)]);
    assert.equal(strip.firstElementChild.getAttribute('aria-label'), '12 AM: no data');

    const day = engine.computeDay(samplePlan(), SAMPLE_FORECAST);
    const el = document.createElement('div');
    view.renderSeason(el, samplePlan(), engine.seasonSavings(day, day, 0));
    assert.match(el.textContent, /smog season .* is over/);
    view.renderSeason(el, samplePlan(), engine.seasonSavings(day, day, 30));
    assert.match(el.textContent, /already close to the cleanest/);
    view.renderRipple(el, engine.communityRipple(day, day, 100));
    assert.match(el.textContent, /nothing to multiply yet/);
    view.renderSuggestions(el, [], () => {});
    assert.match(el.textContent, /already well planned/);
  });

  it('edits effort, transport and smoke source with valid values only', () => {
    const plan = samplePlan();
    const cooking = plan.activities.find((a) => a.id === 'cooking');
    const trip = plan.activities.find((a) => a.id === 'school-run');
    setActivityField(cooking, 'intensity', control({ value: 'moderate' }));
    setActivityField(cooking, 'source', control({ value: 'gas-cooking-exhaust' }));
    setActivityField(trip, 'mode', control({ value: 'metro' }));
    setActivityField(trip, 'distanceKm', control({ value: '7' }));
    setActivityField(trip, 'mode', control({ value: 'hoverboard' }));
    assert.deepEqual(
      [cooking.intensity, cooking.source, trip.mode, trip.distanceKm],
      ['moderate', 'gas-cooking-exhaust', 'metro', 7],
    );
  });
});

describe('storage problems', () => {
  afterEach(() => mock.restoreAll());

  it('keeps working when the browser cannot save', () => {
    mock.method(dom.window.Storage.prototype, 'setItem', () => {
      throw new Error('QuotaExceededError');
    });
    assert.doesNotThrow(() => state.planEdited());
    assert.equal(dom.window.Storage.prototype.setItem.mock.callCount(), 1, 'the save was attempted');
  });

  it('starts from the sample family when the saved plan is missing or corrupt', () => {
    localStorage.removeItem('breathprint:plan:v1');
    assert.deepEqual(state.loadPlan(), samplePlan());
    localStorage.setItem('breathprint:plan:v1', '{not json');
    assert.deepEqual(state.loadPlan(), samplePlan());
  });

  it('restores a valid saved plan', () => {
    const saved = samplePlan();
    saved.members[0].name = 'From storage';
    localStorage.setItem('breathprint:plan:v1', JSON.stringify(saved));
    assert.equal(state.loadPlan().members[0].name, 'From storage');
  });
});
