// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { isForecast, validatePlan, cleanText } from '../engine/validate.js';
import { LANGUAGES, coach, interpretWhatIf, scanRoom } from './coach.js';
import { decodeImage } from './image.js';
import { TtlCache } from './cache.js';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Build the Express app. Services are injected so tests can run fully offline.
 * @param {{
 *   air: ReturnType<typeof import('./services/airQuality.js').createAirQualityService>,
 *   gemini: ReturnType<typeof import('./services/gemini.js').createGemini>,
 *   rateLimitPerMinute?: number, aiRateLimitPerMinute?: number,
 *   logger?: Pick<Console, 'error'>
 * }} deps
 */
export function createApp({ air, gemini, rateLimitPerMinute = 120, aiRateLimitPerMinute = 15, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Cloud Run / one reverse proxy

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          'img-src': ["'self'", 'data:', 'blob:'],
          'connect-src': ["'self'"],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  const limiter = (/** @type {number} */ limit) => rateLimit({ windowMs: 60_000, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests, please wait a minute.' } });
  app.use('/api/', limiter(rateLimitPerMinute));
  const aiLimiter = limiter(aiRateLimitPerMinute);

  // Room photos are the only large requests: they get their own body limit, every other
  // route keeps 32 KB. Photos are checked, sent to Gemini and never stored or logged.
  app.post('/api/scan', aiLimiter, express.json({ limit: '1600kb' }), async (req, res, next) => {
    if (!gemini.enabled) return res.status(503).json({ error: 'Photo scanning needs the AI service, which is not set up on this server.' });
    const image = decodeImage(req.body?.image, req.body?.mimeType);
    if ('error' in image) return res.status(400).json({ error: image.error });
    try {
      const result = await scanRoom(gemini, image);
      if (!result) return res.status(502).json({ error: 'Could not read that photo. Try another angle.' });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.use(express.json({ limit: '32kb' }));

  // Identical coaching requests (same plan, same air) reuse the last answer for 10 minutes.
  const coachCache = new TtlCache({ ttlMs: 10 * 60_000, max: 300 });

  app.get('/api/health', (_req, res) => {
    // aiLastError is a short reason code (e.g. "http-429"), never a key or user data.
    res.json({
      ok: true,
      ai: gemini.enabled ? 'gemini' : 'offline',
      ...(gemini.enabled ? { model: gemini.model } : {}),
      ...(gemini.lastError ? { aiLastError: gemini.lastError } : {}),
    });
  });

  app.get('/api/places', async (req, res, next) => {
    const q = cleanText(req.query.q, 60);
    if (q.length < 2) return res.status(400).json({ error: 'Type at least 2 letters of a place name.' });
    try {
      res.set('cache-control', 'public, max-age=86400').json({ places: await air.places(q) });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/forecast', async (req, res, next) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!(Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180)) {
      return res.status(400).json({ error: 'Latitude and longitude are out of range.' });
    }
    try {
      res.set('cache-control', 'public, max-age=900').json(await air.forecast(lat, lon));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/coach', aiLimiter, async (req, res, next) => {
    const input = parsePlanAndForecast(req.body);
    if ('error' in input) return res.status(400).json(input);
    const language = Object.hasOwn(LANGUAGES, req.body?.language) ? req.body.language : 'en';
    const key = createHash('sha256').update(JSON.stringify([input.plan, input.forecast, language])).digest('hex');
    try {
      let result = coachCache.get(key);
      if (!result) {
        result = await coach(gemini, input.plan, input.forecast, language);
        coachCache.set(key, result);
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/whatif', aiLimiter, async (req, res, next) => {
    const checked = validatePlan(req.body?.plan);
    if (!checked.ok) return res.status(400).json({ error: 'Invalid plan.', details: checked.errors.slice(0, 5) });
    const question = cleanText(req.body?.question, 200);
    if (question.length < 3) return res.status(400).json({ error: 'Ask a question, e.g. "What if we take the metro?"' });
    try {
      res.json(await interpretWhatIf(gemini, checked.plan, question));
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // Static front end; the engine is served as-is so the browser runs the same code as the tests.
  const staticOpts = { maxAge: '1h', index: 'index.html' };
  app.use('/engine', express.static(path.join(root, 'src/engine'), staticOpts));
  app.use(express.static(path.join(root, 'public'), staticOpts));

  /** @type {import('express').ErrorRequestHandler} */
  const onError = (err, _req, res, _next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
    logger.error('[breathprint]', err?.message ?? err);
    res.status(502).json({ error: 'The air data service is not responding. Try again or use the sample day.' });
  };
  app.use(onError);
  return app;
}

/**
 * @param {any} body
 * @returns {{ plan: import('../engine/dose.js').Plan, forecast: (number | null)[] } | { error: string, details?: string[] }}
 */
function parsePlanAndForecast(body) {
  const checked = validatePlan(body?.plan);
  if (!checked.ok) return { error: 'Invalid plan.', details: checked.errors.slice(0, 5) };
  if (!isForecast(body?.forecast) || body.forecast.filter((/** @type {unknown} */ v) => v !== null).length < 12) {
    return { error: 'Forecast must be 24 hourly PM2.5 values with at least 12 present.' };
  }
  return { plan: checked.plan, forecast: body.forecast };
}
