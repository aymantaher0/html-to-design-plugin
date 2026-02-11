/**
 * CSS value parsing utilities for converting CSS values to Figma-compatible numbers.
 */

/**
 * Parse a CSS length value (px, rem, em, %, etc.) to a number in pixels.
 */
export function parseCSSLength(value: string | undefined, parentSize?: number): number {
  if (!value || value === 'auto' || value === 'none') return 0;

  const num = parseFloat(value);
  if (isNaN(num)) return 0;

  if (value.endsWith('px')) return num;
  if (value.endsWith('rem')) return num * 16;
  if (value.endsWith('em')) return num * 16;
  if (value.endsWith('%') && parentSize) return (num / 100) * parentSize;
  if (value.endsWith('vw')) return (num / 100) * 1440;
  if (value.endsWith('vh')) return (num / 100) * 900;
  if (value.endsWith('pt')) return num * (4 / 3);

  // Unitless number (often used for line-height)
  return num;
}

/**
 * Parse font weight string to numeric value.
 */
export function parseFontWeight(weight: string | undefined): number {
  if (!weight) return 400;

  const map: Record<string, number> = {
    thin: 100,
    hairline: 100,
    extralight: 200,
    ultralight: 200,
    light: 300,
    normal: 400,
    regular: 400,
    medium: 500,
    semibold: 600,
    demibold: 600,
    bold: 700,
    extrabold: 800,
    ultrabold: 800,
    black: 900,
    heavy: 900,
  };

  const lower = weight.toLowerCase().replace(/[- ]/g, '');
  if (map[lower] !== undefined) return map[lower];

  const num = parseInt(weight, 10);
  return isNaN(num) ? 400 : num;
}

/**
 * Map CSS text-align to Figma text alignment.
 */
export function mapTextAlign(align: string | undefined): 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED' {
  switch (align) {
    case 'center': return 'CENTER';
    case 'right': return 'RIGHT';
    case 'end': return 'RIGHT';
    case 'justify': return 'JUSTIFIED';
    default: return 'LEFT';
  }
}

/**
 * Map CSS text-decoration to Figma text decoration.
 */
export function mapTextDecoration(decoration: string | undefined): 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH' {
  if (!decoration) return 'NONE';
  if (decoration.includes('underline')) return 'UNDERLINE';
  if (decoration.includes('line-through')) return 'STRIKETHROUGH';
  return 'NONE';
}

/**
 * Map CSS text-transform to Figma text case.
 */
export function mapTextCase(transform: string | undefined): 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' {
  switch (transform) {
    case 'uppercase': return 'UPPER';
    case 'lowercase': return 'LOWER';
    case 'capitalize': return 'TITLE';
    default: return 'ORIGINAL';
  }
}

/**
 * Parse a CSS box-shadow value to Figma shadow effects.
 */
export interface ParsedShadow {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
  inset: boolean;
}

export function parseBoxShadow(shadow: string | undefined): ParsedShadow[] {
  if (!shadow || shadow === 'none') return [];

  const shadows: ParsedShadow[] = [];
  // Split by comma, but respect parentheses (for rgb/rgba/hsl colors)
  const parts = splitShadows(shadow);

  for (const part of parts) {
    const parsed = parseSingleShadow(part.trim());
    if (parsed) shadows.push(parsed);
  }

  return shadows;
}

function splitShadows(shadow: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of shadow) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      results.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) results.push(current);

  return results;
}

function parseSingleShadow(shadow: string): ParsedShadow | null {
  const inset = shadow.includes('inset');
  const cleaned = shadow.replace('inset', '').trim();

  // Extract color (rgb/rgba/hsl/hsla or named/hex)
  let color = 'rgba(0,0,0,0.25)';
  let remaining = cleaned;

  // Match rgb/rgba/hsl/hsla
  const colorFnMatch = remaining.match(/(rgba?\([^)]+\)|hsla?\([^)]+\))/);
  if (colorFnMatch) {
    color = colorFnMatch[1];
    remaining = remaining.replace(colorFnMatch[1], '').trim();
  } else {
    // Match hex or named color
    const hexMatch = remaining.match(/(#[0-9a-fA-F]{3,8})/);
    if (hexMatch) {
      color = hexMatch[1];
      remaining = remaining.replace(hexMatch[1], '').trim();
    }
  }

  // Parse numeric values
  const nums = remaining.match(/-?[\d.]+px/g);
  if (!nums || nums.length < 2) return null;

  return {
    offsetX: parseFloat(nums[0]),
    offsetY: parseFloat(nums[1]),
    blur: nums[2] ? parseFloat(nums[2]) : 0,
    spread: nums[3] ? parseFloat(nums[3]) : 0,
    color,
    inset,
  };
}

/**
 * Parse CSS border-radius shorthand or individual values.
 */
export function parseBorderRadius(
  tl?: string, tr?: string, br?: string, bl?: string
): { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number } {
  return {
    topLeft: parseCSSLength(tl),
    topRight: parseCSSLength(tr),
    bottomRight: parseCSSLength(br),
    bottomLeft: parseCSSLength(bl),
  };
}

/**
 * Determine Figma font style name from weight and style.
 */
export function getFigmaFontStyle(weight: number, italic: boolean): string {
  const weightNames: Record<number, string> = {
    100: 'Thin',
    200: 'ExtraLight',
    300: 'Light',
    400: 'Regular',
    500: 'Medium',
    600: 'SemiBold',
    700: 'Bold',
    800: 'ExtraBold',
    900: 'Black',
  };

  // Find closest weight
  const weights = Object.keys(weightNames).map(Number);
  const closest = weights.reduce((prev, curr) =>
    Math.abs(curr - weight) < Math.abs(prev - weight) ? curr : prev
  );

  const name = weightNames[closest] || 'Regular';
  return italic ? `${name} Italic` : name;
}
