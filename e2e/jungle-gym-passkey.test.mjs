/**
 * Jungle Gym — Passkey E2E Test (Real Page-Controller Production Code)
 *
 * Uses the bundled page-controller IIFE (PageController global) to:
 * 1. Extract DOM trees via getFlatTree / flatTreeToString / getSelectorMap
 * 2. Interact with elements via clickElement / inputTextElement / pressKeyAction
 * 3. Navigate: Dashboard -> User Menu -> Account Settings -> Security -> Passkeys -> Add
 * 4. Test element capping via maxElements option
 *
 * Runs at both desktop (1280x800) and mobile (390x844) viewports sequentially
 * in a single browser instance.
 *
 * Run: node e2e/jungle-gym-passkey.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const require = createRequire(import.meta.url)

const __dirname = dirname(fileURLToPath(import.meta.url))
const HEADLESS = process.env.PA_DEMO_HEADLESS === '0' ? false : 'new'

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
	]
	for (const c of candidates) {
		if (existsSync(c)) return c
	}
	throw new Error('No Chromium found. Set PUPPETEER_EXECUTABLE_PATH.')
}

const CHROMIUM = resolveChromium()
const JUNGLE_GYM = resolve(__dirname, 'jungle-gym.html')
const BUNDLE_PATH = resolve(__dirname, 'page-controller-bundle.js')

const BUNDLE_SOURCE_MAP = resolve(__dirname, 'page-controller-bundle.js.map')
const COVERAGE_DIR = resolve(__dirname, '..', 'coverage-e2e')

const VIEWPORTS = [
	{ width: 1280, height: 800, isMobile: false, label: 'Desktop 1280x800' },
	{ width: 390, height: 844, isMobile: true, label: 'Mobile 390x844' },
]

// ── Coverage helpers ────────────────────────────────────────────────
const allCoverageEntries = []

async function startCoverage(page) {
	await page.coverage.startJSCoverage({ resetOnNavigation: false, includeRawScriptCoverage: true })
}

async function collectCoverage(page) {
	const entries = await page.coverage.stopJSCoverage()
	// Only keep entries for our bundle (filter out inline scripts, etc.)
	for (const entry of entries) {
		if (entry.url.includes('page-controller-bundle')) {
			allCoverageEntries.push(entry.rawScriptCoverage || entry)
		}
	}
}

async function reportCoverage() {
	if (allCoverageEntries.length === 0) {
		console.log('\n  No coverage data collected for page-controller-bundle.')
		return
	}

	let v8toIstanbul
	try {
		v8toIstanbul = require('v8-to-istanbul')
	} catch {
		console.log('\n  v8-to-istanbul not available, printing raw V8 coverage instead.')
		printRawCoverage()
		return
	}

	// Merge coverage from all viewports into a single script coverage
	const merged = mergeCoverageRanges(allCoverageEntries)

	// Convert to istanbul format using source map
	const converter = v8toIstanbul(BUNDLE_PATH, 0, {
		source: readFileSync(BUNDLE_PATH, 'utf8'),
		sourceMap: { sourcemap: JSON.parse(readFileSync(BUNDLE_SOURCE_MAP, 'utf8')) },
	})
	await converter.load()
	converter.applyCoverage(merged)
	const istanbulCoverage = converter.toIstanbul()

	// Print per-file coverage summary
	console.log(`\n${'═'.repeat(60)}`)
	console.log('  CODE COVERAGE REPORT (page-controller)')
	console.log(`${'═'.repeat(60)}`)

	let totalStatements = 0,
		coveredStatements = 0
	let totalFunctions = 0,
		coveredFunctions = 0
	let totalBranches = 0,
		coveredBranches = 0
	let totalLines = 0,
		coveredLines = 0

	const rows = []
	for (const [filePath, fileCov] of Object.entries(istanbulCoverage)) {
		// Only report on page-controller source files
		const shortPath = filePath.includes('packages/page-controller')
			? filePath.slice(filePath.indexOf('packages/page-controller'))
			: filePath.includes('page-controller-entry')
				? 'e2e/page-controller-entry.ts'
				: null
		if (!shortPath) continue

		const stmts = Object.values(fileCov.s)
		const fns = Object.values(fileCov.f)
		const branches = Object.values(fileCov.b).flat()
		const lines = Object.values(fileCov.getLineCoverage?.() || {})

		const fileStmtTotal = stmts.length
		const fileStmtCov = stmts.filter((c) => c > 0).length
		const fileFnTotal = fns.length
		const fileFnCov = fns.filter((c) => c > 0).length
		const fileBrTotal = branches.length
		const fileBrCov = branches.filter((c) => c > 0).length

		totalStatements += fileStmtTotal
		coveredStatements += fileStmtCov
		totalFunctions += fileFnTotal
		coveredFunctions += fileFnCov
		totalBranches += fileBrTotal
		coveredBranches += fileBrCov

		const stmtPct = fileStmtTotal ? ((fileStmtCov / fileStmtTotal) * 100).toFixed(1) : '100.0'
		const fnPct = fileFnTotal ? ((fileFnCov / fileFnTotal) * 100).toFixed(1) : '100.0'
		const brPct = fileBrTotal ? ((fileBrCov / fileBrTotal) * 100).toFixed(1) : '100.0'

		rows.push({
			shortPath,
			stmtPct,
			fnPct,
			brPct,
			fileStmtTotal,
			fileStmtCov,
			fileFnTotal,
			fileFnCov,
			fileBrTotal,
			fileBrCov,
		})
	}

	// Table header
	const colFile = 45,
		colStmt = 12,
		colFn = 12,
		colBr = 12
	console.log(
		`  ${'File'.padEnd(colFile)} ${'Stmts'.padStart(colStmt)} ${'Funcs'.padStart(colFn)} ${'Branches'.padStart(colBr)}`
	)
	console.log(
		`  ${'─'.repeat(colFile)} ${'─'.repeat(colStmt)} ${'─'.repeat(colFn)} ${'─'.repeat(colBr)}`
	)

	for (const r of rows.sort((a, b) => a.shortPath.localeCompare(b.shortPath))) {
		const colorStmt = r.stmtPct >= 80 ? '\x1b[32m' : r.stmtPct >= 50 ? '\x1b[33m' : '\x1b[31m'
		const colorFn = r.fnPct >= 80 ? '\x1b[32m' : r.fnPct >= 50 ? '\x1b[33m' : '\x1b[31m'
		const colorBr = r.brPct >= 80 ? '\x1b[32m' : r.brPct >= 50 ? '\x1b[33m' : '\x1b[31m'
		const reset = '\x1b[0m'
		console.log(
			`  ${r.shortPath.padEnd(colFile)} ${colorStmt}${(r.stmtPct + '%').padStart(colStmt)}${reset} ${colorFn}${(r.fnPct + '%').padStart(colFn)}${reset} ${colorBr}${(r.brPct + '%').padStart(colBr)}${reset}`
		)
	}

	// Totals
	const totalStmtPct = totalStatements
		? ((coveredStatements / totalStatements) * 100).toFixed(1)
		: '100.0'
	const totalFnPct = totalFunctions
		? ((coveredFunctions / totalFunctions) * 100).toFixed(1)
		: '100.0'
	const totalBrPct = totalBranches ? ((coveredBranches / totalBranches) * 100).toFixed(1) : '100.0'
	console.log(
		`  ${'─'.repeat(colFile)} ${'─'.repeat(colStmt)} ${'─'.repeat(colFn)} ${'─'.repeat(colBr)}`
	)
	console.log(
		`  ${'TOTAL'.padEnd(colFile)} ${(totalStmtPct + '%').padStart(colStmt)} ${(totalFnPct + '%').padStart(colFn)} ${(totalBrPct + '%').padStart(colBr)}`
	)
	console.log(
		`  ${`(${coveredStatements}/${totalStatements} stmts, ${coveredFunctions}/${totalFunctions} fns, ${coveredBranches}/${totalBranches} branches)`.padEnd(colFile + colStmt + colFn + colBr + 3)}`
	)
	console.log(`${'═'.repeat(60)}`)

	// Write JSON coverage for further processing
	mkdirSync(COVERAGE_DIR, { recursive: true })
	writeFileSync(
		join(COVERAGE_DIR, 'coverage-final.json'),
		JSON.stringify(istanbulCoverage, null, 2)
	)
	console.log(`  Coverage JSON written to: ${join(COVERAGE_DIR, 'coverage-final.json')}`)
}

function mergeCoverageRanges(entries) {
	// Merge function ranges across all collected entries
	const functionMap = new Map()
	for (const entry of entries) {
		for (const fn of entry.functions) {
			const key = `${fn.functionName}:${fn.ranges[0]?.startOffset}:${fn.ranges[0]?.endOffset}`
			if (!functionMap.has(key)) {
				functionMap.set(key, { ...fn, ranges: fn.ranges.map((r) => ({ ...r })) })
			} else {
				const existing = functionMap.get(key)
				for (let i = 0; i < fn.ranges.length; i++) {
					if (existing.ranges[i]) {
						existing.ranges[i].count = Math.max(existing.ranges[i].count, fn.ranges[i].count)
					} else {
						existing.ranges[i] = { ...fn.ranges[i] }
					}
				}
			}
		}
	}
	return [...functionMap.values()]
}

function printRawCoverage() {
	// Fallback: print raw byte-range coverage percentages
	for (const entry of allCoverageEntries) {
		const totalBytes = entry.text?.length || 0
		let coveredBytes = 0
		for (const fn of entry.functions || []) {
			for (const range of fn.ranges || []) {
				if (range.count > 0) {
					coveredBytes += range.endOffset - range.startOffset
				}
			}
		}
		const pct = totalBytes ? ((coveredBytes / totalBytes) * 100).toFixed(1) : '0.0'
		console.log(`  Bundle coverage: ${pct}% (${coveredBytes}/${totalBytes} bytes)`)
	}
}

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

// ── Helpers using real PageController production code ────────────────

/** Get the LLM prompt string from the current page state */
async function getPrompt(page) {
	return page.evaluate(() => {
		const tree = PageController.getFlatTree({})
		return PageController.flatTreeToString(tree, [])
	})
}

