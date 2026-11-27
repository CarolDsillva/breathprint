// @ts-check
/** Section 06, Smoke Detective: room photo (Gemini vision) or checklist → indoor fixes with real impact. */
import { FINDINGS, compareChange, findingsToFixes, isFindingId, validatePlan } from '/engine/index.js';
import { scanPhoto } from './api.js';
import { impactChips } from './components.js';
import { byId, h } from './dom.js';
import { state } from './state.js';

/** @typedef {import('./types.js').ChangeRequest} ChangeRequest */
/** @typedef {import('/engine/scan.js').FindingId} FindingId */
/** @typedef {{ findings: { id: FindingId, evidence: string }[], summary: string }} ScanResult */

const MAX_SIDE = 1024;
const JPEG_QUALITY = 0.8;

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
  /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')).drawImage(
    bitmap,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  bitmap.close();
  /** @type {Blob} */
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not process the photo.'))),
      'image/jpeg',
      JPEG_QUALITY,
    ),
  );
  /** @type {string} */
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the photo.'));
    reader.readAsDataURL(blob);
  });
  return { blob, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

/** Elements of this section, found once when it starts. */
function findElements() {
  return {
    fileInput: /** @type {HTMLInputElement} */ (byId('scan-file')),
    preview: /** @type {HTMLImageElement} */ (byId('scan-preview')),
    status: byId('scan-status'),
    out: byId('scan-out'),
    checklist: byId('checklist'),
    scanBtn: /** @type {HTMLButtonElement} */ (byId('scan-btn')),
  };
}

/** @type {ReturnType<typeof findElements>} */
let ui;
/** @type {(request: ChangeRequest) => void} */
let applyChange = () => {};

/**
 * @param {string} text
 * @param {boolean} [error]
 */
function say(text, error = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle('error', error);
}

/** @param {string} text */
const hint = (text) => h('span', { class: 'hint' }, text);

/**
 * One fix card: what was seen, the fix, and (when the plan allows) its real impact.
 * @param {ReturnType<typeof findingsToFixes>[number]} fix
 * @param {import('./types.js').Plan} plan
 * @param {string | undefined} seen
 */
function fixCard(fix, plan, seen) {
  const { change } = fix;
  const forecast = state.forecast;
  const result = change && forecast ? compareChange(plan, forecast, change) : null;
  const usable = result?.ok ? result : null;
  const useButton =
    usable && change
      ? h(
          'button',
          { type: 'button', class: 'btn', onclick: () => applyChange({ change, title: usable.description }) },
          'Use this in my day',
        )
      : null;
  return h(
    'li',
    null,
    h('strong', null, fix.label),
    seen ? h('span', { class: 'evidence' }, `Seen: ${seen}`) : null,
    h('span', null, fix.advice),
    usable ? impactChips(usable.delta) : null,
    fix.note ? hint(fix.note) : null,
    change && !forecast ? hint('Load a forecast in step 01 to see the impact.') : null,
    useButton ? h('div', null, useButton) : null,
  );
}

/**
 * Show a card per finding.
 * @param {FindingId[]} ids
 * @param {Partial<Record<FindingId, string>>} [evidence]
 */
function showFixes(ids, evidence = {}) {
  const checked = validatePlan(state.plan);
  if (!checked.ok) return say('Fix your family plan above first.', true);
  // Callers pass at least one known finding, so there is always at least one fix.
  const fixes = findingsToFixes(ids, checked.plan);
  ui.out.replaceChildren(h('ul', { class: 'fixes' }, ...fixes.map((f) => fixCard(f, checked.plan, evidence[f.id]))));
}

/** @returns {NodeListOf<HTMLInputElement>} */
const checklistBoxes = () => ui.checklist.querySelectorAll('input');

function onChecklistSubmit() {
  const ids = [...checklistBoxes()]
    .filter((box) => box.checked)
    .map((box) => box.value)
    .filter(isFindingId);
  if (!ids.length) return say('Tick at least one item.', true);
  say(`Showing fixes for ${ids.length} item${ids.length > 1 ? 's' : ''}.`);
  showFixes(ids);
}

/**
 * Shrink the photo, show it, and ask Gemini what it sees. The checklist is ticked to match.
 * @param {File} file
 */
async function scanFile(file) {
  say('Shrinking the photo on your device…');
  const { blob, base64 } = await shrinkPhoto(file);
  if (ui.preview.src) URL.revokeObjectURL(ui.preview.src);
  ui.preview.src = URL.createObjectURL(blob);
  ui.preview.hidden = false;
  say('Gemini is looking for smoke sources…');
  /** @type {ScanResult} */
  const result = await scanPhoto(base64, 'image/jpeg');
  const ids = result.findings.map((f) => f.id);
  for (const box of checklistBoxes()) box.checked = isFindingId(box.value) && ids.includes(box.value);
  say(result.summary || `Found ${ids.length} item${ids.length === 1 ? '' : 's'}.`);
  if (!ids.length) {
    const tip =
      'Nothing to act on in this photo. Try a wider shot of the kitchen, bedroom or puja corner, or tick the checklist above.';
    ui.out.replaceChildren(h('p', { class: 'hint' }, tip));
    return;
  }
  showFixes(ids, Object.fromEntries(result.findings.map((f) => [f.id, f.evidence])));
}

async function onScanSubmit() {
  const file = ui.fileInput.files?.[0];
  if (!file) return say('Choose a photo first.', true);
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return say('Use a JPEG, PNG or WebP photo.', true);
  ui.scanBtn.disabled = true;
  try {
    await scanFile(file);
  } catch (err) {
    say(`${/** @type {Error} */ (err).message} You can use the checklist below instead.`, true);
  } finally {
    ui.scanBtn.disabled = false;
  }
}

/**
 * Wire up the Smoke Detective section.
 * @param {{ apply: (request: ChangeRequest) => void }} deps
 */
export function initScan({ apply }) {
  ui = findElements();
  applyChange = apply;
  ui.checklist.replaceChildren(
    ...Object.entries(FINDINGS).map(([id, f]) =>
      h('label', { class: 'check' }, h('input', { type: 'checkbox', value: id, name: 'finding' }), f.label),
    ),
  );
  byId('checklist-form').addEventListener('submit', (e) => {
    e.preventDefault();
    onChecklistSubmit();
  });
  byId('scan-form').addEventListener('submit', (e) => {
    e.preventDefault();
    onScanSubmit();
  });
}
