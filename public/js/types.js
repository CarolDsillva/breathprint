// @ts-check
/**
 * Shared JSDoc types for the browser code. Types come from the engine, so the UI and the
 * model can never disagree about the shape of a plan.
 *
 * @typedef {import('/engine/dose.js').Plan} Plan
 * @typedef {import('/engine/dose.js').Member} Member
 * @typedef {import('/engine/dose.js').Activity} Activity
 * @typedef {import('/engine/dose.js').Forecast} Forecast
 * @typedef {ReturnType<typeof import('/engine/dose.js').computeDay>} DayResult
 * @typedef {import('/engine/optimizer.js').Suggestion} Suggestion
 * @typedef {import('/engine/scenario.js').Change} Change
 * @typedef {import('/engine/scenario.js').Comparison} Comparison
 * @typedef {{ change: Change, title: string }} ChangeRequest a change the user chose to apply
 * @typedef {{ date: string, pm25: Forecast }} ForecastDay
 * @typedef {{ name: string, region: string, country: string, lat: number, lon: number }} Place
 */

export {};
