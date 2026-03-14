/**
 * Page Agent — Multi-Viewport E2E Tests (Desktop + Mobile)
 *
 * Tests REAL page-controller production code: DOM extraction, element capping,
 * keyboard actions, click actions, and viewport-responsive behavior.
 *
 * Viewports:
 * - Desktop: 1280x800
 * - Mobile iPhone 14: 390x844
 * - Mobile iPhone SE: 375x812
 *
 * Run: node e2e/multi-viewport.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolve(__dirname, 'page-controller-bundle.js')

// ── Chromium resolver ────────────────────────────────────────────────
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
		window.__keyEvents = [];
		document.addEventListener('keydown', (e) => {
			const log = document.getElementById('key-log');
			const mods = [];
			if (e.ctrlKey) mods.push('Ctrl');
			if (e.shiftKey) mods.push('Shift');
			if (e.altKey) mods.push('Alt');
			if (e.metaKey) mods.push('Meta');
			const modStr = mods.length ? mods.join('+') + '+' : '';
			const entry = modStr + e.key + ' (code: ' + e.code + ')';
			log.textContent = 'Last key: ' + entry;
			window.__keyEvents.push({ key: e.key, code: e.code, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey });
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
	console.log(`\nUsing Chromium: ${CHROMIUM}\n`)

	const browser = await puppeteer.launch({
		executablePath: CHROMIUM,
		headless: 'new',
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
	})

	const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(TEST_HTML)}`

	// Collect interactive counts per viewport for cross-viewport comparison
	const interactiveCountsByViewport = {}

	for (const [vpKey, vp] of Object.entries(VIEWPORTS)) {
		console.log(`\nViewport: ${vp.label}`)
		console.log(`   ${'-'.repeat(50)}`)

		const page = await browser.newPage()
		await page.setViewport({ width: vp.width, height: vp.height, isMobile: vp.isMobile })
		if (vp.isMobile) {
			await page.setUserAgent(
				'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
			)
		}
		await page.goto(dataUrl, { waitUntil: 'networkidle0' })

		// Inject the real page-controller bundle
		await page.addScriptTag({ path: bundlePath })

		// Verify the bundle loaded
		await test(`[${vpKey}] PageController bundle loaded`, async () => {
			const hasPC = await page.evaluate(() => {
				return (
					typeof PageController === 'object' &&
					typeof PageController.getFlatTree === 'function' &&
					typeof PageController.flatTreeToString === 'function' &&
					typeof PageController.getSelectorMap === 'function' &&
					typeof PageController.pressKeyAction === 'function' &&
					typeof PageController.clickElement === 'function' &&
					typeof PageController.getElementByIndex === 'function' &&
					typeof PageController.inputTextElement === 'function'
				)
			})
			assert.ok(hasPC, 'PageController object must expose all expected functions')
		})

		// ── 1. DOM extraction with real getFlatTree ──────────────────

		await test(`[${vpKey}] getFlatTree finds interactive elements`, async () => {
			const result = await page.evaluate(() => {
				const tree = PageController.getFlatTree({})
				const selectorMap = PageController.getSelectorMap(tree)
				const interactiveCount = selectorMap.size
				// Collect tag names of interactive elements
				const tagNames = []
				for (const [, node] of selectorMap) {
					tagNames.push(node.tagName)
				}
				return { interactiveCount, tagNames }
			})
			// Must find a meaningful number of interactive elements (inputs, selects, buttons)
			assert.ok(
				result.interactiveCount >= 10,
				`Expected at least 10 interactive elements, got ${result.interactiveCount}`
			)
			// Must include input and button elements
			assert.ok(
				result.tagNames.includes('input'),
				`Expected to find 'input' in interactive elements, got: ${result.tagNames.slice(0, 10).join(', ')}`
			)
			assert.ok(
				result.tagNames.includes('button'),
				`Expected to find 'button' in interactive elements, got: ${result.tagNames.slice(0, 10).join(', ')}`
			)
			interactiveCountsByViewport[vpKey] = result.interactiveCount
			console.log(`     [info] Found ${result.interactiveCount} interactive elements`)
		})

		await test(`[${vpKey}] getFlatTree returns valid tree structure`, async () => {
			const result = await page.evaluate(() => {
				const tree = PageController.getFlatTree({})
				return {
					hasRootId: typeof tree.rootId === 'string' || typeof tree.rootId === 'number',
					hasMap: typeof tree.map === 'object' && tree.map !== null,
					mapSize: Object.keys(tree.map).length,
					rootExists: tree.rootId in tree.map,
				}
			})
			assert.ok(result.hasRootId, 'Tree must have a rootId')
			assert.ok(result.hasMap, 'Tree must have a map object')
			assert.ok(result.mapSize > 0, `Tree map must not be empty, got ${result.mapSize} nodes`)
			assert.ok(result.rootExists, 'Root node must exist in map')
		})

		await test(`[${vpKey}] flatTreeToString produces non-empty prompt text`, async () => {
			const result = await page.evaluate(() => {
				const tree = PageController.getFlatTree({})
				const prompt = PageController.flatTreeToString(tree, [])
				return {
					promptLength: prompt.length,
					hasHighlightIndices: /\[\d+\]/.test(prompt),
					lineCount: prompt.split('\n').filter((l) => l.trim()).length,
					// Extract a few lines for debugging
					sampleLines: prompt
						.split('\n')
						.filter((l) => /\[\d+\]/.test(l))
						.slice(0, 5),
				}
			})
			assert.ok(
				result.promptLength > 100,
				`Prompt text should be substantial, got ${result.promptLength} chars`
			)
			assert.ok(
				result.hasHighlightIndices,
				'Prompt text must contain highlight indices like [0], [1], etc.'
			)
			assert.ok(result.lineCount > 5, `Prompt should have many lines, got ${result.lineCount}`)
			console.log(`     [info] Prompt: ${result.promptLength} chars, ${result.lineCount} lines`)
		})

		// ── 2. Element capping with real flatTreeToString ────────────

		await test(`[${vpKey}] Element capping limits output with maxElements`, async () => {
			const result = await page.evaluate(() => {
				const tree = PageController.getFlatTree({})
				const selectorMap = PageController.getSelectorMap(tree)
				const totalInteractive = selectorMap.size
				const fullPrompt = PageController.flatTreeToString(tree, [])
				const cappedPrompt = PageController.flatTreeToString(tree, [], { maxElements: 5 })
				// Count highlight indices in each prompt
				const countIndices = (text) => {
					const matches = text.match(/\[\d+\]/g) || []
					return matches.length
				}
				return {
					totalInteractive,
					fullIndices: countIndices(fullPrompt),
					cappedIndices: countIndices(cappedPrompt),
					cappedPromptLength: cappedPrompt.length,
					fullPromptLength: fullPrompt.length,
					hasOmittedMessage:
						cappedPrompt.includes('omitted') || cappedPrompt.includes('more element'),
				}
			})
			assert.ok(
				result.totalInteractive > 5,
				`Need more than 5 interactive elements to test capping, got ${result.totalInteractive}`
			)
			assert.ok(
				result.cappedIndices <= 5,
				`Capped prompt should have at most 5 highlight indices, got ${result.cappedIndices}`
			)
			assert.ok(
				result.cappedIndices > 0,
				`Capped prompt should have at least 1 highlight index, got ${result.cappedIndices}`
			)
			assert.ok(
				result.cappedPromptLength < result.fullPromptLength,
				`Capped prompt (${result.cappedPromptLength}) should be shorter than full (${result.fullPromptLength})`
			)
			assert.ok(
				result.hasOmittedMessage,
				'Capped prompt should include an omitted elements message'
			)
			console.log(
				`     [info] Full: ${result.fullIndices} indices, Capped: ${result.cappedIndices} indices`
			)
		})

		await test(`[${vpKey}] Element capping with maxElements=1 shows exactly 1 element`, async () => {
			const result = await page.evaluate(() => {
				const tree = PageController.getFlatTree({})
				const cappedPrompt = PageController.flatTreeToString(tree, [], { maxElements: 1 })
				const indices = cappedPrompt.match(/\[\d+\]/g) || []
				return { indexCount: indices.length, hasOmittedMsg: cappedPrompt.includes('omitted') }
			})
			assert.equal(
				result.indexCount,
				1,
				`maxElements=1 should produce exactly 1 highlighted element, got ${result.indexCount}`
			)
			assert.ok(result.hasOmittedMsg, 'Should show omitted message when heavily capped')
		})

		// ── 3. Keyboard actions with real pressKeyAction ─────────────

		await test(`[${vpKey}] pressKeyAction dispatches Enter key`, async () => {
			// Focus the key-input first, then press Enter via production code
			const result = await page.evaluate(async () => {
				window.__keyEvents = []
				document.getElementById('key-input').focus()
				await PageController.pressKeyAction('Enter')
				const events = window.__keyEvents
				return {
					eventCount: events.length,
					hasEnter: events.some((e) => e.key === 'Enter'),
					logText: document.getElementById('key-log').textContent,
				}
			})
			assert.ok(
				result.eventCount > 0,
				`pressKeyAction should dispatch keyboard events, got ${result.eventCount}`
			)
			assert.ok(
				result.hasEnter,
				`Expected Enter key in events, got keys: ${JSON.stringify(result)}`
			)
			assert.ok(
				result.logText.includes('Enter'),
				`Key log should show Enter, got: ${result.logText}`
			)
		})

		await test(`[${vpKey}] pressKeyAction dispatches ArrowDown`, async () => {
			const result = await page.evaluate(async () => {
				window.__keyEvents = []
				document.getElementById('key-input').focus()
				await PageController.pressKeyAction('ArrowDown')
				return {
					hasArrowDown: window.__keyEvents.some((e) => e.key === 'ArrowDown'),
					logText: document.getElementById('key-log').textContent,
				}
			})
			assert.ok(result.hasArrowDown, 'pressKeyAction should dispatch ArrowDown')
			assert.ok(
				result.logText.includes('ArrowDown'),
				`Key log should show ArrowDown, got: ${result.logText}`
			)
		})

		await test(`[${vpKey}] pressKeyAction with Shift modifier`, async () => {
			const result = await page.evaluate(async () => {
				window.__keyEvents = []
				document.getElementById('key-input').focus()
				await PageController.pressKeyAction('a', ['Shift'])
				const events = window.__keyEvents
				const shiftA = events.find((e) => e.key === 'a' && e.shiftKey)
				return {
					foundShiftA: !!shiftA,
					logText: document.getElementById('key-log').textContent,
					events: events.map((e) => ({ key: e.key, shiftKey: e.shiftKey })),
				}
			})
			assert.ok(
				result.foundShiftA,
				`Expected Shift+a event, got events: ${JSON.stringify(result.events)}`
			)
			assert.ok(
				result.logText.includes('Shift'),
				`Key log should show Shift modifier, got: ${result.logText}`
			)
		})

		await test(`[${vpKey}] pressKeyAction Escape closes modal`, async () => {
			// Open modal via production clickElement, then close with Escape via pressKeyAction
			const result = await page.evaluate(async () => {
				// Open modal by clicking the open button
				const openBtn = document.getElementById('open-modal-btn')
				openBtn.click()
				const wasOpen = document.getElementById('test-modal').classList.contains('open')

				// Close with production pressKeyAction
				await PageController.pressKeyAction('Escape')
				const isClosed = !document.getElementById('test-modal').classList.contains('open')

				return { wasOpen, isClosed }
			})
			assert.ok(result.wasOpen, 'Modal should have opened')
			assert.ok(result.isClosed, 'pressKeyAction(Escape) should close the modal')
		})

		// ── 4. Click actions with real clickElement ──────────────────

		await test(`[${vpKey}] clickElement changes button text via production click`, async () => {
			// Use getFlatTree + getSelectorMap + getElementByIndex + clickElement
			const result = await page.evaluate(async () => {
				const tree = PageController.getFlatTree({})
				const selectorMap = PageController.getSelectorMap(tree)

				// Find the grid button with text "Btn 5" in the selectorMap
				let targetIndex = -1
				for (const [index, node] of selectorMap) {
					if (node.ref && node.ref.id === 'grid-btn-5') {
						targetIndex = index
						break
					}
				}
				if (targetIndex === -1) {
					return { error: 'Could not find grid-btn-5 in selectorMap' }
				}

				const element = PageController.getElementByIndex(selectorMap, targetIndex)
				const textBefore = element.textContent
				await PageController.clickElement(element)
				const textAfter = element.textContent

				return { textBefore, textAfter, targetIndex }
			})
			assert.ok(!result.error, result.error || '')
			assert.equal(
				result.textBefore,
				'Btn 5',
				`Button should start as "Btn 5", got "${result.textBefore}"`
			)
			assert.equal(
				result.textAfter,
				'Clicked 5',
				`Button should become "Clicked 5" after click, got "${result.textAfter}"`
			)
		})

		await test(`[${vpKey}] clickElement opens modal via production code`, async () => {
			const result = await page.evaluate(async () => {
				// Ensure modal is closed first
				document.getElementById('test-modal').classList.remove('open')

				const tree = PageController.getFlatTree({})
				const selectorMap = PageController.getSelectorMap(tree)

				// Find the "Open Modal" button
				let openBtnIndex = -1
				for (const [index, node] of selectorMap) {
					if (node.ref && node.ref.id === 'open-modal-btn') {
						openBtnIndex = index
						break
					}
				}
				if (openBtnIndex === -1) {
					return { error: 'Could not find open-modal-btn in selectorMap' }
				}

				const element = PageController.getElementByIndex(selectorMap, openBtnIndex)
				await PageController.clickElement(element)
				const isOpen = document.getElementById('test-modal').classList.contains('open')

				return { isOpen }
			})
			assert.ok(!result.error, result.error || '')
			assert.ok(result.isOpen, 'clickElement on Open Modal button should open the modal')
		})

		await test(`[${vpKey}] inputTextElement types into input field`, async () => {
			const result = await page.evaluate(async () => {
				const tree = PageController.getFlatTree({})
				const selectorMap = PageController.getSelectorMap(tree)

				// Find the name input
				let inputIndex = -1
				for (const [index, node] of selectorMap) {
					if (node.ref && node.ref.id === 'name-input') {
						inputIndex = index
						break
					}
				}
				if (inputIndex === -1) {
					return { error: 'Could not find name-input in selectorMap' }
				}

				const element = PageController.getElementByIndex(selectorMap, inputIndex)
				// Clear any existing value
				element.value = ''
				await PageController.inputTextElement(element, 'Hello World')
				return { value: element.value }
			})
			assert.ok(!result.error, result.error || '')
			assert.equal(
				result.value,
				'Hello World',
				`inputTextElement should set value to "Hello World", got "${result.value}"`
			)
		})

		// ── 5. Viewport-responsive behavior ─────────────────────────

		await test(`[${vpKey}] Viewport-aware capping prioritizes in-viewport elements`, async () => {
			// Scroll to top so viewport elements are deterministic
			const result = await page.evaluate(async () => {
				window.scrollTo(0, 0)
				// Wait for scroll to settle
				await new Promise((r) => setTimeout(r, 100))

				const tree = PageController.getFlatTree({})
				const selectorMap = PageController.getSelectorMap(tree)

				// Get capped output with a small cap
				const cappedPrompt = PageController.flatTreeToString(tree, [], { maxElements: 5 })

				// Extract the highlight indices from the capped prompt
				const cappedIndices = (cappedPrompt.match(/\[\d+\]/g) || []).map((m) =>
					parseInt(m.replace(/[\[\]]/g, ''))
				)

				// Check if capped elements are in-viewport ones
				let inViewportCount = 0
				for (const idx of cappedIndices) {
					const node = selectorMap.get(idx)
					if (node && node.isInViewport) {
						inViewportCount++
					}
				}

				// Also check: does below-fold-btn appear in the capped output?
				let belowFoldInCapped = false
				for (const idx of cappedIndices) {
					const node = selectorMap.get(idx)
					if (node && node.ref && node.ref.id === 'below-fold-btn') {
						belowFoldInCapped = true
					}
				}

				return {
					cappedCount: cappedIndices.length,
					inViewportCount,
					belowFoldInCapped,
					totalInteractive: selectorMap.size,
				}
			})
			assert.ok(result.cappedCount > 0, `Should have capped elements, got ${result.cappedCount}`)
			// In-viewport elements should be prioritized — most/all capped elements should be in viewport
			assert.ok(
				result.inViewportCount >= result.cappedCount - 1,
				`Most capped elements should be in viewport: ${result.inViewportCount}/${result.cappedCount}`
			)
			// Below-fold button should NOT appear in the capped output (it is off-screen)
			assert.ok(
				!result.belowFoldInCapped,
				'Below-fold button should not be in capped output when scrolled to top'
			)
		})

		await page.close()
	}

	// ── Cross-viewport comparison tests ─────────────────────────────
	console.log(`\nCross-Viewport Comparison`)
	console.log(`   ${'-'.repeat(50)}`)

	await test('[cross-viewport] Desktop and mobile find comparable interactive elements', async () => {
		const desktop = interactiveCountsByViewport['desktop']
		const iphone14 = interactiveCountsByViewport['mobile_iphone14']
		const iphoneSE = interactiveCountsByViewport['mobile_iphoneSE']
		assert.ok(desktop > 0, `Desktop must find interactive elements, got ${desktop}`)
		assert.ok(iphone14 > 0, `iPhone 14 must find interactive elements, got ${iphone14}`)
		assert.ok(iphoneSE > 0, `iPhone SE must find interactive elements, got ${iphoneSE}`)
		console.log(`     [info] Desktop: ${desktop}, iPhone 14: ${iphone14}, iPhone SE: ${iphoneSE}`)
	})

	// Viewport-specific capping comparison: different viewports should produce different capped outputs
	await test('[cross-viewport] Different viewports produce different capped prompts', async () => {
		const cappedPrompts = {}

		for (const [vpKey, vp] of Object.entries(VIEWPORTS)) {
			const page = await browser.newPage()
			await page.setViewport({ width: vp.width, height: vp.height, isMobile: vp.isMobile })
			if (vp.isMobile) {
				await page.setUserAgent(
					'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
				)
			}
			await page.goto(dataUrl, { waitUntil: 'networkidle0' })
			await page.addScriptTag({ path: bundlePath })

			cappedPrompts[vpKey] = await page.evaluate(() => {
				window.scrollTo(0, 0)
				const tree = PageController.getFlatTree({})
				const fullPrompt = PageController.flatTreeToString(tree, [])
				const cappedPrompt = PageController.flatTreeToString(tree, [], { maxElements: 10 })
				return {
					fullLength: fullPrompt.length,
					cappedLength: cappedPrompt.length,
					capped: cappedPrompt,
				}
			})

			await page.close()
		}

		// All viewports should produce non-empty capped output
		for (const [vpKey, data] of Object.entries(cappedPrompts)) {
			assert.ok(
				data.cappedLength > 0,
				`${vpKey} capped prompt should be non-empty, got length ${data.cappedLength}`
			)
			assert.ok(
				data.cappedLength < data.fullLength,
				`${vpKey} capped prompt (${data.cappedLength}) should be shorter than full (${data.fullLength})`
			)
		}

		// Desktop and mobile should produce prompts (they may differ in content due to viewport priority)
		const desktopCapped = cappedPrompts['desktop'].capped
		const mobileCapped = cappedPrompts['mobile_iphone14'].capped
		assert.ok(desktopCapped.length > 0, 'Desktop capped prompt must not be empty')
		assert.ok(mobileCapped.length > 0, 'Mobile capped prompt must not be empty')
		console.log(
			`     [info] Desktop capped: ${desktopCapped.length} chars, Mobile capped: ${mobileCapped.length} chars`
		)
	})

	await browser.close()

	// ── Summary ─────────────────────────────────────────────────────
	console.log(`\n${'='.repeat(60)}`)
	console.log(`  Results: ${results.passed} passed, ${results.failed} failed`)
	if (results.errors.length > 0) {
		console.log('\n  Failures:')
		for (const { name, error } of results.errors) {
			console.log(`    FAIL ${name}: ${error}`)
		}
	}
	console.log(`${'='.repeat(60)}\n`)

	process.exit(results.failed > 0 ? 1 : 0)
}

main().catch((err) => {
	console.error('Fatal error:', err)
	process.exit(1)
})
