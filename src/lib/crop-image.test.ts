import { describe, expect, it } from 'vitest';
import {
  applyRatio, canSwap, circleSize, clampRect, croppedName, defaultFormat, drawHandle, initialCrop, isImageFile, moveRect, outputSize,
  ratioLabel, ratioValue, resizeRect, setField, type Rect,
} from './crop-image';

const image = { width: 1000, height: 600 };
const ratioOf = (rect: Rect) => rect.width / rect.height;
const inside = (rect: Rect, size = image) => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= size.width && rect.y + rect.height <= size.height;

describe('ratios', () => {
  it('reads width:height chips, the image’s own ratio and a free crop', () => {
    expect(ratioValue('4:5', image)).toBe(0.8);
    expect(ratioValue('4:5', image, true)).toBe(1.25);
    expect(ratioValue('original', image)).toBeCloseTo(1000 / 600);
    expect(ratioValue('free', image)).toBeUndefined();
  });

  it('labels a turned ratio the other way round, except ratios that can’t turn', () => {
    expect(ratioLabel('3:2', true)).toBe('2:3');
    expect(ratioLabel('3:2', false)).toBe('3:2');
    expect(ratioLabel('free', true)).toBe('free');
  });

  it('turns only ratios whose turned form has no chip of its own', () => {
    expect((['4:5', '3:2', '4:3'] as const).every(canSwap)).toBe(true);
    expect((['free', 'original', '1:1', '16:9', '9:16'] as const).some(canSwap)).toBe(false);
  });
});

