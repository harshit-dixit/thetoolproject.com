// Word, character, sentence and paragraph counts for the word counter, plus its top words list.
// Characters are grapheme clusters (what a reader sees as one character), so é, 👍🏽 and 🇯🇵 each count once.
// A word is a run between spaces with at least one letter or digit, like a word processor counts; scripts
// written without spaces (Chinese, Japanese, Thai…) are split into words with Intl.Segmenter instead.

export type TextStats = {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  letters: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  readingSeconds: number;
  speakingSeconds: number;
};

export type PhraseCount = { phrase: string; count: number; share: number };

export type Analysis = { stats: TextStats; runs: string[][] };

// Silent reading of non-fiction and reading aloud, from Brysbaert (2019), a review of 190 studies.
export const READING_WPM = 238;
export const SPEAKING_WPM = 183;
// Chinese and Japanese are timed by character instead, since their words have no fixed length.
export const READING_CPM = 500;
export const SPEAKING_CPM = 300;

const WORD_CHAR = /[\p{L}\p{N}]/u;
const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const CJK_CHARS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
// Text made only of these has one grapheme per UTF-16 unit, except CRLF: Latin, Greek and Cyrillic without combining marks.
const SIMPLE_TEXT = /^[\u0000-˿Ͱ-҂Ҋ-ԯ -⁯]*$/;

const segmenters = new Map<string, Intl.Segmenter>();
function segmenter(locale: string, granularity: 'grapheme' | 'word' | 'sentence') {
  if (typeof Intl.Segmenter !== 'function') return undefined;
  const key = `${locale}:${granularity}`;
  let found = segmenters.get(key);
  if (!found) segmenters.set(key, found = new Intl.Segmenter(locale, { granularity }));
  return found;
}

function countMatches(text: string, pattern: RegExp) {
  let count = 0;
  pattern.lastIndex = 0;
  while (pattern.exec(text)) count++;
  return count;
}

function countCharacters(text: string, locale: string) {
  const graphemes = segmenter(locale, 'grapheme');
  if (SIMPLE_TEXT.test(text) || !graphemes) {
    // Without Intl.Segmenter, code points are the closest fallback.
    const characters = (graphemes ? text.length : [...text].length) - countMatches(text, /\r\n/g);
    const spaces = countMatches(text, /\s/g) - countMatches(text, /\r\n/g);
    return { characters, charactersNoSpaces: characters - spaces, letters: countMatches(text, /\p{L}/gu) };
  }
  let characters = 0;
  let spaces = 0;
  let letters = 0;
  for (const { segment } of graphemes.segment(text)) {
    characters++;
    if (/^\s/.test(segment)) spaces++;
    else if (/^\p{L}/u.test(segment)) letters++;
  }
  return { characters, charactersNoSpaces: characters - spaces, letters };
}

/** Splits text into runs of words. A run ends at punctuation or a line break, so phrases never cross them. */
function wordRuns(text: string, locale: string) {
  const runs: string[][] = [];
  const words = segmenter(locale, 'word');
  let run: string[] = [];
  let cjkWords = 0;
  const end = () => { if (run.length) runs.push(run); run = []; };
  for (const line of text.split(/\r\n|\r|\n/)) {
    for (const token of line.split(/\s+/)) {
      if (!WORD_CHAR.test(token)) { if (token) end(); continue; }
      if (words && SPACELESS.test(token)) {
        for (const part of words.segment(token)) {
          if (part.isWordLike && WORD_CHAR.test(part.segment)) {
            run.push(part.segment);
            if (CJK.test(part.segment)) cjkWords++;
          } else if (!/^\s*$/.test(part.segment)) end();
        }
        continue;
      }
      const leading = /^[^\p{L}\p{N}]+/u.exec(token);
      const trailing = /[^\p{L}\p{N}]+$/u.exec(token);
      if (leading) end();
      run.push(token.replace(EDGE_PUNCTUATION, ''));
      if (trailing) end();
    }
    end();
  }
  return { runs, cjkWords };
}

function countSentences(text: string, locale: string) {
  const sentences = segmenter(locale, 'sentence');
  let count = 0;
  if (sentences) {
    for (const { segment } of sentences.segment(text)) if (WORD_CHAR.test(segment)) count++;
    return count;
  }
  for (const part of text.split(/[.!?…。！？]+|\n/)) if (WORD_CHAR.test(part)) count++;
  return count;
}

export function analyzeText(text: string, locale = 'en'): Analysis {
  const lines = text.split(/\r\n|\r|\n/);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const { runs, cjkWords } = wordRuns(text, locale);
  const words = runs.reduce((sum, run) => sum + run.length, 0);
  const cjkChars = countMatches(text, CJK_CHARS);
  const otherWords = words - cjkWords;
  return {
    runs,
    stats: {
      words,
      ...countCharacters(text, locale),
      sentences: countSentences(text, locale),
      paragraphs: lines.filter(line => line.trim()).length,
      lines: lines.length,
      readingSeconds: Math.round((otherWords / READING_WPM + cjkChars / READING_CPM) * 60),
      speakingSeconds: Math.round((otherWords / SPEAKING_WPM + cjkChars / SPEAKING_CPM) * 60),
    },
  };
}

/** Parses the space-separated stop word list from the translation files. */
export function stopWordSet(list: string, locale = 'en') {
  return new Set(list.split(/\s+/).filter(Boolean).map(word => normalizeWord(word, locale)));
}

function normalizeWord(word: string, locale: string) {
  return word.toLocaleLowerCase(locale).replace(/[‘’ʼ]/g, "'");
}

/**
 * The most frequent words (size 1) or phrases (2 or 3 words), ignoring case. With stop words, a word in the
 * list is skipped, and so is a phrase that starts or ends with one. `share` is count × size ÷ all words.
 */
export function topPhrases(runs: string[][], size: 1 | 2 | 3, options: { locale?: string; stopWords?: Set<string>; limit?: number } = {}): PhraseCount[] {
  const { locale = 'en', stopWords, limit = 10 } = options;
  const counts = new Map<string, number>();
  let total = 0;
  for (const run of runs) {
    const normalized = run.map(word => normalizeWord(word, locale));
    total += normalized.length;
    for (let i = 0; i + size <= normalized.length; i++) {
      if (stopWords && (stopWords.has(normalized[i]) || stopWords.has(normalized[i + size - 1]))) continue;
      const phrase = size === 1 ? normalized[i] : normalized.slice(i, i + size).join(' ');
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  // Map keeps first-seen order and the sort is stable, so ties stay in the order they appear in the text.
  return [...counts]
    .filter(([, count]) => size === 1 || count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([phrase, count]) => ({ phrase, count, share: total ? (count * size) / total : 0 }));
}
