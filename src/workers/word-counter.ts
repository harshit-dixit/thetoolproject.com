import { analyzeText, stopWordSet, topPhrases, type Analysis, type PhraseCount, type TextStats } from '../lib/word-counter';

// `text` is left out when only the top words options changed, and the last text is reused.
export type WordCounterRequest = { id: number; text?: string; locale: string; size: 1 | 2 | 3; stopWords?: string };
export type WordCounterResponse = { id: number; stats: TextStats; top: PhraseCount[] };

let last: Analysis = analyzeText('');
let stopWords: { list: string; set: Set<string> } | undefined;

self.onmessage = (event: MessageEvent<WordCounterRequest>) => {
  const { id, text, locale, size } = event.data;
  if (text !== undefined) last = analyzeText(text, locale);
  if (event.data.stopWords && stopWords?.list !== event.data.stopWords) stopWords = { list: event.data.stopWords, set: stopWordSet(event.data.stopWords, locale) };
  const top = topPhrases(last.runs, size, { locale, stopWords: event.data.stopWords ? stopWords!.set : undefined });
  self.postMessage({ id, stats: last.stats, top } satisfies WordCounterResponse);
};
