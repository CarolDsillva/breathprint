// @ts-check
/**
 * The Express app: security, API routes, the static front end and error handling.
 * Services are injected so tests can run fully offline.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { aiRoutes } from './routes/ai.js';
import { airRoutes } from './routes/air.js';
import { rateLimitPerMinute, securityHeaders } from './security.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STATIC_OPTIONS = { maxAge: '1h', index: 'index.html' };

/**
 * @typedef {{
 *   air: ReturnType<typeof import('./services/airQuality.js').createAirQualityService>,
 *   gemini: ReturnType<typeof import('./services/gemini.js').createGemini>,
 *   rateLimitPerMinute?: number,
 *   aiRateLimitPerMinute?: number,
 *   logger?: Pick<Console, 'error'>
 * }} AppDeps
 */

/**
 * Turn any error into a safe JSON response; upstream details are logged, never sent.
 * @param {Pick<Console, 'error'>} logger
 * @returns {import('express').ErrorRequestHandler}
 */
function errorHandler(logger) {
  return (err, _req, res, _next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
    logger.error('[breathprint]', err?.message ?? err);
    res.status(502).json({ error: 'The air data service is not responding. Try again or use the sample day.' });
  };
}

/**
 * Build the Express app with security headers, API routes, static files and errors.
 * @param {AppDeps} deps
 */
export function createApp({
  air,
  gemini,
  rateLimitPerMinute: apiLimit = 120,
  aiRateLimitPerMinute: aiLimit = 15,
  logger = console,
}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Vercel / Cloud Run: one reverse proxy
  app.use(securityHeaders());
  app.use('/api/', rateLimitPerMinute(apiLimit));

  app.get('/api/health', (_req, res) => {
    // aiLastError is a short reason code (e.g. "http-429"), never a key or user data.
    res.json({
      ok: true,
      ai: gemini.enabled ? 'gemini' : 'offline',
      ...(gemini.enabled ? { model: gemini.model } : {}),
      ...(gemini.lastError ? { aiLastError: gemini.lastError } : {}),
    });
  });
  app.use('/api', airRoutes({ air }));
  app.use('/api', aiRoutes({ gemini, limiter: rateLimitPerMinute(aiLimit) }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // The engine is served as-is, so the browser runs exactly the code the tests cover.
  app.use('/engine', express.static(path.join(ROOT, 'src/engine'), STATIC_OPTIONS));
  app.use(express.static(path.join(ROOT, 'public'), STATIC_OPTIONS));

  app.use(errorHandler(logger));
  return app;
}
