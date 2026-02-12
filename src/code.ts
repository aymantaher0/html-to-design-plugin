import { MessageToController, MessageToUI, SerializedDOM, ImportMetadata } from './types';
import { FigmaMapper } from './mapper/figma-mapper';

figma.showUI(__html__, { width: 360, height: 480 });

figma.ui.onmessage = async (msg: MessageToController) => {
  switch (msg.type) {
    case 'import-dom':
      await handleImportDOM(msg.dom);
      break;

    case 'reimport':
      await handleReimport(msg.nodeId);
      break;

    case 'get-reimport-metadata':
      handleGetReimportMetadata(msg.nodeId);
      break;

    case 'cancel':
      break;

    case 'resize':
      figma.ui.resize(msg.width, msg.height);
      break;
  }
};

async function handleImportDOM(dom: SerializedDOM): Promise<void> {
  try {
    sendToUI({ type: 'import-started' });

    const mapper = new FigmaMapper((message, percent) => {
      sendToUI({ type: 'import-progress', message, percent });
    });

    const metadata: ImportMetadata = {
      sourceUrl: dom.attributes['data-source-url'],
      importedAt: new Date().toISOString(),
    };

    const viewport = dom.attributes['data-viewport'];
    if (viewport) {
      metadata.viewport = viewport as any;
    }

    const frame = await mapper.mapToFigma(dom, metadata);

    const viewX = figma.viewport.center.x - frame.width / 2;
    const viewY = figma.viewport.center.y - frame.height / 2;

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

    if (viewport) {
      const vpWidth = dom.attributes['data-viewport-width'];
      frame.name = `${frame.name} - ${viewport} (${vpWidth}px)`;
    }

    const sourceFile = dom.attributes['data-source-file'];
    if (sourceFile) {
      frame.name = `Import: ${sourceFile}`;
    }

    figma.currentPage.selection = [frame];
    figma.viewport.scrollAndZoomIntoView([frame]);

    sendToUI({ type: 'import-complete', nodeId: frame.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during import';
    sendToUI({ type: 'import-error', message });
  }
}

async function handleReimport(nodeId: string): Promise<void> {
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

    // Store position of old frame so the new one replaces it
    const oldX = frame.x;
    const oldY = frame.y;
    frame.remove();

    // Send metadata back to UI so it can re-fetch and re-parse
    sendToUI({
      type: 'reimport-metadata',
      metadata: {
        ...metadata,
        // Store old position for the re-imported frame
        reimportX: oldX,
        reimportY: oldY,
      } as any,
      nodeId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Re-import failed';
    sendToUI({ type: 'import-error', message });
  }
}

function handleGetReimportMetadata(nodeId: string): void {
  const node = figma.getNodeById(nodeId);
  if (!node || node.type !== 'FRAME') {
    return;
  }

  const frame = node as FrameNode;
  const metadataStr = frame.getPluginData('importMetadata');
  if (!metadataStr) return;

  try {
    const metadata: ImportMetadata = JSON.parse(metadataStr);
    sendToUI({ type: 'reimport-metadata', metadata, nodeId });
  } catch {
    // Invalid metadata
  }
}

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

function sendToUI(msg: MessageToUI): void {
  figma.ui.postMessage(msg);
}
