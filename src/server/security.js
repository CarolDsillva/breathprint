// @ts-check
/** HTTP security: response headers and rate limits. */
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';

const ONE_MINUTE_MS = 60_000;

/**
 * Helmet with a strict Content-Security-Policy: scripts and styles only from this origin
 * (fonts from Google Fonts), no inline code, no framing.
 */
export function securityHeaders() {
  return helmet({
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
  });
}

/**
 * Per-IP limit of `perMinute` requests, answered with a JSON error when exceeded.
 * @param {number} perMinute
 */
export function rateLimitPerMinute(perMinute) {
  return rateLimit({
    windowMs: ONE_MINUTE_MS,
    limit: perMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests, please wait a minute.' },
  });
}
