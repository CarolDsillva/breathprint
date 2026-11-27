// @ts-check
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 15000;

/**
 * Minimal Gemini client: one JSON-mode generateContent call. The API key is sent in a header,
 * never in the URL, and never leaves the server.
 * @param {{ apiKey?: string, model?: string, fetchImpl?: typeof fetch }} opts
 */
export function createGemini({ apiKey, model = 'gemini-flash-latest', fetchImpl = fetch }) {
  const enabled = Boolean(apiKey);
  return {
    enabled,
    model,
    /**
     * @param {{ system: string, prompt: string, maxTokens?: number, image?: { mimeType: string, data: string } }} req
     *   `image` is base64 data sent inline (used for room photos).
     * @returns {Promise<unknown>} parsed JSON from the model
     */
    async generateJson({ system, prompt, maxTokens = 700, image }) {
      if (!enabled) throw new Error('Gemini is not configured');
      const res = await fetchImpl(`${API}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': /** @type {string} */ (apiKey) },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }, ...(image ? [{ inlineData: image }] : [])] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens },
        }),
      });
      if (!res.ok) throw new Error(`Gemini answered ${res.status}`);
      const body = /** @type {any} */ (await res.json());
      const text = (body?.candidates?.[0]?.content?.parts ?? []).map((/** @type {any} */ p) => p?.text ?? '').join('');
      return JSON.parse(stripFences(text));
    },
  };
}

/** @param {string} s */
function stripFences(s) {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
}