describe('the starting box', () => {
  it('covers the middle 80% for a free crop', () => {
    expect(initialCrop(image, undefined)).toEqual({ x: 100, y: 60, width: 800, height: 480 });
  });

  it('is the largest centred box of a ratio', () => {
    expect(initialCrop(image, 1)).toEqual({ x: 200, y: 0, width: 600, height: 600 });
    expect(initialCrop(image, 16 / 9)).toEqual({ x: 0, y: 19, width: 1000, height: 563 });
  });

  it('works on a 1 × 1 image', () => {
    expect(initialCrop({ width: 1, height: 1 }, undefined)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe('moving', () => {
  it('moves the box and stops at the image’s edges without changing its size', () => {
    const rect = { x: 100, y: 100, width: 200, height: 100 };
    expect(moveRect(rect, 50, -20, image)).toEqual({ x: 150, y: 80, width: 200, height: 100 });
    expect(moveRect(rect, 5000, 5000, image)).toEqual({ x: 800, y: 500, width: 200, height: 100 });
    expect(moveRect(rect, -5000, -5000, image)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('keeps whole pixels inside the image', () => {
    expect(clampRect({ x: -3.4, y: 2.6, width: 2000, height: 10.4 }, image)).toEqual({ x: 0, y: 3, width: 1000, height: 10 });
  });
});

describe('resizing', () => {
  const rect = { x: 100, y: 100, width: 400, height: 200 };

  it('keeps the opposite corner still when a corner is dragged', () => {
    expect(resizeRect(rect, 'se', 50, 30, image, undefined)).toEqual({ x: 100, y: 100, width: 450, height: 230 });
    expect(resizeRect(rect, 'nw', 50, 30, image, undefined)).toEqual({ x: 150, y: 130, width: 350, height: 170 });
  });

  it('moves one side with an edge handle', () => {
    expect(resizeRect(rect, 'w', -60, 999, image, undefined)).toEqual({ x: 40, y: 100, width: 460, height: 200 });
  });

  it('stops at the image’s edges and at 1 pixel, without flipping over', () => {
    expect(resizeRect(rect, 'se', 5000, 5000, image, undefined)).toEqual({ x: 100, y: 100, width: 900, height: 500 });
    expect(resizeRect(rect, 'se', -5000, -5000, image, undefined)).toEqual({ x: 100, y: 100, width: 1, height: 1 });
  });

  it('keeps a ratio from a corner, following the direction that moved further', () => {
    const square = { x: 100, y: 100, width: 200, height: 200 };
    expect(resizeRect(square, 'se', 100, 10, image, 1)).toEqual({ x: 100, y: 100, width: 300, height: 300 });
    expect(resizeRect(square, 'se', 10, 100, image, 1)).toEqual({ x: 100, y: 100, width: 300, height: 300 });
    expect(resizeRect(square, 'nw', 50, 0, image, 1)).toEqual({ x: 150, y: 150, width: 150, height: 150 });
  });

  it('keeps a ratio from an edge, growing the other side around the centre', () => {
    const square = { x: 300, y: 200, width: 200, height: 200 };
    expect(resizeRect(square, 'e', 100, 0, image, 1)).toEqual({ x: 300, y: 150, width: 300, height: 300 });
  });

  it('keeps a ratio when the image’s edge stops the box', () => {
    const square = { x: 300, y: 200, width: 200, height: 200 };
    const grown = resizeRect(square, 'se', 2000, 2000, image, 1);
    expect(grown).toEqual({ x: 300, y: 200, width: 400, height: 400 });
    const wide = resizeRect({ x: 0, y: 0, width: 160, height: 90 }, 'se', 5000, 0, image, 16 / 9);
    expect(inside(wide)).toBe(true);
    expect(ratioOf(wide)).toBeCloseTo(16 / 9, 2);
    expect(wide.width).toBe(1000);
  });

  it('draws a new box from a point in any direction', () => {
    const start = { x: 500, y: 300, width: 0, height: 0 };
    expect(drawHandle(-1, 1)).toBe('sw');
    expect(resizeRect(start, drawHandle(-100, -50), -100, -50, image, undefined)).toEqual({ x: 400, y: 250, width: 100, height: 50 });
    expect(resizeRect(start, drawHandle(100, 20), 100, 20, image, 1)).toEqual({ x: 500, y: 300, width: 100, height: 100 });
  });
});

describe('typed sizes', () => {
  const rect = { x: 100, y: 100, width: 400, height: 200 };

  it('sets one side, or both with a ratio', () => {
    expect(setField(rect, 'width', 300, image, undefined)).toEqual({ x: 100, y: 100, width: 300, height: 200 });
    expect(setField(rect, 'width', 300, image, 1)).toEqual({ x: 100, y: 100, width: 300, height: 300 });
    expect(setField(rect, 'height', 100, image, 2)).toEqual({ x: 100, y: 100, width: 200, height: 100 });
  });

  it('moves the box back inside rather than cutting the typed size', () => {
    expect(setField(rect, 'width', 950, image, undefined)).toEqual({ x: 50, y: 100, width: 950, height: 200 });
    expect(setField(rect, 'x', 900, image, undefined)).toEqual({ x: 600, y: 100, width: 400, height: 200 });
  });

  it('makes a box that can’t fit as large as the image allows', () => {
    expect(setField(rect, 'width', 5000, image, undefined)).toEqual({ x: 0, y: 100, width: 1000, height: 200 });
    expect(setField(rect, 'width', 5000, image, 1)).toEqual({ x: 100, y: 0, width: 600, height: 600 });
  });
});

describe('changing the ratio', () => {
  it('fits the largest box of the new shape, centred where the box was', () => {
    expect(applyRatio({ x: 0, y: 0, width: 200, height: 200 }, image, 1)).toEqual({ x: 0, y: 0, width: 600, height: 600 });
    expect(applyRatio({ x: 700, y: 0, width: 300, height: 600 }, image, 16 / 9)).toEqual({ x: 0, y: 19, width: 1000, height: 563 });
    const free = { x: 10, y: 20, width: 30, height: 40 };
    expect(applyRatio(free, image, undefined)).toBe(free);
  });
});

describe('saving', () => {
  it('saves at the crop’s size unless the canvas limit needs a smaller one', () => {
    expect(outputSize({ width: 4000, height: 3000 })).toEqual({ width: 4000, height: 3000, scale: 1 });
    const limited = outputSize({ width: 6000, height: 6000 }, { side: 8_192, pixels: 16_000_000 });
    expect(limited.width * limited.height).toBeLessThanOrEqual(16_000_000);
    expect(limited.scale).toBeLessThan(1);
  });

  it('never enlarges a circle', () => {
    const rect = { x: 0, y: 0, width: 300, height: 300 };
    expect(circleSize(rect, 'original')).toBe(300);
    expect(circleSize(rect, 1080)).toBe(300);
    expect(circleSize({ ...rect, width: 2000, height: 2000 }, 512)).toBe(512);
  });

  it('keeps the image’s format where it can', () => {
    expect(defaultFormat({ name: 'a.jpeg', type: 'image/jpeg' })).toBe('jpg');
    expect(defaultFormat({ name: 'a.avif', type: 'image/avif' })).toBe('jpg');
    expect(defaultFormat({ name: 'a.webp', type: '' })).toBe('webp');
    expect(defaultFormat({ name: 'a.png', type: 'image/png' })).toBe('png');
    expect(defaultFormat({ name: 'a.gif', type: 'image/gif' })).toBe('png');
  });

  it('names the download after the original', () => {
    expect(croppedName('holiday.jpeg', 'jpg')).toBe('holiday-cropped.jpg');
    expect(croppedName('me.png', 'png', 'circle')).toBe('me-circle.png');
    expect(croppedName('.png', 'png')).toBe('image-cropped.png');
    expect(croppedName('a:b?.jpg', 'webp')).toBe('a_b_-cropped.webp');
  });

  it('accepts images by type or extension', () => {
    expect(isImageFile({ name: 'scan.bmp', type: '' })).toBe(true);
    expect(isImageFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
  });
});