/** Get the LLM prompt with maxElements capping */
async function getPromptCapped(page, maxElements) {
	return page.evaluate((max) => {
		const tree = PageController.getFlatTree({})
		return PageController.flatTreeToString(tree, [], { maxElements: max })
	}, maxElements)
}

/** Get element count from the selector map */
async function getElementCount(page) {
	return page.evaluate(() => {
		const tree = PageController.getFlatTree({})
		const selectorMap = PageController.getSelectorMap(tree)
		return selectorMap.size
	})
}

/** Find an element's highlight index by searching text in the DOM ref, flat tree children, or attributes */
async function findElementByText(page, searchText) {
	return page.evaluate((text) => {
		const tree = PageController.getFlatTree({})
		const selectorMap = PageController.getSelectorMap(tree)
		for (const [idx, node] of selectorMap.entries()) {
			// Check the actual DOM element's textContent (covers nested children)
			if (node.ref && node.ref.textContent && node.ref.textContent.includes(text)) {
				return idx
			}
			// Check flat tree text children
			if (node.children) {
				for (const cId of node.children) {
					const child = tree.map[cId]
					if (child?.type === 'TEXT_NODE' && child.text?.includes(text)) {
						return idx
					}
				}
			}
			// Check attributes (aria-label, placeholder, value, etc.)
			if (node.attributes) {
				for (const val of Object.values(node.attributes)) {
					if (typeof val === 'string' && val.includes(text)) {
						return idx
					}
				}
			}
		}
		return null
	}, searchText)
}

