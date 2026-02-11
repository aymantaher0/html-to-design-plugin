import { MessageToController, MessageToUI, SerializedDOM, ImportMetadata } from './types';
import { FigmaMapper } from './mapper/figma-mapper';

// ─── Plugin Setup ───

figma.showUI(__html__, {
  width: 360,
  height: 480,
  themeColors: true,
  title: 'HTML to Design',
});

// ─── Message Handler ───

figma.ui.onmessage = async (msg: MessageToController) => {
  switch (msg.type) {
    case 'import-dom':
      await handleImportDOM(msg.dom);
      break;

    case 'import-url':
      // URL fetching and parsing happens in the UI context
      // The UI will send 'import-dom' messages after parsing
      sendToUI({ type: 'import-started' });
      break;

    case 'import-html':
      // Direct HTML import - UI handles parsing
      sendToUI({ type: 'import-started' });
      break;

    case 'import-file':
      // File parsing happens in the UI context
      sendToUI({ type: 'import-started' });
      break;

    case 'reimport':
      await handleReimport(msg.nodeId, msg.url, msg.html, msg.css);
      break;

    case 'cancel':
      // No-op for now, but could be used to cancel ongoing imports
      break;

    case 'resize':
      figma.ui.resize(msg.width, msg.height);
      break;
  }
};

// ─── Import DOM ───

async function handleImportDOM(dom: SerializedDOM): Promise<void> {
  try {
    sendToUI({ type: 'import-started' });

    const mapper = new FigmaMapper((message, percent) => {
      sendToUI({ type: 'import-progress', message, percent });
    });

    // Build metadata from DOM attributes
    const metadata: ImportMetadata = {
      sourceUrl: dom.attributes['data-source-url'],
      importedAt: new Date().toISOString(),
    };

    const viewport = dom.attributes['data-viewport'];
    if (viewport) {
      metadata.viewport = viewport as any;
    }

    // Create the Figma frame
    const frame = await mapper.mapToFigma(dom, metadata);

    // Position the frame in the viewport
    const viewX = figma.viewport.center.x - frame.width / 2;
    const viewY = figma.viewport.center.y - frame.height / 2;

    // If multiple viewports, offset each one
    const existingFrames = figma.currentPage.children.filter(
      node => node.type === 'FRAME' && node.name.startsWith('Import:')
    );

    if (existingFrames.length > 0) {
      const lastFrame = existingFrames[existingFrames.length - 1];
      frame.x = lastFrame.x + lastFrame.width + 40;
      frame.y = lastFrame.y;
    } else {
      frame.x = viewX;
      frame.y = viewY;
    }

    // Add viewport suffix to name
    if (viewport) {
      const vpWidth = dom.attributes['data-viewport-width'];
      frame.name = `${frame.name} - ${viewport} (${vpWidth}px)`;
    }

    // Add source file name
    const sourceFile = dom.attributes['data-source-file'];
    if (sourceFile) {
      frame.name = `Import: ${sourceFile}`;
    }

    // Select and zoom to the frame
    figma.currentPage.selection = [frame];
    figma.viewport.scrollAndZoomIntoView([frame]);

    sendToUI({ type: 'import-complete', nodeId: frame.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during import';
    sendToUI({ type: 'import-error', message });
  }
}

// ─── Re-Import ───

async function handleReimport(
  nodeId: string,
  url?: string,
  html?: string,
  css?: string
): Promise<void> {
  const existingNode = figma.getNodeById(nodeId);
  if (!existingNode || existingNode.type !== 'FRAME') {
    sendToUI({ type: 'import-error', message: 'Original frame not found' });
    return;
  }

  const frame = existingNode as FrameNode;
  const metadataStr = frame.getPluginData('importMetadata');

  if (!metadataStr) {
    sendToUI({ type: 'import-error', message: 'No import metadata found on this frame' });
    return;
  }

  try {
    const metadata: ImportMetadata = JSON.parse(metadataStr);

    // Remember position
    const oldX = frame.x;
    const oldY = frame.y;

    // Remove old frame
    frame.remove();

    // The UI will handle re-fetching and re-parsing, then send import-dom
    // For now, we just inform the UI to re-trigger the import
    sendToUI({
      type: 'import-progress',
      message: 'Re-importing...',
      percent: 10,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Re-import failed';
    sendToUI({ type: 'import-error', message });
  }
}

// ─── Selection Change Listener ───

figma.on('selectionchange', () => {
  const selection = figma.currentPage.selection;
  if (selection.length === 1 && selection[0].type === 'FRAME') {
    const frame = selection[0] as FrameNode;
    const metadata = frame.getPluginData('importMetadata');
    if (metadata) {
      sendToUI({
        type: 'selection-change',
        hasDesignNode: true,
        nodeId: frame.id,
      });
      return;
    }
  }

  sendToUI({ type: 'selection-change', hasDesignNode: false });
});

// ─── Helper ───

function sendToUI(msg: MessageToUI): void {
  figma.ui.postMessage(msg);
}
