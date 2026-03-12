import { BookOpen, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { siGithub } from 'simple-icons'
import { Link } from 'wouter'

import ThemeSwitcher from './ThemeSwitcher'

export default function Header() {
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

	return (
		<>
			<header
				className="relative z-50 bg-white/80 dark:bg-stone-900/80 backdrop-blur-md border-b border-stone-200 dark:border-stone-700"
				role="banner"
			>
				<div className="max-w-7xl mx-auto px-6 py-4">
					<div className="flex items-center justify-between gap-2">
						{/* Logo */}
						<Link
							href="/"
							className="flex items-center gap-2 sm:gap-3 group shrink-0"
							aria-label="page-agent home"
							onClick={() => setMobileMenuOpen(false)}
						>
							<div>
								<span className="text-base sm:text-xl font-bold font-mono text-stone-900 dark:text-stone-100 block leading-tight">
									page-agent
								</span>
								<p className="hidden sm:block text-xs text-stone-500 dark:text-stone-400 font-mono">
									browser agent
								</p>
							</div>
						</Link>

						{/* Mobile Icon Navigation */}
						<nav
							className="md:hidden flex items-center gap-1 overflow-x-auto scrollbar-hide flex-1"
							role="navigation"
							aria-label="Mobile navigation"
						>
							<Link
								href="/docs/introduction/overview"
								className="p-2 rounded-lg text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-stone-100 transition-colors duration-200 shrink-0"
								aria-label="Docs"
							>
								<BookOpen className="w-5 h-5" />
							</Link>
							<a
								href="https://github.com/maceip/page-agent"
								target="_blank"
								rel="noopener noreferrer"
								className="p-2 rounded-lg text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-stone-100 transition-colors duration-200 shrink-0"
								aria-label="GitHub"
							>
								<svg
									role="img"
									viewBox="0 0 24 24"
									className="w-5 h-5 fill-current"
									aria-hidden="true"
								>
									<path d={siGithub.path} />
								</svg>
							</a>
						</nav>

						{/* Desktop Navigation */}
						<nav
							className="hidden md:flex items-center space-x-6"
							role="navigation"
							aria-label="Main navigation"
						>
							<span className="text-xs font-mono text-stone-400 dark:text-stone-500 tabular-nums before:content-['v']">
								{import.meta.env.VERSION}
							</span>
							<Link
								href="/docs/introduction/overview"
								className="flex items-center gap-1.5 text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors duration-200"
							>
								<BookOpen className="w-4 h-4" />
								Docs
							</Link>
							<a
								href="https://github.com/maceip/page-agent"
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1.5 text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors duration-200"
								aria-label="GitHub"
							>
								<svg
									role="img"
									viewBox="0 0 24 24"
									className="w-4 h-4 fill-current"
									aria-hidden="true"
								>
									<path d={siGithub.path} />
								</svg>
								GitHub
							</a>
							<ThemeSwitcher />
						</nav>

						{/* Mobile menu button */}
						<button
							type="button"
							className="md:hidden p-2 rounded-lg text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors duration-200 shrink-0"
							aria-label="Open navigation"
							aria-expanded={mobileMenuOpen}
							aria-controls="mobile-menu"
							onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
						>
							{mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
						</button>
					</div>

					{/* Mobile Navigation */}
					{mobileMenuOpen && (
						<nav
							id="mobile-menu"
							className="md:hidden pt-4 pb-2 space-y-3 border-t border-stone-200 dark:border-stone-700 mt-4"
							role="navigation"
						>
							<Link
								href="/docs/introduction/overview"
								className="flex items-center gap-2 px-3 py-2 rounded-lg text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-stone-100 transition-colors duration-200"
								onClick={() => setMobileMenuOpen(false)}
							>
								<BookOpen className="w-5 h-5" />
								Docs
							</Link>
							<a
								href="https://github.com/maceip/page-agent"
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-2 px-3 py-2 rounded-lg text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-stone-100 transition-colors duration-200"
								aria-label="GitHub"
							>
								<svg
									role="img"
									viewBox="0 0 24 24"
									className="w-5 h-5 fill-current"
									aria-hidden="true"
								>
									<path d={siGithub.path} />
								</svg>
								GitHub
							</a>
							<div className="flex items-center gap-3 px-3 py-2">
								<ThemeSwitcher />
							</div>
						</nav>
					)}
				</div>
			</header>
		</>
	)
}
