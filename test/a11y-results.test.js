// Accessibility of what the app renders: the page filled with the sample family's results,
// editor forms and a what-if comparison, audited with axe-core (WCAG 2.1 A/AA).
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dom } from './helpers/dom-env.js';

const require = createRequire(import.meta.url);

const engine = await import('../src/engine/index.js');
const view = await import('../public/js/budget-view.js');
const components = await import('../public/js/components.js');
const cards = await import('../public/js/editor-cards.js');
const { renderAirStrip } = await import('../public/js/forecast-panel.js');

const { document } = dom.window;
const byId = (id) => document.getElementById(id);

describe('accessibility of rendered results (axe-core)', () => {
  before(() => {
    const plan = engine.samplePlan();
    const pm = engine.SAMPLE_FORECAST;
    const day = engine.computeDay(plan, pm);
    const smarter = engine.computeDay(engine.optimizeDay(plan, pm).plan, pm);

    renderAirStrip(byId('air-strip'), pm);
    byId('members').replaceChildren(...plan.members.map((m, i) => cards.memberCard(m, i, plan.members.length)));
    byId('activities').replaceChildren(...plan.activities.map((a) => cards.activityCard(a, plan.members)));
    view.renderStats(byId('stats'), day, smarter);
    view.renderSeason(byId('season-out'), plan, engine.seasonSavings(day, smarter, 94));
    view.renderRipple(byId('ripple-out'), engine.communityRipple(day, smarter, 100));
    view.renderHourGrid(byId('hour-grid'), plan, pm, engine.memberTimeline);
    view.renderBudget(byId('budget'), plan, day);
    view.renderSuggestions(byId('suggestions'), engine.suggest(plan, pm), () => {});
    const comparison = engine.compareChange(plan, pm, { activityId: 'school-run', mode: 'metro' });
    assert.ok(comparison.ok);
    byId('whatif-out').replaceChildren(components.comparisonCard(comparison, comparison.description));
  });

  it('has no WCAG A/AA violations with results on screen', async () => {
    dom.window.eval(await readFile(require.resolve('axe-core/axe.min.js'), 'utf8'));
    const { violations } = await dom.window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
      rules: { 'color-contrast': { enabled: false } }, // checked against the real colours in the browser
    });
    const report = violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
    assert.equal(report.length, 0, report.join('\n'));
  });

  it('describes charts in words and labels every control', () => {
    const grid = document.querySelector('.hour-grid');
    assert.equal(grid.getAttribute('role'), 'img');
    assert.match(grid.getAttribute('aria-label'), /Aarav: .*outdoors at 5:00 PM \(Cricket practice\)/);
    for (const bar of document.querySelectorAll('#air-strip li'))
      assert.match(bar.getAttribute('aria-label'), /micrograms, \w/);
    for (const control of document.querySelectorAll(
      '#members input, #members select, #activities input, #activities select',
    )) {
      assert.ok(control.closest('label'), `unlabelled: ${control.outerHTML.slice(0, 70)}`);
    }
    for (const button of document.querySelectorAll('button')) {
      assert.ok(button.textContent.trim() || button.getAttribute('aria-label'), 'button without a name');
    }
  });

  it('never relies on colour alone for impact', () => {
    const chips = [...document.querySelectorAll('.chip')].map((c) => c.textContent);
    assert.ok(chips.length > 0);
    for (const text of chips) assert.match(text, /less|more|Little difference/);
    assert.equal(
      components.impactSummary({ dosePct: -3.8, co2: -90 }),
      'family breathes 3.8% less; city gets 90 g CO₂ less',
    );
    assert.equal(components.impactSummary({ dosePct: 0.1, co2: 0 }), 'little difference');
  });

  it('comparison tables have row and column headers', () => {
    const table = document.querySelector('#whatif-out table');
    assert.ok(table.querySelector('caption'));
    assert.equal(table.querySelectorAll('thead th[scope="col"]').length, 4);
    assert.equal(table.querySelectorAll('tbody th[scope="row"]').length, 4);
  });
});
