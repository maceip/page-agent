/**
 * Memory Panel — Side Panel UI for browsing, searching, importing/exporting memories
 */
import {
	Brain,
	ClipboardCopy,
	ClipboardPaste,
	CornerUpLeft,
	Download,
	Search,
	Trash2,
	Upload,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	clearAllMemories,
	deleteMemory,
	getMemoryCount,
	listAllMemories,
	onMemoryEvent,
	recallMemories,
} from '@/lib/memory-store'
import {
	exportAsJSON,
	exportAsText,
	importFromClipboard,
	importFromText,
} from '@/lib/memory-transfer'
import type { Memory } from '@/lib/memory-types'

interface MemoryPanelProps {
	onBack: () => void
}

export function MemoryPanel({ onBack }: MemoryPanelProps) {
	const [memories, setMemories] = useState<Memory[]>([])
	const [count, setCount] = useState(0)
	const [search, setSearch] = useState('')
	const [showImport, setShowImport] = useState(false)
	const [importText, setImportText] = useState('')
	const [importing, setImporting] = useState(false)
	const [statusMessage, setStatusMessage] = useState('')

	const loadMemories = useCallback(async () => {
		if (search.trim()) {
			const results = await recallMemories({ search: search.trim(), limit: 50 })
			setMemories(results)
		} else {
			const all = await listAllMemories()
			setMemories(all.slice(0, 100)) // Cap at 100 for UI performance
		}
		const total = await getMemoryCount()
		setCount(total)
	}, [search])

	useEffect(() => {
		loadMemories()
	}, [loadMemories])

	// Listen for cross-tab memory updates
	useEffect(() => {
		return onMemoryEvent(() => {
			loadMemories()
		})
	}, [loadMemories])

	const showStatus = (msg: string) => {
		setStatusMessage(msg)
		setTimeout(() => setStatusMessage(''), 3000)
	}

	const handleDelete = async (id: string) => {
		await deleteMemory(id)
		await loadMemories()
		showStatus('Memory deleted')
	}

	const handleClearAll = async () => {
		if (!confirm('Delete all memories? This cannot be undone.')) return
		await clearAllMemories()
		await loadMemories()
		showStatus('All memories cleared')
	}

	const handleExportText = async () => {
		const text = exportAsText(memories)
		await navigator.clipboard.writeText(text)
		showStatus(`Copied ${memories.length} memories to clipboard`)
	}

	const handleExportJSON = async () => {
		const json = exportAsJSON(memories)
		await navigator.clipboard.writeText(json)
		showStatus(`Copied ${memories.length} memories as JSON`)
	}

	const handleImport = async () => {
		if (!importText.trim()) return
		setImporting(true)
		try {
			const imported = await importFromText(importText)
			showStatus(`Imported ${imported.length} memories`)
			setImportText('')
			setShowImport(false)
			await loadMemories()
		} catch (err) {
			showStatus(`Import failed: ${err}`)
		} finally {
			setImporting(false)
		}
	}

	const handlePasteImport = async () => {
		setImporting(true)
		try {
			const imported = await importFromClipboard()
			showStatus(`Imported ${imported.length} memories from clipboard`)
			await loadMemories()
		} catch (err) {
			showStatus(`Paste import failed: ${err}`)
		} finally {
			setImporting(false)
		}
	}

	return (
		<div className="flex flex-col h-screen bg-background">
			{/* Header */}
			<header className="flex items-center justify-between border-b px-3 py-2">
				<div className="flex items-center gap-2">
					<Brain className="size-4" />
					<span className="text-sm font-medium">Memory</span>
					<span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
						{count}
					</span>
				</div>
				<Button variant="ghost" size="icon-sm" onClick={onBack} className="cursor-pointer">
					<CornerUpLeft className="size-3.5" />
				</Button>
			</header>

			{/* Status message */}
			{statusMessage && (
				<div className="px-3 py-1.5 bg-muted/50 text-[11px] text-muted-foreground border-b">
					{statusMessage}
				</div>
			)}

			{/* Search */}
			<div className="px-3 py-2 border-b">
				<div className="relative">
					<Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
					<Input
						placeholder="Search memories..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="text-xs h-7 pl-7"
					/>
				</div>
			</div>

			{/* Import dialog */}
			{showImport && (
				<div className="px-3 py-2 border-b bg-muted/30 space-y-2">
					<textarea
						placeholder="Paste memory text here (plain text or JSON)..."
						value={importText}
						onChange={(e) => setImportText(e.target.value)}
						rows={4}
						className="w-full text-xs rounded-md border border-input bg-background px-2 py-1.5 resize-y"
					/>
					<div className="flex gap-2">
						<Button
							size="sm"
							onClick={handleImport}
							disabled={!importText.trim() || importing}
							className="text-xs h-6 cursor-pointer"
						>
							{importing ? 'Importing...' : 'Import'}
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={handlePasteImport}
							disabled={importing}
							className="text-xs h-6 cursor-pointer"
						>
							<ClipboardPaste className="size-3 mr-1" />
							Paste
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => setShowImport(false)}
							className="text-xs h-6 cursor-pointer"
						>
							Cancel
						</Button>
					</div>
				</div>
			)}

			{/* Memory list */}
			<main className="flex-1 overflow-y-auto p-3 space-y-1.5">
				{memories.length === 0 && (
					<div className="text-center text-xs text-muted-foreground py-8">
						{search
							? 'No memories match your search'
							: 'No memories yet. Start using Page Agent to build memory.'}
					</div>
				)}

				{memories.map((mem) => (
					<MemoryCard key={mem.id} memory={mem} onDelete={handleDelete} />
				))}
			</main>

			{/* Actions */}
			<footer className="border-t px-3 py-2 flex gap-1.5">
				<Button
					variant="outline"
					size="sm"
					onClick={() => setShowImport(!showImport)}
					className="text-[10px] h-6 cursor-pointer"
				>
					<Upload className="size-3 mr-1" />
					Import
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={handleExportText}
					disabled={memories.length === 0}
					className="text-[10px] h-6 cursor-pointer"
				>
					<ClipboardCopy className="size-3 mr-1" />
					Copy
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={handleExportJSON}
					disabled={memories.length === 0}
					className="text-[10px] h-6 cursor-pointer"
				>
					<Download className="size-3 mr-1" />
					JSON
				</Button>
				<div className="flex-1" />
				<Button
					variant="ghost"
					size="sm"
					onClick={handleClearAll}
					disabled={memories.length === 0}
					className="text-[10px] h-6 text-destructive cursor-pointer"
				>
					<Trash2 className="size-3" />
				</Button>
			</footer>
		</div>
	)
}

