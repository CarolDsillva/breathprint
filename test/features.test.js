import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLE_FORECAST,
  FINDING_IDS,
  communityRipple,
  computeDay,
  findingsToFixes,
  optimizeDay,
  samplePlan,
  sanitizeScan,
  seasonSavings,
  smogSeasonDaysLeft,
} from '../src/engine/index.js';
import { decodeImage, MAX_IMAGE_BYTES } from '../src/server/image.js';
import { createApp } from '../src/server/app.js';
import { createGemini } from '../src/server/services/gemini.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]).toString('base64');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(60, 1),
]).toString('base64');

function sampleDays() {
  const plan = samplePlan();
  const day = computeDay(plan, SAMPLE_FORECAST);
  const smarter = computeDay(optimizeDay(plan, SAMPLE_FORECAST).plan, SAMPLE_FORECAST);
  return { day, smarter };
}

describe('smog season', () => {
  it('counts days left until 28 February, inclusive', () => {
    assert.equal(smogSeasonDaysLeft(new Date(2026, 10, 27)), 94);
    assert.equal(smogSeasonDaysLeft(new Date(2027, 1, 28)), 1);
    assert.equal(smogSeasonDaysLeft(new Date(2027, 0, 1)), 59);
    assert.equal(smogSeasonDaysLeft(new Date(2026, 9, 15)), 137);
  });
  it('is zero outside the season', () => {
    assert.equal(smogSeasonDaysLeft(new Date(2026, 5, 1)), 0);
    assert.equal(smogSeasonDaysLeft(new Date(2026, 9, 14)), 0);
  });
  it('scales per-person savings by days and never goes negative', () => {
    const { day, smarter } = sampleDays();
    const s = seasonSavings(day, smarter, 10);
    const aarav = s.people.find((p) => p.memberId === 'aarav');
    const i = day.members.findIndex((m) => m.memberId === 'aarav');
    assert.ok(
      Math.abs(aarav.cigarettesAvoided - (day.members[i].cigarettes - smarter.members[i].cigarettes) * 10) < 1e-9,
    );
    assert.ok(s.co2KgAvoided > 0);
    const reversed = seasonSavings(smarter, day, 10);
    assert.ok(reversed.people.every((p) => p.cigarettesAvoided === 0));
    assert.equal(reversed.co2KgAvoided, 0);
  });
});

describe('neighbourhood ripple', () => {
  it('multiplies one family’s savings by the number of families', () => {
    const { day, smarter } = sampleDays();
    const one = communityRipple(day, smarter, 1);
    const hundred = communityRipple(day, smarter, 100);
    assert.ok(Math.abs(hundred.co2KgAvoided - one.co2KgAvoided * 100) < 1e-9);
    assert.ok(Math.abs(hundred.cigarettesAvoided - one.cigarettesAvoided * 100) < 1e-6);
    assert.ok(Math.abs(one.co2KgAvoided - 0.63) < 1e-9, 'sample plan saves 630 g of CO₂');
  });
  it('clamps silly family counts', () => {
    const { day, smarter } = sampleDays();
    assert.equal(communityRipple(day, smarter, -5).families, 0);
    assert.equal(communityRipple(day, smarter, 1e12).families, 1_000_000);
  });
});

describe('smoke detective fixes', () => {
  it('maps findings to plan changes where the plan can show the impact', () => {
    const fixes = findingsToFixes(
      ['gas-stove-no-exhaust', 'incense', 'window-open', 'purifier-present', 'plants'],
      samplePlan(),
    );
    const by = Object.fromEntries(fixes.map((f) => [f.id, f]));
    assert.deepEqual(by['gas-stove-no-exhaust'].change, { activityId: 'cooking', source: 'gas-cooking-exhaust' });
    assert.deepEqual(by.incense.change, { activityId: 'puja', source: 'none' });
    assert.deepEqual(by['window-open'].change, { windows: 'closed' });
    assert.deepEqual(by['purifier-present'].change, { purifier: true });
    assert.equal(by.plants.change, undefined, 'advice only');
    assert.match(by.plants.advice, /almost no PM2\.5/);
  });
  it('explains when the plan has nothing to change', () => {
    const plan = samplePlan();
    plan.activities = plan.activities.filter((a) => a.kind !== 'home');
    plan.home.windows = 'closed';
    const fixes = findingsToFixes(['gas-stove-no-exhaust', 'window-open', 'mosquito-coil'], plan);
    assert.equal(fixes[0].change, undefined);
    assert.match(fixes[0].note, /Add your cooking/);
    assert.equal(fixes[1].change, undefined, 'windows already shut');
    assert.equal(fixes[2].change, undefined);
  });
  it('ignores unknown and duplicate ids', () => {
    assert.deepEqual(
      findingsToFixes(['bogus', 'plants', 'plants'], samplePlan()).map((f) => f.id),
      ['plants'],
    );
  });
  it('keeps only known, cleaned findings from the model', () => {
    const r = sanitizeScan({
      findings: [
        { id: 'incense', evidence: '<b>sticks</b> burning on the shelf' },
        { id: 'incense', evidence: 'duplicate' },
        { id: 'rm -rf', evidence: 'x' },
        { id: 'plants', evidence: 'y'.repeat(500) },
      ],
      summary: 'A puja corner.',
    });
    assert.deepEqual(
      r.findings.map((f) => f.id),
      ['incense', 'plants'],
    );
    assert.doesNotMatch(r.findings[0].evidence, /[<>]/);
    assert.equal(r.findings[1].evidence.length, 140);
    assert.equal(sanitizeScan('nope'), null);
    assert.deepEqual(sanitizeScan({}).findings, []);
  });
  it('caps the number of findings', () => {
    const r = sanitizeScan({ findings: FINDING_IDS.map((id) => ({ id, evidence: '' })) });
    assert.equal(r.findings.length, 8);
  });
});

