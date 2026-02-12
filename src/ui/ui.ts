import { MessageToController, MessageToUI, ViewportType, VIEWPORT_CONFIGS, ImportMetadata } from '../types';
import { HTMLParser } from '../parser/html-parser';
import { fetchUrl } from '../utils/url-fetcher';
import { parseFile } from '../utils/file-parser';

// ─── State ───

let selectedViewports: Set<ViewportType> = new Set(['desktop']);
let uploadedFiles: File[] = [];
let activeEditorTab: 'html' | 'css' = 'html';
let selectedNodeId: string | null = null;

// ─── Import Counter ───

const FREE_IMPORT_LIMIT = 10;
const COUNTER_PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface ImportCounter {
  count: number;
  periodStart: number;
}

function getImportCounter(): ImportCounter {
  try {
    const stored = localStorage.getItem('h2d-import-counter');
    if (stored) {
      const counter: ImportCounter = JSON.parse(stored);
      if (Date.now() - counter.periodStart > COUNTER_PERIOD_MS) {
        return { count: 0, periodStart: Date.now() };
      }
      return counter;
    }
  } catch {
    // Ignore storage errors
  }
  return { count: 0, periodStart: Date.now() };
}

function incrementImportCount(): void {
  const counter = getImportCounter();
  counter.count++;
  try {
    localStorage.setItem('h2d-import-counter', JSON.stringify(counter));
  } catch {
    // Ignore storage errors
  }
  updateImportCounterUI(counter);
}

function updateImportCounterUI(counter?: ImportCounter): void {
  if (!counter) counter = getImportCounter();
  const numEl = document.getElementById('import-count-num');
  const containerEl = document.getElementById('import-counter');
  if (!numEl || !containerEl) return;

  numEl.textContent = String(counter.count);
  containerEl.classList.remove('warning', 'limit');

  if (counter.count >= FREE_IMPORT_LIMIT) {
    containerEl.classList.add('limit');
  } else if (counter.count >= FREE_IMPORT_LIMIT - 2) {
    containerEl.classList.add('warning');
  }
}

function canImport(): boolean {
  const counter = getImportCounter();
  if (counter.count >= FREE_IMPORT_LIMIT) {
    // Show error on whichever panel is active
    const activePanel = document.querySelector('.tab-panel.active');
    if (activePanel) {
      const status = activePanel.querySelector('.status-message');
      if (status) {
        status.className = 'status-message visible error';
        status.textContent = `Import limit reached (${FREE_IMPORT_LIMIT}/30 days). Upgrade to Pro for unlimited imports.`;
      }
    }
    return false;
  }
  return true;
}

// ─── Post message helper ───

function postMessage(msg: MessageToController): void {
  parent.postMessage({ pluginMessage: msg }, '*');
}

// ─── Tab Navigation ───

function initTabs(): void {
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.getAttribute('data-tab')!;

      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(`panel-${tabId}`)?.classList.add('active');
    });
  });
}

// ─── Viewport Selector ───

