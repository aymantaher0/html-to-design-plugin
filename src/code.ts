import { MessageToController, MessageToUI, SerializedDOM, ImportMetadata } from './types';
import { FigmaMapper } from './mapper/figma-mapper';

figma.showUI(__html__, { width: 340, height: 400 });

figma.ui.onmessage = async (msg: MessageToController) => {
  switch (msg.type) {
    case 'import-dom':
      await handleImportDOM(msg.dom);
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

    // Position frame on canvas
    const existingFrames = figma.currentPage.children.filter(
      node => node.type === 'FRAME' && node.name.startsWith('Import:')
    );

    if (existingFrames.length > 0) {
      const lastFrame = existingFrames[existingFrames.length - 1];
      frame.x = lastFrame.x + lastFrame.width + 40;
      frame.y = lastFrame.y;
    } else {
      frame.x = figma.viewport.center.x - frame.width / 2;
      frame.y = figma.viewport.center.y - frame.height / 2;
    }

    if (viewport) {
      const vpWidth = dom.attributes['data-viewport-width'];
      frame.name = `${frame.name} - ${viewport} (${vpWidth}px)`;
    }

    figma.currentPage.selection = [frame];
    figma.viewport.scrollAndZoomIntoView([frame]);

    sendToUI({ type: 'import-complete', nodeId: frame.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during import';
    sendToUI({ type: 'import-error', message });
  }
}

function sendToUI(msg: MessageToUI): void {
  figma.ui.postMessage(msg);
}
