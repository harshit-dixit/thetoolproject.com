import { locales } from '../i18n/locales.mjs';

const ordinaryPages = new Set(['about', 'contact', 'privacy', 'terms']);
const reserved = new Set(['404', '500', 'api', 'assets', 'fonts', 'guides', 'blog', '_astro']);
const identity = (kind, id, locale) => `${kind}:${id}:${locale}`;
const fail = message => { throw new Error(`Localized paths: ${message}`); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Migration paths are ASCII, lowercase, normalized directory URLs. */
export function validateLocalizedPath(path, locale) {
  if (typeof path !== 'string' || !/^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)+$/.test(path)) {
    fail(`invalid normalized path: ${String(path)}`);
  }
  if (!path.startsWith(`/${locale}/`) || path === `/${locale}/`) {
    fail(`expected /${locale}/ prefix and a page slug: ${path}`);
  }
  const segment = path.split('/')[2];
  if (reserved.has(segment) || locales.includes(segment)) fail(`reserved path: ${path}`);
}

/** The three public HTML forms for a canonical directory path. */
export function historicalPathForms(path) {
  return [path, path.slice(0, -1), `${path}index.html`];
}

/**
 * Validate against actual registries, including draft paths for collision checks.
 * baseline is the immutable Phase 0 publishedRoutes array; optional for isolated fixtures.
 * Returns exact, direct permanent redirects, sorted independently of object insertion order.
 */
export function validateLocalizedPaths(mapping, { tools, pages }, baseline) {
  if (!isObject(mapping) || Object.keys(mapping).some(kind => !['tool', 'page'].includes(kind))) {
    fail('unknown kind or invalid map');
  }
  const items = { tool: Object.values(tools), page: Object.values(pages).filter(Boolean) };
  const configured = new Map();
  const changes = [];
  for (const kind of ['tool', 'page']) {
    const group = mapping[kind] === undefined ? {} : mapping[kind];
    if (!isObject(group)) fail(`invalid ${kind} map`);
    for (const [id, translations] of Object.entries(group)) {
      const item = items[kind].find(item => item.id === id);
      if (!item) fail(`unknown ${kind} ID: ${id}`);
      if (kind === 'page' && !ordinaryPages.has(id)) fail(`cannot change special page: ${id}`);
      if (!isObject(translations) || !Object.keys(translations).length) fail(`empty locale map: ${kind}:${id}`);
      for (const [locale, change] of Object.entries(translations)) {
        const key = identity(kind, id, locale);
        if (!locales.includes(locale)) fail(`unknown locale: ${key}`);
        if (locale === 'en') fail(`cannot change English: ${key}`);
        const entry = item.locales[locale];
        if (!entry?.reviewed) fail(`destination is not published: ${key}`);
        if (locale === 'ja') fail(`Japanese paths are retained by policy: ${key}`);
        if (!isObject(change) || Object.keys(change).some(key => !['path', 'previousPaths'].includes(key))) {
          fail(`invalid change: ${key}`);
        }
        validateLocalizedPath(change.path, locale);
        if (!Array.isArray(change.previousPaths) || !change.previousPaths.length) fail(`missing historical paths: ${key}`);
        const seen = new Set();
        for (const oldPath of change.previousPaths) {
          validateLocalizedPath(oldPath, locale);
          if (seen.has(oldPath)) fail(`duplicate historical path: ${oldPath}`);
          seen.add(oldPath);
          if (oldPath === change.path) fail(`self-redirect: ${oldPath}`);
        }
        if (baseline) {
          const old = baseline.find(row => row.kind === kind && row.stableId === id && row.locale === locale);
          if (!old || !seen.has(old.oldCanonicalPath)) fail(`missing published baseline alias: ${key}`);
          for (const oldPath of seen) {
            const owner = baseline.find(row => row.oldCanonicalPath === oldPath);
            if (owner && identity(owner.kind, owner.stableId, owner.locale) !== key) {
              fail(`historical path belongs to another entry: ${oldPath}`);
            }
          }
        }
        if (entry.path !== change.path) fail(`registry destination disagrees with mapping: ${key}`);
        changes.push({ key, ...change });
      }
    }
    for (const item of items[kind]) {
      for (const [locale, entry] of Object.entries(item.locales)) {
        if (!entry) continue;
        const key = identity(kind, item.id, locale);
        // Reserve drafts too: migration must not shadow an opt-in preview path.
        const forms = entry.path.endsWith('/') ? historicalPathForms(entry.path) : [entry.path];
        for (const form of forms) {
          if (configured.has(form)) fail(`duplicate destination: ${form}`);
          configured.set(form, key);
        }
      }
    }
  }
  const sources = new Map();
  for (const change of changes) {
    for (const oldPath of change.previousPaths) {
      for (const source of historicalPathForms(oldPath)) {
        if (configured.has(source)) fail(`historical source collides with an active path (chain or loop): ${source}`);
        if (sources.has(source)) fail(`duplicate redirect source: ${source}`);
        sources.set(source, { source, destination: change.path, status: 301 });
      }
    }
  }
  return [...sources.values()].sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
}
