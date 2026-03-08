/**
 * Observer Manager
 *
 * Manages page observers lifecycle. Determines which observers to activate
 * based on the current URL and user settings. Sends observations to the
 * background service worker for persistence.
 */
import { ChatGPTObserver } from './chatgpt-observer'
import { ClaudeObserver } from './claude-observer'
import { GeminiObserver } from './gemini-observer'
import { PageObserver } from './observer-base'
import type { PageObservation } from './types'
import { DEFAULT_OBSERVER_SETTINGS, type ObserverSettings } from './types'

/** All available observer constructors */
const OBSERVER_FACTORIES: ((
	onObs: (obs: PageObservation) => void,
	debounceMs: number
) => PageObserver)[] = [
	(onObs, ms) => new ClaudeObserver(onObs, ms),
	(onObs, ms) => new ChatGPTObserver(onObs, ms),
	(onObs, ms) => new GeminiObserver(onObs, ms),
]

let activeObservers: PageObserver[] = []
let settings: ObserverSettings = DEFAULT_OBSERVER_SETTINGS

/**
 * Initialize observers for the current page.
 * Call this from the content script.
 */
export async function initObservers(): Promise<void> {
	// Load settings
	try {
		const result = await chrome.storage.local.get('observerSettings')
		if (result.observerSettings) {
			settings = { ...DEFAULT_OBSERVER_SETTINGS, ...result.observerSettings }
		}
	} catch {
		// Not in extension context, skip
		return
	}

	const url = window.location.href

	const handleObservation = (obs: PageObservation) => {
		// Send to background service worker for persistence
		try {
			chrome.runtime.sendMessage({
				type: 'MEMORY_WRITE',
				payload: {
					content: obs.content,
					tags: obs.tags,
					kind: obs.kind,
					scope: obs.url,
					source: obs.source,
				},
			})
		} catch (err) {
			console.warn('[ObserverManager] Failed to send observation:', err)
		}
	}

	// Create and start matching observers
	for (const factory of OBSERVER_FACTORIES) {
		const observer = factory(handleObservation, settings.debounceMs)

		// Check if this observer matches the current URL
		if (!observer.matches(url)) continue

		// Check if enabled in settings (default to observer's defaultEnabled)
		const isEnabled = settings.enabled[observer.config.name] ?? observer.config.defaultEnabled

		if (!isEnabled) continue

		observer.start()
		activeObservers.push(observer)
	}

	if (activeObservers.length > 0) {
		console.log(
			`[ObserverManager] Active observers: ${activeObservers.map((o) => o.config.name).join(', ')}`
		)
	}
}

/** Stop all active observers */
export function stopAllObservers(): void {
	for (const observer of activeObservers) {
		observer.stop()
	}
	activeObservers = []
}

/** Get names of currently active observers */
export function getActiveObserverNames(): string[] {
	return activeObservers.map((o) => o.config.name)
}

/** Get all available observer configs */
export function getAvailableObservers() {
	const dummyHandler = () => {}
	return OBSERVER_FACTORIES.map((f) => {
		const obs = f(dummyHandler, 300)
		return obs.config
	})
}

/** Update observer settings */
export async function updateObserverSettings(updates: Partial<ObserverSettings>): Promise<void> {
	settings = { ...settings, ...updates }
	await chrome.storage.local.set({ observerSettings: settings })

	// Restart observers with new settings
	stopAllObservers()
	await initObservers()
}