function initViewportSelector(): void {
  const options = document.querySelectorAll('.viewport-option');

  options.forEach(option => {
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

function initUrlImport(): void {
  const input = document.getElementById('url-input') as HTMLInputElement;
  const btn = document.getElementById('btn-import-url') as HTMLButtonElement;

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
    if (!canImport()) return;

    btn.disabled = true;
    showProgress('url-progress', 'Fetching website...', 5);
    hideStatus('url-status');

    try {
      showProgress('url-progress', 'Downloading page...', 10);
      const { html, baseUrl } = await fetchUrl(url);

      const viewports = Array.from(selectedViewports);

      for (let i = 0; i < viewports.length; i++) {
        const viewport = viewports[i];
        const config = VIEWPORT_CONFIGS[viewport];
        const progressBase = 10 + (i / viewports.length) * 70;

        showProgress('url-progress', `Parsing ${config.name} layout...`, progressBase);

        const parser = new HTMLParser(baseUrl);
        const dom = await parser.parse(html, '', config.width, config.height);

        showProgress('url-progress', `Creating ${config.name} Figma frame...`, progressBase + 30);

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

      incrementImportCount();
      showProgress('url-progress', 'Import complete!', 100);
      showStatus('url-status', 'success', `Successfully imported ${url}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error occurred';
      showStatus('url-status', 'error', `Failed to import: ${message}`);
      hideProgress('url-progress');
    } finally {
      btn.disabled = false;
    }
  });
}

// ─── File Import ───

function initFileImport(): void {
  const dropZone = document.getElementById('file-drop')!;
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const fileList = document.getElementById('file-list')!;
  const btn = document.getElementById('btn-import-file') as HTMLButtonElement;

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer?.files) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files) {
      addFiles(Array.from(fileInput.files));
    }
    fileInput.value = '';
  });

  function addFiles(files: File[]): void {
    const validExts = ['html', 'htm', 'zip', 'h2d', 'eml', 'emlx', 'msg'];
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext && validExts.includes(ext)) {
        uploadedFiles.push(file);
      }
    }
    renderFileList();
  }

  function renderFileList(): void {
    fileList.innerHTML = '';
    uploadedFiles.forEach((file, index) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span>${file.name} (${formatFileSize(file.size)})</span>
        <span class="remove-file" data-index="${index}">&times;</span>
      `;
      fileList.appendChild(li);
    });

    fileList.querySelectorAll('.remove-file').forEach(removeBtn => {
      removeBtn.addEventListener('click', (e) => {
        const idx = parseInt((e.target as HTMLElement).getAttribute('data-index')!);
        uploadedFiles.splice(idx, 1);
        renderFileList();
      });
    });

    btn.disabled = uploadedFiles.length === 0;
  }

  btn.addEventListener('click', async () => {
    if (uploadedFiles.length === 0) return;
    if (!canImport()) return;

    btn.disabled = true;
    showProgress('file-progress', 'Parsing files...', 5);
    hideStatus('file-status');

    try {
      let totalImported = 0;

      for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        const progress = (i / uploadedFiles.length) * 80;
        showProgress('file-progress', `Processing ${file.name}...`, 10 + progress);

        const parsedFiles = await parseFile(file);

        for (const parsed of parsedFiles) {
          const parser = new HTMLParser();
          const dom = await parser.parse(parsed.html, parsed.css, 1440, 900);

          dom.attributes = {
            ...dom.attributes,
            'data-source-file': parsed.fileName,
          };

          postMessage({ type: 'import-dom', dom });
          totalImported++;
        }
      }

      incrementImportCount();
      showProgress('file-progress', 'Import complete!', 100);
      showStatus('file-status', 'success', `Successfully imported ${totalImported} file(s)`);
      uploadedFiles = [];
      renderFileList();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error occurred';
      showStatus('file-status', 'error', `Failed to import: ${message}`);
      hideProgress('file-progress');
    } finally {
      btn.disabled = false;
    }
  });
}

// ─── Code Editor ───

function initCodeEditor(): void {
  const htmlEditor = document.getElementById('html-editor') as HTMLTextAreaElement;
  const cssEditor = document.getElementById('css-editor') as HTMLTextAreaElement;
  const editorTabs = document.querySelectorAll('.editor-tab');
  const btn = document.getElementById('btn-import-code') as HTMLButtonElement;

  editorTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const editor = tab.getAttribute('data-editor') as 'html' | 'css';
      activeEditorTab = editor;

      editorTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      htmlEditor.style.display = editor === 'html' ? 'block' : 'none';
      cssEditor.style.display = editor === 'css' ? 'block' : 'none';
    });
  });

  [htmlEditor, cssEditor].forEach(editor => {
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 2;
      }
    });
  });

  btn.addEventListener('click', async () => {
    const html = htmlEditor.value.trim();
    const css = cssEditor.value.trim();

    if (!html) {
      showStatus('editor-status', 'error', 'Please enter some HTML code');
      return;
    }
    if (!canImport()) return;

    btn.disabled = true;
    showProgress('editor-progress', 'Parsing code...', 10);
    hideStatus('editor-status');

    try {
      const parser = new HTMLParser();
      const dom = await parser.parse(html, css, 1440, 900);

      showProgress('editor-progress', 'Creating Figma frame...', 60);

      postMessage({ type: 'import-dom', dom });

      incrementImportCount();
      showProgress('editor-progress', 'Import complete!', 100);
      showStatus('editor-status', 'success', 'Code imported successfully');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error occurred';
      showStatus('editor-status', 'error', `Failed to import: ${message}`);
      hideProgress('editor-progress');
    } finally {
      btn.disabled = false;
    }
  });
}

