# Breathprint

[![CI](https://github.com/CarolDsillva/breathprint/actions/workflows/ci.yml/badge.svg)](https://github.com/CarolDsillva/breathprint/actions/workflows/ci.yml)
![Coverage: 100% of lines](https://img.shields.io/badge/coverage-100%25%20lines-brightgreen)
![Node 22+](https://img.shields.io/badge/node-%3E%3D22-blue)
[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

**Every breath leaves a print.** Breathprint is a GenAI-powered urban air quality assistant for families in smog-hit
cities. It works out how much PM2.5 **each person in the family actually breathes, hour by hour**, finds the choices
that cut it, and shows two impacts for every choice: what the family breathes, and what their trips add to the city.

**[Live app](https://breathprint-jade.vercel.app/)** · **[Demo video](https://youtu.be/_rJci_0Fc3c)** ·
**[Architecture](docs/ARCHITECTURE.md)** · **[The science](docs/science.md)** · **[Security](SECURITY.md)**

> **Chosen vertical:** PromptWars Challenge 6, Urban Air Quality Assistant. It suggests low-emission daily routines,
> indoor air-quality fixes and sustainable alternatives, tailored to the family's location and lifestyle, and
> explains the direct impact of each choice.

## Contents

- [Why Breathprint](#why-breathprint)
- [Features](#features)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [How Gemini is used](#how-gemini-is-used)
- [Engineering quality](#engineering-quality)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [Assumptions and limits](#assumptions-and-limits)
- [Contributing, security and licence](#contributing-security-and-licence)

## Why Breathprint

Most air-quality apps show a city AQI number and generic advice ("wear a mask"). But **a city's AQI is not what you
breathe; your day is.** A child playing cricket at 5 PM next to a busy road breathes many times more smog than a
grandparent indoors with the windows shut, in the same city on the same day. Breathprint plans around the
individual, then scales the effect up to the season and the neighbourhood.

## Features

| Feature                             | What it does                                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Family breath budget**            | PM2.5 inhaled per person: outdoor air × how much reaches where they are × how hard they breathe × time. Shown in µg, cigarette equivalents and × the WHO guideline.                             |
| **Hour-by-hour view**               | The forecast next to where each person is each hour: outdoors, travelling, school/office, home, indoor smoke, asleep.                                                                           |
| **Smarter plan**                    | One click moves flexible activities to cleaner hours, swaps transport, fixes indoor smoke and shuts windows. Every change is checked for clashes, sleep, distance and what transport is nearby. |
| **Two-sided ledger**                | Every choice shows both impacts, e.g. _metro instead of auto: Priya breathes 3% less, and the city gets 540 g less CO₂._                                                                        |
| **"What if…?"** (Gemini)            | Ask in plain words, even Hinglish: _"aarav ka cricket 3 baje kar dein to?"_. The engine shows before and after for every family member.                                                         |
| **Family briefing** (Gemini)        | A short, warm plan in English or Hindi, written only from the engine's numbers.                                                                                                                 |
| **Smoke Detective** (Gemini vision) | Photograph a kitchen, bedroom or puja corner. Gemini finds smoke sources and leaks, and each finding becomes a fix with its computed impact. A checklist does the same without a photo.         |
| **Season and neighbourhood impact** | _"Until 28 Feb, the smarter plan spares Aarav ≈ 237 cigarettes' worth of smoke"_ and _"100 families making the same switches avoid 63 kg CO₂ a day."_                                           |
| **Clean-room calculator**           | Minutes for a purifier (or a DIY box-fan filter) to make a bedroom safe, and the clean-air delivery rate (CADR) the room needs.                                                                 |
| **Inclusive and offline**           | Light and dark themes, screen-reader summaries, keyboard use, Hindi output. Installable, and the sample day works with no network.                                                              |

## Quick start

Requires Node.js 22 or newer.

```bash
git clone https://github.com/CarolDsillva/breathprint.git
cd breathprint
npm install
cp .env.example .env   # optional: add GEMINI_API_KEY to turn on the AI features
npm start              # http://localhost:8080
```

Press **Try a Delhi smog day** to explore without a network or a key. Without a Gemini key everything still works:
the briefing uses a template, what-ifs use an offline parser, and Smoke Detective uses its checklist.

**Deploy:** the app runs as-is on Vercel (set `GEMINI_API_KEY` in the project's environment variables) or on Google
Cloud Run with the included Dockerfile: `gcloud run deploy breathprint --source .`

## How it works

```
 Browser (ES modules, no build step)            Node.js server (Express 5)
 ┌──────────────────────────────┐               ┌─────────────────────────────────────┐
 │ public/js: one module per    │ /api/places   │ routes/air  → Open-Meteo geocoding    │
 │ section, shared state        │ /api/forecast │             → Open-Meteo CAMS PM2.5   │
 │                              │──────────────▶│               (cached per ~11 km)     │
 │ /engine/* ◀── same code ───▶ │ /api/briefing │ routes/ai   → ai/briefing ─┐          │
 │ src/engine: pure model,      │ /api/whatif   │             → ai/whatif ───┼─ Gemini  │
 │ runs instantly and offline   │ /api/scan     │             → ai/roomScan ─┘          │
 └──────────────────────────────┘               └─────────────────────────────────────┘
```

1. **Forecast.** Hourly PM2.5 for today and tomorrow from Open-Meteo (CAMS model; free, no key).
2. **Engine** (`src/engine`). Pure, deterministic functions that **both** the browser and the server import: dose,
   emissions, scenarios, optimiser, purifier model, season and neighbourhood impact, offline parser and validation.
   The browser recalculates instantly with no server round-trip, and the tests cover exactly the code users run.
3. **AI layer** (`src/server/ai`). Gemini explains and understands; the engine decides and computes. See below.

The design decisions behind this are in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**, and the formulas are in
**[docs/science.md](docs/science.md)**.

## How Gemini is used

Gemini (`gemini-flash-lite-latest`, with `gemini-flash-latest` as an automatic backup) is called **only from the
server**, so the key never reaches the browser. It is used in three places:

| Feature         | Route           | What Gemini does                                                                 | Safeguard                                                                      |
| --------------- | --------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Family briefing | `/api/briefing` | Turns facts computed by the engine into a short plan in English or Hindi         | Fixed JSON shape, sanitised, length-capped. It may use only the given numbers. |
| What-if         | `/api/whatif`   | Turns a free-text question (English, Hindi, Hinglish) into one structured change | Only known ids, modes and sources; re-validated and feasibility-checked        |
| Smoke Detective | `/api/scan`     | Lists what it sees in a room photo (resized on the device, never stored)         | Answers only from a fixed list of 12 findings; the engine computes the impact  |

All prompts mark user text, and text inside photos, as data rather than instructions. **The model never produces a
number the user sees.** Every feature falls back to offline logic if Gemini is off, slow or wrong.

## Engineering quality

- **Code quality.** Small single-purpose modules: one per UI section, one per AI feature, and separate routes,
  security and config. ESLint enforces complexity ≤ 15, ≤ 80 lines per function, ≤ 300 per file, ≤ 4 parameters,
  and a doc comment on every function. A strict TypeScript check (`strict`, `noImplicitAny`) runs over JSDoc types
  in all code, with **no `any`**: untrusted input is `unknown` until a type guard has checked it. Prettier and
  EditorConfig keep the style consistent. Conventions are in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Testing.** 144 tests with Node's built-in runner, at **100% line coverage** across engine, server and browser
  code. They include:
  - hand-calculated dose checks;
  - HTTP tests for every route, with Gemini and Open-Meteo stubbed;
  - a full-page test that loads the real page and `app.js` in jsdom and drives every section like a user;
  - two automated axe-core WCAG 2.1 AA audits.
- **Security.** Strict same-origin Content-Security-Policy with self-hosted fonts, a Permissions-Policy, Helmet
  headers, rate limits, size limits, allow-list validation, photo signature checks, and no `innerHTML`. Details in
  [SECURITY.md](SECURITY.md).
- **Efficiency.** The engine runs in the browser. Forecasts are cached per grid cell with in-flight de-duplication,
  and repeated briefings are cached. Photos are resized on the device, and a service worker serves the app offline.
  There are three runtime dependencies and no front-end build.
- **Accessibility.**
  - Landmarks, a skip link, and every control labelled.
  - Short screen-reader summaries instead of whole live regions.
  - Colour never used alone, and text descriptions for charts.
  - Keyboard use, 40 px+ targets and reduced motion.
  - Light and dark themes with 4.5:1 contrast.
  - Hindi output tagged with `lang`.
- **CI.** GitHub Actions on Node 22 and 24 runs format check, lint, type-check, tests with coverage, and
  `npm audit`.

## Configuration

Set these in `.env` locally, or in your host's environment. All are optional.

| Variable         | Default                    | Meaning                                                  |
| ---------------- | -------------------------- | -------------------------------------------------------- |
| `GEMINI_API_KEY` | _(none: offline mode)_     | Google AI Studio key for the briefing, what-if and scans |
| `GEMINI_MODEL`   | `gemini-flash-lite-latest` | Gemini model to use; `gemini-flash-latest` is the backup |
| `PORT`           | `8080`                     | HTTP port                                                |

Invalid values fall back to the defaults with a warning (see `src/server/config.js`).

## Scripts

| Command             | What it does                                               |
| ------------------- | ---------------------------------------------------------- |
| `npm start`         | Start the server                                           |
| `npm run dev`       | Start with automatic restart on changes                    |
| `npm test`          | Run all tests (no network needed)                          |
| `npm run coverage`  | Run tests with a coverage report                           |
| `npm run lint`      | ESLint, including size, complexity and documentation rules |
| `npm run typecheck` | Strict TypeScript check of the JSDoc types                 |
| `npm run format`    | Format everything with Prettier                            |
| `npm run check`     | Format check, lint, type-check and tests: what CI runs     |

## Project structure

```
src/engine/        Pure model shared by browser and server
  constants.js       reference values (breathing rates, transport, smoke sources) with sources
  dose.js            inhaled dose per person, hour-by-hour timeline
  emissions.js       trip CO₂ and PM2.5
  scenario.js        apply, check, describe and compare a change
  optimizer.js       rank changes, build the smarter day
  impact.js          smog-season and neighbourhood totals
  room.js            purifier mass-balance model
  scan.js            Smoke Detective findings → fixes
  intent.js          offline what-if parser
  validate.js        strict input validation
src/server/        Express app
  app.js · config.js · security.js · cache.js · image.js
  routes/            air (places, forecast) and ai (briefing, whatif, scan)
  ai/                briefing, whatif, roomScan, prompts
  services/          Open-Meteo and Gemini clients
public/            Front end (no build step)
  js/app.js          wires one module per page section
  js/*-panel.js      forecast, budget, ripple, briefing, what-if, room
  js/editor*.js      family editor: wiring, cards, field rules
  js/state.js · components.js · dom.js · api.js · types.js
test/              node:test suites, including the full-page and accessibility tests
docs/              architecture and science notes
```

## Assumptions and limits

- Breathing rates come from the US EPA _Exposure Factors Handbook_ (2011), ch. 6.
- Indoor/outdoor and in-vehicle ratios, indoor smoke sources and emission factors are typical published values.
  All of them are listed with sources in [docs/science.md](docs/science.md).
- Cigarette equivalence follows Berkeley Earth's rule of thumb: 22 µg/m³ for 24 h ≈ 1 cigarette.
- Forecasts are model estimates (CAMS), not station readings.
- Season totals assume every remaining smog-season day is like the planned one.
- These are **estimates for comparing choices, not medical advice.**

## Contributing, security and licence

- [CONTRIBUTING.md](CONTRIBUTING.md): setup, checks and code conventions.
- [SECURITY.md](SECURITY.md): data handling and how to report a problem.
- [MIT licence](LICENSE). The Geist fonts are under the SIL Open Font License ([public/fonts/OFL-LICENSE.txt](public/fonts/OFL-LICENSE.txt)).
