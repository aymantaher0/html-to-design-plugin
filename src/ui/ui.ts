import { MessageToController, MessageToUI, ViewportType, VIEWPORT_CONFIGS } from '../types';
import { HTMLParser } from '../parser/html-parser';
import { fetchUrl } from '../utils/url-fetcher';
import { parseFile } from '../utils/file-parser';

// ─── State ───

let selectedViewports: Set<ViewportType> = new Set(['desktop']);
let uploadedFiles: File[] = [];
let activeEditorTab: 'html' | 'css' = 'html';

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
        // Don't deselect the last one
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

    btn.disabled = true;
    showProgress('url-progress', 'Fetching website...', 5);
    hideStatus('url-status');

    try {
      // Fetch the URL content
      showProgress('url-progress', 'Downloading page...', 10);
      const { html, baseUrl } = await fetchUrl(url);

      // Parse for each viewport
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
            // Pass viewport info via attributes
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

  // Click to upload
  dropZone.addEventListener('click', () => fileInput.click());

  // Drag and drop
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

  // File input change
  fileInput.addEventListener('change', () => {
    if (fileInput.files) {
      addFiles(Array.from(fileInput.files));
    }
    fileInput.value = '';
  });

  function addFiles(files: File[]): void {
    const validExts = ['html', 'htm', 'zip', 'eml', 'emlx', 'msg'];
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

    // Remove handlers
    fileList.querySelectorAll('.remove-file').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt((e.target as HTMLElement).getAttribute('data-index')!);
        uploadedFiles.splice(idx, 1);
        renderFileList();
      });
    });

    btn.disabled = uploadedFiles.length === 0;
  }

  btn.addEventListener('click', async () => {
    if (uploadedFiles.length === 0) return;

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

  // Tab key support in editors
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

    btn.disabled = true;
    showProgress('editor-progress', 'Parsing code...', 10);
    hideStatus('editor-status');

    try {
      const parser = new HTMLParser();
      const dom = await parser.parse(html, css, 1440, 900);

      showProgress('editor-progress', 'Creating Figma frame...', 60);

      postMessage({ type: 'import-dom', dom });

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

// ─── Extension listener ───

function initExtensionListener(): void {
  // Listen for messages from the Chrome Extension via window.postMessage
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (data && data.source === 'html-to-design-extension') {
      const dot = document.getElementById('extension-dot')!;
      dot.classList.add('connected');
      dot.parentElement!.querySelector('span')!.textContent = 'Extension connected';

      if (data.type === 'dom-capture') {
        showProgress('extension-progress', 'Processing captured page...', 30);
        postMessage({ type: 'import-dom', dom: data.dom });
        showProgress('extension-progress', 'Import complete!', 100);
        showStatus('extension-status-msg', 'success', 'Page captured and imported');
      }
    }
  });
}

// ─── MCP ───

function initMcp(): void {
  const btn = document.getElementById('btn-mcp-generate') as HTMLButtonElement;
  const prompt = document.getElementById('mcp-prompt') as HTMLTextAreaElement;

  // MCP is server-side, so we just provide the UI
  // The MCP server communicates with the plugin via the extension or direct API
  btn.disabled = true;

  // Listen for MCP connections
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (data && data.source === 'html-to-design-mcp') {
      const dot = document.getElementById('mcp-dot')!;
      dot.classList.add('connected');
      dot.parentElement!.querySelector('span')!.textContent = 'MCP server connected';
      btn.disabled = false;

      if (data.type === 'design-generated') {
        showProgress('mcp-progress', 'Importing AI-generated design...', 50);
        postMessage({ type: 'import-dom', dom: data.dom });
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
      // Update all visible progress bars
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
      // Show error on the active panel's status
      const activePanel = document.querySelector('.tab-panel.active');
      if (activePanel) {
        const status = activePanel.querySelector('.status-message');
        if (status) {
          status.className = 'status-message visible error';
          status.textContent = msg.message;
        }
      }
      break;

    case 'selection-change':
      // Could enable re-import button if selection has import metadata
      break;
  }
};

// ─── Initialize ───

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initViewportSelector();
  initUrlImport();
  initFileImport();
  initCodeEditor();
  initExtensionListener();
  initMcp();

  // Request initial resize
  postMessage({ type: 'resize', width: 360, height: 480 });
});