// ─── Re-import ───

function initReimport(): void {
  const btn = document.getElementById('btn-reimport') as HTMLButtonElement;

  btn.addEventListener('click', () => {
    if (!selectedNodeId) return;
    postMessage({ type: 'reimport', nodeId: selectedNodeId });
    document.getElementById('reimport-banner')!.classList.remove('visible');
  });
}

async function handleReimportMetadata(metadata: ImportMetadata): Promise<void> {
  if (metadata.sourceUrl) {
    showProgress('url-progress', 'Re-importing from URL...', 10);

    try {
      const { html, baseUrl } = await fetchUrl(metadata.sourceUrl);
      const viewport = metadata.viewport || 'desktop';
      const config = VIEWPORT_CONFIGS[viewport];

      showProgress('url-progress', `Parsing ${config.name} layout...`, 40);

      const parser = new HTMLParser(baseUrl);
      const dom = await parser.parse(html, '', config.width, config.height);

      showProgress('url-progress', 'Creating Figma frame...', 70);

      postMessage({
        type: 'import-dom',
        dom: {
          ...dom,
          attributes: {
            ...dom.attributes,
            'data-viewport': viewport,
            'data-source-url': metadata.sourceUrl,
            'data-viewport-width': String(config.width),
            'data-viewport-height': String(config.height),
          },
        },
      });

      showProgress('url-progress', 'Re-import complete!', 100);
      showStatus('url-status', 'success', `Re-imported ${metadata.sourceUrl}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Re-import failed';
      showStatus('url-status', 'error', `Failed to re-import: ${message}`);
      hideProgress('url-progress');
    }
  } else if (metadata.sourceHtml) {
    showProgress('editor-progress', 'Re-importing from code...', 10);

    try {
      const parser = new HTMLParser();
      const dom = await parser.parse(metadata.sourceHtml, metadata.sourceCss || '', 1440, 900);

      showProgress('editor-progress', 'Creating Figma frame...', 60);
      postMessage({ type: 'import-dom', dom });

      showProgress('editor-progress', 'Re-import complete!', 100);
      showStatus('editor-status', 'success', 'Re-imported successfully');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Re-import failed';
      showStatus('editor-status', 'error', `Failed to re-import: ${message}`);
      hideProgress('editor-progress');
    }
  }
}

// ─── Extension listener ───

function initExtensionListener(): void {
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (data && data.source === 'html-to-design-extension') {
      const dot = document.getElementById('extension-dot')!;
      dot.classList.add('connected');
      dot.parentElement!.querySelector('span')!.textContent = 'Extension connected';

      if (data.type === 'dom-capture') {
        if (!canImport()) return;
        showProgress('extension-progress', 'Processing captured page...', 30);
        postMessage({ type: 'import-dom', dom: data.dom });
        incrementImportCount();
        showProgress('extension-progress', 'Import complete!', 100);
        showStatus('extension-status-msg', 'success', 'Page captured and imported');
      }
    }
  });
}

// ─── MCP ───

function initMcp(): void {
  const btn = document.getElementById('btn-mcp-generate') as HTMLButtonElement;

  btn.disabled = true;

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (data && data.source === 'html-to-design-mcp') {
      const dot = document.getElementById('mcp-dot')!;
      dot.classList.add('connected');
      dot.parentElement!.querySelector('span')!.textContent = 'MCP server connected';
      btn.disabled = false;

      if (data.type === 'design-generated') {
        if (!canImport()) return;
        showProgress('mcp-progress', 'Importing AI-generated design...', 50);
        postMessage({ type: 'import-dom', dom: data.dom });
        incrementImportCount();
        showProgress('mcp-progress', 'Import complete!', 100);
        showStatus('mcp-status-msg', 'success', 'AI design imported');
      }
    }
  });
}

// ─── UI Helpers ───

function showProgress(containerId: string, message: string, percent: number): void {
  const container = document.getElementById(containerId)!;
  container.classList.add('visible');
  container.querySelector('.progress-fill')!.setAttribute('style', `width: ${percent}%`);
  container.querySelector('.progress-text')!.textContent = message;
}

function hideProgress(containerId: string): void {
  const container = document.getElementById(containerId)!;
  container.classList.remove('visible');
}

function showStatus(elementId: string, type: 'success' | 'error' | 'info', message: string): void {
  const el = document.getElementById(elementId)!;
  el.className = `status-message visible ${type}`;
  el.textContent = message;
}

function hideStatus(elementId: string): void {
  const el = document.getElementById(elementId)!;
  el.classList.remove('visible');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ─── Message Handler from Plugin Controller ───

window.onmessage = (event) => {
  const msg = event.data.pluginMessage as MessageToUI;
  if (!msg) return;

  switch (msg.type) {
    case 'import-progress':
      document.querySelectorAll('.progress-container.visible').forEach(container => {
        container.querySelector('.progress-fill')!.setAttribute('style', `width: ${msg.percent}%`);
        container.querySelector('.progress-text')!.textContent = msg.message;
      });
      break;

    case 'import-complete':
      document.querySelectorAll('.progress-container.visible').forEach(container => {
        container.querySelector('.progress-fill')!.setAttribute('style', 'width: 100%');
        container.querySelector('.progress-text')!.textContent = 'Import complete!';
      });
      break;

    case 'import-error':
      document.querySelectorAll('.progress-container.visible').forEach(container => {
        container.classList.remove('visible');
      });
      const activePanel = document.querySelector('.tab-panel.active');
      if (activePanel) {
        const status = activePanel.querySelector('.status-message');
        if (status) {
          status.className = 'status-message visible error';
          status.textContent = msg.message;
        }
      }
      break;

    case 'selection-change': {
      const banner = document.getElementById('reimport-banner')!;
      const sourceEl = document.getElementById('reimport-source')!;

      if (msg.hasDesignNode && msg.nodeId) {
        selectedNodeId = msg.nodeId;
        banner.classList.add('visible');
        sourceEl.textContent = 'Click Re-import to refresh this design';
        postMessage({ type: 'get-reimport-metadata', nodeId: msg.nodeId });
      } else {
        selectedNodeId = null;
        banner.classList.remove('visible');
      }
      break;
    }

    case 'reimport-metadata': {
      const sourceEl = document.getElementById('reimport-source');
      if (sourceEl && msg.metadata) {
        if (msg.metadata.sourceUrl) {
          sourceEl.textContent = msg.metadata.sourceUrl;
        } else {
          sourceEl.textContent = `Imported ${msg.metadata.importedAt ? new Date(msg.metadata.importedAt).toLocaleDateString() : ''}`;
        }
      }
      // If this came from a re-import request (frame was removed), handle re-fetch
      if (msg.metadata && (msg.metadata as any).reimportX !== undefined) {
        handleReimportMetadata(msg.metadata);
      }
      break;
    }
  }
};

// ─── Initialize ───

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initViewportSelector();
  initUrlImport();
  initFileImport();
  initCodeEditor();
  initReimport();
  initExtensionListener();
  initMcp();
  updateImportCounterUI();

  postMessage({ type: 'resize', width: 360, height: 480 });
});
