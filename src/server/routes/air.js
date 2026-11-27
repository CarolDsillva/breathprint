// @ts-check
/** Air-data routes: place search and hourly PM2.5 forecasts. Express 5 forwards async errors. */
import { Router } from 'express';
import { cleanText } from '../../engine/validate.js';

const ONE_DAY_S = 86_400;
const FIFTEEN_MINUTES_S = 900;

/**
 * @param {{ air: ReturnType<typeof import('../services/airQuality.js').createAirQualityService> }} deps
 */
export function airRoutes({ air }) {
  const router = Router();

  router.get('/places', async (req, res) => {
    const query = cleanText(req.query.q, 60);
    if (query.length < 2) return res.status(400).json({ error: 'Type at least 2 letters of a place name.' });
    res.set('cache-control', `public, max-age=${ONE_DAY_S}`).json({ places: await air.places(query) });
  });

  router.get('/forecast', async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const valid = Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180;
    if (!valid) return res.status(400).json({ error: 'Latitude and longitude are out of range.' });
    res.set('cache-control', `public, max-age=${FIFTEEN_MINUTES_S}`).json(await air.forecast(lat, lon));
  });

  return router;
}
