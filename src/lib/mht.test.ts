import { describe, expect, it } from 'vitest';
import { createResolver, isWebAddress, linkUrl, MhtError, parseMht, rewriteCss, rewriteSrcset } from './mht';

const encode = (text: string) => new TextEncoder().encode(text.replace(/\n/g, '\r\n'));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// The shape Chrome and Edge write for "Webpage, single file".
const chrome = [
  'From: <Saved by Blink>', 'Snapshot-Content-Location: https://example.com/blog/tea.html', 'Subject: =?utf-8?Q?Green_tea_=E2=80=93_a_guide?=',
  'Date: Tue, 12 Mar 2024 14:30:00 -0000', 'MIME-Version: 1.0',
  'Content-Type: multipart/related;', '\ttype="text/html";', '\tboundary="----MultipartBoundary--abc----"', '', '',
  '------MultipartBoundary--abc----', 'Content-Type: text/html', 'Content-ID: <frame-1@mhtml.blink>', 'Content-Transfer-Encoding: quoted-placeholder',
].join('\n');

const chromePage = [
  'From: <Saved by Blink>', 'Snapshot-Content-Location: https://example.com/blog/tea.html', 'Subject: =?utf-8?Q?Green_tea_=E2=80=93_a_guide?=',
  'Date: Tue, 12 Mar 2024 14:30:00 -0000', 'MIME-Version: 1.0',
  'Content-Type: multipart/related;', '\ttype="text/html";', '\tboundary="----MultipartBoundary--abc----"', '', '',
  '------MultipartBoundary--abc----', 'Content-Type: text/html', 'Content-ID: <frame-1@mhtml.blink>', 'Content-Transfer-Encoding: quoted-printable',
  'Content-Location: https://example.com/blog/tea.html', '',
  '<!DOCTYPE html><html><head><meta charset=3D"utf-8"><title>Green tea</title><link rel=3D"stylesheet" href=3D"../css/site.css"></head>',
  '<body><h1>Green tea</h1><p>Steep at 80 =C2=B0C.</p><img src=3D"img/cup.png"><a href=3D"/about">About</a></body></html>', '',
  '------MultipartBoundary--abc----', 'Content-Type: image/png', 'Content-Transfer-Encoding: base64', 'Content-Location: https://example.com/blog/img/cup.png', '', PNG, '',
  '------MultipartBoundary--abc----', 'Content-Type: text/css', 'Content-Transfer-Encoding: quoted-printable', 'Content-Location: https://example.com/css/site.css', '',
  'body { background: url("../img/bg.png"); }', '',
  '------MultipartBoundary--abc------', '',
].join('\n');

// Word's "Single File Web Page", with Windows-1252 text and file:// locations.
const word = [
  'MIME-Version: 1.0', 'Content-Type: multipart/related; boundary="----=_NextPart_01DA0000.12345678"', '',
  'This document is a Single File Web Page, also known as a Web Archive file.', '',
  '------=_NextPart_01DA0000.12345678', 'Content-Location: file:///C:/D0B1E2F3/Report.htm', 'Content-Transfer-Encoding: quoted-printable',
  'Content-Type: text/html; charset="windows-1252"', '',
  '<html><head><title>Quarterly report</title></head><body><p class=3DMsoNormal>Caf=E9 sales rose.</p>',
  '<img width=3D200 height=3D100 src=3D"Report_files/image001.png"></body></html>', '',
  '------=_NextPart_01DA0000.12345678', 'Content-Location: file:///C:/D0B1E2F3/Report_files/image001.png', 'Content-Transfer-Encoding: base64', 'Content-Type: image/png', '', PNG, '',
  '------=_NextPart_01DA0000.12345678--', '',
].join('\n');

// Windows Steps Recorder: relative locations.
const steps = [
  'MIME-Version: 1.0', 'Content-Type: multipart/related; boundary="=_NextPart_SMP_1d0"', '',
  '--=_NextPart_SMP_1d0', 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: 7bit', 'Content-Location: main.htm', '',
  '<html><body><p>Step 1: User left click on "Start"</p><img src="screenshot0001.JPEG"></body></html>', '',
  '--=_NextPart_SMP_1d0', 'Content-Type: image/jpeg', 'Content-Transfer-Encoding: base64', 'Content-Location: screenshot0001.JPEG', '', '/9j/4AAQ', '',
  '--=_NextPart_SMP_1d0--', '',
].join('\n');

