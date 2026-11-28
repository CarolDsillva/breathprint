# Contributing

Thanks for helping make smoggy days a little healthier.

## Setup

```bash
npm install
cp .env.example .env   # optional: GEMINI_API_KEY for the AI features
npm run dev            # http://localhost:8080, restarts on changes
```

## Before you push

```bash
npm run check          # format check, lint, type-check and tests: the same as CI
npm run format         # fix formatting
```

## Conventions

- **Where code goes.** Anything that calculates belongs in `src/engine` as a pure function (no I/O, no DOM). The
  server and the browser both import it. UI code goes in `public/js`, one module per page section.
- **Size limits** (enforced by ESLint): complexity ≤ 15, ≤ 80 lines per function, ≤ 300 lines per file,
  ≤ 4 parameters. Prefer an options object or a lookup table to more arguments or longer `if` chains.
- **Types.** Write JSDoc types; `npm run typecheck` runs TypeScript in strict mode. Don't use `any`. Treat untrusted
  data as `unknown` and narrow it with a type guard. Prefer a runtime check (`inputById`, `instanceof`) to a cast.
- **Documentation.** Every function gets a one-line description of what it does (ESLint checks this). Explain _why_
  in comments, not _what_.
- **Safety.** Build DOM with `h()` from `dom.js`, never `innerHTML`. Validate every request body against
  allow-lists. Treat model output as untrusted and re-validate it. Never send the Gemini key to the browser.
- **Accessibility.** Every control needs a label. Never show meaning by colour alone. Announce results with
  `announce()`, not by making large areas live. Keep text contrast at 4.5:1 or better in both themes.
- **Tests.** Add tests with every change. `npm run coverage` should stay at 100% of lines. UI behaviour belongs in
  `test/app.test.js`, which drives the real page.
- **Commits.** Use the imperative mood, with a short summary line and details in the body when useful.
