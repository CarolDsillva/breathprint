// @ts-check
/** Public surface of the Breathprint engine (pure functions, no I/O). */
export * from './constants.js';
export { activityHours, computeDay, memberDose, memberTimeline, memberWeight } from './dose.js';
export { planEmissions } from './emissions.js';
export { applyChange, checkChange, compareChange, describeChange } from './scenario.js';
export { optimizeDay, suggest } from './optimizer.js';
export { PURIFIERS, purifierPlan } from './room.js';
export { parseWhatIf } from './intent.js';
export { isForecast, sanitizeChange, validatePlan } from './validate.js';
export { formatTime } from './time.js';
export { SAMPLE_FORECAST, samplePlan } from './sample.js';
export { communityRipple, seasonSavings, smogSeasonDaysLeft } from './impact.js';
export { FINDINGS, FINDING_IDS, findingsToFixes, isFindingId, sanitizeScan } from './scan.js';