describe('parseMht', () => {
  it('reads a Chrome archive: title, address, date, page and parts', () => {
    const archive = parseMht(encode(chromePage));
    expect(archive.title).toBe('Green tea – a guide');
    expect(archive.url).toBe('https://example.com/blog/tea.html');
    expect(archive.date).toBe('Tue, 12 Mar 2024 14:30:00 -0000');
    expect(archive.html).toContain('<p>Steep at 80 °C.</p>');
    expect(archive.parts.map(part => part.type)).toEqual(['image/png', 'text/css']);
    expect(archive.charsetFallback).toBe(false);
  });

  it('decodes Word pages in their charset and keeps local paths out of the address', () => {
    const archive = parseMht(encode(word));
    expect(archive.html).toContain('Café sales rose.');
    expect(archive.title).toBe('Quarterly report');
    expect(archive.url).toBe('');
  });

  it('uses the start parameter to pick the page', () => {
    const archive = parseMht(encode([
      'MIME-Version: 1.0', 'Content-Type: multipart/related; boundary=b; start="<page>"', '',
      '--b', 'Content-Type: text/html', 'Content-ID: <frame>', '', '<p>frame</p>',
      '--b', 'Content-Type: text/html', 'Content-ID: <page>', '', '<p>page</p>', '--b--', '',
    ].join('\n')));
    expect(archive.html).toBe('<p>page</p>');
    expect(archive.parts).toHaveLength(1);
  });

  it('accepts a plain HTML file named .mht and reads its meta charset', () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('<!doctype html><meta charset="windows-1252"><title>Old page</title><p>Na'), 0xef, ...new TextEncoder().encode('ve</p>')]);
    const archive = parseMht(bytes);
    expect(archive.html).toContain('Naïve');
    expect(archive.title).toBe('Old page');
    expect(archive.parts).toEqual([]);
  });

  it('explains files it cannot read', () => {
    const code = (text: string) => { try { parseMht(encode(text)); return ''; } catch (error) { return (error as MhtError).code; } };
    expect(code('  \n')).toBe('empty');
    expect(code('just some notes')).toBe('notMht');
    expect(code(['MIME-Version: 1.0', 'Content-Type: multipart/related; boundary=b', '', '--b', 'Content-Type: image/png', '', 'x', '--b--'].join('\n'))).toBe('noPage');
    expect(code(chrome)).toBe('');
  });
});

describe('createResolver', () => {
  it('finds parts by relative and absolute address, by case and by file name', () => {
    const archive = parseMht(encode(chromePage));
    const resolve = createResolver(archive);
    expect(resolve('img/cup.png')).toBe(0);
    expect(resolve('https://example.com/blog/img/cup.png#x')).toBe(0);
    expect(resolve('IMG/CUP.PNG')).toBe(0);
    expect(resolve('../css/site.css')).toBe(1);
    expect(resolve('../img/bg.png', 'https://example.com/css/site.css')).toBeUndefined();
    expect(resolve('data:image/png;base64,AAAA')).toBeUndefined();

    expect(createResolver(parseMht(encode(word)))('Report_files/image001.png')).toBe(0);
    const recorder = parseMht(encode(steps));
    expect(createResolver(recorder)('screenshot0001.JPEG')).toBe(0);
    // A part found only by its file name, as when a page was moved before saving.
    expect(createResolver(recorder)('C:\\Users\\me\\screenshot0001.jpeg')).toBe(0);
  });

  it('finds parts by Content-ID', () => {
    const resolve = createResolver({ base: '', parts: [{ type: 'image/png', bytes: new Uint8Array(), cid: 'Logo@Example' }] });
    expect(resolve('cid:logo@example')).toBe(0);
    expect(resolve('cid:other')).toBeUndefined();
  });
});

describe('addresses', () => {
  it('makes links absolute against the saved address only', () => {
    const archive = parseMht(encode(chromePage));
    expect(linkUrl('/about', archive)).toBe('https://example.com/about');
    expect(linkUrl('mailto:a@example.com', archive)).toBe('mailto:a@example.com');
    expect(linkUrl('page2.htm', parseMht(encode(word)))).toBeUndefined();
  });

  it('tells web images from files that were not saved', () => {
    expect(isWebAddress('https://cdn.example.com/a.png', { base: 'file:///C:/x/Report.htm' })).toBe(true);
    expect(isWebAddress('Report_files/missing.png', { base: 'file:///C:/x/Report.htm' })).toBe(false);
    expect(isWebAddress('missing.png', { base: 'main.htm' })).toBe(false);
    expect(isWebAddress('missing.png', { base: 'https://example.com/' })).toBe(true);
  });

  it('rewrites style sheet and srcset addresses', () => {
    const map = (url: string) => (url.endsWith('.png') || url.endsWith('.css') ? `blob:${url}` : undefined);
    expect(rewriteCss('a{background:url( "x.png" )} b{background:url(y.png)} c{src:url(font.woff)} @import "z.css";', map))
      .toBe('a{background:url("blob:x.png")} b{background:url("blob:y.png")} c{src:url(font.woff)} @import url("blob:z.css");');
    expect(rewriteSrcset('a.png 1x, b.png 2x', map)).toBe('blob:a.png 1x, blob:b.png 2x');
    expect(rewriteSrcset('data:image/png;base64,AAAA 1x,c.png 2x', map)).toBe('data:image/png;base64,AAAA 1x, blob:c.png 2x');
  });
});
