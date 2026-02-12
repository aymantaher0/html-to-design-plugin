// ─── Message types between UI and Plugin Controller ───

export type MessageToController =
  | { type: 'import-dom'; dom: SerializedDOM }
  | { type: 'resize'; width: number; height: number };

export type MessageToUI =
  | { type: 'import-started' }
  | { type: 'import-progress'; message: string; percent: number }
  | { type: 'import-complete'; nodeId: string }
  | { type: 'import-error'; message: string };

// ─── Viewport ───

export type ViewportType = 'desktop' | 'mobile' | 'tablet';

export interface ViewportConfig {
  name: string;
  width: number;
  height: number;
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

// ─── Import metadata ───

export interface ImportMetadata {
  sourceUrl?: string;
  viewport?: ViewportType;
  importedAt: string;
}
