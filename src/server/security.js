// @ts-check
/** HTTP security: response headers and rate limits. */
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';

const ONE_MINUTE_MS = 60_000;

/**
 * Browser features the page may use. Location (to find your city) and the camera (for room
 * photos) are allowed for this site only; everything else is switched off.
 */
export const PERMISSIONS_POLICY = [
  'geolocation=(self)',
  'camera=(self)',
  'microphone=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'bluetooth=()',
  'hid=()',
  'midi=()',
  'display-capture=()',
  'fullscreen=(self)',
].join(', ');

/**
 * Helmet with a strict Content-Security-Policy: everything (scripts, styles, fonts, data)
 * from this origin only, no inline code, no framing. Plus a Permissions-Policy.
 * @returns {import('express').RequestHandler[]}
 */
export function securityHeaders() {
  return [
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'font-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'connect-src': ["'self'"],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
    (_req, res, next) => {
      res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
      next();
    },
  ];
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
