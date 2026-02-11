/**
 * CSS color parsing utilities for converting CSS colors to Figma RGBA.
 */

export interface FigmaColor {
  r: number; // 0-1
  g: number; // 0-1
  b: number; // 0-1
}

export interface FigmaRGBA extends FigmaColor {
  a: number; // 0-1
}

const NAMED_COLORS: Record<string, string> = {
  transparent: 'rgba(0,0,0,0)',
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  teal: '#008080',
  navy: '#000080',
  fuchsia: '#ff00ff',
  purple: '#800080',
  orange: '#ffa500',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  coral: '#ff7f50',
  crimson: '#dc143c',
  darkblue: '#00008b',
  darkgray: '#a9a9a9',
  darkgreen: '#006400',
  darkred: '#8b0000',
  gold: '#ffd700',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lightblue: '#add8e6',
  lightgray: '#d3d3d3',
  lightgreen: '#90ee90',
  lightyellow: '#ffffe0',
  linen: '#faf0e6',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  oldlace: '#fdf5e6',
  orangered: '#ff4500',
  orchid: '#da70d6',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  sienna: '#a0522d',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  snow: '#fffafa',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  whitesmoke: '#f5f5f5',
  yellowgreen: '#9acd32',
};

export function parseCSSColor(color: string | undefined): FigmaRGBA | null {
  if (!color || color === 'transparent' || color === 'none') {
    return null;
  }

  color = color.trim().toLowerCase();

  // Named color
  if (NAMED_COLORS[color]) {
    color = NAMED_COLORS[color];
  }

  // Hex
  if (color.startsWith('#')) {
    return parseHex(color);
  }

  // rgb/rgba
  if (color.startsWith('rgb')) {
    return parseRgb(color);
  }

  // hsl/hsla
  if (color.startsWith('hsl')) {
    return parseHsl(color);
  }

  return null;
}

function parseHex(hex: string): FigmaRGBA {
  hex = hex.replace('#', '');

  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  } else if (hex.length === 4) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }

  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const a = hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1;

  return { r, g, b, a };
}

function parseRgb(color: string): FigmaRGBA | null {
  const match = color.match(/rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?))?\s*\)/);
  if (!match) return null;

  const parseComponent = (val: string): number => {
    if (val.endsWith('%')) return parseFloat(val) / 100;
    return parseFloat(val) / 255;
  };

  return {
    r: parseComponent(match[1]),
    g: parseComponent(match[2]),
    b: parseComponent(match[3]),
    a: match[4] ? (match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4])) : 1,
  };
}

function parseHsl(color: string): FigmaRGBA | null {
  const match = color.match(/hsla?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+%?))?\s*\)/);
  if (!match) return null;

  const h = parseFloat(match[1]) / 360;
  const s = parseFloat(match[2]) / 100;
  const l = parseFloat(match[3]) / 100;
  const a = match[4] ? (match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4])) : 1;

  const { r, g, b } = hslToRgb(h, s, l);
  return { r, g, b, a };
}

function hslToRgb(h: number, s: number, l: number): FigmaColor {
  if (s === 0) {
    return { r: l, g: l, b: l };
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: hue2rgb(p, q, h + 1 / 3),
    g: hue2rgb(p, q, h),
    b: hue2rgb(p, q, h - 1 / 3),
  };
}

/**
 * Check if a color is effectively transparent.
 */
export function isTransparent(color: FigmaRGBA | null): boolean {
  if (!color) return true;
  return color.a < 0.01;
}
