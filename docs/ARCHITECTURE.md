# Architecture

This document explains how Breathprint is put together and why. For the formulas, see [science.md](science.md).

## Overview

```
                       ┌──────────────────────── src/engine (pure, no I/O) ───────────────────────┐
                       │ constants → dose → emissions → scenario → optimizer → impact, room, scan │
                       │ validate (shared input rules)        intent (offline what-if parser)     │
                       └───────────────▲──────────────────────────────────────▲──────────────────┘
                                       │ imported as /engine/*                │ imported directly
 ┌──────────────── public/js (browser) ┴────────────┐       ┌────────────── src/server (Node) ┴──────────────┐
 │ app.js wires the sections:                       │ HTTP  │ app.js: security → routes → static → errors    │
 │  forecast-panel · editor · home-settings         │──────▶│ routes/air → services/airQuality (Open-Meteo)  │
 │  budget-panel (+ budget-view, ripple-panel)      │ JSON  │ routes/ai  → ai/briefing · whatif · roomScan   │
 │  briefing-panel · whatif-panel · room · scan     │       │              → services/gemini (Gemini API)     │
 │ state.js: plan, forecast, undo, change events    │       │ config.js · cache.js · image.js · security.js  │
 └──────────────────────────────────────────────────┘       └────────────────────────────────────────────────┘
```

## Key decisions

### 1. One pure engine, shared by browser and server

All the maths lives in `src/engine`: plain functions with no I/O, no globals and no randomness. The server serves
that folder to the browser at `/engine/`, so the browser runs **the same code** the tests cover.

- Recalculation is instant on every edit, with no round-trip, and works offline.
- The server re-validates everything with the same rules (`validate.js`), so a modified client gains nothing.
- The engine is easy to test exhaustively: same input, same output.

### 2. Gemini explains and understands; the engine decides and computes

Language models are good at language and unreliable at arithmetic. So:

- **Briefing:** the engine computes a facts object, and Gemini only rephrases it.
- **What-if:** Gemini maps a question to a structured change. The engine checks that it is feasible and computes
  before and after.
- **Smoke Detective:** Gemini picks findings from a fixed list. The engine maps them to plan changes and impact.

Every model answer must match a fixed JSON shape and is re-validated. Each feature has a deterministic fallback,
so the app is fully usable without AI, and an AI failure never breaks a user's flow.

### 3. No front-end framework, no build step

The UI is a few hundred lines per section of standard ES modules. A tiny `h()` builder creates elements with
`textContent` only, which removes a whole class of injection bugs and lets a strict Content-Security-Policy forbid
inline scripts and styles. With no build step, what is in the repo is exactly what runs.

### 4. JavaScript with checked types

Types are written as JSDoc and checked by `tsc` in strict mode with `noImplicitAny`. This gives TypeScript's safety
with no compile step, because the same files run in Node and the browser. Untrusted data (form input, JSON from
Open-Meteo or Gemini) is typed `unknown` and narrowed by type guards, and casts are avoided in favour of runtime
checks (for example `inputById()` checks the element really is an `<input>`).

### 5. Small modules with enforced limits

ESLint enforces complexity ≤ 15, ≤ 80 lines per function, ≤ 300 lines per file, ≤ 4 parameters, and a doc comment
on every function. Long `if` chains became lookup tables (for example the editor's field setters), and validation is
split into one small reader per part of the plan.

## Browser state

`state.js` holds the draft plan, the forecast and the undo point, and emits three kinds of change:

| Event      | When                                         | Who reacts                                                |
| ---------- | -------------------------------------------- | --------------------------------------------------------- |
| `replaced` | sample day, a suggestion or undo swaps plans | editors re-render, home settings sync, budget renders now |
| `edited`   | the user changes a field                     | budget re-renders after a 120 ms pause                    |
| `forecast` | a new day's forecast arrives                 | budget and clean-room calculator recalculate              |

The plan is saved to `localStorage` as a convenience. The app works without it.

## A request's life: `POST /api/whatif`

1. **Security middleware:** Helmet headers and the Permissions-Policy, then the per-IP rate limit (15/min for AI).
2. **Body parser:** at most 32 KB.
3. **Validation:** `validatePlan()` rebuilds a clean plan from allow-lists, and the question is cleaned and
   length-capped.
4. **`interpretWhatIf()`:** Gemini gets the activity ids, modes and sources, plus the question marked as data. It
   answers with a JSON change, which goes through `sanitizeChange()` then `checkChange()`. If anything fails, the
   offline parser answers.
5. The browser calls `compareChange()` from the same engine to show before and after for each person.
6. **Errors:** any thrown error reaches one handler that logs details on the server and returns a friendly message.

## Testing strategy

| Layer         | How                                                                                     |
| ------------- | --------------------------------------------------------------------------------------- |
| Engine        | Unit tests, including hand calculations and invariants (linearity, never-worse choices) |
| Server        | Real HTTP requests against the app on a random port, with Gemini and Open-Meteo stubbed |
| Browser       | Unit tests in jsdom, plus a full-page test that loads `app.js` and drives every section |
| Accessibility | axe-core WCAG 2.1 AA audits of the empty page and of a page full of results             |

Coverage is 100% of lines across all three layers, and CI runs everything on Node 22 and 24.
