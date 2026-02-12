/**
 * File parsing utility for handling uploaded files.
 * Supports .html, .htm, .zip, .h2d, .eml, .emlx, .msg formats.
 */

export interface ParsedFile {
  html: string;
  css: string;
  fileName: string;
}

/**
 * Parse an uploaded file based on its type.
 */
export async function parseFile(file: File): Promise<ParsedFile[]> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  switch (ext) {
    case 'html':
    case 'htm':
      return [await parseHtmlFile(file)];
    case 'zip':
      return parseZipFile(file);
    case 'h2d':
      return parseH2dFile(file);
    case 'eml':
    case 'emlx':
      return [await parseEmlFile(file)];
    case 'msg':
      return [await parseMsgFile(file)];
    default:
      throw new Error(`Unsupported file format: .${ext}`);
  }
}

async function parseHtmlFile(file: File): Promise<ParsedFile> {
  const text = await readFileAsText(file);
  return {
    html: text,
    css: '',
    fileName: file.name,
  };
}

async function parseZipFile(file: File): Promise<ParsedFile[]> {
  const JSZip = (window as any).JSZip;
  if (!JSZip) {
    throw new Error('ZIP support requires JSZip library');
  }

  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const fileNames = Object.keys(zip.files);

  // Detect Google Stitch exports (contain stitch.json or specific folder structure)
  const isGoogleStitch = fileNames.some(
    name => name === 'stitch.json' || name.endsWith('/stitch.json')
  );

  if (isGoogleStitch) {
    return parseGoogleStitchZip(zip, fileNames);
  }

  const results: ParsedFile[] = [];

  const htmlFiles = fileNames.filter(
    name => name.endsWith('.html') || name.endsWith('.htm')
  );

  if (htmlFiles.length === 0) {
    throw new Error('No HTML files found in ZIP archive');
  }

  // Collect CSS files
  const cssFiles = fileNames.filter(name => name.endsWith('.css'));
  let combinedCss = '';
  for (const cssFile of cssFiles) {
    const content = await zip.files[cssFile].async('string');
    combinedCss += content + '\n';
  }

  for (const htmlFile of htmlFiles) {
    const content = await zip.files[htmlFile].async('string');
    results.push({
      html: content,
      css: combinedCss,
      fileName: htmlFile,
    });
  }

  return results;
}

/**
 * Parse a Google Stitch exported ZIP file.
 * Stitch exports contain a stitch.json manifest and organized page assets.
 */
async function parseGoogleStitchZip(zip: any, fileNames: string[]): Promise<ParsedFile[]> {
  const results: ParsedFile[] = [];

  // Try to read the stitch manifest
  const manifestFile = fileNames.find(
    name => name === 'stitch.json' || name.endsWith('/stitch.json')
  );

  let manifest: any = null;
  if (manifestFile) {
    try {
      const manifestContent = await zip.files[manifestFile].async('string');
      manifest = JSON.parse(manifestContent);
    } catch {
      // Fallback to scanning for HTML files
    }
  }

  // If we have a manifest with pages, use it to order imports
  if (manifest?.pages && Array.isArray(manifest.pages)) {
    for (const page of manifest.pages) {
      const htmlPath = page.html || page.path;
      if (htmlPath && zip.files[htmlPath]) {
        const html = await zip.files[htmlPath].async('string');
        let css = '';

        // Load associated CSS
        if (page.css && zip.files[page.css]) {
          css = await zip.files[page.css].async('string');
        }

        results.push({
          html,
          css,
          fileName: page.name || htmlPath,
        });
      }
    }
  }

  // If manifest parsing didn't produce results, fall back to finding HTML files
  if (results.length === 0) {
    const htmlFiles = fileNames.filter(
      name => name.endsWith('.html') || name.endsWith('.htm')
    );

    const cssFiles = fileNames.filter(name => name.endsWith('.css'));
    let combinedCss = '';
    for (const cssFile of cssFiles) {
      combinedCss += await zip.files[cssFile].async('string') + '\n';
    }

    for (const htmlFile of htmlFiles) {
      results.push({
        html: await zip.files[htmlFile].async('string'),
        css: combinedCss,
        fileName: htmlFile,
      });
    }
  }

  if (results.length === 0) {
    throw new Error('No importable pages found in Google Stitch export');
  }

  return results;
}

