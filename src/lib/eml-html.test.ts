import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToBlocks, textToBlocks, type Block, type TextBlock } from './eml-html';

const texts = (blocks: Block[]) => blocks.filter((block): block is TextBlock => block.kind === 'text').map(block => block.runs.map(run => run.text).join(''));

describe('htmlToBlocks', () => {
  it('collapses whitespace and splits paragraphs, keeping line breaks', () => {
    const { blocks } = htmlToBlocks('<html><head><title>x</title><style>p{color:red}</style></head><body><p>Hello\n   <b>Luis</b>,</p><p>Line one<br>line two<br></p></body></html>');
    expect(texts(blocks)).toEqual(['Hello Luis,', 'Line one\nline two']);
    const first = blocks[0] as TextBlock;
    expect(first.runs).toEqual([{ text: 'Hello ' }, { text: 'Luis', bold: true }, { text: ',' }]);
    expect(blocks[1].gap).toBe(true);
  });

  it('keeps an empty line made with <div><br></div>', () => {
    expect(texts(htmlToBlocks('<div>One</div><div><br></div><div>Two</div>').blocks)).toEqual(['One', '\n', 'Two']);
  });

  it('skips hidden preheaders, scripts and comments', () => {
    const html = '<div style="display:none;max-height:0">Preview text</div><!-- note --><script>alert(1)</script><span style="font-size:0px">x</span><p>Shown</p>';
    expect(texts(htmlToBlocks(html).blocks)).toEqual(['Shown']);
  });

  it('keeps links that are http, https or mailto only', () => {
    const { blocks } = htmlToBlocks('<p><a href="https://example.com/a?b=1&amp;c=2">site</a> <a href="javascript:alert(1)">bad</a></p>');
    const runs = (blocks[0] as TextBlock).runs;
    expect(runs[0]).toEqual({ text: 'site', href: 'https://example.com/a?b=1&c=2' });
    expect(runs.slice(1).every(run => !run.href)).toBe(true);
  });

  it('marks list items, headings and quotes', () => {
    const { blocks } = htmlToBlocks('<h2>Agenda</h2><ol><li>First<li>Second<ul><li>Nested</li></ul></li></ol><blockquote><p>Quoted</p></blockquote>');
    expect(blocks.map(block => block.kind === 'text' ? [block.runs[0].text, block.level, block.marker ?? '', block.indent, block.quote] : block.kind)).toEqual([
      ['Agenda', 2, '', 0, 0], ['First', 0, '1.', 1, 0], ['Second', 0, '2.', 1, 0], ['Nested', 0, '•', 2, 0], ['Quoted', 0, '', 0, 1],
    ]);
  });

  it('turns a data table into a grid and a layout table into a flow', () => {
    const data = htmlToBlocks('<table><tr><th>Item</th><th>Price</th></tr><tr><td>Tea</td><td>$4</td></tr></table>').blocks;
    expect(data).toHaveLength(1);
    expect(data[0].kind).toBe('table');
    const grid = data[0] as Extract<Block, { kind: 'table' }>;
    expect(grid.rows.map(row => row.map(cell => cell.runs.map(run => run.text).join('')))).toEqual([['Item', 'Price'], ['Tea', '$4']]);
    expect(grid.rows[0][0].runs[0].bold).toBe(true);

    const layout = htmlToBlocks('<table><tr><td><table><tr><td>Hi</td><td>there</td></tr></table></td></tr><tr><td><p>Footer</p></td></tr></table>').blocks;
    expect(layout.map(block => block.kind)).toEqual(['table', 'text']);
  });

  it('puts stray text between table tags before the table', () => {
    const { blocks } = htmlToBlocks('<table>stray<tr><td>a</td><td>b</td></tr></table>');
    expect(blocks.map(block => block.kind)).toEqual(['text', 'table']);
  });

  it('counts remote images without loading them and keeps inline ones', () => {
    const body = htmlToBlocks('<img src="https://tracker.example/p.gif" width="1" height="1"><img src="https://cdn.example/logo.png" alt="ACME"><img src="cid:logo@x" width="120">');
    expect(body.remoteImages).toBe(1);
    expect(texts(body.blocks)).toEqual(['[ACME]']);
    expect(body.blocks[1]).toMatchObject({ kind: 'image', src: 'cid:logo@x', width: 120 });
  });

  it('respects style overrides such as Google Docs bold spans', () => {
    const runs = (htmlToBlocks('<b style="font-weight:normal"><span style="font-weight:700">A</span> b</b>').blocks[0] as TextBlock).runs;
    expect(runs).toEqual([{ text: 'A', bold: true }, { text: ' b' }]);
  });

  it('survives malformed markup', () => {
    expect(texts(htmlToBlocks('<p>One<div>Two</p>Three</div>').blocks)).toEqual(['One', 'Two', 'Three']);
    // An unclosed quote ends the tag at the next ">", so the rest of the text isn't lost.
    expect(texts(htmlToBlocks('<p>Hi <a href="x>there</a> tail').blocks)).toEqual(['Hi there tail']);
  });
});

describe('decodeEntities', () => {
  it('decodes named, numeric and Windows-1252 references', () => {
    expect(decodeEntities('&lt;a&gt; &amp; &eacute; &#8364; &#x1F600; &#150; &bogus;')).toBe('<a> & é € 😀 – &bogus;');
  });
});

describe('textToBlocks', () => {
  it('keeps lines, groups quotes and links URLs', () => {
    const { blocks } = textToBlocks('Hi,\nsee https://example.com/x.\n\n> earlier\n> > older\n');
    expect(blocks.map(block => [texts([block])[0], block.quote, block.gap])).toEqual([
      ['Hi,\nsee https://example.com/x.', 0, false], ['earlier', 1, true], ['older', 2, false],
    ]);
    expect((blocks[0] as TextBlock).runs.find(run => run.href)?.href).toBe('https://example.com/x');
  });
});
