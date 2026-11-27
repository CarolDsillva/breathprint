import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM, VirtualConsole } from 'jsdom';

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');

/**
 * Run axe-core (WCAG 2.1 A/AA rules) on the page markup.
 * Colour contrast needs real layout, so it is checked in the browser instead.
 */
async function audit() {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  // axe probes <canvas>, which jsdom does not implement; that warning is noise here.
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  dom.window.eval(axeSource);
  return dom.window.axe.run(dom.window.document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    rules: { 'color-contrast': { enabled: false } },
  });
}

describe('accessibility (axe-core)', () => {
  it('page markup has no WCAG A/AA violations', async () => {
    const { violations } = await audit();
    const report = violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
    // `violations` comes from jsdom's own JS realm, so compare the count, not the array.
    assert.equal(report.length, 0, report.join('\n'));
  });

  it('every form control has a label and the page has landmarks', async () => {
    const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
    const { document } = new JSDOM(html).window;
    for (const el of document.querySelectorAll('input, select, textarea')) {
      const labelled = el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.getAttribute('aria-label');
      assert.ok(labelled, `unlabelled control: ${el.outerHTML.slice(0, 80)}`);
    }
    assert.ok(document.querySelector('main#main'));
    assert.ok(document.querySelector('a.skip-link[href="#main"]'));
    assert.equal(document.documentElement.lang, 'en');
  });
});
