// ─── Popup script for HTML to Design Chrome Extension ───

document.getElementById('btn-capture').addEventListener('click', () => capturePage(false));
document.getElementById('btn-capture-selection').addEventListener('click', () => capturePage(true));

async function capturePage(selectionOnly) {
  const status = document.getElementById('status');
  const btn = document.getElementById('btn-capture');
  const btnSel = document.getElementById('btn-capture-selection');

  btn.disabled = true;
  btnSel.disabled = true;
  showStatus('info', 'Capturing page...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Inject content script and capture
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: captureDOM,
      args: [selectionOnly],
    });

    if (results && results[0] && results[0].result) {
      const dom = results[0].result;

      // Send to Figma plugin via clipboard or external messaging
      // For now, copy to clipboard as a fallback
      const serialized = JSON.stringify({
        source: 'html-to-design-extension',
        type: 'dom-capture',
        dom: dom,
        url: tab.url,
        title: tab.title,
      });

      await navigator.clipboard.writeText(serialized);
      showStatus('success', 'Page captured! Open the Figma plugin and paste, or the plugin will detect it automatically.');
    } else {
      showStatus('error', 'Failed to capture page content.');
    }
  } catch (err) {
    showStatus('error', `Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btnSel.disabled = false;
  }
}

function showStatus(type, message) {
  const el = document.getElementById('status');
  el.className = `status visible ${type}`;
  el.textContent = message;
}

/**
 * This function runs in the context of the webpage.
 * It serializes the DOM into the format expected by the plugin.
 */
function captureDOM(selectionOnly) {
  function serializeElement(element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    // Skip invisible elements
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    if (rect.width === 0 && rect.height === 0) return null;

    const tag = element.tagName.toLowerCase();

    // Skip unwanted tags
    if (['script', 'style', 'link', 'meta', 'noscript', 'iframe'].includes(tag)) return null;

    const attrs = {};
    for (const attr of element.attributes) {
      attrs[attr.name] = attr.value;
    }

    // Extract computed styles
    const props = [
      'display', 'position', 'flexDirection', 'justifyContent', 'alignItems',
      'flexWrap', 'gap', 'rowGap', 'columnGap',
      'width', 'height', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
      'lineHeight', 'letterSpacing', 'textAlign', 'textDecoration', 'textTransform',
      'color', 'backgroundColor', 'backgroundImage',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
      'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
      'opacity', 'boxShadow', 'overflow', 'visibility', 'objectFit',
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

    // Serialize children
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
              x: textRect.left,
              y: textRect.top,
              width: textRect.width,
              height: textRect.height,
            },
          });
        }
      }
    }

    return {
      type: 'element',
      tag: tag,
      attributes: attrs,
      computedStyle: computedStyle,
      boundingBox: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      children: children,
    };
  }

  // Determine root element
  let root = document.body;

  if (selectionOnly) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      root = container.nodeType === Node.ELEMENT_NODE
        ? container
        : container.parentElement;
    }
  }

  const serialized = serializeElement(root);

  return {
    tag: serialized.tag,
    attributes: serialized.attributes,
    computedStyle: serialized.computedStyle,
    boundingBox: serialized.boundingBox,
    children: serialized.children,
  };
}
