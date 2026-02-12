import { SerializedDOM, SerializedNode, SerializedElement, SerializedText, BoundingBox } from '../types';

/**
 * Parses an HTML string into a serialized DOM tree with computed styles.
 * This runs in the plugin UI context (has access to browser DOM APIs).
 */
export class HTMLParser {
  private iframe: HTMLIFrameElement | null = null;
  private baseUrl: string;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  async parse(html: string, css: string = '', viewportWidth: number = 1440, viewportHeight: number = 900): Promise<SerializedDOM> {
    const iframe = await this.createSandboxIframe(viewportWidth, viewportHeight);
    const doc = iframe.contentDocument!;

    // Inject base URL for relative resource resolution
    if (this.baseUrl) {
      const base = doc.createElement('base');
      base.href = this.baseUrl;
      doc.head.appendChild(base);
    }

    // Write content
    const fullHtml = this.buildFullDocument(html, css);
    doc.open();
    doc.write(fullHtml);
    doc.close();

    // Wait for resources to load
    await this.waitForLoad(iframe);

    // Serialize the DOM tree
    const body = doc.body;
    const bodyRect = body.getBoundingClientRect();
    const serialized = this.serializeDOM(body, doc);

    // Clean up
    this.destroyIframe();

    return serialized;
  }

  private buildFullDocument(html: string, css: string): string {
    // Check if html is already a full document
    if (html.toLowerCase().includes('<html') || html.toLowerCase().includes('<!doctype')) {
      if (css) {
        // Inject additional CSS into existing document
        return html.replace('</head>', `<style>${css}</style></head>`);
      }
      return html;
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; }
    ${css}
  </style>
</head>
<body>
  ${html}
</body>
</html>`;
  }

  private createSandboxIframe(width: number, height: number): Promise<HTMLIFrameElement> {
    return new Promise((resolve) => {
      if (this.iframe) {
        this.destroyIframe();
      }

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.left = '-10000px';
      iframe.style.top = '-10000px';
      iframe.style.width = `${width}px`;
      iframe.style.height = `${height}px`;
      iframe.style.border = 'none';
      iframe.style.visibility = 'hidden';
      iframe.sandbox.add('allow-same-origin');

      document.body.appendChild(iframe);
      this.iframe = iframe;

      // Give iframe time to initialize
      setTimeout(() => resolve(iframe), 50);
    });
  }

  private waitForLoad(iframe: HTMLIFrameElement): Promise<void> {
    return new Promise((resolve) => {
      const doc = iframe.contentDocument!;

      // Wait for images
      const images = doc.querySelectorAll('img');
      const imagePromises = Array.from(images).map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise<void>((res) => {
          img.onload = () => res();
          img.onerror = () => res();
          setTimeout(res, 3000); // Timeout per image
        });
      });

      Promise.all(imagePromises).then(() => {
        // Additional delay for CSS/font loading
        setTimeout(resolve, 200);
      });
    });
  }

  private serializeDOM(element: HTMLElement, doc: Document): SerializedDOM {
    const rect = element.getBoundingClientRect();
    const computedStyle = doc.defaultView!.getComputedStyle(element);

    return {
      tag: element.tagName.toLowerCase(),
      attributes: this.getAttributes(element),
      computedStyle: this.extractStyles(computedStyle),
      boundingBox: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      children: this.serializeChildren(element, doc),
    };
  }

  private serializeChildren(parent: HTMLElement, doc: Document): SerializedNode[] {
    const nodes: SerializedNode[] = [];

    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        const tag = el.tagName.toLowerCase();

        // Skip invisible elements
        const style = doc.defaultView!.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta' || tag === 'noscript') continue;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        const serialized: SerializedElement = {
          type: 'element',
          tag,
          attributes: this.getAttributes(el),
          computedStyle: this.extractStyles(style),
          boundingBox: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          },
          children: this.serializeChildren(el, doc),
        };

        nodes.push(serialized);
      } else if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent?.trim();
        if (!text) continue;

        // Get text bounding box via range
        const range = doc.createRange();
        range.selectNodeContents(child);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        const parentStyle = doc.defaultView!.getComputedStyle(parent);

        nodes.push({
          type: 'text',
          content: text,
          computedStyle: this.extractStyles(parentStyle),
          boundingBox: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          },
        });
      }
    }

    return nodes;
  }

  private getAttributes(element: HTMLElement): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const attr of Array.from(element.attributes)) {
      attrs[attr.name] = attr.value;
    }
    return attrs;
  }

  private extractStyles(style: CSSStyleDeclaration): Record<string, string> {
    const props = [
      'display', 'position', 'flexDirection', 'justifyContent', 'alignItems',
      'flexWrap', 'gap', 'rowGap', 'columnGap',
      'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
      'top', 'right', 'bottom', 'left', 'zIndex',
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
      'lineHeight', 'letterSpacing', 'textAlign', 'textDecoration', 'textTransform',
      'color', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
      'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
      'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
      'opacity', 'boxShadow', 'overflow', 'visibility', 'objectFit',
    ];

    const result: Record<string, string> = {};
    for (const prop of props) {
      const value = style.getPropertyValue(this.camelToKebab(prop));
      if (value && value !== '' && value !== 'none' && value !== 'normal' && value !== 'auto') {
        result[prop] = value;
      }
    }

    // Always include these even if "normal" or "auto"
    result['display'] = style.getPropertyValue('display');
    result['position'] = style.getPropertyValue('position');

    return result;
  }

  private camelToKebab(str: string): string {
    return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  }

  private destroyIframe(): void {
    if (this.iframe && this.iframe.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe);
      this.iframe = null;
    }
  }
}
