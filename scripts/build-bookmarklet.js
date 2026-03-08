#!/usr/bin/env node

/**
 * Bookmarklet builder for page-agent
 *
 * Generates multiple bookmarklet deployment formats:
 * 1. Inline bookmarklet - Self-contained (subject to URL length limits ~2KB)
 * 2. Bounce loader - Loads the full IIFE bundle from a hosted URL
 * 3. Local orchestrator - Loads from a local development server
 *
 * Usage:
 *   node scripts/build-bookmarklet.js [--cdn-url <url>] [--local-port <port>]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const args = process.argv.slice(2)
function getArg(name) {
	const idx = args.indexOf(`--${name}`)
	return idx !== -1 && args[idx + 1] ? args[idx + 1] : null
}

const cdnUrl =
	getArg('cdn-url') ||
	'https://cdn.jsdelivr.net/npm/page-agent@latest/dist/iife/page-agent.demo.js'
const localPort = getArg('local-port') || '5174'
const outDir = resolve(ROOT, 'dist', 'bookmarklet')
mkdirSync(outDir, { recursive: true })

// --- 1. Bounce Loader Bookmarklet (recommended) ---
// Loads the full bundle from a CDN/hosted URL. Works on all browsers.
// NOTE: Sites with strict Content-Security-Policy (CSP) may block injected
// script tags. In that case, users need the browser extension instead.
const bounceLoader = `javascript:void(function(){if(window.pageAgent){window.pageAgent.dispose()}var s=document.createElement('script');s.src='${cdnUrl}';s.onerror=function(){alert('Failed to load page-agent. Check your network connection.')};document.head.appendChild(s)}())`

// --- 2. Local Dev Bookmarklet ---
// Loads from a local dev server for testing
const localLoader = `javascript:void(function(){if(window.pageAgent){window.pageAgent.dispose()}var s=document.createElement('script');s.src='http://localhost:${localPort}/page-agent.demo.js';s.onerror=function(){alert('Local page-agent server not running. Start with: npm run dev:demo')};document.head.appendChild(s)}())`

// --- 3. Configurable Bounce Bookmarklet ---
// Prompts user for LLM config on first run, stores in localStorage
const configurableLoader = `javascript:void(function(){if(window.pageAgent){window.pageAgent.panel.show();return}var c=localStorage.getItem('pageAgentConfig');if(!c){var m=prompt('LLM Model name:','');if(!m)return;var b=prompt('LLM Base URL:','https://api.openai.com/v1');if(!b)return;var k=prompt('API Key:','');if(!k)return;c=JSON.stringify({model:m,baseURL:b,apiKey:k});localStorage.setItem('pageAgentConfig',c)}var cfg=JSON.parse(c);var s=document.createElement('script');s.src='${cdnUrl}'+'?model='+encodeURIComponent(cfg.model)+'&baseURL='+encodeURIComponent(cfg.baseURL)+'&apiKey='+encodeURIComponent(cfg.apiKey);s.onerror=function(){alert('Failed to load page-agent')};document.head.appendChild(s)}())`

// --- 4. Try to build inline bookmarklet from IIFE if available ---
let inlineBookmarklet = null
try {
	const iifePath = resolve(ROOT, 'packages', 'page-agent', 'dist', 'iife', 'page-agent.demo.js')
	const iifeContent = readFileSync(iifePath, 'utf-8')

	// Bookmarklets have practical URL limits (~2KB for older browsers, ~65KB for modern)
	// Most page-agent builds will exceed even the generous limit
	const encoded = `javascript:void(function(){${encodeURIComponent(iifeContent)}}())`
	if (encoded.length <= 65536) {
		inlineBookmarklet = encoded
		console.log(`Inline bookmarklet: ${encoded.length} chars (within limits)`)
	} else {
		console.log(
			`Inline bookmarklet too large: ${encoded.length} chars (limit: 65536). Use bounce loader instead.`
		)
	}
} catch {
	console.log('IIFE build not found - skipping inline bookmarklet (build first with npm run build)')
}

// --- Generate output ---
const output = {
	bounce: bounceLoader,
	local: localLoader,
	configurable: configurableLoader,
	inline: inlineBookmarklet,
	metadata: {
		cdnUrl,
		localPort,
		generatedAt: new Date().toISOString(),
		browsers: {
			chrome: { desktop: 'full', android: 'bookmarklet-only (no extension support)' },
			firefox: { desktop: 'full', android: 'bookmarklet + extension (limited)' },
			safari: { desktop: 'full', ios: 'bookmarklet via share sheet or extension' },
			edge: { desktop: 'full', android: 'bookmarklet-only (no extension support)' },
		},
	},
}

writeFileSync(resolve(outDir, 'bookmarklets.json'), JSON.stringify(output, null, 2))

// Generate an HTML installer page
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page Agent - Bookmarklet Installer</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 700px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
  h1 { border-bottom: 2px solid #333; padding-bottom: 0.5rem; }
  .bookmarklet-link { display: inline-block; padding: 0.75rem 1.5rem; background: #2563eb; color: white;
    text-decoration: none; border-radius: 0.5rem; margin: 0.5rem 0; font-weight: bold; cursor: grab; }
  .bookmarklet-link:hover { background: #1d4ed8; }
  .instructions { background: #f3f4f6; padding: 1rem; border-radius: 0.5rem; margin: 1rem 0; }
  code { background: #e5e7eb; padding: 0.15rem 0.4rem; border-radius: 0.25rem; font-size: 0.9em; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #e5e7eb; }
  th { background: #f9fafb; }
  .tag { display: inline-block; padding: 0.1rem 0.4rem; border-radius: 0.25rem; font-size: 0.8em; font-weight: bold; }
  .tag-full { background: #dcfce7; color: #166534; }
  .tag-partial { background: #fef9c3; color: #854d0e; }
  .tag-bookmarklet { background: #dbeafe; color: #1e40af; }
</style>
</head>
<body>
<h1>Page Agent Bookmarklet</h1>
<p>Drag any of the links below to your bookmarks bar to install.</p>

<h2>Recommended: Bounce Loader</h2>
<p>Loads the latest version from CDN. Works on all browsers.</p>
<a class="bookmarklet-link" href="${bounceLoader.replace(/"/g, '&quot;')}">Page Agent</a>

<h2>Configurable Loader</h2>
<p>Prompts for your LLM API configuration on first use (saved in localStorage).</p>
<a class="bookmarklet-link" href="${configurableLoader.replace(/"/g, '&quot;')}">Page Agent (Config)</a>

<h2>Local Dev</h2>
<p>For development. Start the dev server first: <code>npm run dev:demo</code></p>
<a class="bookmarklet-link" href="${localLoader.replace(/"/g, '&quot;')}">Page Agent (Local)</a>

<div class="instructions">
<h3>Mobile Installation</h3>
<p><strong>iOS Safari:</strong> Create any bookmark, then edit it and replace the URL with the bookmarklet code.</p>
<p><strong>Android Chrome/Firefox:</strong> Same approach - create a bookmark, edit it, paste the bookmarklet URL.</p>
<p><strong>Tip:</strong> Copy the bookmarklet URL from the JSON output for mobile use.</p>
</div>

<h2>Browser Compatibility</h2>
<table>
<tr><th>Browser</th><th>Desktop</th><th>Mobile</th></tr>
<tr><td>Chrome</td><td><span class="tag tag-full">Extension + Bookmarklet</span></td><td><span class="tag tag-bookmarklet">Bookmarklet only</span></td></tr>
<tr><td>Firefox</td><td><span class="tag tag-full">Extension + Bookmarklet</span></td><td><span class="tag tag-partial">Extension (limited) + Bookmarklet</span></td></tr>
<tr><td>Safari</td><td><span class="tag tag-full">Extension + Bookmarklet</span></td><td><span class="tag tag-partial">Extension (Xcode) + Bookmarklet</span></td></tr>
<tr><td>Edge</td><td><span class="tag tag-full">Extension + Bookmarklet</span></td><td><span class="tag tag-bookmarklet">Bookmarklet only</span></td></tr>
</table>

<p><small>Generated: ${new Date().toISOString()}</small></p>
</body>
</html>`

writeFileSync(resolve(outDir, 'index.html'), html)

console.log(`\nBookmarklet artifacts written to: ${outDir}/`)
console.log(`  bookmarklets.json - Machine-readable bookmarklet URLs`)
console.log(`  index.html        - Drag-and-drop installer page`)
console.log(`\nBounce loader length: ${bounceLoader.length} chars`)
console.log(`Configurable loader length: ${configurableLoader.length} chars`)
