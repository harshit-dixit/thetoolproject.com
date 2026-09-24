// Shared setup for the browser checks. Run `npm run build && npm run preview` first, then:
//   node scripts/browser-check.mjs [--browser=chromium|webkit|firefox] [--base=http://localhost:4321]
// Playwright's own browsers are used (`npx playwright install chromium webkit`). Set CHROME_PATH to use an installed Chrome instead.
import { chromium, firefox, webkit } from 'playwright';

const flag = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const engines = { chromium, firefox, webkit };
export const browserName = flag('browser') ?? process.env.BROWSER ?? 'chromium';
if (!engines[browserName]) throw new Error(`Unknown browser "${browserName}". Use chromium, webkit or firefox.`);
export const base = new URL('/json-to-html/', flag('base') ?? process.env.BASE_URL ?? 'http://localhost:4321').href;
export const positional = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
export function launch() {
  const executablePath = browserName === 'chromium' ? process.env.CHROME_PATH : undefined;
  return engines[browserName].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
}
