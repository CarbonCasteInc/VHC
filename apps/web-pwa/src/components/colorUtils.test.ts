import { describe, expect, it } from 'vitest';
import { buildColor, hexToHsl, hslToHex, parseColor } from './colorUtils';

describe('colorUtils', () => {
  describe('hexToHsl', () => {
    it('converts valid 6-digit hex values (with and without #)', () => {
      expect(hexToHsl('#ff0000')).toEqual({ h: 0, s: 100, l: 50 });
      expect(hexToHsl('ff0000')).toEqual({ h: 0, s: 100, l: 50 });
    });

    it('handles achromatic values and extremes', () => {
      expect(hexToHsl('#808080')).toEqual({ h: 0, s: 0, l: 50 });
      expect(hexToHsl('#000000')).toEqual({ h: 0, s: 0, l: 0 });
      expect(hexToHsl('#ffffff')).toEqual({ h: 0, s: 0, l: 100 });
    });

    it('returns fallback for invalid values', () => {
      expect(hexToHsl('not-a-hex')).toEqual({ h: 0, s: 50, l: 50 });
    });

    it('computes hue for green- and blue-dominant colors', () => {
      expect(hexToHsl('#00ff00').h).toBe(120);
      expect(hexToHsl('#0000ff').h).toBe(240);
    });

    it('handles bright red hues with higher lightness', () => {
      expect(hexToHsl('#ff80c0')).toEqual({ h: 330, s: 100, l: 75 });
    });
  });

  describe('hslToHex', () => {
    it('round-trips known values', () => {
      const redHsl = hexToHsl('#ff0000');
      expect(hslToHex(redHsl.h, redHsl.s, redHsl.l)).toBe('#ff0000');
    });

    it('converts canonical HSL values to hex', () => {
      expect(hslToHex(0, 100, 50)).toBe('#ff0000');
      expect(hslToHex(0, 0, 0)).toBe('#000000');
      expect(hslToHex(0, 0, 100)).toBe('#ffffff');
    });
  });

  describe('parseColor', () => {
    it('parses hex input and trims whitespace', () => {
      expect(parseColor('#ff0000')).toEqual({ hex: '#ff0000', alpha: 1 });
      expect(parseColor('  #ff0000  ')).toEqual({ hex: '#ff0000', alpha: 1 });
    });

    it('slices hex values longer than 7 chars', () => {
      expect(parseColor('#ff0000aa')).toEqual({ hex: '#ff0000', alpha: 1 });
    });

    it('parses rgb/rgba comma format', () => {
      expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual({ hex: '#ff0000', alpha: 0.5 });
      expect(parseColor('rgb(255, 0, 0)')).toEqual({ hex: '#ff0000', alpha: 1 });
    });

    it('parses rgb/rgba space+slash format', () => {
      expect(parseColor('rgb(100 116 139)')).toEqual({ hex: '#64748b', alpha: 1 });
      expect(parseColor('rgb(100 116 139 / 0.12)')).toEqual({ hex: '#64748b', alpha: 0.12 });
    });

    it('returns fallback for unrecognized inputs', () => {
      expect(parseColor('hsl(0 100% 50%)')).toEqual({ hex: '#888888', alpha: 1 });
      expect(parseColor('rgb(not valid)')).toEqual({ hex: '#888888', alpha: 1 });
    });
  });

  describe('buildColor', () => {
    it('returns hex as-is when alpha is 1', () => {
      expect(buildColor('#ff0000', 1)).toBe('#ff0000');
    });

    it('returns rgba string when alpha is less than 1', () => {
      expect(buildColor('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.50)');
    });

    it('handles fully transparent alpha', () => {
      expect(buildColor('#ff0000', 0)).toBe('rgba(255, 0, 0, 0.00)');
    });
  });
});
