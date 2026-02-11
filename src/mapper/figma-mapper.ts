import { SerializedDOM, SerializedNode, SerializedElement, SerializedText, ImportMetadata } from '../types';
import { parseCSSColor, isTransparent, FigmaRGBA } from '../utils/color';
import {
  parseCSSLength,
  parseFontWeight,
  mapTextAlign,
  mapTextDecoration,
  mapTextCase,
  parseBoxShadow,
  getFigmaFontStyle,
} from '../utils/css';

/**
 * Maps a serialized DOM tree to Figma nodes.
 * Runs in the Figma plugin sandbox (has access to figma.* APIs).
 */
export class FigmaMapper {
  private imageCache: Map<string, string> = new Map(); // url -> imageHash
  private fontLoadErrors: Set<string> = new Set();
  private progressCallback?: (message: string, percent: number) => void;

  constructor(progressCallback?: (message: string, percent: number) => void) {
    this.progressCallback = progressCallback;
  }

  async mapToFigma(dom: SerializedDOM, metadata?: ImportMetadata): Promise<FrameNode> {
    this.report('Creating Figma frame...', 10);

    // Create root frame
    const rootFrame = figma.createFrame();
    rootFrame.name = metadata?.sourceUrl
      ? `Import: ${new URL(metadata.sourceUrl).hostname}`
      : 'HTML Import';
    rootFrame.resize(
      Math.max(dom.boundingBox.width, 1),
      Math.max(dom.boundingBox.height, 1)
    );

    // Apply root styles
    this.applyFrameStyles(rootFrame, dom.computedStyle);
    rootFrame.clipsContent = true;

    // Store metadata for re-import
    if (metadata) {
      rootFrame.setPluginData('importMetadata', JSON.stringify(metadata));
    }

    this.report('Mapping elements...', 20);

    // Map children
    const totalChildren = this.countNodes(dom.children);
    let processed = 0;

    for (const child of dom.children) {
      const node = await this.mapNode(child, dom.boundingBox, (count) => {
        processed += count;
        const percent = 20 + Math.floor((processed / totalChildren) * 60);
        this.report(`Mapping elements (${processed}/${totalChildren})...`, percent);
      });
      if (node) {
        rootFrame.appendChild(node);
      }
    }

    // Try to apply auto-layout if the root is a flex container
    this.tryApplyAutoLayout(rootFrame, dom.computedStyle);

    this.report('Import complete!', 100);
    return rootFrame;
  }

  private async mapNode(
    node: SerializedNode,
    parentBounds: { x: number; y: number; width: number; height: number },
    onProgress: (count: number) => void
  ): Promise<SceneNode | null> {
    if (node.type === 'text') {
      onProgress(1);
      return this.createTextNode(node, parentBounds);
    }

    return this.mapElement(node, parentBounds, onProgress);
  }

  private async mapElement(
    element: SerializedElement,
    parentBounds: { x: number; y: number; width: number; height: number },
    onProgress: (count: number) => void
  ): Promise<SceneNode | null> {
    const { tag, attributes, computedStyle: style, boundingBox: bounds, children } = element;

    // Handle special tags
    if (tag === 'img') {
      onProgress(1);
      return this.createImageNode(element, parentBounds);
    }

    if (tag === 'svg') {
      onProgress(1);
      return this.createSvgNode(element, parentBounds);
    }

    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      onProgress(1);
      return this.createFormElement(element, parentBounds);
    }

    if (tag === 'hr') {
      onProgress(1);
      return this.createHrNode(element, parentBounds);
    }

    // Check if this is a text-only element (leaf with only text children)
    const hasOnlyText = children.length > 0 &&
      children.every(c => c.type === 'text') &&
      children.some(c => c.type === 'text' && (c as SerializedText).content.trim());

    if (hasOnlyText) {
      onProgress(1);
      const textContent = children
        .filter(c => c.type === 'text')
        .map(c => (c as SerializedText).content)
        .join(' ');
      return this.createTextFrame(element, textContent, parentBounds);
    }

    // Create a frame for container elements
    const frame = figma.createFrame();
    frame.name = this.generateNodeName(element);

    // Position and size
    frame.resize(
      Math.max(Math.round(bounds.width), 1),
      Math.max(Math.round(bounds.height), 1)
    );
    frame.x = Math.round(bounds.x - parentBounds.x);
    frame.y = Math.round(bounds.y - parentBounds.y);

