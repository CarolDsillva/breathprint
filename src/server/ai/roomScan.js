// @ts-check
/**
 * Smoke Detective: Gemini vision lists indoor air-quality findings in a room photo, from a
 * fixed list only. The engine (src/engine/scan.js) turns findings into fixes.
 */
import { sanitizeScan } from '../../engine/scan.js';
import { SCAN_SYSTEM } from './prompts.js';

/**
 * Ask Gemini which known findings are visible in the photo.
 * @param {import('./client.js').AiClient} ai
 * @param {import('./client.js').InlineImage} image already validated by decodeImage
 * @returns {Promise<(NonNullable<ReturnType<typeof sanitizeScan>> & { source: 'gemini' }) | null>}
 *   null when the model fails or answers in an unusable shape
 */
export async function scanRoom(ai, image) {
  try {
    const raw = await ai.generateJson({
      system: SCAN_SYSTEM,
      prompt: 'List the air-quality findings in this room photo.',
      maxTokens: 500,
      image,
    });
    const clean = sanitizeScan(raw);
    return clean ? { ...clean, source: 'gemini' } : null;
  } catch {
    return null;
  }
}
