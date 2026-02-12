import { MessageToController, MessageToUI, ViewportType, VIEWPORT_CONFIGS } from '../types';
import { HTMLParser } from '../parser/html-parser';
import { fetchUrl } from '../utils/url-fetcher';

let selectedViewports: Set<ViewportType> = new Set(['desktop']);

function postMessage(msg: MessageToController): void {
  parent.postMessage({ pluginMessage: msg }, '*');
}

// ─── Viewport Selector ───

function initViewportSelector(): void {
  document.querySelectorAll('.viewport-option').forEach(option => {
    option.addEventListener('click', () => {
      const viewport = option.getAttribute('data-viewport') as ViewportType;

      if (option.classList.contains('selected')) {
        if (selectedViewports.size > 1) {
          selectedViewports.delete(viewport);
          option.classList.remove('selected');
        }
      } else {
        selectedViewports.add(viewport);
        option.classList.add('selected');
      }
    });
  });
}

// ─── URL Import ───

function initImport(): void {
  const input = document.getElementById('url-input') as HTMLInputElement;
  const btn = document.getElementById('btn-import') as HTMLButtonElement;

  input.addEventListener('input', () => {
    btn.disabled = !input.value.trim();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !btn.disabled) {
      btn.click();
    }
  });

  btn.addEventListener('click', async () => {
    const url = input.value.trim();
    if (!url) return;

    btn.disabled = true;
    showProgress('Fetching website...', 5);
    hideStatus();

    try {
      showProgress('Downloading page...', 10);
      const { html, baseUrl } = await fetchUrl(url);

      const viewports = Array.from(selectedViewports);

      for (let i = 0; i < viewports.length; i++) {
        const viewport = viewports[i];
        const config = VIEWPORT_CONFIGS[viewport];
        const progressBase = 10 + (i / viewports.length) * 70;

        showProgress(`Parsing ${config.name} layout...`, progressBase);

        const parser = new HTMLParser(baseUrl);
        const dom = await parser.parse(html, '', config.width, config.height);

        showProgress(`Creating ${config.name} Figma frame...`, progressBase + 30);

        postMessage({
          type: 'import-dom',
          dom: {
            ...dom,
            attributes: {
              ...dom.attributes,
              'data-viewport': viewport,
              'data-source-url': url,
              'data-viewport-width': String(config.width),
              'data-viewport-height': String(config.height),
            },
          },
        });
      }

      showProgress('Import complete!', 100);
      showStatus('success', `Imported ${url}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import';
      showStatus('error', message);
      hideProgress();
    } finally {
      btn.disabled = !input.value.trim();
    }
  });
}

// ─── UI Helpers ───

function showProgress(message: string, percent: number): void {
  const container = document.getElementById('progress')!;
  container.classList.add('visible');
  container.querySelector('.progress-fill')!.setAttribute('style', `width: ${percent}%`);
  container.querySelector('.progress-text')!.textContent = message;
}

function hideProgress(): void {
  document.getElementById('progress')!.classList.remove('visible');
}

function showStatus(type: 'success' | 'error', message: string): void {
  const el = document.getElementById('status')!;
  el.className = `status-message visible ${type}`;
  el.textContent = message;
}

function hideStatus(): void {
  document.getElementById('status')!.classList.remove('visible');
}

// ─── Messages from Plugin Controller ───

window.onmessage = (event) => {
  const msg = event.data.pluginMessage as MessageToUI;
  if (!msg) return;

  switch (msg.type) {
    case 'import-progress':
      showProgress(msg.message, msg.percent);
      break;

    case 'import-complete':
      showProgress('Import complete!', 100);
      break;

    case 'import-error':
      hideProgress();
      showStatus('error', msg.message);
      break;
  }
};

// ─── Init ───

document.addEventListener('DOMContentLoaded', () => {
  initViewportSelector();
  initImport();
});
