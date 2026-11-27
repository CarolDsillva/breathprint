// @ts-check
/** Checks for uploaded room photos: allowed type, real file signature, size cap. */

export const MAX_IMAGE_BYTES = 1_000_000;

/** File signatures ("magic bytes") for the formats we accept. */
const SIGNATURES = /** @type {const} */ ({
  'image/jpeg': (/** @type {Buffer} */ b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (/** @type {Buffer} */ b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (/** @type {Buffer} */ b) =>
    b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
});

/**
 * Validate a base64 photo. Returns the data ready for Gemini, or a friendly error.
 * @param {unknown} data base64 without a data: prefix
 * @param {unknown} mimeType
 * @returns {{ mimeType: string, data: string } | { error: string }}
 */
export function decodeImage(data, mimeType) {
  if (typeof mimeType !== 'string' || !Object.hasOwn(SIGNATURES, mimeType))
    return { error: 'Use a JPEG, PNG or WebP photo.' };
  if (typeof data !== 'string' || data.length < 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
    return { error: 'The photo could not be read.' };
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) return { error: 'The photo is too large (max 1 MB after resizing).' };
  if (!SIGNATURES[/** @type {keyof typeof SIGNATURES} */ (mimeType)](bytes))
    return { error: 'That file is not the image type it claims to be.' };
  return { mimeType, data };
}
