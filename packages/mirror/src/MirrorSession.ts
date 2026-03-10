/**
 * MirrorSession — Concrete session wiring that connects RemotePageController
 * to the MirrorController's hot layer.
 *
 * This is the "end-to-end instantiation path" referenced in the Phase 1 caveat:
 * it creates a RemotePageController, subscribes to hot-layer spatial map updates,
 * feeds incoming MicroDOMSnapshots (and materializes diffs) into the controller,
 * and exposes the controller for PageAgentCore consumption.
 *
 * Usage:
 *   const session = new MirrorSession(hotLayer)
 *   session.start()
 *
 *   // Use the controller with PageAgentCore (no cast needed — implements IPageController):
 *   const core = new PageAgentCore({
 *     pageController: session.controller,
 *     ...agentConfig,
 *   })
 *
 *   // When done:
 *   session.dispose()
 */
import { RemotePageController } from './RemotePageController'
import type { IHotLayer } from './layers/hot'
import type { MicroDOMDiff, MicroDOMSnapshot, SpatialElement } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type guard: is this update a full snapshot (has `elements`) or a diff (has `upserted`)? */
function isSnapshot(update: MicroDOMSnapshot | MicroDOMDiff): update is MicroDOMSnapshot {
	return 'elements' in update && 'simplifiedHTML' in update
}

/** Escape a string for safe inclusion inside an HTML attribute value (double-quoted). */
function escapeAttr(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------------
// MirrorSession
// ---------------------------------------------------------------------------

export class MirrorSession {
	readonly controller: RemotePageController

	private hotLayer: IHotLayer
	private unsubSpatial: (() => void) | null = null
	private currentSnapshot: MicroDOMSnapshot | null = null
	private started = false
	private disposed = false

	constructor(hotLayer: IHotLayer) {
		this.hotLayer = hotLayer
		this.controller = new RemotePageController(hotLayer)
	}

	/**
	 * Start the session: subscribe to hot-layer spatial map updates and begin
	 * feeding them to the RemotePageController.
	 *
	 * If the hot layer already has a snapshot cached, it's applied immediately.
	 */
	start(): void {
		if (this.started) return
		this.started = true

		// Seed from any existing snapshot the hot layer may already hold
		const existing = this.hotLayer.getLatestSnapshot()
		if (existing) {
			this.currentSnapshot = existing
			this.controller.applySnapshot(existing)
		}

		// Subscribe to future updates.
		// Guard against callbacks firing after dispose() — the hot layer may
		// enqueue a callback between unsubscribe and delivery completion.
		this.unsubSpatial = this.hotLayer.onSpatialMapUpdate((update) => {
			if (this.disposed) return

			if (isSnapshot(update)) {
				this.currentSnapshot = update
				this.controller.applySnapshot(update)
			} else {
				// Materialize diff into a full snapshot
				this.currentSnapshot = this.applyDiff(this.currentSnapshot, update)
				this.controller.applySnapshot(this.currentSnapshot)
			}
		})
	}

	/**
	 * Get the latest snapshot that was applied to the controller.
	 */
	getLatestSnapshot(): MicroDOMSnapshot | null {
		return this.currentSnapshot
	}

	/**
	 * Whether the session has received at least one snapshot.
	 */
	get hasSnapshot(): boolean {
		return this.currentSnapshot !== null
	}

	/**
	 * Tear down: unsubscribe from spatial updates and dispose the controller.
	 */
	dispose(): void {
		// Set disposed flag FIRST so in-flight callbacks become no-ops
		this.disposed = true

		if (this.unsubSpatial) {
			this.unsubSpatial()
			this.unsubSpatial = null
		}
		this.controller.dispose()
		this.currentSnapshot = null
		this.started = false
	}

	// -----------------------------------------------------------------------
	// Diff materialization
	// -----------------------------------------------------------------------

	/**
	 * Apply a MicroDOMDiff to the current snapshot, producing a new full snapshot.
	 *
	 * If there's no prior snapshot, the diff's upserted elements become the
	 * full element list (best-effort recovery), but url/title/dpr may be
	 * incomplete — a warning is logged to make this visible.
	 */
	private applyDiff(base: MicroDOMSnapshot | null, diff: MicroDOMDiff): MicroDOMSnapshot {
		if (!base) {
			console.warn(
				'[MirrorSession] Applying diff without a base snapshot — url/title/dpr ' +
					'may be incorrect. This typically means the first message from the hot ' +
					'layer was a diff, not a full snapshot.'
			)
		}

		// Start from existing elements or empty
		const elementMap = new Map<number, SpatialElement>()
		if (base) {
			for (const el of base.elements) {
				elementMap.set(el.id, el)
			}
		}

		// Apply removals
		for (const id of diff.removed) {
			elementMap.delete(id)
		}

		// Apply upserts
		for (const el of diff.upserted) {
			elementMap.set(el.id, el)
		}

		const elements = [...elementMap.values()]

		// Regenerate simplifiedHTML from elements (attributes are escaped to
		// prevent malformed HTML from confusing the LLM's element index parsing).
		const simplifiedHTML = elements
			.map((el) => {
				const attrs: string[] = []
				if (el.inputType) attrs.push(`type="${escapeAttr(el.inputType)}"`)
				if (el.placeholder) attrs.push(`placeholder="${escapeAttr(el.placeholder)}"`)
				if (el.label) attrs.push(`aria-label="${escapeAttr(el.label)}"`)
				if (el.autocomplete) attrs.push(`autocomplete="${escapeAttr(el.autocomplete)}"`)
				if (el.href) attrs.push(`href="${escapeAttr(el.href)}"`)

				const attrStr = attrs.length ? ` ${attrs.join(' ')}` : ''

				if (el.tag === 'input' || el.tag === 'select') {
					return `[${el.id}]<${el.tag}${attrStr} />`
				}
				const label = el.label || el.tag
				return `[${el.id}]<${el.tag}${attrStr}>${label}</${el.tag}>`
			})
			.join('\n')

		return {
			seq: diff.seq,
			ts: diff.ts,
			viewport: diff.viewport ?? base?.viewport ?? { w: 1920, h: 1080 },
			scroll: diff.scroll ?? base?.scroll ?? { x: 0, y: 0 },
			dpr: diff.dpr ?? base?.dpr ?? 1,
			url: diff.url ?? base?.url ?? '',
			title: diff.title ?? base?.title ?? '',
			elements,
			simplifiedHTML,
		}
	}
}
