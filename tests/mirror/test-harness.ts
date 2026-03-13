import type {
	DomMutation,
	HotLayerMetrics,
	IHotLayer,
	RemoteInputEvent,
	ScrollState,
	VisualHandoffRequest,
} from '../../packages/mirror/src/layers/hot'
import type {
	DiffFrame,
	HotLayerConfig,
	LayerSyncStatus,
	MicroDOMDiff,
	MicroDOMSnapshot,
	SpatialElement,
	TauriWindowState,
	VisualFrame,
} from '../../packages/mirror/src/types'
import type { BrowserState } from '../../packages/page-controller/src/PageController'

export class HotLayerHarness implements IHotLayer {
	status: LayerSyncStatus = 'idle'
	inputEvents: RemoteInputEvent[] = []

	private latestSnapshot: MicroDOMSnapshot | null = null
	private frameHandlers = new Set<(frame: VisualFrame | DiffFrame) => void>()
	private spatialHandlers = new Set<(update: MicroDOMSnapshot | MicroDOMDiff) => void>()

	async initialize(): Promise<void> {
		this.status = 'synced'
	}

	onFrame(handler: (frame: VisualFrame | DiffFrame) => void): () => void {
		this.frameHandlers.add(handler)
		return () => this.frameHandlers.delete(handler)
	}

	onSpatialMapUpdate(handler: (update: MicroDOMSnapshot | MicroDOMDiff) => void): () => void {
		this.spatialHandlers.add(handler)
		return () => this.spatialHandlers.delete(handler)
	}

	async captureFrame(): Promise<VisualFrame> {
		return {
			seq: this.latestSnapshot?.seq ?? 0,
			timestamp: new Date().toISOString(),
			format: 'png',
			data: new ArrayBuffer(0),
			viewport: {
				width: this.latestSnapshot?.viewport.w ?? 1280,
				height: this.latestSnapshot?.viewport.h ?? 720,
			},
			browserState: await this.getRemoteBrowserState(),
		}
	}

	async getRemoteBrowserState(): Promise<BrowserState> {
		const snapshot = this.latestSnapshot
		if (!snapshot) {
			return {
				url: '',
				title: '',
				header: '[No snapshot available]',
				content: '<EMPTY>',
				footer: '[End of page]',
			}
		}
		return {
			url: snapshot.url,
			title: snapshot.title,
			header: `Current Page: [${snapshot.title}](${snapshot.url})`,
			content: snapshot.simplifiedHTML,
			footer: '[End of page]',
		}
	}

	getSpatialMap(): SpatialElement[] {
		return this.latestSnapshot?.elements ?? []
	}

	getLatestSnapshot(): MicroDOMSnapshot | null {
		return this.latestSnapshot
	}

	async pushDomMutations(_mutations: DomMutation[]): Promise<void> {}

	async pushScrollState(_state: ScrollState): Promise<void> {}

	async sendInputEvent(event: RemoteInputEvent): Promise<void> {
		this.inputEvents.push(event)
	}

	async initiateHandoff(_request: VisualHandoffRequest): Promise<void> {}

	getWindowState(): TauriWindowState {
		return {
			localVisible: true,
			canvasOverlayActive: false,
			inputProjectionActive: false,
			overlayOpacity: 0,
		}
	}

	async refreshProjectedInputs(): Promise<void> {}

	async updateConfig(_config: Partial<HotLayerConfig>): Promise<void> {}

	getMetrics(): HotLayerMetrics {
		return {
			currentFps: 60,
			avgLatencyMs: 2,
			bandwidthKbps: 3000,
			droppedFrames: 0,
			totalFrames: 0,
			differentialActive: true,
			activeCodec: 'av1',
			unreliableDatagrams: true,
			spatialMapUpdates: 0,
			projectedInputCount: 0,
		}
	}

	pause(): void {}

	resume(): void {}

	async dispose(): Promise<void> {
		this.status = 'idle'
		this.frameHandlers.clear()
		this.spatialHandlers.clear()
	}

	emitSnapshot(snapshot: MicroDOMSnapshot): void {
		this.latestSnapshot = snapshot
		for (const handler of this.spatialHandlers) {
			handler(snapshot)
		}
	}

	emitDiff(diff: MicroDOMDiff): void {
		for (const handler of this.spatialHandlers) {
			handler(diff)
		}
	}
}

export function createSpatialElement(
	id: number,
	overrides: Partial<SpatialElement> = {}
): SpatialElement {
	return {
		id,
		rect: { x: id * 5, y: id * 4, w: 120, h: 24 },
		role: 'input',
		tag: 'input',
		zOrder: id,
		inViewport: true,
		inputType: 'text',
		placeholder: `field-${id}`,
		label: `Field ${id}`,
		...overrides,
	}
}

export function createSnapshot(
	seq: number,
	elements: SpatialElement[],
	overrides: Partial<MicroDOMSnapshot> = {}
): MicroDOMSnapshot {
	const simplifiedHTML = elements.map((el) => `[${el.id}]<${el.tag} />`).join('\n')
	return {
		seq,
		ts: Date.now(),
		viewport: { w: 1280, h: 720 },
		scroll: { x: 0, y: 0 },
		dpr: 1,
		url: 'https://example.com',
		title: 'Example',
		elements,
		simplifiedHTML,
		...overrides,
	}
}
