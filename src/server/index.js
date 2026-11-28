// @ts-check
/** Server entry point: read the settings, build the app and start listening. */
import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createAirQualityService } from './services/airQuality.js';
import { createGemini } from './services/gemini.js';

try {
  process.loadEnvFile('.env'); // optional local settings
} catch {
  // No .env file: rely on the real environment.
}

const config = readConfig(process.env);
for (const warning of config.warnings) console.warn(`[breathprint] ${warning}`);

const app = createApp({
  air: createAirQualityService(),
  gemini: createGemini({ apiKey: config.geminiApiKey, model: config.geminiModel, logger: console }),
});

const server = app.listen(config.port, () => {
  console.log(
    `Breathprint on http://localhost:${config.port} (AI: ${config.geminiApiKey ? 'Gemini' : 'offline mode'})`,
  );
});

for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
