// Server-side only: every locale dictionary, keyed by locale. Never import this from a
// client script; tool components pass the few keys a script needs through data-strings.
import en from './en.json';
import es from './es.json';
import pt from './pt.json';
import de from './de.json';
import fr from './fr.json';
import ja from './ja.json';
import { locales } from './locales.mjs';

export type Locale = typeof locales[number];
export type Dictionary = Record<string, string>;

export const dictionaries: Record<Locale, Dictionary> = { en, es, pt, de, fr, ja };
