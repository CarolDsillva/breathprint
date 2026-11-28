// Edge cases across the engine, server and AI layer: missing data, invalid inputs and failures.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLE_FORECAST,
  findingsToFixes,
  memberDose,
  parseWhatIf,
  samplePlan,
  validatePlan,
} from '../src/engine/index.js';
import { createApp } from '../src/server/app.js';
import { interpretWhatIf } from '../src/server/ai/whatif.js';
import { createGemini } from '../src/server/services/gemini.js';

const answer = (text) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));

describe('engine edge cases', () => {
  it('counts forecast gaps that fall during an activity', () => {
    const plan = samplePlan();
    const pm = [...SAMPLE_FORECAST];
    pm[17] = null; // during cricket practice
    const aarav = plan.members.find((m) => m.id === 'aarav');
    assert.equal(memberDose(plan, aarav, pm).missingHours, 1);
  });

  it('understands "skip" for a smoky home activity', () => {
    assert.deepEqual(parseWhatIf('skip the incense at puja', samplePlan()).change, {
      activityId: 'puja',
      source: 'none',
    });
  });

  it('suggests LPG instead of a wood stove when the plan has one', () => {
    const plan = samplePlan();
    plan.activities.find((a) => a.id === 'cooking').source = 'biomass-cooking';
    const [fix] = findingsToFixes(['biomass-stove'], plan);
    assert.deepEqual(fix.change, { activityId: 'cooking', source: 'gas-cooking-exhaust' });
    const [noPlan] = findingsToFixes(['biomass-stove'], samplePlan());
    assert.match(noPlan.note, /wood\/coal stove/);
  });

  it('rejects impossible sleep hours and windows shorter than the activity', () => {
    const plan = samplePlan();
    plan.sleep = { from: 22, to: 30 };
    plan.activities.find((a) => a.id === 'cricket').window = { from: 14, to: 14.5 };
    const r = validatePlan(plan);
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes('Sleep hours must be between 0 and 23.5.'));
    assert.ok(r.errors.some((e) => /flexible window is shorter/.test(e)));
  });
});

describe('Gemini client failures', () => {
  it('reports an answer that is not JSON', async () => {
    const g = createGemini({ apiKey: 'k', fetchImpl: async () => answer('Sure! Here you go.') });
    await assert.rejects(g.generateJson({ system: 's', prompt: 'p' }), /bad-json/);
    assert.equal(g.lastError, 'bad-json');
  });

  it('reports blocked prompts and network failures', async () => {
    const blocked = createGemini({
      apiKey: 'k',
      fetchImpl: async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })),
    });
    await assert.rejects(blocked.generateJson({ system: 's', prompt: 'p' }), /blocked/);
    const offline = createGemini({
      apiKey: 'k',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await assert.rejects(offline.generateJson({ system: 's', prompt: 'p' }), /network/);
    assert.equal(offline.lastError, 'network');
  });

  it('a failing what-if call falls back to the offline parser', async () => {
    const ai = { enabled: true, generateJson: async () => Promise.reject(new Error('quota')) };
    const r = await interpretWhatIf(ai, samplePlan(), 'school run by metro');
    assert.equal(r.source, 'offline');
    assert.deepEqual(r.change, { activityId: 'school-run', mode: 'metro' });
  });
});

describe('server error handling', () => {
  it('turns a failed place search into a friendly 502', async () => {
    const air = {
      places: async () => Promise.reject(new Error('upstream down')),
      forecast: async () => ({}),
    };
    const errors = [];
    const app = createApp({ air, gemini: createGemini({ apiKey: '' }), logger: { error: (...a) => errors.push(a) } });
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    try {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/places?q=Delhi`);
      assert.equal(r.status, 502);
      assert.doesNotMatch((await r.json()).error, /upstream down/);
      assert.equal(errors.length, 1, 'the detail is logged on the server');
    } finally {
      server.close();
    }
  });
});

describe('server settings', () => {
  it('reads valid settings', async () => {
    const { readConfig } = await import('../src/server/config.js');
    assert.deepEqual(readConfig({ PORT: '3000', GEMINI_API_KEY: ' key ', GEMINI_MODEL: 'gemini-flash-latest' }), {
      port: 3000,
      geminiApiKey: 'key',
      geminiModel: 'gemini-flash-latest',
      warnings: [],
    });
  });

  it('falls back to safe defaults with a warning', async () => {
    const { readConfig } = await import('../src/server/config.js');
    const config = readConfig({ PORT: 'eighty', GEMINI_API_KEY: '  ', GEMINI_MODEL: '../../etc' });
    assert.equal(config.port, 8080);
    assert.equal(config.geminiApiKey, undefined, 'a blank key means offline mode');
    assert.equal(config.geminiModel, undefined);
    assert.equal(config.warnings.length, 2);
    assert.equal(readConfig({}).port, 8080);
  });
});
