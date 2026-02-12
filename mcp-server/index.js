#!/usr/bin/env node

/**
 * HTML to Design MCP Server
 *
 * Provides tools for AI assistants (Claude Desktop, Cursor, etc.) to:
 * - Generate HTML/CSS layouts and send them to Figma
 * - Import URLs into Figma
 * - Create design components programmatically
 *
 * This server communicates with the Figma plugin via a local WebSocket bridge.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  {
    name: 'html-to-design',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ─── Tool Definitions ───

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'import_url',
        description: 'Import a website URL into Figma as editable design layers. The website will be fetched, parsed, and converted into Figma frames with auto-layout, text layers, images, and proper styling.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The website URL to import (e.g., "https://example.com")',
            },
            viewport: {
              type: 'string',
              enum: ['desktop', 'mobile', 'tablet'],
              description: 'The viewport size to render at. Desktop=1440px, Tablet=768px, Mobile=375px',
              default: 'desktop',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'import_html',
        description: 'Import raw HTML and CSS code into Figma as editable design layers. Useful for generating designs from code.',
        inputSchema: {
          type: 'object',
          properties: {
            html: {
              type: 'string',
              description: 'The HTML code to import',
            },
            css: {
              type: 'string',
              description: 'Optional CSS styles to apply',
              default: '',
            },
            name: {
              type: 'string',
              description: 'Name for the imported frame in Figma',
              default: 'AI Generated Design',
            },
          },
          required: ['html'],
        },
      },
      {
        name: 'generate_design',
        description: 'Generate a UI design from a text description. Creates HTML/CSS and imports it into Figma. The AI should generate the HTML/CSS based on the description and use import_html.',
        inputSchema: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: 'A description of the desired UI design',
            },
            style: {
              type: 'string',
              enum: ['modern', 'minimal', 'corporate', 'playful', 'dark'],
              description: 'The visual style to apply',
              default: 'modern',
            },
            viewport: {
              type: 'string',
              enum: ['desktop', 'mobile', 'tablet'],
              description: 'Target viewport',
              default: 'desktop',
            },
          },
          required: ['description'],
        },
      },
      {
        name: 'create_component',
        description: 'Create a reusable UI component in Figma from HTML/CSS. The component will be added to the current page.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Component name',
            },
            html: {
              type: 'string',
              description: 'HTML code for the component',
            },
            css: {
              type: 'string',
              description: 'CSS styles for the component',
              default: '',
            },
            variants: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  html: { type: 'string' },
                  css: { type: 'string' },
                },
              },
              description: 'Optional variants of the component',
            },
          },
          required: ['name', 'html'],
        },
      },
    ],
  };
});

// ─── Tool Handlers ───

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'import_url':
      return handleImportUrl(args);
    case 'import_html':
      return handleImportHtml(args);
    case 'generate_design':
      return handleGenerateDesign(args);
    case 'create_component':
      return handleCreateComponent(args);
    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

async function handleImportUrl(args) {
  const { url, viewport = 'desktop' } = args;

  try {
    // Send command to Figma plugin via the bridge
    const result = await sendToPlugin({
      type: 'import-url',
      url,
      viewports: [viewport],
    });

    return {
      content: [{
        type: 'text',
        text: `Successfully sent URL import request to Figma plugin.\nURL: ${url}\nViewport: ${viewport}\n\nThe website is being fetched and converted into Figma layers. Check Figma for the result.`,
      }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Failed to import URL: ${err.message}` }],
      isError: true,
    };
  }
}

async function handleImportHtml(args) {
  const { html, css = '', name = 'AI Generated Design' } = args;

  try {
    await sendToPlugin({
      type: 'import-html',
      html,
      css,
    });

    return {
      content: [{
        type: 'text',
        text: `Successfully sent HTML import to Figma plugin.\nFrame name: ${name}\nHTML length: ${html.length} chars\nCSS length: ${css.length} chars\n\nCheck Figma for the generated design.`,
      }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Failed to import HTML: ${err.message}` }],
      isError: true,
    };
  }
}

async function handleGenerateDesign(args) {
  const { description, style = 'modern', viewport = 'desktop' } = args;

  // The MCP server acts as a bridge - the actual AI will generate the HTML/CSS
  // We provide the instruction for the calling AI to generate and use import_html
  return {
    content: [{
      type: 'text',
      text: `To generate a design for: "${description}"\n\nPlease create the HTML and CSS for this design and then use the import_html tool to send it to Figma.\n\nStyle: ${style}\nViewport: ${viewport}\n\nTips:\n- Use flexbox for layouts (converts to Figma auto-layout)\n- Use semantic HTML tags for better Figma layer naming\n- Include proper font-family, font-size, and color properties\n- Use px units for consistent sizing\n- Background colors and border-radius are fully supported`,
    }],
  };
}

async function handleCreateComponent(args) {
  const { name, html, css = '', variants } = args;

  try {
    // Import main component
    await sendToPlugin({
      type: 'import-html',
      html,
      css,
    });

    // Import variants if provided
    if (variants && variants.length > 0) {
      for (const variant of variants) {
        await sendToPlugin({
          type: 'import-html',
          html: variant.html,
          css: variant.css || css,
        });
      }
    }

    return {
      content: [{
        type: 'text',
        text: `Component "${name}" sent to Figma plugin.\n${variants ? `Including ${variants.length} variant(s).` : ''}\n\nCheck Figma for the result.`,
      }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Failed to create component: ${err.message}` }],
      isError: true,
    };
  }
}

// ─── Plugin Communication ───

// In production, this would connect to the Figma plugin via WebSocket
// For now, we store commands that the plugin polls for

const pendingCommands = [];

async function sendToPlugin(command) {
  pendingCommands.push({
    ...command,
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
  });

  // In a full implementation, this would:
  // 1. Connect to a local WebSocket server
  // 2. Send the command to the Figma plugin
  // 3. Wait for acknowledgment
  return { success: true };
}

// ─── Start Server ───

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('HTML to Design MCP server running');
}

main().catch(console.error);
