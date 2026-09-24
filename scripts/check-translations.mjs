import { readdirSync, readFileSync } from 'node:fs';
const folder = new URL('../src/i18n/', import.meta.url);
const en = JSON.parse(readFileSync(new URL('en.json', folder), 'utf8'));
for (const file of readdirSync(folder).filter(name => name.endsWith('.json') && name !== 'en.json')) {
  const data = JSON.parse(readFileSync(new URL(file, folder), 'utf8'));
  const missing = Object.keys(en).filter(key => !(key in data));
  if (missing.length) throw new Error(`${file} is missing: ${missing.join(', ')}`);
}
console.log('Translation keys checked');
