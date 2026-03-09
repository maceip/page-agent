/**
 * ChatGPT Observer
 *
 * Watches chatgpt.com for assistant message completions.
 * Extracts structured summaries without capturing raw content.
 *
 * Targets: chatgpt.com/*
 */
import { PageObserver } from './observer-base'
import type { PageObservation } from './types'

export class ChatGPTObserver extends PageObserver {
	private lastMessageCount = 0

	constructor(onObservation: (obs: PageObservation) => void, debounceMs = 300) {
		super(
			{
				name: 'ChatGPT',
				patterns: ['chatgpt.com/*', 'chat.openai.com/*'],
				agent: 'chatgpt',
				defaultEnabled: true,
			},
			onObservation,
			debounceMs
		)
	}

	protected getObservationTarget(): Element | null {
		return (
			document.querySelector('[class*="react-scroll-to-bottom"]') ||
			document.querySelector('main') ||
			document.body
		)
	}

	protected extractObservations(_mutations: MutationRecord[]): void {
		// ChatGPT assistant messages
		const messageBlocks = document.querySelectorAll(
			'[data-message-author-role="assistant"], [class*="agent-turn"]'
		)

		if (messageBlocks.length <= this.lastMessageCount) return
		this.lastMessageCount = messageBlocks.length

		const lastMessage = messageBlocks[messageBlocks.length - 1]
		if (!lastMessage) return

		// Check for streaming indicator
		const isStreaming =
			lastMessage.querySelector('[class*="result-streaming"]') !== null ||
			lastMessage.querySelector('[class*="typing"]') !== null
		if (isStreaming) return

		const text = lastMessage.textContent?.trim() || ''
		if (text.length < 10) return

		// Summary
		const hasCode = lastMessage.querySelector('pre, code') !== null
		let summary = text.slice(0, 200)
		if (text.length > 200) summary += '...'

		const tags: string[] = ['chatgpt']
		if (hasCode) tags.push('code')

		const isCompletion =
			text.includes('completed') ||
			text.includes('Here') ||
			text.includes('done') ||
			text.includes('created')

		this.emitIfNew({
			content: summary,
			url: window.location.href,
			source: { agent: 'chatgpt', url: window.location.href },
			tags,
			kind: isCompletion ? 'task_result' : 'observation',
		})
	}
}
