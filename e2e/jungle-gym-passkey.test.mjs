/**
 * Jungle Gym — Passkey E2E Test (Two-Browser Mirror Pattern)
 *
 * Simulates the mirror-mode agent flow:
 * 1. "Remote" browser loads the Jungle Gym app (Acme Cloud dashboard)
 * 2. "Local" browser acts as the agent controller
 * 3. Agent must navigate: Dashboard → User Menu → Account Settings → Security → Passkeys → Add
 * 4. The passkey settings are intentionally buried 3 clicks deep
 * 5. Tests element capping, keyboard actions, and action enrichment along the way
 *
 * Runs at both desktop (1280x800) and mobile (390x844) viewports.
 *
 * Run: node e2e/jungle-gym-passkey.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

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

const VIEWPORTS = [
	{ width: 1280, height: 800, isMobile: false, label: 'Desktop 1280x800' },
	{ width: 390, height: 844, isMobile: true, label: 'Mobile 390x844' },
]

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

// ── Helpers ──────────────────────────────────────────────────────────

/** Get a snapshot from the jungle gym via the mirror harness API */
async function getSnapshot(page) {
	return page.evaluate(() => window.__getSnapshot())
}

/** Apply an input event via the mirror harness API */
async function applyEvent(page, event) {
	return page.evaluate((e) => window.__applyInputEvent(e), event)
}

