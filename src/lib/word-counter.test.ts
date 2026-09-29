import { describe, expect, it } from 'vitest';
import { analyzeText, stopWordSet, topPhrases } from './word-counter';

describe('analyzeText', () => {
  it('counts words between spaces, keeping contractions and hyphenated words whole', () => {
    const { stats } = analyzeText("Well-known authors don't write — they rewrite & edit.");
    expect(stats.words).toBe(7);
  });

  it('counts characters with and without spaces, and letters', () => {
    const { stats } = analyzeText('Hi there, 42!');
    expect(stats.characters).toBe(13);
    expect(stats.charactersNoSpaces).toBe(11);
    expect(stats.letters).toBe(7);
  });

  it('counts what a reader sees as one character once', () => {
    // A composed é, a decomposed é, a thumbs up with a skin tone, and a flag.
    const { stats } = analyzeText('é é 👍🏽 🇯🇵');
    expect(stats.characters).toBe(7);
    expect(stats.charactersNoSpaces).toBe(4);
    expect(stats.letters).toBe(2);
    expect(stats.words).toBe(2);
  });

  it('counts a Windows line break as one character and a line break as a space', () => {
    const { stats } = analyzeText('one\r\ntwo');
    expect(stats.characters).toBe(7);
    expect(stats.charactersNoSpaces).toBe(6);
    expect(stats.lines).toBe(2);
  });

  it('counts lines up to the last one with text, and paragraphs as lines with text', () => {
    const { stats } = analyzeText('Title\nFirst paragraph.\n\n\nSecond paragraph.\n\n');
    expect(stats.lines).toBe(5);
    expect(stats.paragraphs).toBe(3);
  });

  it('counts sentences, including a line without an end mark', () => {
    const { stats } = analyzeText('A heading\nIs this a question? Yes! It is 3.5 times longer, e.g. here.');
    expect(stats.sentences).toBe(4);
  });

  it('splits Chinese and Japanese into words and times them by character', () => {
    const { stats } = analyzeText('吾輩は猫である。名前はまだ無い。', 'ja');
    expect(stats.characters).toBe(16);
    expect(stats.words).toBeGreaterThan(5);
    expect(stats.sentences).toBe(2);
    // 14 kanji and kana at 500 a minute
    expect(stats.readingSeconds).toBe(2);
  });

  it('estimates reading and speaking time from the word count', () => {
    const { stats } = analyzeText('word '.repeat(476));
    expect(stats.readingSeconds).toBe(120);
    expect(stats.speakingSeconds).toBe(156);
  });

  it('returns zeros for empty or blank text', () => {
    expect(analyzeText('').stats).toEqual({ words: 0, characters: 0, charactersNoSpaces: 0, letters: 0, sentences: 0, paragraphs: 0, lines: 0, readingSeconds: 0, speakingSeconds: 0 });
    expect(analyzeText(' \n\t').stats.charactersNoSpaces).toBe(0);
  });
});

describe('topPhrases', () => {
  const { runs } = analyzeText('The cat sat. The cat ran! A dog and the Cat. Cat food, cat food.');
  const stopWords = stopWordSet('the a and');

  it('lists the most frequent words ignoring case, with their share of all words', () => {
    const top = topPhrases(runs, 1, { stopWords });
    expect(top[0]).toEqual({ phrase: 'cat', count: 5, share: 5 / 15 });
    expect(top.map(entry => entry.phrase)).toEqual(['cat', 'food', 'sat', 'ran', 'dog']);
  });

  it('keeps common words when no stop words are given', () => {
    expect(topPhrases(runs, 1)[0].phrase).toBe('cat');
    expect(topPhrases(runs, 1).some(entry => entry.phrase === 'the')).toBe(true);
  });

  it('finds repeated phrases without crossing punctuation', () => {
    expect(topPhrases(runs, 2)).toEqual([
      { phrase: 'the cat', count: 3, share: 6 / 15 },
      { phrase: 'cat food', count: 2, share: 4 / 15 },
    ]);
  });

  it('skips phrases that start or end with a stop word', () => {
    expect(topPhrases(runs, 2, { stopWords }).map(entry => entry.phrase)).toEqual(['cat food']);
  });

  it('matches curly and straight apostrophes', () => {
    const top = topPhrases(analyzeText('Don’t stop. don\'t').runs, 1, { stopWords: stopWordSet("don't") });
    expect(top.map(entry => entry.phrase)).toEqual(['stop']);
  });
});