// --- Memory Card Component ---

function MemoryCard({ memory, onDelete }: { memory: Memory; onDelete: (id: string) => void }) {
	const age = timeSince(memory.createdAt)
	const sourceLabel = memory.source.agent !== 'page-agent' ? memory.source.agent : null

	const kindIcons: Record<string, string> = {
		observation: 'o',
		task_result: 'r',
		user_preference: 'p',
		page_snapshot: 's',
		workflow_step: 'w',
	}

	return (
		<div className="group rounded-md border p-2 hover:bg-muted/30 transition-colors">
			<div className="flex items-start gap-1.5">
				{/* Kind indicator */}
				<span
					className="mt-0.5 shrink-0 size-4 rounded text-[8px] font-mono flex items-center justify-center bg-muted text-muted-foreground"
					title={memory.kind}
				>
					{kindIcons[memory.kind] || '?'}
				</span>

				{/* Content */}
				<div className="flex-1 min-w-0">
					<p className="text-[11px] leading-relaxed break-words">
						{memory.content.length > 200 ? memory.content.slice(0, 200) + '...' : memory.content}
					</p>

					{/* Meta */}
					<div className="flex items-center gap-1.5 mt-1 flex-wrap">
						{sourceLabel && (
							<span className="text-[9px] bg-blue-500/10 text-blue-600 px-1 rounded">
								{sourceLabel}
							</span>
						)}
						{memory.tags.map((tag) => (
							<span key={tag} className="text-[9px] bg-muted text-muted-foreground px-1 rounded">
								{tag}
							</span>
						))}
						{memory.consolidated && (
							<span className="text-[9px] bg-green-500/10 text-green-600 px-1 rounded">
								consolidated
							</span>
						)}
						<span className="text-[9px] text-muted-foreground ml-auto">{age}</span>
						{memory.scope !== '*' && (
							<span
								className="text-[9px] text-muted-foreground truncate max-w-[120px]"
								title={memory.scope}
							>
								{shortenUrl(memory.scope)}
							</span>
						)}
					</div>
				</div>

				{/* Delete */}
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={() => onDelete(memory.id)}
					className="opacity-0 group-hover:opacity-100 size-5 shrink-0 cursor-pointer"
				>
					<Trash2 className="size-2.5 text-destructive" />
				</Button>
			</div>
		</div>
	)
}

function timeSince(isoDate: string): string {
	const seconds = Math.floor((Date.now() - Date.parse(isoDate)) / 1000)
	if (seconds < 60) return 'just now'
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
	if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
	return `${Math.floor(seconds / 604800)}w ago`
}

function shortenUrl(url: string): string {
	try {
		const u = new URL(url)
		return u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 20) : '')
	} catch {
		return url.slice(0, 30)
	}
}
