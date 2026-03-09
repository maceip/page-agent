/**
 * Gemini Observer
 *
 * Watches gemini.google.com for assistant responses.
 * Extracts structured summaries without capturing raw content.
 */
import { PageObserver } from './observer-base'
import type { PageObservation } from './types'

export class GeminiObserver extends PageObserver {
	private lastMessageCount = 0

	constructor(onObservation: (obs: PageObservation) => void, debounceMs = 300) {
		super(
			{
				name: 'Gemini',
				patterns: ['gemini.google.com/*', 'aistudio.google.com/*'],
				agent: 'gemini',
				defaultEnabled: true,
			},
			onObservation,
			debounceMs
		)
	}

	protected getObservationTarget(): Element | null {
		return (
			document.querySelector('[class*="conversation-container"]') ||
			document.querySelector('main') ||
			document.body
		)
	}

	protected extractObservations(_mutations: MutationRecord[]): void {
		// Gemini response blocks
		const messageBlocks = document.querySelectorAll(
			'model-response, [class*="model-response"], [data-content-type="response"]'
		)

		if (messageBlocks.length <= this.lastMessageCount) return
		this.lastMessageCount = messageBlocks.length

		const lastMessage = messageBlocks[messageBlocks.length - 1]
		if (!lastMessage) return

		const text = lastMessage.textContent?.trim() || ''
		if (text.length < 10) return

		const hasCode = lastMessage.querySelector('pre, code') !== null
		let summary = text.slice(0, 200)
		if (text.length > 200) summary += '...'

		const tags: string[] = ['gemini']
		if (hasCode) tags.push('code')

		this.emitIfNew({
			content: summary,
			url: window.location.href,
			source: { agent: 'gemini', url: window.location.href },
			tags,
			kind: 'observation',
		})
	}
}
