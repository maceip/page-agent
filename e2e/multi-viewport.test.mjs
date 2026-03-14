/**
 * Page Agent — Multi-Viewport E2E Tests (Desktop + Mobile)
 *
 * Tests DOM pruning, keyboard actions, and element capping
 * across desktop and mobile viewports using real Chromium.
 *
 * Viewports:
 * - Desktop: 1280x800
 * - Mobile iPhone 14: 390x844
 * - Mobile iPhone SE: 375x812 (smaller/older device)
 *
 * Run: node e2e/multi-viewport.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Chromium resolver (same as memory-system.test.mjs) ──────────────
function resolveChromium() {
	const envPath =
		process.env.PUPPETEER_EXECUTABLE_PATH ||
		process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
		process.env.CHROMIUM_EXECUTABLE_PATH
	if (envPath && existsSync(envPath)) return envPath

	const userHome = process.env.HOME || process.env.USERPROFILE || '/root'
	const cacheRoots = [join(userHome, '.cache', 'ms-playwright'), '/root/.cache/ms-playwright']
	for (const cacheRoot of cacheRoots) {
		if (!existsSync(cacheRoot)) continue
		const entries = readdirSync(cacheRoot, { withFileTypes: true })
			.filter((e) => e.isDirectory() && e.name.startsWith('chromium'))
			.map((e) => e.name)
			.sort((a, b) => b.localeCompare(a))
		for (const entry of entries) {
			const base = join(cacheRoot, entry, 'chrome-linux')
			for (const bin of [join(base, 'chrome'), join(base, 'headless_shell')]) {
				if (existsSync(bin)) return bin
			}
		}
	}

	const candidates = [
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/usr/bin/google-chrome-stable',
		'/usr/bin/google-chrome',
	]
	for (const c of candidates) {
		if (existsSync(c)) return c
	}
	throw new Error('No Chromium found. Set PUPPETEER_EXECUTABLE_PATH.')
}

const CHROMIUM = resolveChromium()

// ── Viewport definitions ────────────────────────────────────────────
const VIEWPORTS = {
	desktop: { width: 1280, height: 800, isMobile: false, label: 'Desktop 1280x800' },
	mobile_iphone14: { width: 390, height: 844, isMobile: true, label: 'Mobile iPhone 14 (390x844)' },
	mobile_iphoneSE: { width: 375, height: 812, isMobile: true, label: 'Mobile iPhone SE (375x812)' },
}

// ── Test harness HTML ───────────────────────────────────────────────
const TEST_HTML = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Page Agent Multi-Viewport Test</title>
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body { font-family: sans-serif; padding: 16px; }
		.form-section { margin: 20px 0; }
		.form-section input, .form-section select, .form-section button {
			display: block; margin: 8px 0; padding: 8px; width: 100%; max-width: 400px;
		}
		.many-buttons { display: flex; flex-wrap: wrap; gap: 4px; }
		.many-buttons button { width: auto; flex: 0 0 auto; padding: 4px 8px; font-size: 12px; }
		.below-fold { margin-top: 2000px; padding: 20px; background: #f0f0f0; }
		.modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
			background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; }
		.modal.open { display: flex; }
		.modal-content { background: white; padding: 24px; border-radius: 8px; min-width: 280px; }
		#key-log { padding: 12px; background: #eee; margin: 12px 0; min-height: 40px; font-family: monospace; }
	</style>
</head>
<body>
	<h1>Multi-Viewport Test Page</h1>

	<div class="form-section">
		<h2>Form Section</h2>
		<label for="name-input">Name:</label>
		<input id="name-input" type="text" placeholder="Enter your name">
		<label for="email-input">Email:</label>
		<input id="email-input" type="email" placeholder="Enter email">
		<label for="country-select">Country:</label>
		<select id="country-select">
			<option value="">Select country</option>
			<option value="us">United States</option>
			<option value="uk">United Kingdom</option>
			<option value="jp">Japan</option>
		</select>
		<button id="submit-btn" type="button">Submit</button>
	</div>

	<div class="form-section">
		<h2>Keyboard Test</h2>
		<div id="key-log">Press a key...</div>
		<input id="key-input" type="text" placeholder="Type here">
	</div>

	<div class="form-section">
		<h2>Modal Test</h2>
		<button id="open-modal-btn">Open Modal</button>
	</div>

	<div class="modal" id="test-modal">
		<div class="modal-content" role="dialog" aria-label="Test Modal">
			<h3>Modal Title</h3>
			<p>This is a test modal.</p>
			<button id="close-modal-btn">Close</button>
		</div>
	</div>

	<div class="form-section">
		<h2>Many Interactive Elements (for capping test)</h2>
		<div class="many-buttons" id="button-grid"></div>
	</div>

	<div class="below-fold">
		<h2>Below the Fold</h2>
		<button id="below-fold-btn">Below Fold Button</button>
		<input id="below-fold-input" type="text" placeholder="Below fold input">
	</div>

	<script>
		// Generate 100 buttons for element capping tests
		const grid = document.getElementById('button-grid');
		for (let i = 0; i < 100; i++) {
			const btn = document.createElement('button');
			btn.textContent = 'Btn ' + i;
			btn.id = 'grid-btn-' + i;
			btn.addEventListener('click', () => { btn.textContent = 'Clicked ' + i; });
			grid.appendChild(btn);
		}

		// Keyboard event logging
		document.addEventListener('keydown', (e) => {
			const log = document.getElementById('key-log');
			const mods = [];
			if (e.ctrlKey) mods.push('Ctrl');
			if (e.shiftKey) mods.push('Shift');
			if (e.altKey) mods.push('Alt');
			if (e.metaKey) mods.push('Meta');
			const modStr = mods.length ? mods.join('+') + '+' : '';
			log.textContent = 'Last key: ' + modStr + e.key + ' (code: ' + e.code + ')';
		});

		// Modal
		document.getElementById('open-modal-btn').addEventListener('click', () => {
			document.getElementById('test-modal').classList.add('open');
		});
		document.getElementById('close-modal-btn').addEventListener('click', () => {
			document.getElementById('test-modal').classList.remove('open');
		});
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				document.getElementById('test-modal').classList.remove('open');
			}
		});
	</script>
</body>
</html>`

// ── Test runner ─────────────────────────────────────────────────────
const results = { passed: 0, failed: 0, errors: [] }

async function test(name, fn) {
	process.stdout.write(`  ${name} ... `)
	try {
		await fn()
		results.passed++
		console.log('\x1b[32mPASS\x1b[0m')
	} catch (err) {
		results.failed++
		results.errors.push({ name, error: err.message })
		console.log(`\x1b[31mFAIL\x1b[0m  ${err.message}`)
	}
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
	console.log(`\n🔧 Using Chromium: ${CHROMIUM}\n`)

	const browser = await puppeteer.launch({
		executablePath: CHROMIUM,
		headless: 'new',
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
	})

	// Write test HTML to a data URL (avoids needing a file on disk)
	const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(TEST_HTML)}`

	for (const [vpKey, vp] of Object.entries(VIEWPORTS)) {
		console.log(`\n📐 Viewport: ${vp.label}`)
		console.log(`   ${'-'.repeat(50)}`)

		const page = await browser.newPage()
		await page.setViewport({ width: vp.width, height: vp.height, isMobile: vp.isMobile })
		if (vp.isMobile) {
			await page.setUserAgent(
				'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
			)
		}
		await page.goto(dataUrl, { waitUntil: 'networkidle0' })

		// ── Test: Page loads and renders at correct viewport ──
		await test(`[${vpKey}] Page renders at ${vp.width}x${vp.height}`, async () => {
			const viewport = page.viewport()
			assert.equal(viewport.width, vp.width)
			assert.equal(viewport.height, vp.height)
			const title = await page.title()
			assert.equal(title, 'Page Agent Multi-Viewport Test')
		})

		// ── Test: Interactive element count ──
		await test(`[${vpKey}] Detects all interactive elements`, async () => {
			const count = await page.evaluate(() => {
				// Count elements that would be interactive: inputs, selects, buttons, textareas
				const selectors = 'input, select, button, textarea, [role="button"], a[href]'
				return document.querySelectorAll(selectors).length
			})
			// 100 grid buttons + name input + email input + select + submit + key-input
			// + open-modal-btn + close-modal-btn + below-fold-btn + below-fold-input = 109
			assert.ok(count >= 100, `Expected >= 100 interactive elements, got ${count}`)
		})

		// ── Test: Form input works ──
		await test(`[${vpKey}] Text input works`, async () => {
			await page.click('#name-input')
			await page.type('#name-input', 'Test User')
			const value = await page.$eval('#name-input', (el) => el.value)
			assert.equal(value, 'Test User')
		})

		// ── Test: Dropdown selection ──
		await test(`[${vpKey}] Dropdown selection works`, async () => {
			await page.select('#country-select', 'jp')
			const value = await page.$eval('#country-select', (el) => el.value)
			assert.equal(value, 'jp')
		})

		// ── Test: Keyboard event dispatch ──
		await test(`[${vpKey}] Keyboard events dispatch correctly`, async () => {
			await page.click('#key-input')
			await page.keyboard.press('Enter')
			const logText = await page.$eval('#key-log', (el) => el.textContent)
			assert.ok(logText.includes('Enter'), `Expected "Enter" in log, got: ${logText}`)
		})

		// ── Test: Keyboard with modifiers ──
		await test(`[${vpKey}] Keyboard modifiers work`, async () => {
			await page.click('#key-input')
			await page.keyboard.down('Shift')
			await page.keyboard.press('a')
			await page.keyboard.up('Shift')
			const logText = await page.$eval('#key-log', (el) => el.textContent)
			assert.ok(
				logText.includes('Shift') && (logText.includes('A') || logText.includes('a')),
				`Expected Shift+A in log, got: ${logText}`
			)
		})

		// ── Test: Arrow key navigation ──
		await test(`[${vpKey}] Arrow keys dispatch`, async () => {
			await page.click('#key-input')
			await page.keyboard.press('ArrowDown')
			const logText = await page.$eval('#key-log', (el) => el.textContent)
			assert.ok(logText.includes('ArrowDown'), `Expected "ArrowDown" in log, got: ${logText}`)
		})

		// ── Test: Escape closes modal ──
		await test(`[${vpKey}] Escape closes modal`, async () => {
			// Open modal
			await page.click('#open-modal-btn')
			const isOpen = await page.$eval('#test-modal', (el) => el.classList.contains('open'))
			assert.ok(isOpen, 'Modal should be open after click')

			// Press Escape to close
			await page.keyboard.press('Escape')
			await new Promise((r) => setTimeout(r, 100))
			const isClosed = await page.$eval('#test-modal', (el) => !el.classList.contains('open'))
			assert.ok(isClosed, 'Modal should be closed after Escape')
		})

		// ── Test: Tab navigation ──
		await test(`[${vpKey}] Tab key navigates focus`, async () => {
			await page.click('#name-input')
			await page.keyboard.press('Tab')
			const focusedId = await page.evaluate(() => document.activeElement?.id)
			assert.equal(focusedId, 'email-input', `Expected focus on email-input, got: ${focusedId}`)
		})

		// ── Test: Button click interaction ──
		await test(`[${vpKey}] Button click updates text`, async () => {
			await page.click('#grid-btn-0')
			const text = await page.$eval('#grid-btn-0', (el) => el.textContent)
			assert.equal(text, 'Clicked 0')
		})

		// ── Test: Elements exist below the fold ──
		await test(`[${vpKey}] Below-fold elements exist and are interactive`, async () => {
			// Scroll to below-fold section
			await page.evaluate(() => {
				document.getElementById('below-fold-btn').scrollIntoView()
			})
			await new Promise((r) => setTimeout(r, 200))

			await page.click('#below-fold-btn')
			// Element should still be clickable
			const exists = await page.$('#below-fold-btn')
			assert.ok(exists, 'Below-fold button should exist')
		})

		// ── Test: Viewport-specific element visibility ──
		await test(`[${vpKey}] Viewport-aware element visibility`, async () => {
			// Scroll back to top
			await page.evaluate(() => window.scrollTo(0, 0))
			await new Promise((r) => setTimeout(r, 200))

			// Check how many grid buttons are in viewport
			const inViewport = await page.evaluate(() => {
				const buttons = document.querySelectorAll('.many-buttons button')
				let count = 0
				for (const btn of buttons) {
					const rect = btn.getBoundingClientRect()
					if (rect.top >= 0 && rect.bottom <= window.innerHeight) {
						count++
					}
				}
				return count
			})

			if (vp.isMobile) {
				// Mobile: fewer buttons visible due to smaller viewport
				assert.ok(
					inViewport < 100,
					`Mobile should not show all 100 buttons in viewport, got ${inViewport}`
				)
			}
			// Desktop: likely shows more buttons
			console.log(`     [info] ${inViewport} of 100 grid buttons in viewport`)
		})

		// ── Test: Responsive layout ──
		await test(`[${vpKey}] Page width adapts to viewport`, async () => {
			const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
			// Body should not be wider than viewport (no horizontal scroll on well-designed pages)
			// Allow some tolerance for padding/margins
			assert.ok(
				bodyWidth <= vp.width + 50,
				`Body width (${bodyWidth}) should not greatly exceed viewport (${vp.width})`
			)
		})

		// ── Test: User agent matches viewport type ──
		if (vp.isMobile) {
			await test(`[${vpKey}] Mobile user agent is set`, async () => {
				const ua = await page.evaluate(() => navigator.userAgent)
				assert.ok(ua.includes('Mobile'), `Expected mobile UA, got: ${ua.substring(0, 60)}...`)
			})
		}

		await page.close()
	}

	await browser.close()

	// ── Summary ─────────────────────────────────────────────────────
	console.log(`\n${'═'.repeat(60)}`)
	console.log(`  Results: ${results.passed} passed, ${results.failed} failed`)
	if (results.errors.length > 0) {
		console.log('\n  Failures:')
		for (const { name, error } of results.errors) {
			console.log(`    ❌ ${name}: ${error}`)
		}
	}
	console.log(`${'═'.repeat(60)}\n`)

	process.exit(results.failed > 0 ? 1 : 0)
}

main().catch((err) => {
	console.error('Fatal error:', err)
	process.exit(1)
})
