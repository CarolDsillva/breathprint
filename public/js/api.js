// @ts-check
/** Calls to the Breathprint server. Every call has a timeout and returns parsed JSON or throws a friendly Error. */

/**
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function request(url, init = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
  return body;
}

/** @param {string} q */
export const searchPlaces = (q) => request(`/api/places?q=${encodeURIComponent(q)}`);

/**
 * @param {number} lat
 * @param {number} lon
 */
export const getForecast = (lat, lon) => request(`/api/forecast?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`);

/**
 * @param {unknown} plan
 * @param {(number | null)[]} forecast
 * @param {string} language
 */
export const getCoach = (plan, forecast, language) => request('/api/coach', { method: 'POST', body: JSON.stringify({ plan, forecast, language }) });

/**
 * @param {unknown} plan
 * @param {string} question
 */
export const askWhatIf = (plan, question) => request('/api/whatif', { method: 'POST', body: JSON.stringify({ plan, question }) });

/**
 * @param {string} image base64 (no data: prefix)
 * @param {string} mimeType
 */
export const scanPhoto = (image, mimeType) => request('/api/scan', { method: 'POST', body: JSON.stringify({ image, mimeType }) });
