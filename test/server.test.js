import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server/app.js';
import { TtlCache, cached } from '../src/server/cache.js';
import { createAirQualityService, parseForecast } from '../src/server/services/airQuality.js';
import { createGemini } from '../src/server/services/gemini.js';
import { buildFacts, sanitizeBriefing, templateBriefing } from '../src/server/ai/briefing.js';
import { SAMPLE_FORECAST, samplePlan } from '../src/engine/index.js';

/** Open-Meteo-shaped body for two local days. */
function openMeteoBody() {
  const time = [];
  const pm = [];
  for (const date of ['2026-12-01', '2026-12-02']) {
    for (let h = 0; h < 24; h++) {
      time.push(`${date}T${String(h).padStart(2, '0')}:00`);
      pm.push(100 + h);
    }
  }
  return { timezone: 'Asia/Kolkata', hourly: { time, pm2_5: pm, us_aqi: pm.map((v) => v + 50) } };
}

/** fetch stub that records calls and answers from a routing function. */
function stubFetch(route) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const { status = 200, body } = await route(String(url), init);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}

/**
 * Start an app on a random port.
 * @param {{ gemini?: any, air?: any, rateLimitPerMinute?: number, aiRateLimitPerMinute?: number }} [opts]
 */
async function start(opts = {}) {
  const airFetch = stubFetch((url) =>
    url.includes('geocoding')
      ? { body: { results: [{ name: 'Delhi', admin1: 'Delhi', country: 'India', latitude: 28.65, longitude: 77.23 }] } }
      : { body: openMeteoBody() },
  );
  const app = createApp({
    air: opts.air ?? createAirQualityService({ fetchImpl: airFetch }),
    gemini: opts.gemini ?? createGemini({ apiKey: '' }),
    rateLimitPerMinute: opts.rateLimitPerMinute,
    aiRateLimitPerMinute: opts.aiRateLimitPerMinute,
    logger: { error() {} },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, server, airFetch };
}

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('HTTP API (offline AI)', () => {
  let ctx;
  before(async () => {
    ctx = await start();
  });
  after(() => ctx.server.close());

  it('reports health and AI mode', async () => {
    const r = await fetch(`${ctx.base}/api/health`);
    assert.deepEqual(await r.json(), { ok: true, ai: 'offline' });
  });

  it('sends security headers and a strict CSP', async () => {
    const r = await fetch(`${ctx.base}/`);
    assert.equal(r.status, 200);
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-powered-by'), null);
  });

  it('serves the shared engine to the browser', async () => {
    const r = await fetch(`${ctx.base}/engine/dose.js`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /javascript/);
  });

  it('returns forecasts grouped into days and caches them', async () => {
    const a = await (await fetch(`${ctx.base}/api/forecast?lat=28.61&lon=77.21`)).json();
    await fetch(`${ctx.base}/api/forecast?lat=28.64&lon=77.24`); // same ~11 km cell
    assert.equal(a.days.length, 2);
    assert.equal(a.days[0].pm25.length, 24);
    assert.equal(a.days[1].pm25[5], 105);
    assert.equal(ctx.airFetch.calls.filter((c) => c.url.includes('air-quality')).length, 1);
  });

  it('validates coordinates and search text', async () => {
    assert.equal((await fetch(`${ctx.base}/api/forecast?lat=999&lon=0`)).status, 400);
    assert.equal((await fetch(`${ctx.base}/api/forecast?lat=abc&lon=0`)).status, 400);
    assert.equal((await fetch(`${ctx.base}/api/places?q=a`)).status, 400);
    const places = await (await fetch(`${ctx.base}/api/places?q=Delhi`)).json();
    assert.equal(places.places[0].name, 'Delhi');
  });

  it('writes an offline briefing grounded in engine numbers', async () => {
    const r = await post(`${ctx.base}/api/coach`, { plan: samplePlan(), forecast: SAMPLE_FORECAST, language: 'en' });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.source, 'template');
    assert.match(body.summary, /300 µg\/m³/);
    assert.ok(body.tips.length >= 2);
  });

  it('rejects invalid plans, forecasts and bodies', async () => {
    assert.equal((await post(`${ctx.base}/api/coach`, { plan: {}, forecast: SAMPLE_FORECAST })).status, 400);
    assert.equal((await post(`${ctx.base}/api/coach`, { plan: samplePlan(), forecast: [1, 2, 3] })).status, 400);
    const bad = await fetch(`${ctx.base}/api/coach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    });
    assert.equal(bad.status, 400);
    const huge = await post(`${ctx.base}/api/whatif`, { plan: samplePlan(), question: 'x'.repeat(50_000) });
    assert.equal(huge.status, 413);
  });

  it('answers what-if questions with the offline parser', async () => {
    const r = await (
      await post(`${ctx.base}/api/whatif`, { plan: samplePlan(), question: 'What if the school run is by metro?' })
    ).json();
    assert.equal(r.source, 'offline');
    assert.deepEqual(r.change, { activityId: 'school-run', mode: 'metro' });
    const none = await (
      await post(`${ctx.base}/api/whatif`, { plan: samplePlan(), question: 'tell me a joke' })
    ).json();
    assert.equal(none.change, null);
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const r = await fetch(`${ctx.base}/api/nope`);
    assert.equal(r.status, 404);
    assert.ok((await r.json()).error);
  });
});

describe('HTTP API with Gemini', () => {
  it('uses Gemini text when it is well-formed, and keeps the key out of the URL', async () => {
    const fetchImpl = stubFetch(() => ({
      body: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"summary":"Stay in till 2 PM.","tips":["Shut windows: 26% less smog.","Metro: 630 g less CO2."]}',
                },
              ],
            },
          },
        ],
      },
    }));
    const ctx = await start({ gemini: createGemini({ apiKey: 'test-key', model: 'm', fetchImpl }) });
    try {
      const body = await (
        await post(`${ctx.base}/api/coach`, { plan: samplePlan(), forecast: SAMPLE_FORECAST, language: 'hi' })
      ).json();
      assert.equal(body.source, 'gemini');
      assert.equal(body.tips.length, 2);
      const call = fetchImpl.calls[0];
      assert.doesNotMatch(call.url, /test-key/);
      assert.equal(call.init.headers['x-goog-api-key'], 'test-key');
      assert.match(JSON.parse(call.init.body).contents[0].parts[0].text, /Hindi/);
      // Same request again is served from cache.
      await post(`${ctx.base}/api/coach`, { plan: samplePlan(), forecast: SAMPLE_FORECAST, language: 'hi' });
      assert.equal(fetchImpl.calls.length, 1);
    } finally {
      ctx.server.close();
    }
  });

  it('falls back when Gemini fails or proposes something impossible', async () => {
    const fetchImpl = stubFetch((url, init) => {
      const prompt = JSON.parse(init.body).contents[0].parts[0].text;
      return prompt.includes('QUESTION')
        ? { body: { candidates: [{ content: { parts: [{ text: '{"activityId":"office-trip","mode":"walk"}' }] } }] } } // 12 km walk: infeasible
        : { status: 500, body: {} };
    });
    const ctx = await start({ gemini: createGemini({ apiKey: 'k', fetchImpl }) });
    try {
      const coach = await (
        await post(`${ctx.base}/api/coach`, { plan: samplePlan(), forecast: SAMPLE_FORECAST })
      ).json();
      assert.equal(coach.source, 'template');
      const w = await (
        await post(`${ctx.base}/api/whatif`, { plan: samplePlan(), question: 'office commute by metro' })
      ).json();
      assert.equal(w.source, 'offline');
      assert.deepEqual(w.change, { activityId: 'office-trip', mode: 'metro' });
    } finally {
      ctx.server.close();
    }
  });

  it('rate-limits the AI endpoints', async () => {
    const ctx = await start({ aiRateLimitPerMinute: 2 });
    try {
      const codes = [];
      for (let i = 0; i < 3; i++)
        codes.push(
          (await post(`${ctx.base}/api/whatif`, { plan: samplePlan(), question: 'school run by bus' })).status,
        );
      assert.deepEqual(codes, [200, 200, 429]);
    } finally {
      ctx.server.close();
    }
  });

  it('hides upstream errors behind a friendly 502', async () => {
    const air = createAirQualityService({ fetchImpl: stubFetch(() => ({ status: 503, body: {} })) });
    const ctx = await start({ air });
    try {
      const r = await fetch(`${ctx.base}/api/forecast?lat=1&lon=1`);
      assert.equal(r.status, 502);
      assert.doesNotMatch((await r.json()).error, /503/);
    } finally {
      ctx.server.close();
    }
  });
});

describe('server helpers', () => {
  it('cache expires entries and evicts the least recently used', () => {
    let now = 0;
    const c = new TtlCache({ ttlMs: 100, max: 2, now: () => now });
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    assert.equal(c.get('b'), undefined, 'b was least recently used');
    assert.equal(c.get('a'), 1);
    now = 200;
    assert.equal(c.get('a'), undefined, 'expired');
  });

  it('shares one in-flight request between concurrent callers', async () => {
    let loads = 0;
    const get = cached(new TtlCache({ ttlMs: 1000, max: 10 }), async (k) => {
      loads++;
      return k;
    });
    await Promise.all([get('x'), get('x'), get('x')]);
    assert.equal(loads, 1);
  });

  it('parses forecasts defensively', () => {
    assert.throws(() => parseForecast({}), /Unexpected/);
    const f = parseForecast({ hourly: { time: ['2026-12-01T03:00', 'garbage'], pm2_5: [55.55, 1] } });
    assert.equal(f.days[0].pm25[3], 55.6);
    assert.equal(f.days[0].pm25[4], null);
  });

  it('accepts only well-formed briefing text', () => {
    assert.equal(sanitizeBriefing({ summary: 'x' }), null);
    assert.equal(sanitizeBriefing('nope'), null);
    const ok = sanitizeBriefing({ summary: '<b>Hi</b>', tips: ['a', 5, 'b', 'c', 'd', 'e'] });
    assert.equal(ok.summary, 'bHi/b');
    assert.equal(ok.tips.length, 4);
  });

  it('template briefing uses only computed facts', () => {
    const facts = buildFacts(samplePlan(), SAMPLE_FORECAST);
    const t = templateBriefing(facts);
    assert.match(t.summary, new RegExp(String(facts.airThatDay.worstPm25)));
    assert.equal(t.tips.length, Math.min(4, facts.suggestions.length));
  });
});

describe('Gemini client robustness', () => {
  const ok = (text, extra = {}) =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, ...extra }] }));

  it('asks for low thinking and enough output room', async () => {
    let body;
    const g = createGemini({
      apiKey: 'k',
      fetchImpl: async (_u, init) => {
        body = JSON.parse(init.body);
        return ok('{"a":1}');
      },
    });
    assert.deepEqual(await g.generateJson({ system: 's', prompt: 'p', maxTokens: 200 }), { a: 1 });
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'low');
    assert.ok(body.generationConfig.maxOutputTokens >= 2048);
    assert.equal(g.lastError, null);
  });

  it('retries once without thinkingConfig when a model rejects it', async () => {
    const bodies = [];
    const g = createGemini({
      apiKey: 'k',
      fetchImpl: async (_u, init) => {
        bodies.push(JSON.parse(init.body));
        return bodies.length === 1 ? new Response('{}', { status: 400 }) : ok('{"b":2}');
      },
    });
    assert.deepEqual(await g.generateJson({ system: 's', prompt: 'p' }), { b: 2 });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].generationConfig.thinkingConfig, undefined);
  });

  it('ignores thought parts and reports cut-off answers', async () => {
    const thoughtful = createGemini({
      apiKey: 'k',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: '{"c":3}' }] } }],
          }),
        ),
    });
    assert.deepEqual(await thoughtful.generateJson({ system: 's', prompt: 'p' }), { c: 3 });

    const warnings = [];
    const cut = createGemini({
      apiKey: 'k',
      logger: { warn: (m) => warnings.push(m) },
      fetchImpl: async () => ok('{"summary": "half', { finishReason: 'MAX_TOKENS' }),
    });
    await assert.rejects(cut.generateJson({ system: 's', prompt: 'p' }), /truncated/);
    assert.equal(cut.lastError, 'truncated');
    assert.deepEqual(warnings, ['[gemini] truncated']);
  });

  it('shows the last failure code in the health check, without secrets', async () => {
    const gemini = createGemini({
      apiKey: 'secret-key',
      logger: { warn() {} },
      fetchImpl: async () => new Response('{}', { status: 429 }),
    });
    const ctx = await start({ gemini });
    try {
      await post(`${ctx.base}/api/coach`, { plan: samplePlan(), forecast: SAMPLE_FORECAST });
      const text = await (await fetch(`${ctx.base}/api/health`)).text();
      assert.deepEqual(JSON.parse(text), {
        ok: true,
        ai: 'gemini',
        model: 'gemini-flash-lite-latest',
        aiLastError: 'http-429',
      });
      assert.doesNotMatch(text, /secret-key/);
    } finally {
      ctx.server.close();
    }
  });
});

describe('Gemini model choice', () => {
  it('defaults to Flash-Lite and switches to the backup model if it is not found', async () => {
    const urls = [];
    const g = createGemini({
      apiKey: 'k',
      logger: { warn() {} },
      fetchImpl: async (url) => {
        urls.push(String(url));
        return String(url).includes('flash-lite')
          ? new Response('{}', { status: 404 })
          : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }));
      },
    });
    assert.equal(g.model, 'gemini-flash-lite-latest');
    assert.deepEqual(await g.generateJson({ system: 's', prompt: 'p' }), { ok: true });
    assert.equal(g.model, 'gemini-flash-latest');
    await g.generateJson({ system: 's', prompt: 'p' });
    assert.equal(urls.filter((u) => u.includes('flash-lite')).length, 1, 'remembers the switch');
  });
});