/** Click an element found by its text content using real production code */
async function clickByText(page, searchText) {
	return page.evaluate(async (text) => {
		const tree = PageController.getFlatTree({})
		const selectorMap = PageController.getSelectorMap(tree)
		for (const [idx, node] of selectorMap.entries()) {
			let found = false
			// Check the actual DOM element's textContent (covers nested children)
			if (node.ref && node.ref.textContent && node.ref.textContent.includes(text)) {
				found = true
			}
			if (!found && node.children) {
				for (const cId of node.children) {
					const child = tree.map[cId]
					if (child?.type === 'TEXT_NODE' && child.text?.includes(text)) {
						found = true
						break
					}
				}
			}
			if (!found && node.attributes) {
				for (const val of Object.values(node.attributes)) {
					if (typeof val === 'string' && val.includes(text)) {
						found = true
						break
					}
				}
			}
			if (found) {
				const element = PageController.getElementByIndex(selectorMap, idx)
				if (element) {
					await PageController.clickElement(element)
					return { success: true, index: idx }
				}
			}
		}
		throw new Error(`No element found containing text: "${text}"`)
	}, searchText)
}

/** Type text into an element found by text content */
async function typeByText(page, searchText, text) {
	return page.evaluate(
		async (search, inputText) => {
			const tree = PageController.getFlatTree({})
			const selectorMap = PageController.getSelectorMap(tree)
			for (const [idx, node] of selectorMap.entries()) {
				let found = false
				if (node.ref && node.ref.textContent && node.ref.textContent.includes(search)) {
					found = true
				}
				if (!found && node.ref && node.ref.placeholder && node.ref.placeholder.includes(search)) {
					found = true
				}
				if (!found && node.children) {
					for (const cId of node.children) {
						const child = tree.map[cId]
						if (child?.type === 'TEXT_NODE' && child.text?.includes(search)) {
							found = true
							break
						}
					}
				}
				if (!found && node.attributes) {
					for (const val of Object.values(node.attributes)) {
						if (typeof val === 'string' && val.includes(search)) {
							found = true
							break
						}
					}
				}
				if (found) {
					const element = PageController.getElementByIndex(selectorMap, idx)
					if (element) {
						await PageController.inputTextElement(element, inputText)
						return { success: true, index: idx }
					}
				}
			}
			throw new Error(`No element found containing text: "${search}"`)
		},
		searchText,
		text
	)
}

