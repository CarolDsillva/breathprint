# Security

Breathprint handles a family's daily routine and, optionally, a photo of a room in their home.
This page explains how that data and the app's secrets are protected.

## Reporting a problem

Please open a private security advisory on this repository (GitHub → Security → Report a
vulnerability) rather than a public issue.

## Data the app handles

| Data                                              | Where it goes                                                                                                                             | Kept?                                                                                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Family plan (first names, age groups, activities) | Calculated in the browser. Sent to the server only for the Gemini briefing and what-if questions.                                         | Saved only in the visitor's own browser (`localStorage`). The server keeps briefings in memory for 10 minutes to avoid repeat AI calls. |
| Location                                          | Coordinates rounded to ~11 km before the forecast lookup.                                                                                 | Not stored.                                                                                                                             |
| Room photo                                        | Resized on the device (max 1024 px, which also drops the original file and its location metadata), checked on the server, sent to Gemini. | Never stored or logged.                                                                                                                 |
| Gemini API key                                    | Server environment variable, sent to Google in a request header.                                                                          | Never sent to the browser, never in a URL, never logged.                                                                                |

## Protections

- **Strict Content-Security-Policy.** Scripts, styles, fonts and data come only from the app's own origin (fonts are self-hosted). No inline scripts or styles, no framing, and forms post only to the same site.
- **Permissions-Policy.** Only location and camera are allowed, for this site only. Microphone, payment, USB and other features are switched off.
- **Other headers (Helmet):** HSTS, `nosniff`, `no-referrer`, and a same-origin opener policy. `X-Powered-By` is removed.
- **Input validation.** Every request body is checked against allow-lists (ids, enums, number ranges, length caps). Unknown fields are dropped, and control characters and angle brackets are stripped. Body limit is 32 KB, or 1.6 MB for photos only.
- **Photo checks:** JPEG, PNG or WebP only, verified by the file's signature (magic bytes), not just its declared type. 1 MB cap after resizing.
- **Rate limits:** 120 requests a minute per IP, and 15 a minute for the AI routes.
- **AI output is untrusted.** Prompts mark user text and text inside photos as data, not instructions. Model answers must match a fixed JSON shape and, for what-ifs and photo findings, a fixed list of ids. Every answer is re-validated before use. All numbers shown to users come from the deterministic engine, never from the model.
- **No HTML injection.** The UI builds every element with `textContent`, never `innerHTML`.
- **Safe errors.** Upstream failures return a friendly message. Details are logged on the server only, and `/api/health` reports at most a short failure code.
- **Supply chain:** 3 runtime dependencies, and `npm audit` runs in CI on every push.
