import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import puppeteer from 'puppeteer-core'

const __dirname = dirname(fileURLToPath(import.meta.url))
const KEEP_OPEN = process.env.PA_DEMO_KEEP_OPEN === '1'
const HEADLESS = process.env.PA_DEMO_HEADLESS === '0' ? false : 'new'
const KEEP_OPEN_MS = Number(process.env.PA_DEMO_KEEP_OPEN_MS || 60_000)

const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']

function unique(values) {
	return [...new Set(values)]
}

function resolvePlaywrightChromium(cacheRoot) {
	if (!existsSync(cacheRoot)) return
	const entries = readdirSync(cacheRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium'))
		.map((entry) => entry.name)
		.sort((a, b) => b.localeCompare(a))

	for (const entry of entries) {
		const base = join(cacheRoot, entry, 'chrome-linux')
		const candidates = [join(base, 'chrome'), join(base, 'headless_shell')]
		const found = candidates.find((candidate) => existsSync(candidate))
		if (found) return found
	}
}

function resolveChromiumExecutable() {
	const envPath =
		process.env.PUPPETEER_EXECUTABLE_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_EXECUTABLE_PATH
	if (envPath && existsSync(envPath)) {
		return envPath
	}

	const userHome = process.env.HOME || process.env.USERPROFILE || '/root'
	const cacheRoots = unique([
		join(userHome, '.cache', 'ms-playwright'),
		'/root/.cache/ms-playwright',
		'/home/runner/.cache/ms-playwright',
	])

	for (const cacheRoot of cacheRoots) {
		const candidate = resolvePlaywrightChromium(cacheRoot)
		if (candidate) return candidate
	}

	const candidates = [
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/usr/bin/google-chrome-stable',
		'/usr/bin/google-chrome',
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	]

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate
	}

	throw new Error(
		'No Chromium executable could be resolved. Set PUPPETEER_EXECUTABLE_PATH/PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH before running this demo.'
	)
}

function log(message) {
	process.stdout.write(`${new Date().toISOString()} ${message}\n`)
}

function stableEventId(event) {
	return createHash('sha1').update(JSON.stringify(event)).digest('hex').slice(0, 10)
}

