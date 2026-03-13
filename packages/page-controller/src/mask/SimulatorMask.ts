import { Motion } from 'ai-motion'

import { isPageDark } from './checkDarkMode'

import styles from './SimulatorMask.module.css'
import cursorStyles from './cursor.module.css'

export class SimulatorMask {
	shown: boolean = false
	wrapper = document.createElement('div')
	motion: Motion | null = null

	#cursor = document.createElement('div')

	#currentCursorX = 0
	#currentCursorY = 0

	#targetCursorX = 0
	#targetCursorY = 0

	/** Speed factor for cursor easing (higher = faster). Range 0-1. */
	#cursorSpeed = 0.35

	constructor() {
		this.wrapper.id = 'page-agent-runtime_simulator-mask'
		this.wrapper.className = styles.wrapper
		this.wrapper.setAttribute('data-browser-use-ignore', 'true')
		this.wrapper.setAttribute('data-page-agent-ignore', 'true')

		try {
			const motion = new Motion({
				mode: isPageDark() ? 'dark' : 'light',
				styles: { position: 'absolute', inset: '0' },
			})
			this.motion = motion
			this.wrapper.appendChild(motion.element)
			motion.autoResize(this.wrapper)
		} catch (e) {
			console.warn('[SimulatorMask] Motion overlay unavailable:', e)
		}

		// NOTE: No event blocking. The mask is purely visual.
		// The user's mouse and keyboard remain fully functional.

		// Create AI cursor
		this.#createCursor()

		document.body.appendChild(this.wrapper)

		this.#moveCursorToTarget()

		window.addEventListener('PageAgent::MovePointerTo', (event: Event) => {
			const { x, y } = (event as CustomEvent).detail
			this.setCursorPosition(x, y)
		})

		window.addEventListener('PageAgent::ClickPointer', (event: Event) => {
			this.triggerClickAnimation()
		})
	}

	#createCursor() {
		this.#cursor.className = cursorStyles.cursor

		// Glow trail (rendered behind cursor shape)
		const glow = document.createElement('div')
		glow.className = cursorStyles.cursorGlow
		this.#cursor.appendChild(glow)

		// Ripple effect container
		const rippleContainer = document.createElement('div')
		rippleContainer.className = cursorStyles.cursorRipple
		this.#cursor.appendChild(rippleContainer)

		// Filling layer
		const fillingLayer = document.createElement('div')
		fillingLayer.className = cursorStyles.cursorFilling
		this.#cursor.appendChild(fillingLayer)

		// Border layer
		const borderLayer = document.createElement('div')
		borderLayer.className = cursorStyles.cursorBorder
		this.#cursor.appendChild(borderLayer)

		// "AI" label badge
		const label = document.createElement('div')
		label.className = cursorStyles.cursorLabel
		label.textContent = 'AI'
		this.#cursor.appendChild(label)

		this.wrapper.appendChild(this.#cursor)
	}

	#moveCursorToTarget() {
		const speed = this.#cursorSpeed
		const newX = this.#currentCursorX + (this.#targetCursorX - this.#currentCursorX) * speed
		const newY = this.#currentCursorY + (this.#targetCursorY - this.#currentCursorY) * speed

		const xDistance = Math.abs(newX - this.#targetCursorX)
		if (xDistance > 0) {
			if (xDistance < 1) {
				this.#currentCursorX = this.#targetCursorX
			} else {
				this.#currentCursorX = newX
			}
			this.#cursor.style.left = `${this.#currentCursorX}px`
		}

		const yDistance = Math.abs(newY - this.#targetCursorY)
		if (yDistance > 0) {
			if (yDistance < 1) {
				this.#currentCursorY = this.#targetCursorY
			} else {
				this.#currentCursorY = newY
			}
			this.#cursor.style.top = `${this.#currentCursorY}px`
		}

		requestAnimationFrame(() => this.#moveCursorToTarget())
	}

	setCursorPosition(x: number, y: number) {
		this.#targetCursorX = x
		this.#targetCursorY = y
	}

	triggerClickAnimation() {
		this.#cursor.classList.remove(cursorStyles.clicking)
		this.#cursor.classList.remove(cursorStyles.idle)
		// Force reflow to restart animation
		void this.#cursor.offsetHeight
		this.#cursor.classList.add(cursorStyles.clicking)
	}

	show() {
		if (this.shown) return

		this.shown = true
		this.motion?.start()
		this.motion?.fadeIn()

		this.wrapper.classList.add(styles.visible)

		// Initialize cursor position
		this.#currentCursorX = window.innerWidth / 2
		this.#currentCursorY = window.innerHeight / 2
		this.#targetCursorX = this.#currentCursorX
		this.#targetCursorY = this.#currentCursorY
		this.#cursor.style.left = `${this.#currentCursorX}px`
		this.#cursor.style.top = `${this.#currentCursorY}px`

		// Start with idle breathing animation
		this.#cursor.classList.add(cursorStyles.idle)
	}

	hide() {
		if (!this.shown) return

		this.shown = false
		this.motion?.fadeOut()
		this.motion?.pause()

		this.#cursor.classList.remove(cursorStyles.clicking)
		this.#cursor.classList.remove(cursorStyles.idle)

		setTimeout(() => {
			this.wrapper.classList.remove(styles.visible)
		}, 800) // Match the animation duration
	}

	dispose() {
		this.motion?.dispose()
		this.wrapper.remove()
	}
}
