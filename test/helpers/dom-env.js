// Shared browser-like environment for testing the front-end modules in Node: a jsdom page
// built from public/index.html, DOM globals, and "/engine/…" imports mapped to src/engine.
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { JSDOM, VirtualConsole } from 'jsdom';

register('./browser-paths.js', import.meta.url);

const html = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');

export const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: new VirtualConsole(),
});

Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  localStorage: dom.window.localStorage,
  Node: dom.window.Node,
  Event: dom.window.Event,
  FileReader: dom.window.FileReader,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLSelectElement: dom.window.HTMLSelectElement,
});
