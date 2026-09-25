import { describe, expect, it } from 'vitest';
import { beautifyJson } from './json-beautifier';

describe('beautifyJson', () => {
  it('formats nested JSON with selectable indentation', () => {
    const source = '{"name":"Maya","tags":["new",{"gift":true}]}';
    expect(beautifyJson(source, 2).json).toBe(JSON.stringify(JSON.parse(source), null, 2));
    expect(beautifyJson(source, 4).json).toBe(JSON.stringify(JSON.parse(source), null, 4));
    expect(beautifyJson(source, 'tab').json).toBe(JSON.stringify(JSON.parse(source), null, '\t'));
    expect(beautifyJson(source, 'compact').json).toBe(source);
  });

  it('preserves integer digits outside the safe number range', () => {
    const source = '{"id":9007199254740993,"negative":-9007199254740995,"text":"9007199254740993"}';
    expect(beautifyJson(source, 2).json).toContain('"id": 9007199254740993');
    expect(beautifyJson(source, 'compact').json).toBe(source);
  });

  it('accepts every JSON root type and reports a useful syntax location', () => {
    expect(beautifyJson('false').json).toBe('false');
    expect(beautifyJson('null').json).toBe('null');
    expect(beautifyJson('[]').json).toBe('[]');
    try { beautifyJson('{"a":1,}'); }
    catch (error) { expect(error).toMatchObject({ code: 'trailingComma', line: 1, column: 7 }); return; }
    throw new Error('Expected invalid JSON to be rejected');
  });
});