async function run() {
	const executablePath = resolveChromiumExecutable()
	const localHarness = resolve(__dirname, 'two-browser-local-controller.html')
	const remoteHarness = resolve(__dirname, 'two-browser-remote.html')

	const launchOptions = {
		executablePath,
		headless: HEADLESS,
		args: LAUNCH_ARGS,
	}

	const browserLocal = await puppeteer.launch(launchOptions)
	const browserRemote = await puppeteer.launch(launchOptions)

	let remotePage
	let localPage
	let browserState = {}

	try {
		localPage = await browserLocal.newPage()
		remotePage = await browserRemote.newPage()

		await Promise.all([
			localPage.setViewport({ width: 1280, height: 760 }),
			remotePage.setViewport({ width: 1280, height: 760 }),
		])

		await localPage.goto(`file://${localHarness}`)
		await remotePage.goto(`file://${remoteHarness}`)

		await Promise.all([
			localPage.waitForFunction(() => window.__runPhase2Transfer && window.__clear),
			remotePage.waitForFunction(() => window.__initialised),
		])

		const clearLocal = await localPage.evaluate(() => {
			window.__clear()
			return true
		})
		if (!clearLocal) throw new Error('Failed to clear local harness')
		await remotePage.evaluate(() => {
			window.__clearEventLog()
			return true
		})

		const snapshot = await remotePage.evaluate(() => window.__getSnapshot())
		if (!snapshot?.simplifiedHTML?.includes('[42]')) throw new Error('Snapshot is missing stable id [42]')
		if (!snapshot?.simplifiedHTML?.includes('[43]')) throw new Error('Snapshot is missing stable id [43]')
		if (!snapshot?.simplifiedHTML?.includes('[44]')) throw new Error('Snapshot is missing stable id [44]')

		const signIn = snapshot.elements.find((item) => item.id === 42)
		const plan = snapshot.elements.find((item) => item.id === 44)
		if (!signIn || !plan) throw new Error('Remote snapshot missing expected micro-DOM ids')

		const actions = [
			{
				type: 'click',
				elementId: 42,
				x: Math.round(signIn.rect.x + signIn.rect.w / 2),
				y: Math.round(signIn.rect.y + signIn.rect.h / 2),
				timestamp: new Date().toISOString(),
			},
			{
				type: 'focus',
				elementId: 43,
				timestamp: new Date().toISOString(),
			},
			{
				type: 'type',
				elementId: 43,
				text: 'alice@example.com',
				timestamp: new Date().toISOString(),
			},
			{
				type: 'select',
				elementId: 44,
				value: 'team',
				timestamp: new Date().toISOString(),
			},
			{
				type: 'wheel',
				elementId: 44,
				deltaY: 40,
				x: Math.round(plan.rect.x + plan.rect.w / 2),
				y: Math.round(plan.rect.y + plan.rect.h / 2),
				timestamp: new Date().toISOString(),
			},
		]

		const actionResults = await Promise.all(
			actions.map((action) =>
				remotePage.evaluate((payload) => {
					return window.__applyInputEvent(payload)
				}, action)
			)
		)

		const remoteState = await remotePage.evaluate(() => ({
			log: window.__getEventLog(),
			emailValue: document.querySelector('[data-pa-id="43"]').value,
			planValue: document.querySelector('[data-pa-id="44"]').value,
			clicked: document.getElementById('login-button').dataset.clicked,
		}))

		const transferSummary = await localPage.evaluate((results, state) => {
			const eventSummaries = results.map((result, index) => {
				return {
					kind: result.success ? 'workflow_step' : 'observation',
					message: `${result.message}${index === 2 ? ` (${state.emailValue})` : ''}`,
					tags: result.success
						? ['remote-action', result.type || 'unknown', `element:${result.elementId ?? 'n/a'}`]
						: ['remote-action', 'failed'],
				}
			})
			return window.__runPhase2Transfer(eventSummaries)
		}, actionResults, remoteState)

		if (transferSummary.count !== 5) {
			throw new Error(`Expected 5 transferred memories, got ${transferSummary.count}`)
		}
		if (remoteState.emailValue !== 'alice@example.com') {
			throw new Error('Remote page did not receive typed email')
		}
		if (remoteState.planValue !== 'team') {
			throw new Error('Remote select event did not update plan value')
		}
		if (remoteState.clicked !== '1') {
			throw new Error('Remote button did not receive click marker')
		}

		const clickLog = remoteState.log.find((item) => item.type === 'click' && item.success === true)
		if (!clickLog) {
			throw new Error('No successful click event recorded in remote log')
		}
		if (!remoteState.log.some((item) => item.type === 'type' && item.success === true)) {
			throw new Error('No successful type event recorded in remote log')
		}
		if (!remoteState.log.some((item) => item.type === 'select' && item.success === true)) {
			throw new Error('No successful select event recorded in remote log')
		}

		browserState = {
			phase: 'ok',
			snapshotIds: (snapshot.simplifiedHTML.match(/\[(\d+)\]/g) || []).slice(0, 10),
			eventIds: actionResults.map(stableEventId),
			transferTextHash: createHash('sha1').update(transferSummary.transferText).digest('hex').slice(0, 12),
			remoteEventCount: remoteState.log.length,
			remoteEmail: remoteState.emailValue,
		}

		log(`PASS: two-browser mirror demo complete with ${remoteState.log.length} remote events`)
		log(`PASS: stable IDs observed: ${browserState.snapshotIds.join(', ')}`)
		log(`PASS: phase2 transfer count=${transferSummary.count}`)
		log(`PASS: transfer hash=${browserState.transferTextHash}`)
	} finally {
		if (localPage) {
			if (!KEEP_OPEN) {
				await localPage.close()
			}
		}
		if (remotePage) {
			if (!KEEP_OPEN) {
				await remotePage.close()
			}
		}
		if (!KEEP_OPEN) {
			await browserLocal.close()
			await browserRemote.close()
		}
	}

	if (KEEP_OPEN) {
		log(`PA_DEMO_KEEP_OPEN=1 set; browsers and windows kept open for ${KEEP_OPEN_MS}ms`)
		await new Promise((resolve) => setTimeout(resolve, KEEP_OPEN_MS))
		await browserLocal.close()
		await browserRemote.close()
	}

	log('Demo completed')
	return browserState
}

run().catch((err) => {
	log(`FAIL: ${err.message}`)
	process.exit(1)
})