    // Apply visual styles
    this.applyFrameStyles(frame, style);

    // Map children
    for (const child of children) {
      const childNode = await this.mapNode(child, bounds, onProgress);
      if (childNode) {
        frame.appendChild(childNode);
      }
    }

    // Try auto-layout
    this.tryApplyAutoLayout(frame, style);

    onProgress(1);
    return frame;
  }

  // ─── Text Nodes ───

  private async createTextNode(
    textNode: SerializedText,
    parentBounds: { x: number; y: number; width: number; height: number }
  ): Promise<TextNode | null> {
    const { content, computedStyle: style, boundingBox: bounds } = textNode;
    if (!content.trim()) return null;

    const text = figma.createText();
    text.name = content.substring(0, 40);

    // Position
    text.x = Math.round(bounds.x - parentBounds.x);
    text.y = Math.round(bounds.y - parentBounds.y);

    // Load font
    await this.loadFont(style);

    // Set text
    text.characters = content;

    // Apply text styles
    this.applyTextStyles(text, style);

    // Resize
    text.resize(Math.max(Math.round(bounds.width), 1), Math.max(Math.round(bounds.height), 1));
    text.textAutoResize = 'HEIGHT';

    return text;
  }

  private async createTextFrame(
    element: SerializedElement,
    textContent: string,
    parentBounds: { x: number; y: number; width: number; height: number }
  ): Promise<FrameNode> {
    const { computedStyle: style, boundingBox: bounds } = element;

    const frame = figma.createFrame();
    frame.name = this.generateNodeName(element);

    // Position and size
    frame.resize(
      Math.max(Math.round(bounds.width), 1),
      Math.max(Math.round(bounds.height), 1)
    );
    frame.x = Math.round(bounds.x - parentBounds.x);
    frame.y = Math.round(bounds.y - parentBounds.y);

    // Apply frame visual styles
    this.applyFrameStyles(frame, style);

    // Create text inside
    const text = figma.createText();
    text.name = textContent.substring(0, 40);

    await this.loadFont(style);
    text.characters = textContent;
    this.applyTextStyles(text, style);

    // Auto-layout to contain text properly
    frame.layoutMode = 'VERTICAL';
    frame.primaryAxisAlignItems = 'MIN';
    frame.counterAxisAlignItems = 'MIN';
    frame.layoutSizingHorizontal = 'FIXED';
    frame.layoutSizingVertical = 'HUG';

    // Padding
    frame.paddingTop = parseCSSLength(style.paddingTop);
    frame.paddingRight = parseCSSLength(style.paddingRight);
    frame.paddingBottom = parseCSSLength(style.paddingBottom);
    frame.paddingLeft = parseCSSLength(style.paddingLeft);

    text.layoutSizingHorizontal = 'FILL';
    text.textAutoResize = 'HEIGHT';

    frame.appendChild(text);

    return frame;
  }

  // ─── Image Nodes ───

  private async createImageNode(
    element: SerializedElement,
    parentBounds: { x: number; y: number; width: number; height: number }
  ): Promise<RectangleNode> {
    const { attributes, computedStyle: style, boundingBox: bounds } = element;
    const src = attributes.src || '';

    const rect = figma.createRectangle();
    rect.name = attributes.alt || 'Image';

    rect.resize(
      Math.max(Math.round(bounds.width), 1),
      Math.max(Math.round(bounds.height), 1)
    );
    rect.x = Math.round(bounds.x - parentBounds.x);
    rect.y = Math.round(bounds.y - parentBounds.y);

    // Try to load image
    if (src) {
      try {
        const imageHash = await this.fetchImage(src);
        if (imageHash) {
          rect.fills = [{ type: 'IMAGE', imageHash, scaleMode: 'FILL' }];
        }
      } catch (e) {
        // Fallback: light gray placeholder
        rect.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
      }
    }

    // Border radius
    this.applyBorderRadius(rect, style);

    return rect;
  }

  private async fetchImage(url: string): Promise<string | null> {
    if (this.imageCache.has(url)) {
      return this.imageCache.get(url)!;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) return null;

      const buffer = await response.arrayBuffer();
      const image = figma.createImage(new Uint8Array(buffer));
      this.imageCache.set(url, image.hash);
      return image.hash;
    } catch {
      return null;
    }
  }

  // ─── SVG Nodes ───

  private createSvgNode(
    element: SerializedElement,
    parentBounds: { x: number; y: number; width: number; height: number }
  ): SceneNode {
    const { boundingBox: bounds } = element;

    // Reconstruct SVG markup
    const svgMarkup = this.reconstructSvgMarkup(element);

    try {
      const svgNode = figma.createNodeFromSvg(svgMarkup);
      svgNode.name = element.attributes['aria-label'] || 'SVG';
      svgNode.x = Math.round(bounds.x - parentBounds.x);
      svgNode.y = Math.round(bounds.y - parentBounds.y);
      svgNode.resize(
        Math.max(Math.round(bounds.width), 1),
        Math.max(Math.round(bounds.height), 1)
      );
      return svgNode;
    } catch {
      // Fallback: create a placeholder rectangle
      const rect = figma.createRectangle();
      rect.name = 'SVG (unsupported)';
      rect.resize(Math.max(Math.round(bounds.width), 1), Math.max(Math.round(bounds.height), 1));
      rect.x = Math.round(bounds.x - parentBounds.x);
      rect.y = Math.round(bounds.y - parentBounds.y);
      rect.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }];
      return rect;
    }
  }

  private reconstructSvgMarkup(element: SerializedElement): string {
    const attrs = Object.entries(element.attributes)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');

    const childrenMarkup = element.children
      .filter((c): c is SerializedElement => c.type === 'element')
      .map(c => this.reconstructSvgMarkup(c))
      .join('');

    return `<${element.tag} ${attrs}>${childrenMarkup}</${element.tag}>`;
  }

  // ─── Form Elements ───

  private async createFormElement(
    element: SerializedElement,
    parentBounds: { x: number; y: number; width: number; height: number }
  ): Promise<FrameNode> {
    const { tag, attributes, computedStyle: style, boundingBox: bounds } = element;

    const frame = figma.createFrame();
    frame.name = `${tag}${attributes.type ? `[${attributes.type}]` : ''}`;

    frame.resize(
      Math.max(Math.round(bounds.width), 1),
      Math.max(Math.round(bounds.height), 1)
    );
    frame.x = Math.round(bounds.x - parentBounds.x);
    frame.y = Math.round(bounds.y - parentBounds.y);

    this.applyFrameStyles(frame, style);

    // Add placeholder/value text
    const textValue = attributes.placeholder || attributes.value || '';
    if (textValue) {
      const text = figma.createText();
      await this.loadFont(style);
      text.characters = textValue;
      this.applyTextStyles(text, style);

      frame.layoutMode = 'HORIZONTAL';
      frame.counterAxisAlignItems = 'CENTER';
      frame.paddingLeft = parseCSSLength(style.paddingLeft) || 8;
      frame.paddingRight = parseCSSLength(style.paddingRight) || 8;

      text.layoutSizingHorizontal = 'FILL';
      frame.appendChild(text);
    }

    return frame;
  }

  // ─── HR Element ───

  private createHrNode(
    element: SerializedElement,
    parentBounds: { x: number; y: number; width: number; height: number }
  ): RectangleNode {
    const { computedStyle: style, boundingBox: bounds } = element;

    const rect = figma.createRectangle();
    rect.name = 'Divider';
    rect.resize(Math.max(Math.round(bounds.width), 1), Math.max(Math.round(bounds.height) || 1, 1));
    rect.x = Math.round(bounds.x - parentBounds.x);
    rect.y = Math.round(bounds.y - parentBounds.y);

    const borderColor = parseCSSColor(style.borderTopColor || style.borderColor);
    const bgColor = parseCSSColor(style.backgroundColor);
    const color = borderColor || bgColor || { r: 0.8, g: 0.8, b: 0.8, a: 1 };

    rect.fills = [{ type: 'SOLID', color: { r: color.r, g: color.g, b: color.b }, opacity: color.a }];

    return rect;
  }

  // ─── Style Application ───

  private applyFrameStyles(frame: FrameNode, style: Record<string, string>): void {
    // Background
    const bgColor = parseCSSColor(style.backgroundColor);
    if (bgColor && !isTransparent(bgColor)) {
      frame.fills = [{
        type: 'SOLID',
        color: { r: bgColor.r, g: bgColor.g, b: bgColor.b },
        opacity: bgColor.a,
      }];
    } else {
      frame.fills = [];
    }

    // Background image (gradient support)
    if (style.backgroundImage && style.backgroundImage.startsWith('linear-gradient')) {
      const gradient = this.parseLinearGradient(style.backgroundImage);
      if (gradient) {
        frame.fills = [gradient];
      }
    }

    // Opacity
    if (style.opacity) {
      const opacity = parseFloat(style.opacity);
      if (!isNaN(opacity)) frame.opacity = opacity;
    }

    // Border radius
    this.applyBorderRadius(frame, style);

    // Borders
    this.applyBorders(frame, style);

    // Box shadow
    this.applyBoxShadow(frame, style);

    // Clipping
    if (style.overflow === 'hidden' || style.overflow === 'scroll' || style.overflow === 'auto') {
      frame.clipsContent = true;
    } else {
      frame.clipsContent = false;
    }
  }

  private applyBorderRadius(node: RectangleNode | FrameNode, style: Record<string, string>): void {
    const tl = parseCSSLength(style.borderTopLeftRadius);
    const tr = parseCSSLength(style.borderTopRightRadius);
    const br = parseCSSLength(style.borderBottomRightRadius);
    const bl = parseCSSLength(style.borderBottomLeftRadius);

    if (tl === tr && tr === br && br === bl) {
      node.cornerRadius = tl;
    } else {
      node.topLeftRadius = tl;
      node.topRightRadius = tr;
      node.bottomRightRadius = br;
      node.bottomLeftRadius = bl;
    }
  }

  private applyBorders(frame: FrameNode, style: Record<string, string>): void {
    const topWidth = parseCSSLength(style.borderTopWidth);
    const rightWidth = parseCSSLength(style.borderRightWidth);
    const bottomWidth = parseCSSLength(style.borderBottomWidth);
    const leftWidth = parseCSSLength(style.borderLeftWidth);

    if (topWidth === 0 && rightWidth === 0 && bottomWidth === 0 && leftWidth === 0) return;

    // Use the most prominent border color
    const borderColor = parseCSSColor(
      style.borderTopColor || style.borderRightColor || style.borderBottomColor || style.borderLeftColor
    );

    if (!borderColor || isTransparent(borderColor)) return;

    const maxWidth = Math.max(topWidth, rightWidth, bottomWidth, leftWidth);

    frame.strokes = [{
      type: 'SOLID',
      color: { r: borderColor.r, g: borderColor.g, b: borderColor.b },
      opacity: borderColor.a,
    }];
    frame.strokeWeight = maxWidth;
    frame.strokeAlign = 'INSIDE';

    // Individual border widths if they differ
    if (topWidth !== rightWidth || rightWidth !== bottomWidth || bottomWidth !== leftWidth) {
      frame.strokeTopWeight = topWidth;
      frame.strokeRightWeight = rightWidth;
      frame.strokeBottomWeight = bottomWidth;
      frame.strokeLeftWeight = leftWidth;
    }
  }

  private applyBoxShadow(node: FrameNode | RectangleNode, style: Record<string, string>): void {
    const shadows = parseBoxShadow(style.boxShadow);
    if (shadows.length === 0) return;

    const effects: Effect[] = shadows.map(shadow => {
      const color = parseCSSColor(shadow.color) || { r: 0, g: 0, b: 0, a: 0.25 };
      return {
        type: shadow.inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
        color: { r: color.r, g: color.g, b: color.b, a: color.a },
        offset: { x: shadow.offsetX, y: shadow.offsetY },
        radius: shadow.blur,
        spread: shadow.spread,
        visible: true,
        blendMode: 'NORMAL',
      } as DropShadowEffect | InnerShadowEffect;
    });

    node.effects = effects;
  }

  private applyTextStyles(text: TextNode, style: Record<string, string>): void {
    // Font family and style
    const fontFamily = this.cleanFontFamily(style.fontFamily);
    const fontWeight = parseFontWeight(style.fontWeight);
    const isItalic = style.fontStyle === 'italic';
    const fontStyle = getFigmaFontStyle(fontWeight, isItalic);

    try {
      text.fontName = { family: fontFamily, style: fontStyle };
    } catch {
      // Font not available, keep default
    }

    // Font size
    const fontSize = parseCSSLength(style.fontSize);
    if (fontSize > 0) text.fontSize = fontSize;

    // Line height
    if (style.lineHeight) {
      const lh = parseCSSLength(style.lineHeight);
      if (lh > 0) {
        text.lineHeight = { value: lh, unit: 'PIXELS' };
      }
    }

    // Letter spacing
    if (style.letterSpacing) {
      const ls = parseCSSLength(style.letterSpacing);
      text.letterSpacing = { value: ls, unit: 'PIXELS' };
    }

    // Text color
    const color = parseCSSColor(style.color);
    if (color) {
      text.fills = [{
        type: 'SOLID',
        color: { r: color.r, g: color.g, b: color.b },
        opacity: color.a,
      }];
    }

    // Text alignment
    text.textAlignHorizontal = mapTextAlign(style.textAlign);

    // Text decoration
    text.textDecoration = mapTextDecoration(style.textDecoration);

    // Text case
    text.textCase = mapTextCase(style.textTransform);
  }

  // ─── Auto Layout ───

  private tryApplyAutoLayout(frame: FrameNode, style: Record<string, string>): void {
    const display = style.display;
    if (display !== 'flex' && display !== 'inline-flex') return;

    const direction = style.flexDirection;
    frame.layoutMode = (direction === 'column' || direction === 'column-reverse')
      ? 'VERTICAL'
      : 'HORIZONTAL';

    // Justify content → primary axis
    switch (style.justifyContent) {
      case 'center':
        frame.primaryAxisAlignItems = 'CENTER';
        break;
      case 'flex-end':
      case 'end':
        frame.primaryAxisAlignItems = 'MAX';
        break;
      case 'space-between':
        frame.primaryAxisAlignItems = 'SPACE_BETWEEN';
        break;
      default:
        frame.primaryAxisAlignItems = 'MIN';
    }

    // Align items → counter axis
    switch (style.alignItems) {
      case 'center':
        frame.counterAxisAlignItems = 'CENTER';
        break;
      case 'flex-end':
      case 'end':
        frame.counterAxisAlignItems = 'MAX';
        break;
      case 'baseline':
        frame.counterAxisAlignItems = 'BASELINE';
        break;
      default:
        frame.counterAxisAlignItems = 'MIN';
    }

    // Wrap
    if (style.flexWrap === 'wrap' || style.flexWrap === 'wrap-reverse') {
      frame.layoutWrap = 'WRAP';
    }

    // Gap
    const gap = parseCSSLength(style.gap || style.columnGap);
    if (gap > 0) frame.itemSpacing = gap;

    if (frame.layoutWrap === 'WRAP') {
      const rowGap = parseCSSLength(style.rowGap || style.gap);
      if (rowGap > 0) frame.counterAxisSpacing = rowGap;
    }

    // Padding
    frame.paddingTop = parseCSSLength(style.paddingTop);
    frame.paddingRight = parseCSSLength(style.paddingRight);
    frame.paddingBottom = parseCSSLength(style.paddingBottom);
    frame.paddingLeft = parseCSSLength(style.paddingLeft);

    // Sizing: auto-layout children use FILL by default
    frame.layoutSizingHorizontal = 'FIXED';
    frame.layoutSizingVertical = 'FIXED';

    // Set children sizing
    for (const child of frame.children) {
      if ('layoutSizingHorizontal' in child) {
        (child as FrameNode).layoutSizingHorizontal = 'FIXED';
        (child as FrameNode).layoutSizingVertical = 'FIXED';
      }
    }
  }

  // ─── Gradient Parsing ───

  private parseLinearGradient(value: string): GradientPaint | null {
    const match = value.match(/linear-gradient\(([^)]+)\)/);
    if (!match) return null;

    const args = match[1];
    // Simple gradient parsing: angle + color stops
    const parts = this.splitGradientParts(args);
    if (parts.length < 2) return null;

    let angle = 180; // default: top to bottom
    let colorStartIndex = 0;

    // Check if first part is an angle
    const angleMatch = parts[0].match(/^(\d+)deg$/);
    if (angleMatch) {
      angle = parseFloat(angleMatch[1]);
      colorStartIndex = 1;
    } else if (parts[0] === 'to right') {
      angle = 90;
      colorStartIndex = 1;
    } else if (parts[0] === 'to left') {
      angle = 270;
      colorStartIndex = 1;
    } else if (parts[0] === 'to bottom') {
      angle = 180;
      colorStartIndex = 1;
    } else if (parts[0] === 'to top') {
      angle = 0;
      colorStartIndex = 1;
    }

    const colorParts = parts.slice(colorStartIndex);
    const stops: ColorStop[] = [];

    for (let i = 0; i < colorParts.length; i++) {
      const color = parseCSSColor(colorParts[i].trim());
      if (color) {
        stops.push({
          position: colorParts.length > 1 ? i / (colorParts.length - 1) : 0,
          color: { r: color.r, g: color.g, b: color.b, a: color.a },
        });
      }
    }

    if (stops.length < 2) return null;

    // Convert angle to gradient transform
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    return {
      type: 'GRADIENT_LINEAR',
      gradientTransform: [
        [cos, sin, 0.5 - cos * 0.5 - sin * 0.5],
        [-sin, cos, 0.5 + sin * 0.5 - cos * 0.5],
      ],
      gradientStops: stops,
    };
  }

  private splitGradientParts(args: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';

    for (const char of args) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (char === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  // ─── Helpers ───

  private async loadFont(style: Record<string, string>): Promise<void> {
    const fontFamily = this.cleanFontFamily(style.fontFamily);
    const fontWeight = parseFontWeight(style.fontWeight);
    const isItalic = style.fontStyle === 'italic';
    const fontStyle = getFigmaFontStyle(fontWeight, isItalic);

    const key = `${fontFamily}::${fontStyle}`;
    if (this.fontLoadErrors.has(key)) {
      // Try fallback
      try {
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      } catch {}
      return;
    }

    try {
      await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
    } catch {
      this.fontLoadErrors.add(key);
      // Try without style variant
      try {
        await figma.loadFontAsync({ family: fontFamily, style: 'Regular' });
      } catch {
        // Ultimate fallback
        try {
          await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
        } catch {}
      }
    }
  }

  private cleanFontFamily(fontFamily: string | undefined): string {
    if (!fontFamily) return 'Inter';
    // Take first font, remove quotes
    const first = fontFamily.split(',')[0].trim().replace(/["']/g, '');
    // Map common web fonts to Figma-available fonts
    const fontMap: Record<string, string> = {
      'Arial': 'Inter',
      'Helvetica': 'Inter',
      'Helvetica Neue': 'Inter',
      '-apple-system': 'Inter',
      'BlinkMacSystemFont': 'Inter',
      'Segoe UI': 'Inter',
      'system-ui': 'Inter',
      'sans-serif': 'Inter',
      'serif': 'Roboto Serif',
      'monospace': 'Roboto Mono',
      'Times New Roman': 'Roboto Serif',
      'Georgia': 'Roboto Serif',
      'Courier New': 'Roboto Mono',
      'Courier': 'Roboto Mono',
    };
    return fontMap[first] || first;
  }

  private generateNodeName(element: SerializedElement): string {
    const { tag, attributes } = element;
    const id = attributes.id;
    const classes = attributes.class?.split(' ').filter(Boolean).slice(0, 2).join('.');

    if (id) return `${tag}#${id}`;
    if (classes) return `${tag}.${classes}`;

    // Semantic names
    const semanticTags: Record<string, string> = {
      nav: 'Navigation',
      header: 'Header',
      footer: 'Footer',
      main: 'Main',
      aside: 'Sidebar',
      section: 'Section',
      article: 'Article',
      ul: 'List',
      ol: 'List',
      li: 'ListItem',
      button: 'Button',
      a: 'Link',
      form: 'Form',
      table: 'Table',
      thead: 'TableHead',
      tbody: 'TableBody',
      tr: 'TableRow',
      td: 'TableCell',
      th: 'TableHeader',
    };

    return semanticTags[tag] || tag;
  }

  private countNodes(nodes: SerializedNode[]): number {
    let count = 0;
    for (const node of nodes) {
      count++;
      if (node.type === 'element') {
        count += this.countNodes(node.children);
      }
    }
    return Math.max(count, 1);
  }

  private report(message: string, percent: number): void {
    if (this.progressCallback) {
      this.progressCallback(message, percent);
    }
  }
}
