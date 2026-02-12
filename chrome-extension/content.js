// ─── Content script for HTML to Design Chrome Extension ───
// This script runs on every page and listens for capture requests from the popup.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'capture-request') {
    try {
      const dom = captureCurrentPage(message.selectionOnly);
      sendResponse({ success: true, dom });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }
  return true; // Keep message channel open for async response
});

function captureCurrentPage(selectionOnly) {
  // Re-use the same serialization logic from popup.js
  // In production, this would be a shared module

  function serializeElement(element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    if (style.display === 'none' || style.visibility === 'hidden') return null;
    if (rect.width === 0 && rect.height === 0) return null;

    const tag = element.tagName.toLowerCase();
    if (['script', 'style', 'link', 'meta', 'noscript', 'iframe'].includes(tag)) return null;

    const attrs = {};
    for (const attr of element.attributes) {
      attrs[attr.name] = attr.value;
    }

    const props = [
      'display', 'position', 'flexDirection', 'justifyContent', 'alignItems',
      'flexWrap', 'gap', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
      'textAlign', 'textDecoration', 'textTransform', 'color', 'backgroundColor',
      'backgroundImage', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth',
      'borderLeftWidth', 'borderTopColor', 'borderRightColor', 'borderBottomColor',
      'borderLeftColor', 'borderTopLeftRadius', 'borderTopRightRadius',
      'borderBottomRightRadius', 'borderBottomLeftRadius',
      'opacity', 'boxShadow', 'overflow',
    ];

    const computedStyle = {};
    for (const prop of props) {
      const kebab = prop.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
      const value = style.getPropertyValue(kebab);
      if (value && value !== '' && value !== 'none' && value !== 'normal' && value !== 'auto') {
        computedStyle[prop] = value;
      }
    }
    computedStyle['display'] = style.getPropertyValue('display');
    computedStyle['position'] = style.getPropertyValue('position');

    const children = [];
    for (const child of element.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const serialized = serializeElement(child);
        if (serialized) children.push(serialized);
      } else if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent.trim();
        if (text) {
          const range = document.createRange();
          range.selectNodeContents(child);
          const textRect = range.getBoundingClientRect();
          children.push({
            type: 'text',
            content: text,
            computedStyle: computedStyle,
            boundingBox: {
              x: textRect.left, y: textRect.top,
              width: textRect.width, height: textRect.height,
            },
          });
        }
      }
    }

    return {
      type: 'element',
      tag, attributes: attrs, computedStyle,
      boundingBox: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      children,
    };
  }

  let root = document.body;
  if (selectionOnly) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const container = sel.getRangeAt(0).commonAncestorContainer;
      root = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
    }
  }

  const result = serializeElement(root);
  return {
    tag: result.tag,
    attributes: { ...result.attributes, 'data-source-url': window.location.href },
    computedStyle: result.computedStyle,
    boundingBox: result.boundingBox,
    children: result.children,
  };
}
