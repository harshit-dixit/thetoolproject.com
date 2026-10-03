import { describe, expect, it } from 'vitest';
import { checkClip, DEFAULT_SETTINGS, formatTime, frameCount, frameDelays, frameTimes, gifName, gifRepeat, isVideoFile, LIMITS, outputSize, parseTime } from './video-gif';
import { createGifWriter } from './gif-writer';

describe('isVideoFile', () => {
  it('takes video types and video extensions with no type', () => {
    expect(isVideoFile({ name: 'clip.bin', type: 'video/mp4' })).toBe(true);
    expect(isVideoFile({ name: 'IMG_0001.MOV', type: '' })).toBe(true);
    expect(isVideoFile({ name: 'screen.webm', type: '' })).toBe(true);
    expect(isVideoFile({ name: 'photo.jpg', type: 'image/jpeg' })).toBe(false);
    expect(isVideoFile({ name: 'song.mp3', type: 'audio/mpeg' })).toBe(false);
  });
});

describe('outputSize', () => {
  it('scales to the chosen width and keeps the proportions', () => {
    expect(outputSize(1920, 1080, 480)).toEqual({ width: 480, height: 270 });
    expect(outputSize(1080, 1920, 320)).toEqual({ width: 320, height: 569 });
  });

  it('never enlarges the video', () => {
    expect(outputSize(400, 300, 640)).toEqual({ width: 400, height: 300 });
    expect(outputSize(1280, 720, 'original')).toEqual({ width: 1280, height: 720 });
  });
});

describe('frame timing', () => {
  it('takes one frame every 1/fps seconds before the end', () => {
    expect(frameTimes(2, 3, 5)).toEqual([2, 2.2, 2.4, 2.6, 2.8]);
    expect(frameCount(0, 0.3, 10)).toBe(3);
    expect(frameCount(0, 0.31, 10)).toBe(4);
    expect(frameTimes(1, 1.01, 10)).toEqual([1]);
  });

  it('keeps time with the video in GIF hundredths of a second', () => {
    expect(frameDelays(3, 10, 1)).toEqual([100, 100, 100]);
    expect(frameDelays(6, 15, 1)).toEqual([70, 60, 70, 70, 60, 70]);
    expect(frameDelays(15, 15, 1).reduce((sum, delay) => sum + delay, 0)).toBe(1000);
    expect(frameDelays(2, 10, 2)).toEqual([50, 50]);
    expect(frameDelays(2, 10, 0.5)).toEqual([200, 200]);
    // The fastest choice, 25 fps at 2×, stays at the 20 ms browsers honor.
    expect(frameDelays(4, 25, 2)).toEqual([20, 20, 20, 20]);
  });

  it('maps the loop choice to gifenc', () => {
    expect([gifRepeat('forever'), gifRepeat('once')]).toEqual([0, -1]);
  });
});

describe('checkClip', () => {
  const video = { width: 1920, height: 1080 };
  it('accepts a part within the limits', () => {
    expect(checkClip(0, 10, video, DEFAULT_SETTINGS)).toEqual({ ok: true, frames: 100, width: 480, height: 270 });
  });

  it('rejects an end before the start', () => {
    expect(checkClip(5, 5, video, DEFAULT_SETTINGS)).toMatchObject({ ok: false, code: 'order' });
  });

  it('rejects too many frames, or too many pixels at a large width', () => {
    expect(checkClip(0, 100, video, DEFAULT_SETTINGS)).toMatchObject({ ok: true, frames: LIMITS.frames });
    expect(checkClip(0, 100.1, video, DEFAULT_SETTINGS)).toMatchObject({ ok: false, code: 'tooLong' });
    expect(checkClip(0, 20, video, { ...DEFAULT_SETTINGS, width: 'original' })).toMatchObject({ ok: false, code: 'tooLong', frames: 200 });
  });
});

describe('times', () => {
  it('reads seconds, minutes and hours, with either decimal separator', () => {
    expect(parseTime('12')).toBe(12);
    expect(parseTime(' 12.5 ')).toBe(12.5);
    expect(parseTime('12,5')).toBe(12.5);
    expect(parseTime('.5')).toBe(0.5);
    expect(parseTime('1:05')).toBe(65);
    expect(parseTime('1:05,5')).toBe(65.5);
    expect(parseTime('1:02:05')).toBe(3725);
  });

  it('rejects anything else', () => {
    for (const text of ['', 'abc', '1:75', '1:60:00', '-3', '1:2:3:4', '1.2.3']) expect(parseTime(text)).toBeUndefined();
  });

  it('formats to tenths, cutting rather than rounding', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(65.56)).toBe('1:05.5');
    expect(formatTime(4.99, ',')).toBe('0:04,9');
    expect(formatTime(3725.3)).toBe('1:02:05.3');
    expect(parseTime(formatTime(42.7))).toBeCloseTo(42.7);
  });
});

describe('gifName', () => {
  it('keeps the video name with a .gif extension', () => {
    expect(gifName('holiday clip.mp4')).toBe('holiday clip.gif');
    expect(gifName('a:b?.mov')).toBe('a_b_.gif');
    expect(gifName('.mp4')).toBe('video.gif');
  });
});

describe('opaque GIF frames', () => {
  it('writes video frames without transparency and with their delays', () => {
    const frame = () => {
      const data = new Uint8ClampedArray(16 * 8 * 4);
      for (let i = 0; i < data.length; i += 4) data.set([i % 255, 40, 200, 255], i);
      return { width: 16, height: 8, data };
    };
    const writer = createGifWriter(0, { opaque: true });
    writer.addFrame(frame(), 70);
    writer.addFrame(frame(), 60);
    const { bytes } = writer.finish();
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii.slice(0, 6)).toBe('GIF89a');
    expect(ascii).toContain('NETSCAPE2.0');
    const controls = [...bytes.keys()].filter(i => bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 4);
    expect(controls).toHaveLength(2);
    // No transparent color flag, and delays of 7 and 6 hundredths.
    for (const at of controls) expect(bytes[at + 3] & 1).toBe(0);
    expect([bytes[controls[0] + 4], bytes[controls[1] + 4]]).toEqual([7, 6]);
  });
});
