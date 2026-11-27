// @ts-check
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 20000;

/**
 * Room for the answer. Newer Gemini models "think" before answering, and on some models
 * thinking counts toward the output limit, so the limit is generous and thinking is set low.
 */
const MIN_OUTPUT_TOKENS = 2048;

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
 * @param {{ apiKey?: string, model?: string, fetchImpl?: typeof fetch, logger?: Pick<Console, 'warn'> }} opts
 */
export function createGemini({ apiKey, model = 'gemini-flash-latest', fetchImpl = fetch, logger }) {
  const enabled = Boolean(apiKey);
  const state = { lastError: /** @type {string | null} */ (null) };

  /**
   * @param {object} body
   */
  async function call(body) {
    const res = await fetchImpl(`${API}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': /** @type {string} */ (apiKey) },
      body: JSON.stringify(body),
    });
    return res;
  }

  return {
    enabled,
    model,
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
      const base = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }, ...(image ? [{ inlineData: image }] : [])] }],
      };
      const generationConfig = { responseMimeType: 'application/json', maxOutputTokens: Math.max(maxTokens, MIN_OUTPUT_TOKENS) };
      try {
        let res = await call({ ...base, generationConfig: { ...generationConfig, thinkingConfig: { thinkingLevel: 'low' } } });
        // Older models reject thinkingConfig: retry once without it.
        if (res.status === 400) res = await call({ ...base, generationConfig });
        if (!res.ok) throw new GeminiError(`http-${res.status}`);
        const body = /** @type {any} */ (await res.json());
        const candidate = body?.candidates?.[0];
        if (!candidate) throw new GeminiError(body?.promptFeedback?.blockReason ? 'blocked' : 'no-candidate');
        const text = (candidate.content?.parts ?? []).filter((/** @type {any} */ p) => !p?.thought).map((/** @type {any} */ p) => p?.text ?? '').join('');
        if (candidate.finishReason === 'MAX_TOKENS') throw new GeminiError('truncated');
        let parsed;
        try {
          parsed = JSON.parse(stripFences(text));
        } catch {
          throw new GeminiError('bad-json');
        }
        state.lastError = null;
        return parsed;
      } catch (err) {
        const code = err instanceof GeminiError ? err.code : /** @type {any} */ (err)?.name === 'TimeoutError' ? 'timeout' : 'network';
        state.lastError = code;
        logger?.warn(`[gemini] ${code}`);
        throw err instanceof GeminiError ? err : new GeminiError(code);
      }
    },
  };
}

/** @param {string} s */
function stripFences(s) {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
}
