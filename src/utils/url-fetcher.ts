/**
 * URL fetching utility that retrieves HTML content from URLs.
 * Runs in the plugin UI context (has fetch access via networkAccess).
 */

export interface FetchResult {
  html: string;
  baseUrl: string;
  title?: string;
}

export async function fetchUrl(url: string): Promise<FetchResult> {
  // Normalize URL
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const finalUrl = response.url || url;
  const baseUrl = new URL(finalUrl).origin;

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : undefined;

  // Resolve relative URLs in the HTML
  const resolvedHtml = resolveRelativeUrls(html, finalUrl);

  return { html: resolvedHtml, baseUrl, title };
}

/**
 * Resolve relative URLs in HTML to absolute URLs.
 */
function resolveRelativeUrls(html: string, baseUrl: string): string {
  const base = new URL(baseUrl);

  // Resolve src attributes
  html = html.replace(/(src|href|action)=["'](?!data:)(?!#)(?!javascript:)(?!mailto:)(?!tel:)([^"']+)["']/gi,
    (match, attr, url) => {
      try {
        const absolute = new URL(url, base).href;
        return `${attr}="${absolute}"`;
      } catch {
        return match;
      }
    }
  );

  // Resolve url() in CSS
  html = html.replace(/url\(["']?(?!data:)([^"')]+)["']?\)/gi,
    (match, url) => {
      try {
        const absolute = new URL(url.trim(), base).href;
        return `url("${absolute}")`;
      } catch {
        return match;
      }
    }
  );

  return html;
}
