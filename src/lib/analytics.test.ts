import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttonEvent, fileExtension, fileParams, optionFromDataset, sizeBucket, track, trackResult } from './analytics';

describe('analytics', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('names tool buttons by the action in their id', () => {
    expect(buttonEvent('convert')).toBe('convert_click');
    expect(buttonEvent('xml-json-convert')).toBe('convert_click');
    expect(buttonEvent('beautifier-format')).toBe('convert_click');
    expect(buttonEvent('pdf-run')).toBe('convert_click');
    expect(buttonEvent('download')).toBe('download_click');
    expect(buttonEvent('download-zip')).toBe('download_click');
    expect(buttonEvent('viewer-download-csv')).toBe('download_click');
    expect(buttonEvent('csv-sql-copy')).toBe('copy_click');
    expect(buttonEvent('choose-file')).toBe('choose_file_click');
    expect(buttonEvent('xml-json-choose')).toBe('choose_file_click');
    expect(buttonEvent('image-change')).toBe('choose_file_click');
    expect(buttonEvent('choose-again')).toBe('choose_file_click');
    expect(buttonEvent('try-example')).toBe('example_click');
    expect(buttonEvent('start-over')).toBe('reset_click');
    expect(buttonEvent('beautifier-reset')).toBe('reset_click');
    expect(buttonEvent('qr-start')).toBe('tool_button_click');
  });

  it('reads option chips from their data attribute', () => {
    expect(optionFromDataset({ separator: 'tab' })).toEqual({ option_name: 'separator', option_value: 'tab' });
    expect(optionFromDataset({ astroCid: 'x', view: 'text' })).toEqual({ option_name: 'view', option_value: 'text' });
    expect(optionFromDataset({})).toBeUndefined();
  });

  it('reduces files to extension, count and size range', () => {
    expect(fileExtension('Q3 Report.XLSX')).toBe('xlsx');
    expect(fileExtension('README')).toBe('none');
    expect(sizeBucket(500)).toBe('<10KB');
    expect(sizeBucket(2 * 1024 * 1024)).toBe('1-10MB');
    expect(sizeBucket(80 * 1024 * 1024)).toBe('50MB+');
    const files = [new File(['a'.repeat(20000)], 'secret-name.csv'), new File(['b'], 'other.csv')];
    expect(fileParams(files)).toEqual({ file_count: 2, file_type: 'csv', file_size: '10-100KB' });
  });

  it('sends events through gtag without empty params', () => {
    const gtag = vi.fn();
    vi.stubGlobal('window', { gtag });
    track('convert_click', { button_id: 'convert', empty: '', missing: undefined });
    trackResult('error', { code: 'tooLarge' });
    trackResult('success', { rows: 3 });
    expect(gtag.mock.calls).toEqual([
      ['event', 'convert_click', { button_id: 'convert' }],
      ['event', 'conversion_error', { error_code: 'tooLarge' }],
      ['event', 'conversion_success', { rows: 3 }],
    ]);
  });
});
