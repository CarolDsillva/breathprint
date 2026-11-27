// @ts-check
import { createApp } from './app.js';
import { createAirQualityService } from './services/airQuality.js';
import { createGemini } from './services/gemini.js';

try {
  process.loadEnvFile('.env'); // optional local settings
} catch {
  // No .env file: rely on the real environment.
}
const port = Number(process.env.PORT) || 8080;

const app = createApp({
  air: createAirQualityService(),
  gemini: createGemini({
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || undefined,
    logger: console,
  }),
});

const server = app.listen(port, () => {
  console.log(
    `Breathprint on http://localhost:${port} (AI: ${process.env.GEMINI_API_KEY ? 'Gemini' : 'offline mode'})`,
  );
});

for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
