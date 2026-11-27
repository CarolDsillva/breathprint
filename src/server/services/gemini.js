// @ts-check
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 15000;

/** Fast, low-cost default; the full Flash model is the backup if Flash-Lite is unavailable. */
export const DEFAULT_MODEL = 'gemini-flash-lite-latest';
export const FALLBACK_MODEL = 'gemini-flash-latest';

/**
 * Room for the answer. Newer Gemini models "think" before answering, and on some models
 * thinking counts toward the output limit, so the limit is generous and thinking is set low.
 */
const MIN_OUTPUT_TOKENS = 2048;

/**
 * The parts of a generateContent response we read. Untrusted: every field is optional.
 * @typedef {{ text?: unknown, thought?: unknown }} ResponsePart
 * @typedef {{ content?: { parts?: ResponsePart[] }, finishReason?: unknown }} Candidate
 * @typedef {{ candidates?: Candidate[], promptFeedback?: { blockReason?: unknown } }} GenerateResponse
 */

/** A Gemini failure with a short, non-sensitive reason code (e.g. "http-429", "truncated"). */
export class GeminiError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(`Gemini call failed: ${code}`);
    this.code = code;
  }
}

/**
 * Minimal Gemini client: one JSON-mode generateContent call. The API key is sent in a header,
 * never in the URL, and never leaves the server. The last failure reason (a short code, never
 * the key or any user data) is kept for the health check and the logs.
 * @param {{ apiKey?: string, model?: string, fallbackModel?: string, fetchImpl?: typeof fetch, logger?: Pick<Console, 'warn'> }} opts
 */
export function createGemini({
  apiKey,
  model = DEFAULT_MODEL,
  fallbackModel = FALLBACK_MODEL,
  fetchImpl = fetch,
  logger,
}) {
  const enabled = Boolean(apiKey);
  const state = { lastError: /** @type {string | null} */ (null) };

  let activeModel = model;

  /**
   * @param {object} body
   * @param {string} [useModel]
   */
  async function call(body, useModel = activeModel) {
    const res = await fetchImpl(`${API}/${encodeURIComponent(useModel)}:generateContent`, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': /** @type {string} */ (apiKey) },
      body: JSON.stringify(body),
    });
    return res;
  }

  return {
    enabled,
    /** The model currently in use (switches to the backup if the first is not found). */
    get model() {
      return activeModel;
    },
    /** Short code for the most recent failure, or null after a success. */
    get lastError() {
      return state.lastError;
    },
    /**
     * @param {{ system: string, prompt: string, maxTokens?: number, image?: { mimeType: string, data: string } }} req
     *   `image` is base64 data sent inline (used for room photos).
     * @returns {Promise<unknown>} parsed JSON from the model
     */
    async generateJson({ system, prompt, maxTokens = MIN_OUTPUT_TOKENS, image }) {
      if (!enabled) throw new GeminiError('not-configured');
      try {
        const res = await send(buildRequest({ system, prompt, maxTokens, image }));
        const parsed = await readJsonAnswer(res);
        state.lastError = null;
        return parsed;
      } catch (err) {
        const code = failureCode(err);
        state.lastError = code;
        logger?.warn(`[gemini] ${code}`);
        throw err instanceof GeminiError ? err : new GeminiError(code);
      }
    },
  };

  /**
   * Send a request, recovering from two known problems: a model name this key cannot use
   * (switch to the backup model for good) and models that reject thinkingConfig (retry once
   * without it).
   * @param {ReturnType<typeof buildRequest>} request
   */
  async function send(request) {
    let res = await call(request);
    if (res.status === 404 && activeModel !== fallbackModel) {
      logger?.warn(`[gemini] model ${activeModel} not found, using ${fallbackModel}`);
      activeModel = fallbackModel;
      res = await call(request);
    }
    if (res.status === 400) {
      const { thinkingConfig: _ignored, ...plainConfig } = request.generationConfig;
      res = await call({ ...request, generationConfig: plainConfig });
    }
    return res;
  }
}

/**
 * The generateContent request body: JSON output, low thinking, room for the answer.
 * @param {{ system: string, prompt: string, maxTokens: number, image?: { mimeType: string, data: string } }} req
 */
function buildRequest({ system, prompt, maxTokens, image }) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }, ...(image ? [{ inlineData: image }] : [])] }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: Math.max(maxTokens, MIN_OUTPUT_TOKENS),
      thinkingConfig: { thinkingLevel: 'low' },
    },
  };
}

/**
 * Read the model's JSON answer, or throw a GeminiError saying why it is unusable.
 * @param {Response} res
 * @returns {Promise<unknown>}
 */
async function readJsonAnswer(res) {
  if (!res.ok) throw new GeminiError(`http-${res.status}`);
  const body = /** @type {GenerateResponse | null} */ (await res.json());
  const candidate = body?.candidates?.[0];
  if (!candidate) throw new GeminiError(body?.promptFeedback?.blockReason ? 'blocked' : 'no-candidate');
  if (candidate.finishReason === 'MAX_TOKENS') throw new GeminiError('truncated');
  const text = (candidate.content?.parts ?? [])
    .filter((part) => !part?.thought)
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
  try {
    return JSON.parse(stripFences(text));
  } catch {
    throw new GeminiError('bad-json');
  }
}

/**
 * Short reason code for any failure.
 * @param {unknown} err
 */
function failureCode(err) {
  if (err instanceof GeminiError) return err.code;
  if (err instanceof Error && err.name === 'TimeoutError') return 'timeout';
  return 'network';
}

/** @param {string} s */
function stripFences(s) {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '');
}
