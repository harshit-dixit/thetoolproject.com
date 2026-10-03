// Node checks use the actual registries and publication gate, including explicit overrides.
import assert from 'node:assert/strict';
import { loadRoutingRegistries } from './localized-redirects.mjs';

export function createPathResolver({ tools, pages }) {
  const resolve = (registry, id, locale, allowDrafts) => {
    const item = registry[id] ?? Object.values(registry).find(item => item.id === id);
    assert.ok(item, `Unknown routing identity: ${id}`);
    const entry = item.locales[locale];
    assert.ok(entry && (allowDrafts || entry.reviewed), `Unpublished route: ${id}:${locale}`);
    return entry.path;
  };
  return {
    toolPath: (id, locale = 'en') => resolve(tools, id, locale, false),
    pagePath: (id, locale = 'en') => resolve(pages, id, locale, false),
    configuredToolPath: (id, locale) => resolve(tools, id, locale, true),
  };
}

export async function loadPathResolver() {
  return createPathResolver(await loadRoutingRegistries());
}