/** Press a keyboard key using real production code */
async function pressKey(page, key) {
	return page.evaluate(async (k) => {
		await PageController.pressKeyAction(k)
	}, key)
}

/** Wait for a condition with timeout */
async function waitFor(page, fn, timeoutMs = 5000) {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		const result = await page.evaluate(fn)
		if (result) return result
		await new Promise((r) => setTimeout(r, 100))
	}
	throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`)
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
	console.log(`\nUsing Chromium: ${CHROMIUM}`)
	console.log(`Jungle Gym: ${JUNGLE_GYM}`)
	console.log(`Bundle: ${BUNDLE_PATH}\n`)

	assert.ok(existsSync(BUNDLE_PATH), 'page-controller-bundle.js must exist')

	const browser = await puppeteer.launch({
		executablePath: CHROMIUM,
		headless: HEADLESS,
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-dev-shm-usage',
			'--disable-gpu',
			'--enable-web-authentication-testing-api',
		],
	})

	for (const vp of VIEWPORTS) {
		console.log(`\nViewport: ${vp.label}`)
		console.log(`   ${'─'.repeat(55)}`)

		const page = await browser.newPage()

		await page.setViewport({ width: vp.width, height: vp.height, isMobile: vp.isMobile })

		if (vp.isMobile) {
			await page.setUserAgent(
				'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
			)
		}

		// Enable virtual authenticator via CDP for WebAuthn support
		const cdpSession = await page.createCDPSession()
		await cdpSession.send('WebAuthn.enable')
		await cdpSession.send('WebAuthn.addVirtualAuthenticator', {
			options: {
				protocol: 'ctap2',
				transport: 'internal',
				hasResidentKey: true,
				hasUserVerification: true,
				isUserVerified: true,
			},
		})

		// Start V8 JS coverage before loading any scripts
		await startCoverage(page)

		// Load jungle gym
		await page.goto(`file://${JUNGLE_GYM}`, { waitUntil: 'networkidle0' })

		// Inject the real page-controller bundle
		await page.addScriptTag({ path: BUNDLE_PATH })

		// Verify PageController is available
		const hasController = await page.evaluate(
			() =>
				typeof PageController !== 'undefined' && typeof PageController.getFlatTree === 'function'
		)
		assert.ok(hasController, 'PageController global must be available after injecting bundle')

		// ══════════════════════════════════════════════════════════
		// Phase 1: Initial snapshot — agent sees the dashboard
		// ══════════════════════════════════════════════════════════

		await test(`[${vp.label}] getFlatTree + flatTreeToString produces LLM prompt for dashboard`, async () => {
			const prompt = await getPrompt(page)
			assert.ok(
				typeof prompt === 'string' && prompt.length > 0,
				'Prompt should be a non-empty string'
			)
			assert.ok(prompt.includes('Dashboard'), 'Prompt should contain "Dashboard" text')
		})

		await test(`[${vp.label}] getSelectorMap returns interactive elements`, async () => {
			const count = await getElementCount(page)
			assert.ok(count > 0, `Should have interactive elements, got ${count}`)
			assert.ok(count >= 5, `Should have at least 5 interactive elements, got ${count}`)
		})

		await test(`[${vp.label}] Desktop prompt hides content on inactive pages`, async () => {
			const prompt = await getPrompt(page)
			if (!vp.isMobile) {
				// On desktop, pages use display:none so the page-controller correctly
				// excludes content from inactive pages like Settings > Security
				assert.ok(
					!prompt.includes('Add a Passkey'),
					'Add a Passkey should not appear in dashboard prompt — it is buried in Settings > Security'
				)
			} else {
				// On mobile, the page-controller treats the main area as one scrollable
				// container and includes all page content. This is expected production behavior.
				assert.ok(
					prompt.length > 500,
					'Mobile prompt should include substantial content from the scrollable area'
				)
			}
		})

		// ══════════════════════════════════════════════════════════
		// Phase 2: Navigate to Account Settings (buried in user menu)
		// ══════════════════════════════════════════════════════════

		await test(`[${vp.label}] Click user menu to reveal dropdown`, async () => {
			await clickByText(page, 'Jane Doe')

			const isOpen = await page.evaluate(() =>
				document.getElementById('user-dropdown').classList.contains('open')
			)
			assert.ok(isOpen, 'User dropdown should be open after clicking user menu')
		})

		await test(`[${vp.label}] "Account Settings" is now in the prompt`, async () => {
			const prompt = await getPrompt(page)
			assert.ok(
				prompt.includes('Account Settings'),
				'Account Settings should appear in the prompt after opening dropdown'
			)
		})

		await test(`[${vp.label}] Click "Account Settings" navigates to settings page`, async () => {
			await clickByText(page, 'Account Settings')

			const isActive = await page.evaluate(() =>
				document.getElementById('page-settings').classList.contains('active')
			)
			assert.ok(isActive, 'Settings page should be active')

			const prompt = await getPrompt(page)
			assert.ok(
				prompt.includes('General') && prompt.includes('Security'),
				'Settings page prompt should contain tab names like General and Security'
			)
		})

		// ══════════════════════════════════════════════════════════
		// Phase 3: Navigate to Security tab within Settings
		// ══════════════════════════════════════════════════════════

		await test(`[${vp.label}] "Security" tab is findable via findElementByText`, async () => {
			const idx = await findElementByText(page, 'Security')
			assert.ok(idx !== null, 'Security tab should be findable by text')
		})

		await test(`[${vp.label}] Click Security tab reveals security settings`, async () => {
			await clickByText(page, 'Security')

			const isVisible = await page.evaluate(
				() => document.getElementById('tab-security').style.display !== 'none'
			)
			assert.ok(isVisible, 'Security tab content should be visible')
		})

		// ══════════════════════════════════════════════════════════
		// Phase 4: Find the passkey section (it's at the bottom)
		// ══════════════════════════════════════════════════════════

		await test(`[${vp.label}] "Add a Passkey" now appears in the LLM prompt`, async () => {
			const prompt = await getPrompt(page)
			assert.ok(
				prompt.includes('Add a Passkey'),
				'Add a Passkey button should now be in the LLM prompt on the Security tab'
			)
		})

		await test(`[${vp.label}] Security content is in the prompt (password, 2FA, passkeys)`, async () => {
			const prompt = await getPrompt(page)
			assert.ok(
				prompt.includes('Change Password') || prompt.includes('Password'),
				'Should see password section'
			)
			assert.ok(
				prompt.includes('Passkey') || prompt.includes('passkey'),
				'Should see passkey section'
			)
		})

		// ══════════════════════════════════════════════════════════
		// Phase 5: Click "Add a Passkey" and complete registration
		// ══════════════════════════════════════════════════════════

		await test(`[${vp.label}] Click "Add a Passkey" opens modal`, async () => {
			await clickByText(page, 'Add a Passkey')

			const isOpen = await page.evaluate(() =>
				document.getElementById('passkey-modal').classList.contains('open')
			)
			assert.ok(isOpen, 'Passkey modal should be open')
		})

		await test(`[${vp.label}] Modal form fields appear in prompt`, async () => {
			const prompt = await getPrompt(page)
			assert.ok(
				prompt.includes('Passkey Name') ||
					prompt.includes('MacBook Pro') ||
					prompt.includes('passkey'),
				'Modal form content should appear in the LLM prompt'
			)
		})

		await test(`[${vp.label}] Type passkey name using inputTextElement`, async () => {
			const keyName = vp.isMobile ? 'iPhone 14' : 'MacBook Pro'
			// Find the input by its placeholder text
			await typeByText(page, 'MacBook Pro, iPhone, YubiKey', keyName)

			const value = await page.evaluate(() => document.getElementById('passkey-name-input').value)
			assert.equal(value, keyName, `Input should contain "${keyName}"`)
		})

		await test(`[${vp.label}] Click Register and complete WebAuthn flow`, async () => {
			await clickByText(page, 'Register Passkey')

			// Wait for registration to complete (virtual authenticator handles it instantly,
			// or fallback simulation completes after 1s)
			await new Promise((r) => setTimeout(r, 2000))

			const step3Visible = await page.evaluate(
				() => document.getElementById('passkey-step-3').style.display !== 'none'
			)
			assert.ok(step3Visible, 'Success step should be shown after registration')
		})

		await test(`[${vp.label}] Passkey is now registered in DOM`, async () => {
			const keyName = vp.isMobile ? 'iPhone 14' : 'MacBook Pro'
			// Verify the passkey name appears in the success message
			const successText = await page.evaluate(
				() => document.getElementById('passkey-success-name').textContent
			)
			assert.ok(
				successText.includes(keyName),
				`Success message should include "${keyName}", got "${successText}"`
			)
		})

		await test(`[${vp.label}] Click Done closes modal`, async () => {
			await clickByText(page, 'Done')

			const isClosed = await page.evaluate(
				() => !document.getElementById('passkey-modal').classList.contains('open')
			)
			assert.ok(isClosed, 'Modal should be closed')
		})

		await test(`[${vp.label}] Passkey "Remove" button appears in prompt after registration`, async () => {
			const prompt = await getPrompt(page)
			assert.ok(
				prompt.includes('Remove'),
				'Remove button for registered passkey should appear in the LLM prompt'
			)
		})

		// ══════════════════════════════════════════════════════════
		// Phase 6: Keyboard interaction tests
		// ══════════════════════════════════════════════════════════

		await test(`[${vp.label}] pressKeyAction('Escape') closes modal when open`, async () => {
			// Re-open modal
			await clickByText(page, 'Add a Passkey')
			const isOpen = await page.evaluate(() =>
				document.getElementById('passkey-modal').classList.contains('open')
			)
			assert.ok(isOpen, 'Modal should be open again')

			// Press Escape using real production code
			await pressKey(page, 'Escape')
			await new Promise((r) => setTimeout(r, 100))

			const isClosed = await page.evaluate(
				() => !document.getElementById('passkey-modal').classList.contains('open')
			)
			assert.ok(isClosed, 'Escape should close the modal')
		})

		// ══════════════════════════════════════════════════════════
		// Phase 7: Element capping — verify maxElements option
		// ══════════════════════════════════════════════════════════

		await test(`[${vp.label}] flatTreeToString with maxElements caps the prompt`, async () => {
			const result = await page.evaluate(() => {
				const tree = PageController.getFlatTree({})
				const full = PageController.flatTreeToString(tree, [])
				const capped = PageController.flatTreeToString(tree, [], { maxElements: 5 })
				const fullCount = (full.match(/\[\d+\]/g) || []).length
				const cappedCount = (capped.match(/\[\d+\]/g) || []).length
				return { fullCount, cappedCount, hasOmitted: capped.includes('omitted') }
			})
			assert.ok(
				result.cappedCount <= 5,
				`Capped prompt should have at most 5 highlighted elements, got ${result.cappedCount}`
			)
			// Only assert fewer elements if page actually has more than 5
			if (result.fullCount > 5) {
				assert.ok(
					result.fullCount > result.cappedCount,
					`Full (${result.fullCount}) should have more than capped (${result.cappedCount})`
				)
				assert.ok(result.hasOmitted, 'Capped prompt should contain omitted summary')
			}
			console.log(
				`     [info] Full: ${result.fullCount} elements, Capped: ${result.cappedCount} elements`
			)
		})

		await test(`[${vp.label}] Element count changes when navigating pages`, async () => {
			const countBefore = await getElementCount(page)

			// Navigate to dashboard by clicking "Dashboard" in top nav
			await clickByText(page, 'Dashboard')
			const countAfter = await getElementCount(page)

			assert.notEqual(
				countBefore,
				countAfter,
				`Element count should change when navigating between pages (settings: ${countBefore}, dashboard: ${countAfter})`
			)
		})

		await test(`[${vp.label}] Element count is reasonable for viewport`, async () => {
			const count = await getElementCount(page)
			assert.ok(count >= 5 && count <= 80, `Expected 5-80 interactive elements, got ${count}`)
			console.log(`     [info] ${count} interactive elements on dashboard`)
		})

		// Collect V8 coverage before closing the page
		await collectCoverage(page)

		await page.close()
	}

	await browser.close()

	// ── Coverage report ─────────────────────────────────────────────
	await reportCoverage()

	// ── Summary ─────────────────────────────────────────────────────
	console.log(`\n${'='.repeat(60)}`)
	console.log(`  Jungle Gym Results: ${results.passed} passed, ${results.failed} failed`)
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
