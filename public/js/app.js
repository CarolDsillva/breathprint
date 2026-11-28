// @ts-check
/**
 * Breathprint front end: wires each section of the page to the shared state.
 * All calculations run in the browser with the same engine the tests cover (/engine).
 */
import { initBriefingPanel } from './briefing-panel.js';
import { initBudgetPanel } from './budget-panel.js';
import { buttonById, byId } from './dom.js';
import { initEditor } from './editor.js';
import { initForecastPanel } from './forecast-panel.js';
import { initHomeSettings } from './home-settings.js';
import { initRoomPanel } from './room-panel.js';
import { initScan } from './scan.js';
import { initWhatIfPanel } from './whatif-panel.js';

initEditor({
  membersEl: byId('members'),
  activitiesEl: byId('activities'),
  addMemberBtn: buttonById('add-member'),
  addActivityBtn: buttonById('add-activity'),
});
initHomeSettings();
const budget = initBudgetPanel();
initForecastPanel();
initBriefingPanel();
initWhatIfPanel({ apply: budget.apply });
initRoomPanel();
initScan({ apply: budget.apply });

// Offline support. Registration failing (e.g. in a private window) must not break the app.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
