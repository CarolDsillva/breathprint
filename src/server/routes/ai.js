// @ts-check
/**
 * AI routes: family briefing, what-if questions and room-photo scans. Each has its own body
 * limit: 32 KB for plans and questions, 1.6 MB only for photos.
 */
import { createHash } from 'node:crypto';
import express, { Router } from 'express';
import { cleanText, isForecast, validatePlan } from '../../engine/validate.js';
import { LANGUAGES, writeBriefing } from '../ai/briefing.js';
import { scanRoom } from '../ai/roomScan.js';
import { interpretWhatIf } from '../ai/whatif.js';
import { TtlCache } from '../cache.js';
import { decodeImage } from '../image.js';

const SMALL_BODY = express.json({ limit: '32kb' });
const PHOTO_BODY = express.json({ limit: '1600kb' });
const BRIEFING_CACHE_MS = 10 * 60_000;
const MIN_FORECAST_HOURS = 12;

/** @typedef {import('../../engine/dose.js').Plan} Plan */

/**
 * Read a JSON body as a plain record so every field is checked before use.
 * @param {unknown} body
 * @returns {Record<string, unknown>}
 */
const fields = (body) =>
  typeof body === 'object' && body !== null ? /** @type {Record<string, unknown>} */ (body) : {};

/**
 * Validate the plan and forecast sent for a briefing.
 * @param {Record<string, unknown>} body
 * @returns {{ plan: Plan, forecast: (number | null)[] } | { error: string, details?: string[] }}
 */
function parsePlanAndForecast(body) {
  const checked = validatePlan(body.plan);
  if (!checked.ok) return { error: 'Invalid plan.', details: checked.errors.slice(0, 5) };
  const { forecast } = body;
  if (!isForecast(forecast) || forecast.filter((v) => v !== null).length < MIN_FORECAST_HOURS) {
    return { error: 'Forecast must be 24 hourly PM2.5 values with at least 12 present.' };
  }
  return { plan: checked.plan, forecast };
}

/**
 * @param {{ gemini: ReturnType<typeof import('../services/gemini.js').createGemini>, limiter: import('express').RequestHandler }} deps
 */
export function aiRoutes({ gemini, limiter }) {
  const router = Router();
  // Same plan + same air + same language → reuse the last briefing for 10 minutes.
  const briefingCache = new TtlCache({ ttlMs: BRIEFING_CACHE_MS, max: 300 });

  router.post('/coach', limiter, SMALL_BODY, async (req, res, next) => {
    const body = fields(req.body);
    const input = parsePlanAndForecast(body);
    if ('error' in input) return res.status(400).json(input);
    const language =
      typeof body.language === 'string' && Object.hasOwn(LANGUAGES, body.language)
        ? /** @type {keyof typeof LANGUAGES} */ (body.language)
        : 'en';
    const key = createHash('sha256')
      .update(JSON.stringify([input.plan, input.forecast, language]))
      .digest('hex');
    try {
      let result = briefingCache.get(key);
      if (!result) {
        result = await writeBriefing(gemini, input.plan, input.forecast, language);
        briefingCache.set(key, result);
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/whatif', limiter, SMALL_BODY, async (req, res, next) => {
    const body = fields(req.body);
    const checked = validatePlan(body.plan);
    if (!checked.ok) return res.status(400).json({ error: 'Invalid plan.', details: checked.errors.slice(0, 5) });
    const question = cleanText(body.question, 200);
    if (question.length < 3)
      return res.status(400).json({ error: 'Ask a question, e.g. "What if we take the metro?"' });
    try {
      res.json(await interpretWhatIf(gemini, checked.plan, question));
    } catch (err) {
      next(err);
    }
  });

  // Photos are checked, sent to Gemini and never stored or logged.
  router.post('/scan', limiter, PHOTO_BODY, async (req, res, next) => {
    if (!gemini.enabled) {
      return res
        .status(503)
        .json({ error: 'Photo scanning needs the AI service, which is not set up on this server.' });
    }
    const body = fields(req.body);
    const image = decodeImage(body.image, body.mimeType);
    if ('error' in image) return res.status(400).json({ error: image.error });
    try {
      const result = await scanRoom(gemini, image);
      if (!result) return res.status(502).json({ error: 'Could not read that photo. Try another angle.' });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
