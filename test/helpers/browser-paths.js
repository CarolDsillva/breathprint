// Module resolution hook for tests: the browser imports the engine as "/engine/…" (the server
// serves src/engine there), so map those specifiers to the source files when running in Node.
const ENGINE_PREFIX = '/engine/';
const ENGINE_DIR = new URL('../../src/engine/', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(ENGINE_PREFIX)) {
    return nextResolve(new URL(specifier.slice(ENGINE_PREFIX.length), ENGINE_DIR).href, context);
  }
  return nextResolve(specifier, context);
}