/** Find an element in the snapshot by its data-pa-id */
function findElement(snapshot, id) {
	return snapshot.elements.find((el) => el.id === id)
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
	console.log(`\n🔧 Using Chromium: ${CHROMIUM}`)
	console.log(`🏋 Jungle Gym: ${JUNGLE_GYM}\n`)

	for (const vp of VIEWPORTS) {
		console.log(`\n📐 Viewport: ${vp.label}`)
		console.log(`   ${'─'.repeat(55)}`)

		// Launch TWO browsers (mirror pattern)
		const browserRemote = await puppeteer.launch({
			executablePath: CHROMIUM,
			headless: HEADLESS,
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
				'--disable-gpu',
				// Enable virtual authenticator for WebAuthn
				'--enable-web-authentication-testing-api',
			],
		})
		const browserLocal = await puppeteer.launch({
			executablePath: CHROMIUM,
			headless: HEADLESS,
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
				'--disable-gpu',
			],
		})

		const remotePage = await browserRemote.newPage()
		const localPage = await browserLocal.newPage()

		await remotePage.setViewport({ width: vp.width, height: vp.height, isMobile: vp.isMobile })
		await localPage.setViewport({ width: 1280, height: 760 })

		if (vp.isMobile) {
			await remotePage.setUserAgent(
				'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
			)
		}

		// Enable virtual authenticator via CDP for WebAuthn support
		const cdpSession = await remotePage.createCDPSession()
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

		// Load jungle gym in remote browser
		await remotePage.goto(`file://${JUNGLE_GYM}`, { waitUntil: 'networkidle0' })
		await remotePage.waitForFunction(() => window.__initialised)

		// Load local controller harness
		const localHarness = resolve(__dirname, 'two-browser-local-controller.html')
		await localPage.goto(`file://${localHarness}`)
		await localPage.waitForFunction(() => window.__runPhase2Transfer && window.__clear)
		await localPage.evaluate(() => window.__clear())

		// ══════════════════════════════════════════════════════════
		// Phase 1: Initial snapshot — agent sees the dashboard
		// ══════════════════════════════════════════════════════════

		await test(`[${vp.label}] Initial snapshot shows dashboard`, async () => {
			const snap = await getSnapshot(remotePage)
			assert.ok(snap.simplifiedHTML.includes('[1]'), 'Dashboard nav link should be visible')
			assert.ok(snap.title === 'Acme Cloud — Dashboard')
			// Passkey button should NOT be visible (it's on a different page/tab)
			assert.ok(
				!snap.elements.find((e) => e.id === 50),
				'Add Passkey button should not be visible on dashboard'
			)
		})

		await test(`[${vp.label}] Snapshot contains interactive elements with stable IDs`, async () => {
			const snap = await getSnapshot(remotePage)
			assert.ok(snap.elements.length > 0, 'Should have interactive elements')
			// Check that IDs are stable numeric values
			for (const el of snap.elements) {
				assert.ok(
					typeof el.id === 'number' && el.id > 0,
					`Element should have numeric ID, got: ${el.id}`
				)
				assert.ok(el.rect && typeof el.rect.x === 'number', 'Element should have rect')
				assert.ok(el.role, 'Element should have role')
			}
		})

		// ══════════════════════════════════════════════════════════
		// Phase 2: Navigate to Account Settings (buried in user menu)
		// ══════════════════════════════════════════════════════════

		await test(`[${vp.label}] Click user menu to reveal dropdown`, async () => {
			// Element 5 is the user menu trigger
			const result = await applyEvent(remotePage, { type: 'click', elementId: 5 })
			assert.ok(result.success, 'Click on user menu should succeed')

			// Dropdown should now be visible
			const isOpen = await remotePage.evaluate(() =>
				document.getElementById('user-dropdown').classList.contains('open')
			)
			assert.ok(isOpen, 'User dropdown should be open after click')
		})

		await test(`[${vp.label}] Snapshot now shows dropdown menu items`, async () => {
			const snap = await getSnapshot(remotePage)
			// Element 7 = "Account Settings" link in dropdown
			const settingsLink = findElement(snap, 7)
			assert.ok(settingsLink, 'Account Settings link should be visible in dropdown')
		})

		await test(`[${vp.label}] Click Account Settings navigates to settings page`, async () => {
			const result = await applyEvent(remotePage, { type: 'click', elementId: 7 })
			assert.ok(result.success, 'Click on Account Settings should succeed')

			// Settings page should now be visible
			const isActive = await remotePage.evaluate(() =>
				document.getElementById('page-settings').classList.contains('active')
			)
			assert.ok(isActive, 'Settings page should be active')
		})

		// ══════════════════════════════════════════════════════════
		// Phase 3: Navigate to Security tab within Settings
		// ══════════════════════════════════════════════════════════

		await test(`[${vp.label}] Settings page shows tab navigation`, async () => {
			const snap = await getSnapshot(remotePage)
			// Element 32 = "Security" tab
			const securityTab = findElement(snap, 32)
			assert.ok(securityTab, 'Security tab should be visible in settings nav')
		})

		await test(`[${vp.label}] Click Security tab reveals security settings`, async () => {
			const result = await applyEvent(remotePage, { type: 'click', elementId: 32 })
			assert.ok(result.success, 'Click on Security tab should succeed')

			// Security tab content should be visible
			const isVisible = await remotePage.evaluate(
				() => document.getElementById('tab-security').style.display !== 'none'
			)
			assert.ok(isVisible, 'Security tab content should be visible')
		})

		// ══════════════════════════════════════════════════════════
		// Phase 4: Find the passkey section (it's at the bottom)
		// ══════════════════════════════════════════════════════════

		await test(`[${vp.label}] Passkey "Add" button is now visible in snapshot`, async () => {
			const snap = await getSnapshot(remotePage)
			// Element 50 = "Add a Passkey" button
			const addBtn = findElement(snap, 50)
			assert.ok(addBtn, 'Add Passkey button should now be in the snapshot')
			assert.ok(addBtn.role === 'button', 'Should be a button')
		})

		await test(`[${vp.label}] No passkeys registered initially`, async () => {
			const passkeys = await remotePage.evaluate(() => window.__getRegisteredPasskeys())
			assert.equal(passkeys.length, 0, 'Should start with zero passkeys')
		})

		// ══════════════════════════════════════════════════════════
		// Phase 5: Click "Add a Passkey" and complete registration
		// ══════════════════════════════════════════════════════════

		await test(`[${vp.label}] Click "Add a Passkey" opens modal`, async () => {
			const result = await applyEvent(remotePage, { type: 'click', elementId: 50 })
			assert.ok(result.success, 'Click on Add Passkey should succeed')

			const isOpen = await remotePage.evaluate(() =>
				document.getElementById('passkey-modal').classList.contains('open')
			)
			assert.ok(isOpen, 'Passkey modal should be open')
		})

		await test(`[${vp.label}] Snapshot shows modal form fields`, async () => {
			const snap = await getSnapshot(remotePage)
			// Element 51 = passkey name input
			const nameInput = findElement(snap, 51)
			assert.ok(nameInput, 'Passkey name input should be visible in modal')
			// Element 53 = Register button
			const registerBtn = findElement(snap, 53)
			assert.ok(registerBtn, 'Register Passkey button should be visible')
		})

		await test(`[${vp.label}] Type passkey name into input`, async () => {
			const keyName = vp.isMobile ? 'iPhone 14' : 'MacBook Pro'
			const result = await applyEvent(remotePage, {
				type: 'type',
				elementId: 51,
				text: keyName,
			})
			assert.ok(result.success, 'Type into passkey name should succeed')

			const value = await remotePage.evaluate(
				() => document.getElementById('passkey-name-input').value
			)
			assert.equal(value, keyName, `Input should contain "${keyName}"`)
		})

		await test(`[${vp.label}] Click Register and complete WebAuthn flow`, async () => {
			const result = await applyEvent(remotePage, { type: 'click', elementId: 53 })
			assert.ok(result.success, 'Click Register should succeed')

			// Wait for registration to complete (virtual authenticator handles it instantly,
			// or fallback simulation completes after 1s)
			await new Promise((r) => setTimeout(r, 2000))

			// Step 3 (success) should be visible
			const step3Visible = await remotePage.evaluate(
				() => document.getElementById('passkey-step-3').style.display !== 'none'
			)
			assert.ok(step3Visible, 'Success step should be shown after registration')
		})

		await test(`[${vp.label}] Passkey is now registered`, async () => {
			const passkeys = await remotePage.evaluate(() => window.__getRegisteredPasskeys())
			assert.equal(passkeys.length, 1, 'Should have 1 registered passkey')

			const keyName = vp.isMobile ? 'iPhone 14' : 'MacBook Pro'
			assert.equal(passkeys[0].name, keyName, `Passkey name should be "${keyName}"`)
		})

		await test(`[${vp.label}] Click Done closes modal`, async () => {
			const result = await applyEvent(remotePage, { type: 'click', elementId: 54 })
			assert.ok(result.success, 'Click Done should succeed')

			const isClosed = await remotePage.evaluate(
				() => !document.getElementById('passkey-modal').classList.contains('open')
			)
			assert.ok(isClosed, 'Modal should be closed')
		})

		await test(`[${vp.label}] Passkey appears in the security settings list`, async () => {
			const snap = await getSnapshot(remotePage)
			// The passkey item should now have a Remove button with data-pa-id="60"
			const removeBtn = findElement(snap, 60)
			assert.ok(removeBtn, 'Remove passkey button should now be visible')
		})

		// ══════════════════════════════════════════════════════════
		// Phase 6: Keyboard interaction tests
		// ══════════════════════════════════════════════════════════

		await test(`[${vp.label}] Escape key closes modal when open`, async () => {
			// Re-open modal
			await applyEvent(remotePage, { type: 'click', elementId: 50 })
			const isOpen = await remotePage.evaluate(() =>
				document.getElementById('passkey-modal').classList.contains('open')
			)
			assert.ok(isOpen, 'Modal should be open again')

			// Press Escape via keyboard event
			await applyEvent(remotePage, { type: 'keyboard', key: 'Escape', code: 'Escape' })
			await new Promise((r) => setTimeout(r, 100))

			const isClosed = await remotePage.evaluate(
				() => !document.getElementById('passkey-modal').classList.contains('open')
			)
			assert.ok(isClosed, 'Escape should close the modal')
		})

		// ══════════════════════════════════════════════════════════
		// Phase 7: Action enrichment — verify state changes after actions
		// ══════════════════════════════════════════════════════════

		await test(`[${vp.label}] State diff: element count changes when navigating pages`, async () => {
			// Snapshot on settings page
			const snapBefore = await getSnapshot(remotePage)

			// Navigate to dashboard
			await applyEvent(remotePage, { type: 'click', elementId: 1 })
			const snapAfter = await getSnapshot(remotePage)

			// Dashboard and settings have different element counts
			assert.notEqual(
				snapBefore.elements.length,
				snapAfter.elements.length,
				'Element count should change when navigating between pages'
			)
		})

		// ══════════════════════════════════════════════════════════
		// Phase 8: Transfer memories (local controller)
		// ══════════════════════════════════════════════════════════

		await test(`[${vp.label}] Transfer action history to local controller`, async () => {
			const eventLog = await remotePage.evaluate(() => window.__getEventLog())
			assert.ok(
				eventLog.length >= 5,
				`Should have logged at least 5 events, got ${eventLog.length}`
			)

			const eventSummaries = eventLog
				.filter((e) => e.success)
				.map((e) => ({
					kind: 'workflow_step',
					message: e.message,
					tags: ['remote-action', e.type, `element:${e.elementId ?? 'n/a'}`],
				}))

			const transferResult = await localPage.evaluate((summaries) => {
				return window.__runPhase2Transfer(summaries)
			}, eventSummaries)

			assert.ok(
				transferResult.count >= 5,
				`Should transfer at least 5 memories, got ${transferResult.count}`
			)
		})

		// ══════════════════════════════════════════════════════════
		// Phase 9: Element capping — verify we see reasonable counts
		// ══════════════════════════════════════════════════════════

		await test(`[${vp.label}] Element count is reasonable for viewport`, async () => {
			// Navigate back to settings→security to see all elements including passkey section
			await applyEvent(remotePage, { type: 'click', elementId: 7 })
			await new Promise((r) => setTimeout(r, 100))
			// We need to re-open the dropdown first
			await applyEvent(remotePage, { type: 'click', elementId: 5 })
			await new Promise((r) => setTimeout(r, 100))
			await applyEvent(remotePage, { type: 'click', elementId: 7 })
			await new Promise((r) => setTimeout(r, 100))

			const snap = await getSnapshot(remotePage)
			// We should have a manageable number of interactive elements
			// (not hundreds - the settings page has ~20-30 elements)
			assert.ok(
				snap.elements.length >= 5 && snap.elements.length <= 80,
				`Expected 5-80 visible elements, got ${snap.elements.length}`
			)
			console.log(`     [info] ${snap.elements.length} interactive elements on settings page`)
		})

		await remotePage.close()
		await localPage.close()
		await browserRemote.close()
		await browserLocal.close()
	}

	// ── Summary ─────────────────────────────────────────────────────
	console.log(`\n${'═'.repeat(60)}`)
	console.log(`  Jungle Gym Results: ${results.passed} passed, ${results.failed} failed`)
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
