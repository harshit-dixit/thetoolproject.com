import { describe, expect, it } from 'vitest';
import { EmlError, decodeWords, parseEml, parseStructured, quotedPrintableBinary, unflow } from './eml';

const encode = (text: string) => new TextEncoder().encode(text.replace(/\n/g, '\r\n'));
const utf8Base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

describe('parseEml', () => {
  it('reads headers and a plain-text body', () => {
    const email = parseEml(encode('From: Maya <maya@example.com>\nTo: luis@example.com\nSubject: Q1 invoice\nDate: Tue, 12 Mar 2024 14:30:00 +0100\n\nHi Luis,\nAttached.\n'));
    expect(email.headers).toMatchObject({ from: 'Maya <maya@example.com>', to: 'luis@example.com', subject: 'Q1 invoice', date: 'Tue, 12 Mar 2024 14:30:00 +0100' });
    expect(email.text).toEqual(['Hi Luis,\nAttached.\n']);
    expect(email.html).toEqual([]);
  });

  it('unfolds headers and decodes encoded words, joining split multibyte characters', () => {
    const subject = utf8Base64('Überweisung €');
    const half = Math.ceil(subject.length / 8) * 4;
    const email = parseEml(encode(`Subject: =?UTF-8?B?${subject.slice(0, half)}?=\n =?UTF-8?B?${subject.slice(half)}?=\nFrom: =?iso-8859-1?Q?Jos=E9_Garc=EDa?= <j@example.com>\n\nx`));
    expect(email.headers.subject).toBe('Überweisung €');
    expect(email.headers.from).toBe('José García <j@example.com>');
  });

  it('reads raw UTF-8 headers (RFC 6532)', () => {
    expect(parseEml(encode('Subject: Привет\n\nbody')).headers.subject).toBe('Привет');
  });

  it('prefers HTML in multipart/alternative, keeps the text alternative, and collects attachments', () => {
    const email = parseEml(encode([
      'From: a@example.com', 'Subject: Mixed', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="outer"', '',
      '--outer', 'Content-Type: multipart/alternative; boundary=inner', '',
      '--inner', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', 'Caf=C3=A9 =', 'ok', '',
      '--inner', 'Content-Type: text/html; charset=utf-8', '', '<p>Café</p>', '--inner--', '',
      '--outer', 'Content-Type: application/pdf; name="invoice.pdf"', 'Content-Disposition: attachment; filename="invoice.pdf"', 'Content-Transfer-Encoding: base64', '', btoa('%PDF-1.4'), '',
      '--outer--', '',
    ].join('\n')));
    expect(email.text).toEqual(['Café ok\n']);
    expect(email.html).toEqual(['<p>Café</p>']);
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments[0]).toMatchObject({ name: 'invoice.pdf', type: 'application/pdf' });
    expect(new TextDecoder().decode(email.attachments[0].bytes)).toBe('%PDF-1.4');
  });

  it('keeps Content-IDs for inline images', () => {
    const email = parseEml(encode([
      'From: a@example.com', 'Content-Type: multipart/related; boundary=b', '',
      '--b', 'Content-Type: text/html', '', '<img src="cid:logo@x">',
      '--b', 'Content-Type: image/png', 'Content-ID: <logo@x>', 'Content-Transfer-Encoding: base64', '', 'iVBORw0KGgo=',
      '--b--',
    ].join('\n')));
    expect(email.attachments[0]).toMatchObject({ cid: 'logo@x', type: 'image/png', name: 'attachment-1.png' });
  });

  it('decodes RFC 2231 file names', () => {
    const email = parseEml(encode([
      'From: a@example.com', 'Content-Type: multipart/mixed; boundary=b', '',
      '--b', 'Content-Type: text/plain', '', 'see attached',
      '--b', 'Content-Type: application/octet-stream', "Content-Disposition: attachment; filename*0*=UTF-8''R%C3%A9sum; filename*1*=%C3%A9.pdf", '', 'data',
      '--b--',
    ].join('\n')));
    expect(email.attachments[0].name).toBe('Résumé.pdf');
  });

  it('decodes body charsets and flags unknown ones', () => {
    const latin = new Uint8Array([...encode('From: a@example.com\nContent-Type: text/plain; charset=windows-1252\n\n'), 0x93, 0x68, 0x69, 0x94]);
    expect(parseEml(latin).text[0]).toBe('“hi”');
    const unknown = parseEml(encode('From: a@example.com\nContent-Type: text/plain; charset=x-klingon\n\nhello'));
    expect(unknown.text[0]).toBe('hello');
    expect(unknown.charsetFallback).toBe(true);
  });

  it('unwraps format=flowed text', () => {
    const email = parseEml(encode('From: a@example.com\nContent-Type: text/plain; format=flowed\n\nThis is one \nparagraph.\n> quoted \n> line\n-- \nsig'));
    expect(email.text[0]).toBe('This is one paragraph.\n> quoted line\n-- \nsig');
  });

  it('skips mbox and emlx wrappers', () => {
    expect(parseEml(encode('From maya@example.com Tue Mar 12 14:30:00 2024\nSubject: mbox\n\nhi')).headers.subject).toBe('mbox');
    const message = 'Subject: emlx\r\n\r\nhi';
    expect(parseEml(new TextEncoder().encode(`${message.length}\n${message}<?xml version="1.0"?><plist/>`)).text[0]).toBe('hi');
  });

  it('names attached messages after their subject and marks encrypted mail', () => {
    const email = parseEml(encode([
      'From: a@example.com', 'Content-Type: multipart/mixed; boundary=b', '',
      '--b', 'Content-Type: message/rfc822', '', 'Subject: Original / note', '', 'inner',
      '--b', 'Content-Type: application/pkcs7-mime; smime-type=enveloped-data; name=smime.p7m', '', 'xx',
      '--b--',
    ].join('\n')));
    expect(email.attachments[0].name).toBe('Original - note.eml');
    expect(email.encrypted).toBe(true);
  });

  it('rejects files that are not messages', () => {
    const code = (bytes: Uint8Array) => { try { parseEml(bytes); } catch (error) { return (error as EmlError).code; } };
    expect(code(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe('outlookMsg');
    expect(code(encode('\n\n  \n'))).toBe('empty');
    expect(code(encode('%PDF-1.7\nnot mail'))).toBe('notEmail');
  });
});

describe('MIME helpers', () => {
  it('parses quoted and bare parameters', () => {
    expect(parseStructured('multipart/mixed; boundary="a;b"; charset=UTF-8')).toEqual({ value: 'multipart/mixed', params: { boundary: 'a;b', charset: 'UTF-8' } });
  });

  it('drops whitespace only between encoded words', () => {
    expect(decodeWords('=?utf-8?q?a?= =?utf-8?q?b?= c =?utf-8?q?d?=')).toBe('ab c d');
  });

  it('decodes quoted-printable soft breaks and trailing space', () => {
    expect(quotedPrintableBinary('a=3Db =\r\nc  \r\nd')).toBe('a=b c\r\nd');
  });

  it('keeps signature separators in flowed text', () => {
    expect(unflow('-- \nMaya', false)).toBe('-- \nMaya');
  });
});
