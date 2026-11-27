// @ts-check
import { FINDINGS, compareChange, findingsToFixes, validatePlan } from '/engine/index.js';
import { scanPhoto } from './api.js';
import { byId, h } from './dom.js';
import { impactChips } from './render.js';

const MAX_SIDE = 1024;

/**
 * Shrink a photo in the browser before upload: a smaller request, a faster scan, and the
 * original full-resolution file (with its location metadata) never leaves the phone.
 * @param {File} file
 * @returns {Promise<{ blob: Blob, base64: string }>}
 */
export async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  /** @type {Blob} */
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the photo.'))), 'image/jpeg', 0.8));
  /** @type {string} */
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the photo.'));
    reader.readAsDataURL(blob);
  });
  return { blob, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

/**
 * Wire up the Smoke Detective section.
 * @param {{ getPlan: () => any, getForecast: () => (number | null)[] | null, apply: (s: { change: any, title: string }) => void }} ctx
 */
export function initScan(ctx) {
  const fileInput = /** @type {HTMLInputElement} */ (byId('scan-file'));
  const preview = /** @type {HTMLImageElement} */ (byId('scan-preview'));
  const status = byId('scan-status');
  const out = byId('scan-out');
  const checklist = byId('checklist');
  const scanBtn = /** @type {HTMLButtonElement} */ (byId('scan-btn'));

  checklist.replaceChildren(...Object.entries(FINDINGS).map(([id, f]) =>
    h('label', { class: 'check' }, h('input', { type: 'checkbox', value: id, name: 'finding' }), f.label)));

  /**
   * @param {string} text
   * @param {boolean} [error]
   */
  const say = (text, error = false) => {
    status.textContent = text;
    status.classList.toggle('error', error);
  };

  /**
   * Show a card per finding: what was seen, the fix, and (when the plan allows) its impact.
   * @param {string[]} ids
   * @param {Record<string, string>} [evidence]
   */
  function showFixes(ids, evidence = {}) {
    const checked = validatePlan(ctx.getPlan());
    if (!checked.ok) return say('Fix your family plan above first.', true);
    const forecast = ctx.getForecast();
    const fixes = findingsToFixes(/** @type {any} */ (ids), checked.plan);
    if (!fixes.length) {
      out.replaceChildren(h('p', { class: 'hint' }, 'Nothing to fix was found. Nice work keeping indoor air clean.'));
      return;
    }
    out.replaceChildren(h('ul', { class: 'fixes' }, ...fixes.map((f) => {
      const cmp = f.change && forecast ? compareChange(checked.plan, forecast, f.change) : null;
      const usable = cmp && cmp.ok && cmp.delta;
      return h('li', null,
        h('strong', null, f.label),
        evidence[f.id] ? h('span', { class: 'evidence' }, `Seen: ${evidence[f.id]}`) : null,
        h('span', null, f.advice),
        usable ? impactChips(/** @type {any} */ (cmp).delta) : null,
        f.note ? h('span', { class: 'hint' }, f.note) : null,
        f.change && !forecast ? h('span', { class: 'hint' }, 'Load a forecast in step 01 to see the impact.') : null,
        usable
          ? h('div', null, h('button', { type: 'button', class: 'btn', onclick: () => ctx.apply({ change: f.change, title: /** @type {any} */ (cmp).description ?? f.label }) }, 'Use this in my day'))
          : null,
      );
    })));
  }

  byId('checklist-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const ids = [...checklist.querySelectorAll('input:checked')].map((i) => /** @type {HTMLInputElement} */ (i).value);
    if (!ids.length) return say('Tick at least one item.', true);
    say(`Showing fixes for ${ids.length} item${ids.length > 1 ? 's' : ''}.`);
    showFixes(ids);
  });

  byId('scan-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = fileInput.files?.[0];
    if (!file) return say('Choose a photo first.', true);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return say('Use a JPEG, PNG or WebP photo.', true);
    scanBtn.disabled = true;
    try {
      say('Shrinking the photo on your device…');
      const { blob, base64 } = await shrinkPhoto(file);
      if (preview.src) URL.revokeObjectURL(preview.src);
      preview.src = URL.createObjectURL(blob);
      preview.hidden = false;
      say('Gemini is looking for smoke sources…');
      const r = await scanPhoto(base64, 'image/jpeg');
      /** @type {string[]} */
      const ids = r.findings.map((/** @type {{ id: string }} */ f) => f.id);
      for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (checklist.querySelectorAll('input'))) {
        input.checked = ids.includes(input.value);
      }
      say(r.summary || `Found ${ids.length} item${ids.length === 1 ? '' : 's'}.`);
      if (!ids.length) {
        out.replaceChildren(h('p', { class: 'hint' }, 'Nothing to act on in this photo. Try a wider shot of the kitchen, bedroom or puja corner, or tick the checklist above.'));
        return;
      }
      showFixes(ids, Object.fromEntries(r.findings.map((/** @type {{ id: string, evidence: string }} */ f) => [f.id, f.evidence])));
    } catch (err) {
      say(`${/** @type {Error} */ (err).message} You can use the checklist below instead.`, true);
    } finally {
      scanBtn.disabled = false;
    }
  });
}
