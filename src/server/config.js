// @ts-check
/**
 * Server settings, read from the environment in one place and checked before use.
 * See .env.example for the variables.
 */

const DEFAULT_PORT = 8080;
const MODEL_NAME = /^[a-z0-9][a-z0-9.-]{1,60}$/;

/**
 * @typedef {{
 *   port: number,
 *   geminiApiKey: string | undefined,
 *   geminiModel: string | undefined,
 *   warnings: string[]
 * }} Config
 */

/**
 * Read and validate the settings. Bad values fall back to safe defaults with a warning rather
 * than stopping the server, so a typo never takes the app down.
 * @param {Record<string, string | undefined>} env usually process.env
 * @returns {Config}
 */
export function readConfig(env) {
  /** @type {string[]} */
  const warnings = [];

  const portText = env.PORT?.trim();
  let port = DEFAULT_PORT;
  if (portText) {
    const n = Number(portText);
    if (Number.isInteger(n) && n > 0 && n < 65_536) port = n;
    else warnings.push(`PORT "${portText}" is not a valid port; using ${DEFAULT_PORT}.`);
  }

  const geminiApiKey = env.GEMINI_API_KEY?.trim() || undefined;

  let geminiModel = env.GEMINI_MODEL?.trim() || undefined;
  if (geminiModel && !MODEL_NAME.test(geminiModel)) {
    warnings.push('GEMINI_MODEL is not a valid model name; using the default model.');
    geminiModel = undefined;
  }

  return { port, geminiApiKey, geminiModel, warnings };
}
