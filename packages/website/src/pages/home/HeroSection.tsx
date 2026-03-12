import { ArrowRight, BookOpen, ExternalLink } from 'lucide-react'

export default function HeroSection() {
	return (
		<section className="relative px-6 pt-24 pb-20 lg:pt-32 lg:pb-24" aria-labelledby="hero-heading">
			<div className="max-w-4xl mx-auto">
				<div className="mb-6">
					<span className="inline-block px-3 py-1 text-xs font-mono tracking-wide text-stone-500 border border-stone-300 rounded-full">
						v0 — open source
					</span>
				</div>

				<h1
					id="hero-heading"
					className="text-4xl sm:text-5xl lg:text-6xl font-bold text-stone-900 tracking-tight leading-[1.1] mb-6"
				>
					A browser agent that
					<br />
					lives in the page.
				</h1>

				<p className="text-lg lg:text-xl text-stone-500 max-w-2xl leading-relaxed mb-10">
					One script tag. No server, no headless browser, no Python. Runs in the user's real browser
					with built-in stealth — peekaboo self-removal, chameleon anti-fingerprinting, and
					three-layer remote sync.
				</p>

				{/* Code snippet */}
				<div className="mb-10 max-w-xl">
					<div className="bg-stone-950 rounded-lg overflow-hidden">
						<div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-stone-800">
							<span className="w-2.5 h-2.5 rounded-full bg-stone-700" />
							<span className="w-2.5 h-2.5 rounded-full bg-stone-700" />
							<span className="w-2.5 h-2.5 rounded-full bg-stone-700" />
							<span className="ml-3 text-xs text-stone-500 font-mono">index.html</span>
						</div>
						<pre className="px-4 py-4 text-sm font-mono text-stone-300 overflow-x-auto">
							<code>{`<script src="https://cdn.jsdelivr.net/npm/page-agent/dist/index.js"></script>`}</code>
						</pre>
					</div>
				</div>

				{/* Feature bullets */}
				<ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-stone-500 mb-10" role="list">
					<li className="flex items-center gap-2">
						<span className="w-1 h-1 bg-stone-400 rounded-full" aria-hidden="true" />
						Always-on
					</li>
					<li className="flex items-center gap-2">
						<span className="w-1 h-1 bg-stone-400 rounded-full" aria-hidden="true" />
						Stealth (peekaboo + chameleon)
					</li>
					<li className="flex items-center gap-2">
						<span className="w-1 h-1 bg-stone-400 rounded-full" aria-hidden="true" />
						Cross-device
					</li>
					<li className="flex items-center gap-2">
						<span className="w-1 h-1 bg-stone-400 rounded-full" aria-hidden="true" />
						No server needed
					</li>
					<li className="flex items-center gap-2">
						<span className="w-1 h-1 bg-stone-400 rounded-full" aria-hidden="true" />
						BYOLLM
					</li>
				</ul>

				{/* CTAs */}
				<div className="flex flex-wrap gap-4">
					<a
						href="/docs"
						className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-800 transition-colors"
					>
						<BookOpen className="w-4 h-4" />
						Read the docs
						<ArrowRight className="w-3.5 h-3.5" />
					</a>
					<a
						href="https://github.com/maceip/page-agent"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-stone-700 bg-white border border-stone-300 rounded-lg hover:border-stone-400 hover:bg-stone-50 transition-colors"
					>
						<ExternalLink className="w-4 h-4" />
						View on GitHub
					</a>
				</div>
			</div>
		</section>
	)
}