describe('photo checks', () => {
  it('accepts real JPEG and PNG data', () => {
    assert.deepEqual(decodeImage(JPEG, 'image/jpeg'), { mimeType: 'image/jpeg', data: JPEG });
    assert.equal('error' in decodeImage(PNG, 'image/png'), false);
  });
  it('rejects wrong types, fake signatures, junk and oversized files', () => {
    assert.match(decodeImage(JPEG, 'image/gif').error, /JPEG, PNG or WebP/);
    assert.match(decodeImage(PNG, 'image/jpeg').error, /not the image type/);
    assert.match(decodeImage('not base64!!', 'image/jpeg').error, /could not be read/);
    assert.match(decodeImage(42, 'image/jpeg').error, /could not be read/);
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_IMAGE_BYTES)]).toString('base64');
    assert.match(decodeImage(big, 'image/jpeg').error, /too large/);
  });
});

describe('POST /api/scan', () => {
  /** @type {import('node:http').Server} */
  let server;
  let base = '';
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const text = JSON.stringify({
      findings: [
        { id: 'gas-stove-no-exhaust', evidence: 'stove, no hood above it' },
        { id: 'made-up', evidence: 'x' },
      ],
      summary: 'A small kitchen.',
    });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
  };
  const air = { forecast: async () => ({}), places: async () => [] };
  const post = (body) =>
    fetch(`${base}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  before(async () => {
    const app = createApp({ air, gemini: createGemini({ apiKey: 'k', fetchImpl }), logger: { error() {} } });
    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  it('sends the photo inline to Gemini and returns only known findings', async () => {
    const r = await post({ image: JPEG, mimeType: 'image/jpeg' });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.source, 'gemini');
    assert.deepEqual(
      body.findings.map((f) => f.id),
      ['gas-stove-no-exhaust'],
    );
    const parts = calls[0].contents[0].parts;
    assert.deepEqual(parts[1].inlineData, { mimeType: 'image/jpeg', data: JPEG });
    assert.match(calls[0].systemInstruction.parts[0].text, /not an instruction/);
  });

  it('rejects bad photos before calling Gemini', async () => {
    const before = calls.length;
    assert.equal((await post({ image: PNG, mimeType: 'image/jpeg' })).status, 400);
    assert.equal((await post({ image: JPEG, mimeType: 'text/html' })).status, 400);
    assert.equal(calls.length, before);
  });

  it('allows photo-sized bodies on this route only', async () => {
    const photo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200_000, 7)]).toString('base64');
    assert.equal((await post({ image: photo, mimeType: 'image/jpeg' })).status, 200);
    const big = await fetch(`${base}/api/whatif`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: samplePlan(), question: photo }),
    });
    assert.equal(big.status, 413);
  });

  it('says so when AI is not configured', async () => {
    const app = createApp({ air, gemini: createGemini({ apiKey: '' }), logger: { error() {} } });
    const s = await new Promise((resolve) => {
      const x = app.listen(0, () => resolve(x));
    });
    try {
      const r = await fetch(`http://127.0.0.1:${s.address().port}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: JPEG, mimeType: 'image/jpeg' }),
      });
      assert.equal(r.status, 503);
    } finally {
      s.close();
    }
  });

  it('returns a friendly 502 when Gemini answers nonsense', async () => {
    const app = createApp({
      air,
      gemini: createGemini({ apiKey: 'k', fetchImpl: async () => new Response('{"candidates":[]}') }),
      logger: { error() {} },
    });
    const s = await new Promise((resolve) => {
      const x = app.listen(0, () => resolve(x));
    });
    try {
      const r = await fetch(`http://127.0.0.1:${s.address().port}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: JPEG, mimeType: 'image/jpeg' }),
      });
      assert.equal(r.status, 502);
      assert.match((await r.json()).error, /another angle/);
    } finally {
      s.close();
    }
  });
});

describe('offline support', () => {
  it('caches only files that exist, and every engine module', async () => {
    const { readFile, readdir, access } = await import('node:fs/promises');
    const sw = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
    const shell = [...sw.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]).filter((p) => p !== '/api/');
    for (const p of shell) {
      const file = p === '/' ? 'public/index.html' : p.startsWith('/engine/') ? `src${p}` : `public${p}`;
      await access(new URL(`../${file}`, import.meta.url));
    }
    const engine = (await readdir(new URL('../src/engine/', import.meta.url))).filter((f) => f.endsWith('.js'));
    for (const f of engine) assert.ok(shell.includes(`/engine/${f}`), `sw.js should cache /engine/${f}`);
    const browser = (await readdir(new URL('../public/js/', import.meta.url))).filter((f) => f.endsWith('.js'));
    for (const f of browser) assert.ok(shell.includes(`/js/${f}`), `sw.js should cache /js/${f}`);
  });
});
