import { EyeOff, Fingerprint, Layers, Terminal } from 'lucide-react'

const features = [
	{
		icon: EyeOff,
		title: 'Peekaboo Mode',
		subtitle: 'Self-removal from detection',
		description:
			'Detects fingerprinting attempts — FingerprintJS, BotD, DataDome, and others — then withdraws all traces from the DOM before they can be sampled. Re-injects when the coast is clear.',
		detail: 'State machine: monitoring \u2192 withdrawing \u2192 withdrawn.',
	},
	{
		icon: Fingerprint,
		title: 'Chameleon Engine',
		subtitle: 'Anti-fingerprinting',
		description:
			'Namespace randomization makes injected CSS classes look like a11y frameworks. Log-normal timing jitter mimics human reaction times. navigator.webdriver normalization. DOM footprint minimization.',
		detail: null,
	},
	{
		icon: Layers,
		title: 'Mirror Architecture',
		subtitle: 'Three-layer remote browser sync',
		description:
			'Cold layer: Tauri bootstrapper + Chrome profile sync (<10MB zstd). Warm layer: CDP event bus + credential replication + navigation proxy. Hot layer: MoQ pipeline with AV1 pixel streaming + spatial DOM extraction.',
		detail: null,
	},
	{
		icon: Terminal,
		title: 'Zero Infrastructure',
		subtitle: 'One script tag',
		description:
			"No Python, no headless browser, no server. Runs in the user's actual browser. Bring any OpenAI-compatible LLM — GPT-4o, Claude, DeepSeek, Qwen, or fully offline via Ollama.",
		detail: null,
	},
]

export default function FeaturesSection() {
	return (
		<section className="px-6 py-20" aria-labelledby="features-heading">
			<div className="max-w-5xl mx-auto">
				<h2
					id="features-heading"
					className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight mb-2"
				>
					Built different.
				</h2>
				<p className="text-stone-500 mb-12 max-w-lg">
					Not another wrapper around Playwright. This runs where your users are — in the real
					browser, with built-in stealth.
				</p>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-5">
					{features.map((feature) => {
						const Icon = feature.icon
						return (
							<div
								key={feature.title}
								className="border border-stone-200 rounded-xl bg-white p-6 hover:border-stone-300 transition-colors"
							>
								<div className="flex items-start gap-4 mb-4">
									<div className="shrink-0 w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center">
										<Icon className="w-5 h-5 text-stone-600" strokeWidth={1.5} />
									</div>
									<div>
										<h3 className="font-semibold text-stone-900 text-lg leading-tight">
											{feature.title}
										</h3>
										<span className="text-xs font-mono text-stone-400 tracking-wide">
											{feature.subtitle}
										</span>
									</div>
								</div>
								<p className="text-sm text-stone-500 leading-relaxed">{feature.description}</p>
								{feature.detail && (
									<p className="mt-3 text-xs font-mono text-stone-400">{feature.detail}</p>
								)}
							</div>
						)
					})}
				</div>
			</div>
		</section>
	)
}