/**
 * Parse an .h2d file (HTML to Design batch format).
 * .h2d files are JSON containing one or more HTML/CSS page definitions.
 */
async function parseH2dFile(file: File): Promise<ParsedFile[]> {
  const text = await readFileAsText(file);

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Invalid .h2d file: not valid JSON');
  }

  const results: ParsedFile[] = [];

  // Support both single-page and multi-page formats
  if (Array.isArray(data)) {
    for (const entry of data) {
      if (entry.html) {
        results.push({
          html: entry.html,
          css: entry.css || '',
          fileName: entry.name || entry.fileName || file.name,
        });
      }
    }
  } else if (data.pages && Array.isArray(data.pages)) {
    for (const page of data.pages) {
      if (page.html) {
        results.push({
          html: page.html,
          css: page.css || data.css || '',
          fileName: page.name || page.fileName || file.name,
        });
      }
    }
  } else if (data.html) {
    results.push({
      html: data.html,
      css: data.css || '',
      fileName: data.name || file.name,
    });
  }

  if (results.length === 0) {
    throw new Error('No HTML content found in .h2d file');
  }

  return results;
}

async function parseEmlFile(file: File): Promise<ParsedFile> {
  const text = await readFileAsText(file);
  const html = extractHtmlFromEmail(text);
  return {
    html,
    css: '',
    fileName: file.name,
  };
}

async function parseMsgFile(file: File): Promise<ParsedFile> {
  // .msg files are Outlook format - extract what we can
  const buffer = await file.arrayBuffer();
  const text = new TextDecoder('utf-8').decode(buffer);

  // Try to find HTML content in the raw data
  const htmlMatch = text.match(/<html[\s\S]*?<\/html>/i);
  if (htmlMatch) {
    return {
      html: htmlMatch[0],
      css: '',
      fileName: file.name,
    };
  }

  // Fallback: wrap plain text
  const plainText = text.replace(/[^\x20-\x7E\n\r\t]/g, '');
  return {
    html: `<div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: auto;">${plainText.replace(/\n/g, '<br>')}</div>`,
    css: '',
    fileName: file.name,
  };
}

/**
 * Extract HTML body from EML/EMLX email format.
 */
function extractHtmlFromEmail(emlContent: string): string {
  // Find MIME boundaries
  const boundaryMatch = emlContent.match(/boundary="?([^"\s;]+)"?/);

  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = emlContent.split(`--${boundary}`);

    // Look for HTML part
    for (const part of parts) {
      if (part.includes('Content-Type: text/html') || part.includes('content-type: text/html')) {
        // Extract content after headers (double newline)
        const headerEnd = part.indexOf('\n\n');
        if (headerEnd === -1) continue;
        let content = part.substring(headerEnd + 2).trim();

        // Check for transfer encoding
        if (part.includes('base64')) {
          try {
            content = atob(content.replace(/\s/g, ''));
          } catch {
            // Not valid base64, use as-is
          }
        } else if (part.includes('quoted-printable')) {
          content = decodeQuotedPrintable(content);
        }

        return content;
      }
    }

    // Fallback: look for plain text part
    for (const part of parts) {
      if (part.includes('Content-Type: text/plain') || part.includes('content-type: text/plain')) {
        const headerEnd = part.indexOf('\n\n');
        if (headerEnd === -1) continue;
        const text = part.substring(headerEnd + 2).trim();
        return `<div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: auto; white-space: pre-wrap;">${escapeHtml(text)}</div>`;
      }
    }
  }

  // No MIME boundary - try to find HTML directly
  const htmlMatch = emlContent.match(/<html[\s\S]*?<\/html>/i);
  if (htmlMatch) return htmlMatch[0];

  // Last resort: extract body text after headers
  const headerEnd = emlContent.indexOf('\n\n');
  const body = headerEnd > 0 ? emlContent.substring(headerEnd + 2) : emlContent;
  return `<div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: auto; white-space: pre-wrap;">${escapeHtml(body)}</div>`;
}

function decodeQuotedPrintable(str: string): string {
  return str
    .replace(/=\r?\n/g, '') // Soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
