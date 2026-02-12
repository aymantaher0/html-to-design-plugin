// ─── Message types between UI and Plugin Controller ───

export type MessageToController =
  | { type: 'import-dom'; dom: SerializedDOM }
  | { type: 'reimport'; nodeId: string }
  | { type: 'get-reimport-metadata'; nodeId: string }
  | { type: 'cancel' }
  | { type: 'resize'; width: number; height: number };

export type MessageToUI =
  | { type: 'import-started' }
  | { type: 'import-progress'; message: string; percent: number }
  | { type: 'import-complete'; nodeId: string }
  | { type: 'import-error'; message: string }
  | { type: 'selection-change'; hasDesignNode: boolean; nodeId?: string }
  | { type: 'reimport-metadata'; metadata: ImportMetadata; nodeId: string };

// ─── Viewport ───

export type ViewportType = 'desktop' | 'mobile' | 'tablet';

export interface ViewportConfig {
  name: string;
  width: number;
  height: number;
  userAgent?: string;
}

export const VIEWPORT_CONFIGS: Record<ViewportType, ViewportConfig> = {
  desktop: { name: 'Desktop', width: 1440, height: 900 },
  mobile: { name: 'Mobile', width: 375, height: 812 },
  tablet: { name: 'Tablet', width: 768, height: 1024 },
};

// ─── Serialized DOM ───

export interface SerializedDOM {
  tag: string;
  attributes: Record<string, string>;
  computedStyle: Record<string, string>;
  boundingBox: BoundingBox;
  children: SerializedNode[];
  textContent?: string;
}

export type SerializedNode = SerializedElement | SerializedText;

export interface SerializedElement {
  type: 'element';
  tag: string;
  attributes: Record<string, string>;
  computedStyle: Record<string, string>;
  boundingBox: BoundingBox;
  children: SerializedNode[];
}

export interface SerializedText {
  type: 'text';
  content: string;
  computedStyle: Record<string, string>;
  boundingBox: BoundingBox;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Parsed HTML Structures ───

export interface ParsedNode {
  type: 'element' | 'text';
  tag?: string;
  attributes?: Record<string, string>;
  styles: ComputedStyles;
  bounds: BoundingBox;
  children: ParsedNode[];
  textContent?: string;
  imageUrl?: string;
  svgContent?: string;
}

export interface ComputedStyles {
  // Layout
  display?: string;
  position?: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  flexWrap?: string;
  gap?: string;
  rowGap?: string;
  columnGap?: string;

  // Box model
  width?: string;
  height?: string;
  minWidth?: string;
  minHeight?: string;
  maxWidth?: string;
  maxHeight?: string;
  padding?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  margin?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;

  // Position
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  zIndex?: string;

  // Typography
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  fontStyle?: string;
  lineHeight?: string;
  letterSpacing?: string;
  textAlign?: string;
  textDecoration?: string;
  textTransform?: string;
  color?: string;

  // Background
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;

  // Border
  borderWidth?: string;
  borderTopWidth?: string;
  borderRightWidth?: string;
  borderBottomWidth?: string;
  borderLeftWidth?: string;
  borderColor?: string;
  borderTopColor?: string;
  borderRightColor?: string;
  borderBottomColor?: string;
  borderLeftColor?: string;
  borderStyle?: string;
  borderRadius?: string;
  borderTopLeftRadius?: string;
  borderTopRightRadius?: string;
  borderBottomRightRadius?: string;
  borderBottomLeftRadius?: string;

  // Effects
  opacity?: string;
  boxShadow?: string;
  overflow?: string;
  visibility?: string;

  // Image
  objectFit?: string;

  // Any additional property
  [key: string]: string | undefined;
}

// ─── Import metadata for re-import ───

export interface ImportMetadata {
  sourceUrl?: string;
  sourceHtml?: string;
  sourceCss?: string;
  viewport?: ViewportType;
  importedAt: string;
}
