# Breathprint

[![CI](https://github.com/CarolDsillva/breathprint/actions/workflows/ci.yml/badge.svg)](https://github.com/CarolDsillva/breathprint/actions/workflows/ci.yml)

**Live app:** https://breathprint-jade.vercel.app/

**Every breath leaves a print.** Breathprint is a GenAI-powered urban air quality assistant for families in smog-hit cities. You tell it who lives at home and what their day looks like. It works out how much PM2.5 smog **each person actually breathes, hour by hour**, then finds the choices that cut it. Each choice shows two impacts side by side:

- 🫁 **What your family breathes:** micrograms of PM2.5 inhaled, cigarette-equivalents, and how many times the WHO guideline.
- 🏙️ **What you add to the city:** grams of CO₂ and milligrams of PM2.5 from your trips.

> **Chosen vertical:** Challenge 6, Urban Air Quality Assistant. The app suggests low-emission daily routines, indoor air quality fixes and sustainable alternatives, tailored to the family's location and lifestyle, and clearly explains the direct impact of each choice.

---

## What makes it different

Most air-quality apps show a city AQI number and generic advice ("wear a mask"). But **a city's AQI is not what you breathe; your day is.** A child playing cricket at 5 PM next to a road breathes many times more smog than a grandparent indoors with the windows shut, on the same day in the same city.

| Feature                             | What it does                                                                                                                                                                                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Family breath budget**            | Dose per person = outdoor PM2.5 × how much of it gets to where they are × how hard they're breathing × time. Children, elders and people with asthma or heart conditions are weighted higher when choices are ranked.                                                                                                      |
| **Hour-by-hour view**               | The forecast next to where each person is in every hour (outdoors, travelling, school/office, home, indoor smoke, asleep).                                                                                                                                                                                                 |
| **Smarter plan (decision engine)**  | Moves flexible activities to cleaner hours, swaps transport modes, fixes indoor smoke (chimney, no incense), suggests closing windows, and checks every change against clashes, sleep, distance limits and what transport is nearby.                                                                                       |
| **Two-sided ledger**                | Every suggestion shows breathed _and_ emitted impact, e.g. _metro instead of auto: Priya breathes 3% less and the city gets 540 g less CO₂._                                                                                                                                                                               |
| **"What if…?" box**                 | Ask in plain words: _"What if Aarav plays cricket at 2pm?"_ Gemini turns the question into a structured change; the engine computes before and after for every family member.                                                                                                                                              |
| **Family briefing (Gemini)**        | A short, warm summary in English or Hindi, written **only from the engine's numbers**.                                                                                                                                                                                                                                     |
| **Smoke Detective (Gemini vision)** | Snap your kitchen, bedroom or puja corner. Gemini spots smoke sources and leaks (stove without chimney, incense, mosquito coil, open window, door gaps, purifier, plants…) from a fixed list; each finding becomes a fix with its **computed** impact on your family. A checklist does the same without a photo or AI key. |
| **Smog-season savings**             | _"If every day until 28 Feb looks like this one, the smarter plan spares Aarav ≈ 237 cigarettes' worth of smoke."_                                                                                                                                                                                                         |
| **Neighbourhood ripple**            | _"If 100 families nearby made the same switches: 63 kg less CO₂ and ≈ 1,200 cigarettes' worth of smoke not breathed, in one day."_ Communities, not just households.                                                                                                                                                       |
| **Clean-room calculator**           | A mass-balance model: how many minutes your purifier (or a DIY box-fan filter) needs to make the bedroom safe, and the CADR you actually need.                                                                                                                                                                             |
| **Works offline, installable**      | A service worker caches the app, so the sample day and every calculation work with no network; it installs to a phone's home screen.                                                                                                                                                                                       |

## How it works

```
 Browser (no build step)                      Node.js server (Express)
 ┌───────────────────────────┐                ┌──────────────────────────────────┐
 │ index.html + js/*         │  /api/forecast │ Open-Meteo (CAMS) hourly PM2.5    │
 │  editors, results, grid   │ ─────────────▶ │  cached per ~11 km cell, 30 min   │
 │                           │  /api/places   │ Open-Meteo geocoding (cached 24h) │
 │ /engine/*.js  ◀── same ──▶│                │                                   │
 │  pure dose / optimiser    │  /api/coach    │ Gemini: briefing from engine facts│
 │  runs instantly, offline  │  /api/whatif   │ Gemini: question → change (JSON)  │
 └───────────────────────────┘                │  re-validated, offline fallback   │
                                              └──────────────────────────────────┘
```

1. **Forecast:** hourly PM2.5 for today and tomorrow (Open-Meteo air-quality API, CAMS model; free, no key).
2. **Engine** (`src/engine`, pure functions, shared by browser and server):
   - `dose.js`: per-person inhaled dose, cigarette equivalents, multiple of the WHO guideline, and the hour-by-hour timeline.
   - `emissions.js`: trip CO₂ and PM2.5 (a private vehicle is counted once, shared transit per passenger).
   - `scenario.js`: apply, check and compare a change (a new transport mode keeps the arrival time).
   - `optimizer.js`: ranks single changes and greedily builds the smarter day from free changes.
   - `room.js`: purifier mass-balance model. `intent.js`: offline what-if parser. `validate.js`: strict input validation.
3. **GenAI layer** (`src/server/coach.js`):
   - **Briefing:** Gemini gets a compact facts object (numbers computed by the engine) and must reply in a fixed JSON shape; the output is sanitised and length-capped.
   - **What-if:** Gemini maps free text to `{activityId, start, mode, source, windows, purifier}`. The answer is checked against the plan (only known ids and modes, no clashes). If it is invalid, the offline parser takes over.
   - **Smoke Detective:** the photo is shrunk to at most 1024 px on the device (the original and its location data never leave the phone), checked on the server (JPEG/PNG/WebP only, real file signature, 1 MB cap, separate body limit), sent inline to Gemini, and **never stored or logged**. Gemini may only answer with ids from a fixed list (`src/engine/scan.js`); the engine turns those into plan changes.
   - **No numbers are invented by the model.** Everything the user sees as a figure comes from the engine.

### Decision logic (summary)

- Each candidate change is scored by the drop in **weighted family dose** (weight 1.5 for a child, 1.3 for a senior, +0.5 if sensitive), plus a smaller bonus for cutting emissions.
- A greener transport mode is allowed only if it doesn't raise the family dose by more than 3%.
- Purchases (a purifier) are suggested but never auto-applied; "Use the smarter plan" applies only free changes.

## Run it

```bash
npm install
cp .env.example .env        # optional: add GEMINI_API_KEY for AI briefings
npm start                   # http://localhost:8080
npm test                    # 103 tests, no network needed
npm run coverage            # ~96% of lines, browser code included
npm run check               # Prettier + ESLint + strict TypeScript check (JSDoc) + tests
```

Without a Gemini key the app still works fully: briefings use a deterministic template, what-ifs use the offline parser and Smoke Detective uses the checklist. Press **Try a Delhi smog day** to explore without any network access.

**Deploy (Google Cloud Run):** `gcloud run deploy breathprint --source . --set-secrets GEMINI_API_KEY=gemini-key:latest`

## Quality, security, efficiency, accessibility

- **Code quality:** small single-purpose modules (one per UI panel, one per AI feature, separate routes and security config). ESLint enforces the limits: complexity ≤ 15, ≤ 80 lines per function, ≤ 300 per file, ≤ 4 parameters. Lookup tables replace long `if` chains. Shared types come from the engine. A strict TypeScript check (`strict`, `noImplicitAny`) runs over the JSDoc types in server, engine and browser code with **no `any`**: untrusted JSON is typed as `unknown` and narrowed with type guards. Prettier and EditorConfig keep formatting consistent. All of this runs in **GitHub Actions CI** on Node 22 and 24, with tests, coverage and `npm audit`.
- **Testing:** `node:test`, 103 tests, about 96% line coverage across engine, server **and browser code**. Engine: the dose maths against hand calculations, linearity, emissions, feasibility rules, the optimiser, parsers, validation and injection stripping. Server: HTTP tests for security headers, caching, rate limits, fallbacks, error handling and key handling (Gemini and Open-Meteo are stubbed), plus the photo checks and scan route. Browser: editor field rules, state and undo, DOM helpers, announcements and the API client, run in jsdom. Accessibility: two **axe-core WCAG 2.1 AA audits**, one of the empty page and one with real results, editor forms and a comparison table rendered.
- **Security:** see [SECURITY.md](SECURITY.md). In short: the API key stays on the server, sent in a header (never in a URL). A strict Content-Security-Policy allows **this origin only**, with self-hosted fonts and no third-party requests. A Permissions-Policy allows only location and camera. Helmet sets HSTS, `nosniff` and `no-referrer`. Body limits are 32 KB, or 1.6 MB for photos only. Rate limits are 120/min and 15/min for AI. Every input is checked against allow-lists. Model output is treated as untrusted and re-validated, and prompts mark user and photo text as data. Photos are checked by magic bytes and never stored. All text is rendered with `textContent`. Upstream errors are hidden, and the Docker image runs as non-root.
- **Efficiency:** photos are resized on the device before upload; the service worker serves the app shell offline; the engine runs in the browser (instant recalculation, no server round-trip); forecasts cached per grid cell with in-flight de-duplication; identical briefing requests cached for 10 minutes; 3 runtime dependencies, no front-end build, the repo is a few hundred KB.
- **Accessibility:** semantic landmarks, skip link, every input labelled, `fieldset`/`legend` groups. Short spoken summaries replace whole live regions ("Comparison ready: family breathes 3.8% less"), and focus moves to results after big changes. Colour is never used alone: every band and chip has words, ↑/↓ arrows and patterns. Charts have text descriptions. It works keyboard-only, with 40 px+ targets and `prefers-reduced-motion`. Dark **and light themes** follow the system setting, with text contrast of at least 4.5:1 in both. Hindi output has `lang` set, and Smoke Detective has a photo-free checklist alternative. axe-core audits run in CI.

## Assumptions and limits

- Breathing rates: US EPA _Exposure Factors Handbook_ (2011), ch. 6, means by age group and activity.
- Indoor/outdoor and in-vehicle ratios are typical published values (home with windows open 0.8, shut 0.5, with purifier 0.25; school/office 0.6; two-wheeler 1.5, auto 1.4, bus 1.1, metro and closed car 0.6).
- Indoor sources add a typical concentration while they run (gas cooking +60 µg/m³, with exhaust +15, incense +90, mosquito coil +110, biomass stove +400).
- Emission factors are indicative Indian fleet averages per km (e.g. car 140 g CO₂, auto 60 g, two-wheeler 45 g, bus 25 g and metro 15 g per passenger).
- Cigarette equivalence: Berkeley Earth's rule of thumb (22 µg/m³ for 24 h ≈ 1 cigarette).
- Forecasts are model estimates (CAMS), not station readings. Everyone sleeps 10 PM–6 AM unless the plan says otherwise.
- Season savings assume every remaining smog-season day (to 28 Feb) is like the planned one; the neighbourhood ripple assumes each family makes the same switches.
- These are **estimates for comparing choices, not medical advice.** See [docs/science.md](docs/science.md).

## Project layout

```
src/engine/    pure model: dose, emissions, scenarios, optimiser, room, impact (season/ripple),
               scan (Smoke Detective rules), intent, validation, sample data
src/server/    app.js (composition), security.js (headers, rate limits), routes/ (air, ai), ai/ (briefing,
               whatif, roomScan, prompts), services/ (Open-Meteo, Gemini), cache, image checks
public/js/     app.js wires one module per section: forecast-panel, editor (+ editor-cards, editor-fields),
               home-settings, budget-panel (+ budget-view, ripple-panel), briefing-panel, whatif-panel,
               room-panel, scan; shared state.js, components.js, types.js, dom.js, api.js
public/        index.html, styles.css, self-hosted fonts (OFL), manifest and service worker
test/          engine, inputs, server, features, browser-logic, a11y and a11y-results suites
.github/       CI workflow
```
