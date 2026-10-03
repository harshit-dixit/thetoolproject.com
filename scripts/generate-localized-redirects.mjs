import { generateLocalizedRedirects } from './localized-redirects.mjs';

const args = process.argv.slice(2);
if (args.some(arg => !['--check', '--dist-check'].includes(arg))) {
  throw new Error('Use no arguments to generate, --check to verify source, or --dist-check to verify source and build output');
}
const rules = await generateLocalizedRedirects({ check: args.includes('--check'), distCheck: args.includes('--dist-check') });
console.log(`Localized redirects ${args.length ? 'verified' : 'generated'}: ${rules.length} exact permanent rules.`);
