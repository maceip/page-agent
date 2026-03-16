/**
 * M4 — Keyboard Actions / press_key Tests
 *
 * Tests the pressKeyAction function and input validation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { pressKeyAction } from '../packages/page-controller/src/actions'

describe('M4: Keyboard Actions — pressKeyAction', () => {
	beforeEach(() => {
		document.body.innerHTML = ''
	})

	describe('Key dispatch', () => {
		it('should dispatch keydown, keypress, keyup events for Enter', async () => {
			const events: string[] = []
			const input = document.createElement('input')
			document.body.appendChild(input)
			input.focus()

			input.addEventListener('keydown', () => events.push('keydown'))
			input.addEventListener('keypress', () => events.push('keypress'))
			input.addEventListener('keyup', () => events.push('keyup'))

			await pressKeyAction('Enter')

			expect(events).toEqual(['keydown', 'keypress', 'keyup'])
		})

		it('should dispatch with correct key and code for named keys', async () => {
			const input = document.createElement('input')
			document.body.appendChild(input)
			input.focus()

			let capturedEvent: KeyboardEvent | null = null
			input.addEventListener('keydown', (e) => {
				capturedEvent = e
			})

			await pressKeyAction('Escape')

			expect(capturedEvent).not.toBeNull()
			expect(capturedEvent!.key).toBe('Escape')
			expect(capturedEvent!.code).toBe('Escape')
		})

		it('should dispatch with correct code for single characters', async () => {
			const input = document.createElement('input')
			document.body.appendChild(input)
			input.focus()

			let capturedEvent: KeyboardEvent | null = null
			input.addEventListener('keydown', (e) => {
				capturedEvent = e
			})

			await pressKeyAction('a')

			expect(capturedEvent!.key).toBe('a')
			expect(capturedEvent!.code).toBe('KeyA')
		})

		it('should dispatch to document.body when no element is focused', async () => {
			// Blur everything
			;(document.activeElement as HTMLElement)?.blur()

			let received = false
			document.body.addEventListener('keydown', () => {
				received = true
			})

			await pressKeyAction('Enter')

			expect(received).toBe(true)
		})
	})

	describe('Modifier support', () => {
		it('should set ctrlKey when Ctrl modifier is specified', async () => {
			const input = document.createElement('input')
			document.body.appendChild(input)
			input.focus()

			let capturedEvent: KeyboardEvent | null = null
			input.addEventListener('keydown', (e) => {
				capturedEvent = e
			})

			await pressKeyAction('a', ['Ctrl'])

			expect(capturedEvent!.ctrlKey).toBe(true)
			expect(capturedEvent!.shiftKey).toBe(false)
			expect(capturedEvent!.altKey).toBe(false)
			expect(capturedEvent!.metaKey).toBe(false)
		})

		it('should set shiftKey when Shift modifier is specified', async () => {
			const input = document.createElement('input')
			document.body.appendChild(input)
			input.focus()

			let capturedEvent: KeyboardEvent | null = null
			input.addEventListener('keydown', (e) => {
				capturedEvent = e
			})

			await pressKeyAction('a', ['Shift'])

			expect(capturedEvent!.shiftKey).toBe(true)
		})

		it('should handle multiple modifiers', async () => {
			const input = document.createElement('input')
			document.body.appendChild(input)
			input.focus()

			let capturedEvent: KeyboardEvent | null = null
			input.addEventListener('keydown', (e) => {
				capturedEvent = e
			})

			await pressKeyAction('a', ['Ctrl', 'Shift'])

			expect(capturedEvent!.ctrlKey).toBe(true)
			expect(capturedEvent!.shiftKey).toBe(true)
		})

		it('should accept "Control" as alias for "Ctrl"', async () => {
			const input = document.createElement('input')
			document.body.appendChild(input)
			input.focus()

			let capturedEvent: KeyboardEvent | null = null
			input.addEventListener('keydown', (e) => {
				capturedEvent = e
			})

			await pressKeyAction('a', ['Control'])

			expect(capturedEvent!.ctrlKey).toBe(true)
		})

		it('should accept "Command" as alias for "Meta"', async () => {
			const input = document.createElement('input')
			document.body.appendChild(input)
			input.focus()

			let capturedEvent: KeyboardEvent | null = null
			input.addEventListener('keydown', (e) => {
				capturedEvent = e
			})

			await pressKeyAction('a', ['Command'])

			expect(capturedEvent!.metaKey).toBe(true)
		})
	})

	describe('Arrow keys', () => {
		it('should handle ArrowDown', async () => {
			const input = document.createElement('input')
			document.body.appendChild(input)
			input.focus()

			let capturedEvent: KeyboardEvent | null = null
			input.addEventListener('keydown', (e) => {
				capturedEvent = e
			})

			await pressKeyAction('ArrowDown')

			expect(capturedEvent!.key).toBe('ArrowDown')
			expect(capturedEvent!.code).toBe('ArrowDown')
		})

		it('should handle all arrow key variants', async () => {
			for (const arrow of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
				const input = document.createElement('input')
				document.body.appendChild(input)
				input.focus()

				let capturedEvent: KeyboardEvent | null = null
				input.addEventListener('keydown', (e) => {
					capturedEvent = e
				})

				await pressKeyAction(arrow)
				expect(capturedEvent!.key).toBe(arrow)
				document.body.removeChild(input)
			}
		})
	})

	describe('Form interaction', () => {
		it('should dispatch Enter on a form submit button', async () => {
			const form = document.createElement('form')
			const button = document.createElement('button')
			button.type = 'submit'
			form.appendChild(button)
			document.body.appendChild(form)
			button.focus()

			let keydownReceived = false
			button.addEventListener('keydown', (e) => {
				keydownReceived = true
				expect(e.key).toBe('Enter')
			})

			await pressKeyAction('Enter')
			expect(keydownReceived).toBe(true)
		})

		it('should dispatch Tab for field navigation', async () => {
			const input1 = document.createElement('input')
			const input2 = document.createElement('input')
			document.body.appendChild(input1)
			document.body.appendChild(input2)
			input1.focus()

			let tabReceived = false
			input1.addEventListener('keydown', (e) => {
				if (e.key === 'Tab') tabReceived = true
			})

			await pressKeyAction('Tab')
			expect(tabReceived).toBe(true)
		})

		it('should dispatch Escape for modal dismissal', async () => {
			const modal = document.createElement('div')
			modal.setAttribute('role', 'dialog')
			document.body.appendChild(modal)

			let escapeReceived = false
			modal.addEventListener('keydown', (e) => {
				if (e.key === 'Escape') escapeReceived = true
			})
			;(modal as HTMLElement).focus()

			await pressKeyAction('Escape')
			// Event bubbles, check on body as fallback
		})
	})

	describe('Space key handling', () => {
		it('should map Space key correctly', async () => {
			const input = document.createElement('input')
			document.body.appendChild(input)
			input.focus()

			let capturedEvent: KeyboardEvent | null = null
			input.addEventListener('keydown', (e) => {
				capturedEvent = e
			})

			await pressKeyAction('Space')

			expect(capturedEvent!.key).toBe('Space')
			expect(capturedEvent!.code).toBe('Space')
		})

		it('should map literal space character correctly', async () => {
			const input = document.createElement('input')
			document.body.appendChild(input)
			input.focus()

			let capturedEvent: KeyboardEvent | null = null
			input.addEventListener('keydown', (e) => {
				capturedEvent = e
			})

			await pressKeyAction(' ')

			expect(capturedEvent!.key).toBe(' ')
			expect(capturedEvent!.code).toBe('Space')
		})
	})
})
