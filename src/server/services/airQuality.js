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
  /**
   * GET a JSON document with a timeout, failing on non-2xx answers.
   * @param {string | URL} url
   */
  async function getJson(url) {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new UpstreamError(`Air data service answered ${res.status}`);
    return res.json();
  }

  /** @type {TtlCache<Forecast>} */
  const forecastCache = new TtlCache({ ttlMs: 30 * 60_000, max: 500, now });
  const loadForecast = cached(forecastCache, async (key) => {
    const [lat, lon] = key.split(',');
    const url = new URL(FORECAST_URL);
    url.search = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      hourly: 'pm2_5,us_aqi',
      timezone: 'auto',
      forecast_days: '2',
    }).toString();
    return parseForecast(await getJson(url));
  });

  /** @type {TtlCache<Place[]>} */
  const placeCache = new TtlCache({ ttlMs: 24 * 60 * 60_000, max: 500, now });
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
 * Upstream responses, as far as we rely on them. Every field is optional because the JSON is
 * untrusted: the parsers check each value before using it.
 * @typedef {{ timezone?: unknown, hourly?: { time?: unknown, pm2_5?: unknown, us_aqi?: unknown } }} OpenMeteoForecast
 * @typedef {{ name?: unknown, admin1?: unknown, country?: unknown, latitude?: unknown, longitude?: unknown }} OpenMeteoPlace
 */

/**
 * Group Open-Meteo's flat hourly arrays into 24-hour local days.
 * @param {OpenMeteoForecast | null | undefined} body
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
    let day = days.get(date);
    if (!day) {
      day = { date, pm25: new Array(24).fill(null), aqi: new Array(24).fill(null) };
      days.set(date, day);
    }
    day.pm25[hour] = toNum(pm[i]);
    day.aqi[hour] = Array.isArray(aqi) ? toNum(aqi[i]) : null;
  });
  return { timezone: typeof body?.timezone === 'string' ? body.timezone : 'UTC', days: [...days.values()] };
}

/**
 * Keep only places with real coordinates.
 * @param {{ results?: unknown } | null | undefined} body
 * @returns {Place[]}
 */
export function parsePlaces(body) {
  /** @type {OpenMeteoPlace[]} */
  const results = Array.isArray(body?.results) ? body.results : [];
  /** @type {Place[]} */
  const places = [];
  for (const r of results) {
    const lat = r?.latitude;
    const lon = r?.longitude;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    places.push({
      name: String(r.name ?? ''),
      region: String(r.admin1 ?? ''),
      country: String(r.country ?? ''),
      lat,
      lon,
    });
  }
  return places;
}

/**
 * A finite number rounded to 0.1, or null.
 * @param {unknown} v
 */
function toNum(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}
