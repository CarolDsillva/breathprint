// @ts-check
import { TtlCache, cached } from '../cache.js';

const FORECAST_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const TIMEOUT_MS = 8000;

export class UpstreamError extends Error {}

/**
 * Hourly PM2.5 forecasts and place search from Open-Meteo (CAMS model, free, no key).
 * Results are cached: forecasts per ~11 km grid cell for 30 minutes, place searches for a day.
 * @param {{ fetchImpl?: typeof fetch, now?: () => number }} [deps]
 */
export function createAirQualityService({ fetchImpl = fetch, now = Date.now } = {}) {
  /** @param {string | URL} url */
  async function getJson(url) {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
    if (!res.ok) throw new UpstreamError(`Air data service answered ${res.status}`);
    return res.json();
  }

  const forecastCache = /** @type {TtlCache<Forecast>} */ (new TtlCache({ ttlMs: 30 * 60_000, max: 500, now }));
  const loadForecast = cached(forecastCache, async (key) => {
    const [lat, lon] = key.split(',');
    const url = new URL(FORECAST_URL);
    url.search = new URLSearchParams({ latitude: lat, longitude: lon, hourly: 'pm2_5,us_aqi', timezone: 'auto', forecast_days: '2' }).toString();
    return parseForecast(await getJson(url));
  });

  const placeCache = /** @type {TtlCache<Place[]>} */ (new TtlCache({ ttlMs: 24 * 60 * 60_000, max: 500, now }));
  const loadPlaces = cached(placeCache, async (q) => {
    const url = new URL(GEOCODE_URL);
    url.search = new URLSearchParams({ name: q, count: '5', language: 'en', format: 'json' }).toString();
    return parsePlaces(await getJson(url));
  });

  return {
    /**
     * @param {number} lat
     * @param {number} lon
     */
    forecast(lat, lon) {
      // Round to 0.1° (~11 km): the model grid is coarser, so nearby users share a cache entry.
      return loadForecast(`${lat.toFixed(1)},${lon.toFixed(1)}`);
    },
    /** @param {string} query */
    places(query) {
      return loadPlaces(query.toLowerCase());
    },
  };
}

/**
 * @typedef {{ timezone: string, days: { date: string, pm25: (number | null)[], aqi: (number | null)[] }[] }} Forecast
 * @typedef {{ name: string, region: string, country: string, lat: number, lon: number }} Place
 */

/**
 * Group Open-Meteo's flat hourly arrays into 24-hour local days.
 * @param {any} body
 * @returns {Forecast}
 */
export function parseForecast(body) {
  const times = body?.hourly?.time;
  const pm = body?.hourly?.pm2_5;
  const aqi = body?.hourly?.us_aqi;
  if (!Array.isArray(times) || !Array.isArray(pm)) throw new UpstreamError('Unexpected forecast format');
  /** @type {Map<string, { date: string, pm25: (number | null)[], aqi: (number | null)[] }>} */
  const days = new Map();
  times.forEach((t, i) => {
    if (typeof t !== 'string') return;
    const [date, clock] = t.split('T');
    const hour = Number(clock?.slice(0, 2));
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
    if (!days.has(date)) days.set(date, { date, pm25: new Array(24).fill(null), aqi: new Array(24).fill(null) });
    const day = /** @type {NonNullable<ReturnType<typeof days.get>>} */ (days.get(date));
    day.pm25[hour] = toNum(pm[i]);
    day.aqi[hour] = Array.isArray(aqi) ? toNum(aqi[i]) : null;
  });
  return { timezone: typeof body.timezone === 'string' ? body.timezone : 'UTC', days: [...days.values()] };
}

/**
 * @param {any} body
 * @returns {Place[]}
 */
export function parsePlaces(body) {
  const results = Array.isArray(body?.results) ? body.results : [];
  return results
    .filter((r) => Number.isFinite(r?.latitude) && Number.isFinite(r?.longitude))
    .map((r) => ({
      name: String(r.name ?? ''),
      region: String(r.admin1 ?? ''),
      country: String(r.country ?? ''),
      lat: r.latitude,
      lon: r.longitude,
    }));
}

/** @param {unknown} v */
function toNum(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}
