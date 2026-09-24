import { describe, expect, it } from 'vitest';
import { MAX_NESTING, convertJson, diagnose, findSyntaxError, parsePreservingIntegers, wrapJsonLines } from './json-to-html';

describe('JSON to HTML', () => {
  it('uses a union of object keys in first-seen order and empty missing cells', () => {
    const html = convertJson('[{"b":1},{"a":2,"b":3}]').html;
    expect(html.indexOf('>b</th>')).toBeLessThan(html.indexOf('>a</th>'));
    expect(html).toContain('<td></td>');
    expect(html).toContain('<thead>');
  });
  it('renders a root object as key/value rows', () => {
    const html = convertJson('{"name":"Ada","active":true,"missing":null}').html;
    expect(html).toContain('<th scope="row">name</th>');
    expect(html).toContain('<td>Ada</td>');
    expect(html).toContain('<td>true</td>');
    expect(html).toContain('<td></td>');
  });
  it('renders root primitives and primitive arrays', () => {
    expect(convertJson('42').html).toContain('<td>42</td>');
    expect(convertJson('"hello"').html).toContain('<td>hello</td>');
    expect(convertJson('[1,false,null]').html).toContain('<td>false</td>');
    expect(convertJson('[1,false,null]').columns).toBe(1);
  });
  it('renders nested objects and arrays as tables and lists', () => {
    const html = convertJson('[{"object":{"x":1},"records":[{"y":2}],"values":["a","b"]}]').html;
    expect(html.match(/<table>/g)).toHaveLength(3);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>a</li>');
  });
  it('renders list layout as nested ul and dl', () => {
    const html = convertJson('{"a":[{"b":1}]}', 'list').html;
    expect(html).toContain('<dl>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<dt>b</dt>');
  });
  it('wraps a full page with essential metadata and style', () => {
    const html = convertJson('{"x":1}', 'table', 'page').html;
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<style>');
  });
  it('escapes dangerous keys and values into inert text', () => {
    const html = convertJson('{"<script>alert(1)</script>": "<img src=x onerror=alert(1)>\\\"\u0027&"}').html;
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
    expect(html).toContain('&amp;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
  });
  it('keeps Unicode and emoji', () => {
    expect(convertJson('{"city":"Zürich","mark":"🌍"}').html).toContain('🌍');
  });
  it('handles empty object and array', () => {
    expect(convertJson('{"empty":{},"list":[]}').html.match(/<td><\/td>/g)).toHaveLength(2);
    expect(convertJson('[]').rows).toBe(0);
  });
  it('handles 100 levels of nesting and gives a clear error for much deeper data', () => {
    const source = '['.repeat(100) + '0' + ']'.repeat(100);
    expect(convertJson(source).html).toContain('<td>');
    const tooDeep = '{"x":'.repeat(200) + '0' + '}'.repeat(200);
    let error: unknown;
    try { convertJson(tooDeep); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: 'depth' });
  });
  it.each(['table', 'list'] as const)('applies the same nesting limit in %s layout', layout => {
    const nest = (levels: number) => '{"x":'.repeat(levels) + '0' + '}'.repeat(levels);
    expect(convertJson(nest(MAX_NESTING), layout).html).toContain('0');
    expect(() => convertJson(nest(MAX_NESTING + 1), layout)).toThrow(expect.objectContaining({ code: 'depth' }));
  });
  it('reads only own keys, so inherited property names stay empty', () => {
    const html = convertJson('[{"a":1},{"constructor":2,"toString":"x","__proto__":"p"}]').html;
    expect(html).not.toContain('native code');
    expect(html).toContain('<td>p</td>');
    expect(html.match(/<td><\/td>/g)).toHaveLength(4);
  });
  it('treats a key named like the internal large-number marker as data', () => {
    expect(convertJson('{"__largeJsonInteger":{"a":1}}').html).toContain('<th scope="row">a</th>');
  });
  it('keeps large integer digits in browsers without JSON.parse source access', () => {
    const { value, fallback } = parsePreservingIntegers('{"id":9007199254740993,"note":"9007199254740993","small":1}', false);
    expect(fallback).toBe(true);
    expect((value as { note: string }).note).toBe('9007199254740993');
    expect((value as { id: { digits: string } }).id.digits).toBe('9007199254740993');
  });
  it('keeps integer digits beyond Number.MAX_SAFE_INTEGER', () => {
    const result = convertJson('{"id":9007199254740993,"negative":-9007199254740995}');
    expect(result.html).toContain('9007199254740993');
    expect(result.html).toContain('-9007199254740995');
    expect(result.html).not.toContain('9007199254740992');
  });
  it('limits only the preview to 500 rows', () => {
    const source = JSON.stringify(Array.from({ length: 501 }, (_, i) => ({ i })));
    const result = convertJson(source);
    expect(result.rows).toBe(501);
    expect(result.previewRows).toBe(500);
    expect(result.html).toContain('<td>500</td>');
    expect(result.previewHtml).not.toContain('<td>500</td>');
  });
  it('limits the preview of a large root object too', () => {
    const source = JSON.stringify(Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`k${i}`, i])));
    const result = convertJson(source);
    expect(result.previewRows).toBe(500);
    expect(result.html).toContain('>k599</th>');
    expect(result.previewHtml).toContain('>k499</th>');
    expect(result.previewHtml).not.toContain('>k500</th>');
  });
  it.each([
    ['trailingComma', '{"a":1,}', 1, 7],
    ['singleQuote', "{'a':1}", 1, 2],
    ['unquotedKey', '{a:1}', 1, 2],
    ['comment', '{\n  // note\n  "a":1\n}', 2, 3],
    ['jsonLines', '{"a":1}\n{"a":2}', 2, 1],
    ['trailingComma', '[1, 2,\n]', 1, 6],
    ['syntax', '{\n  "a": 1\n  "b": 2\n}', 3, 3],
    ['syntax', '{"a": "open', 1, 12],
    ['syntax', '{"a": "bad \\x escape"}', 1, 12],
    ['syntax', '[1, 2', 1, 6],
    ['syntax', '{"a":1}}', 1, 8],
    ['syntax', '{"a" 1}', 1, 6],
    ['syntax', '[01]', 1, 3],
  ])('identifies %s at the right line and column: %j', (code, source, line, column) => {
    expect(diagnose(source)).toMatchObject({ code, line, column });
  });
  it('reports the first mistake, not the first pattern that looks like one', () => {
    expect(diagnose('{"a": "it\'s", "b": 1,, }')).toMatchObject({ code: 'syntax', column: 22 });
    expect(diagnose('{"url": "http://x", c: 1}')).toMatchObject({ code: 'unquotedKey', column: 21 });
  });
  it('agrees with JSON.parse on what is valid', () => {
    for (const source of ['{}', '[]', ' 0 ', '-1.5e+3', '"\\u00e9\\n"', '{"a":[true,false,null,{"b":[]}]}', '\t[\r\n1 ]']) {
      expect(() => JSON.parse(source)).not.toThrow();
      expect(findSyntaxError(source)).toBeNull();
    }
    for (const source of ['{', '[1,]', 'tru', '+1', '.5', '1.', '"a\tb"', '{"a":1,}', 'NaN', '﻿{}']) {
      expect(() => JSON.parse(source)).toThrow();
      expect(findSyntaxError(source)).not.toBeNull();
    }
  });
  it('reports empty input and a general syntax position', () => {
    expect(diagnose('  ')).toMatchObject({ code: 'empty', line: 1, column: 1 });
    let error: unknown;
    try { convertJson('{"a": }'); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: 'syntax', line: 1, column: 7 });
  });
  it('wraps JSON Lines as an array', () => {
    expect(JSON.parse(wrapJsonLines('{"a":1}\n{"a":2}'))).toHaveLength(2);
  });
});
