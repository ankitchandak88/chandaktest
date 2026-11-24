import { useState, useRef, useEffect } from 'react'
import type { Workspace } from '@/types/api'
import { useCreateWorkspace, useUpdateWorkspace, useDeleteWorkspace } from '@/lib/queries'

interface WorkspaceBoardTabsProps {
  projectId: string
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelectWorkspace: (id: string) => void
  totalCardsOnCanvas?: number
}

const PRESET_COLORS = [
  { name: 'Blue', hex: '#3b82f6', bg: 'bg-blue-500', border: 'border-blue-500', text: 'text-blue-500' },
  { name: 'Emerald', hex: '#10b981', bg: 'bg-emerald-500', border: 'border-emerald-500', text: 'text-emerald-500' },
  { name: 'Amber', hex: '#f59e0b', bg: 'bg-amber-500', border: 'border-amber-500', text: 'text-amber-500' },
  { name: 'Purple', hex: '#8b5cf6', bg: 'bg-purple-500', border: 'border-purple-500', text: 'text-purple-500' },
  { name: 'Rose', hex: '#f43f5e', bg: 'bg-rose-500', border: 'border-rose-500', text: 'text-rose-500' },
  { name: 'Cyan', hex: '#06b6d4', bg: 'bg-cyan-500', border: 'border-cyan-500', text: 'text-cyan-500' },
  { name: 'Slate', hex: '#64748b', bg: 'bg-slate-500', border: 'border-slate-500', text: 'text-slate-500' },
]

export default function WorkspaceBoardTabs({
  projectId,
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  totalCardsOnCanvas,
}: WorkspaceBoardTabsProps) {
  const [showNewModal, setShowNewModal] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const [newBoardColor, setNewBoardColor] = useState(PRESET_COLORS[0].hex)
  
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null)
  const [editBoardName, setEditBoardName] = useState('')
  const [editBoardColor, setEditBoardColor] = useState('')
  
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const menuRef = useRef<HTMLDivElement>(null)

  const createWorkspace = useCreateWorkspace(projectId)
  const updateWorkspace = useUpdateWorkspace(projectId)
  const deleteWorkspace = useDeleteWorkspace(projectId)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenuId(null)
      }
    }
    if (activeMenuId) {
      window.addEventListener('mousedown', handleClickOutside)
      return () => window.removeEventListener('mousedown', handleClickOutside)
    }
  }, [activeMenuId])

  const handleCreateBoard = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newBoardName.trim()) return

    try {
      const created = await createWorkspace.mutateAsync({
        name: newBoardName.trim(),
        color: newBoardColor,
      })
      setNewBoardName('')
      setShowNewModal(false)
      if (created?.id) {
        onSelectWorkspace(created.id)
      }
    } catch (err) {
      console.error('Failed to create workspace board:', err)
    }
  }

  const handleUpdateBoard = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingWorkspace || !editBoardName.trim()) return

    try {
      await updateWorkspace.mutateAsync({
        workspaceId: editingWorkspace.id,
        data: {
          name: editBoardName.trim(),
          color: editBoardColor,
        },
      })
      setEditingWorkspace(null)
    } catch (err) {
      console.error('Failed to update workspace board:', err)
    }
  }

  const handleDeleteBoard = async (workspaceId: string) => {
    if (workspaces.length <= 1) {
      alert('A project must have at least one workspace board.')
      return
    }

    try {
      await deleteWorkspace.mutateAsync(workspaceId)
      setDeleteConfirmId(null)
      setActiveMenuId(null)

      // If we just deleted the active workspace, switch to another
      if (activeWorkspaceId === workspaceId) {
        const remaining = workspaces.filter((w) => w.id !== workspaceId)
        if (remaining.length > 0) {
          onSelectWorkspace(remaining[0].id)
        }
      }
    } catch (err) {
      console.error('Failed to delete workspace board:', err)
    }
  }

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 text-xs select-none backdrop-blur-xs overflow-x-auto scrollbar-none z-20">
      <div className="flex items-center gap-1 text-slate-400 font-semibold uppercase tracking-wider text-[10px] mr-1.5 shrink-0">
        <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <span>Boards:</span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {workspaces.map((ws) => {
          const isActive = ws.id === activeWorkspaceId
          const wsColor = ws.color || '#3b82f6'
          const count = isActive && totalCardsOnCanvas !== undefined ? totalCardsOnCanvas : ws.items_count ?? 0

          return (
            <div
              key={ws.id}
              className={`group relative flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-all cursor-pointer ${
                isActive
                  ? 'bg-slate-800 text-white shadow-sm ring-1 ring-slate-700/80 font-medium'
                  : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
              onClick={() => onSelectWorkspace(ws.id)}
            >
              {/* Color indicator dot */}
              <span
                className="w-2 h-2 rounded-full shrink-0 shadow-xs"
                style={{ backgroundColor: wsColor }}
              />

              {/* Title */}
              <span className="truncate max-w-[130px]">{ws.name}</span>

              {/* Cards badge */}
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-semibold tabular-nums ${
                  isActive ? 'bg-slate-700/80 text-slate-200' : 'bg-slate-800/80 text-slate-500'
                }`}
              >
                {count}
              </span>

              {/* Board 3-dots action menu */}
              <button
                type="button"
                className={`p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors ${
                  isActive ? 'opacity-70 group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                title="Board Options"
                onClick={(e) => {
                  e.stopPropagation()
                  setActiveMenuId(activeMenuId === ws.id ? null : ws.id)
                }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </button>

              {/* Popover Action Menu */}
              {activeMenuId === ws.id && (
                <div
                  ref={menuRef}
                  className="absolute left-0 top-full mt-1.5 w-44 rounded-xl border border-slate-700 bg-slate-800/95 py-1.5 text-xs text-slate-200 shadow-xl backdrop-blur-md z-50 animate-in fade-in zoom-in-95 duration-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-3 py-1 font-semibold text-[11px] text-slate-400 border-b border-slate-700/60 flex items-center justify-between">
                    <span>Board Options</span>
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: wsColor }} />
                  </div>

                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-700/70 text-left transition-colors"
                    onClick={() => {
                      setEditingWorkspace(ws)
                      setEditBoardName(ws.name)
                      setEditBoardColor(ws.color || '#3b82f6')
                      setActiveMenuId(null)
                    }}
                  >
                    <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                    <span>Rename & Color</span>
                  </button>

                  {workspaces.length > 1 && (
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-rose-950/40 text-rose-400 hover:text-rose-300 text-left transition-colors"
                      onClick={() => {
                        setDeleteConfirmId(ws.id)
                        setActiveMenuId(null)
                      }}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      <span>Delete Board</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add New Board button */}
      <button
        type="button"
        className="flex items-center gap-1 rounded-lg border border-dashed border-slate-700 px-2 py-1 text-slate-400 hover:border-slate-600 hover:text-slate-200 hover:bg-slate-800/40 transition-colors shrink-0 font-medium"
        onClick={() => {
          setNewBoardName('')
          setNewBoardColor(PRESET_COLORS[workspaces.length % PRESET_COLORS.length].hex)
          setShowNewModal(true)
        }}
        title="Add new workspace board"
      >
        <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
        </svg>
        <span>New Board</span>
      </button>

      {/* New Board Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl text-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-white mb-1">Create Workspace Board</h3>
            <p className="text-xs text-slate-400 mb-4">
              Organize excerpts, notes, and evidence into separate themed boards (LiquidText Lesson 7).
            </p>

            <form onSubmit={handleCreateBoard} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Board Name
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Chronology, Cross Examination, Exhibits"
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Accent Color
                </label>
                <div className="flex items-center gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setNewBoardColor(c.hex)}
                      className={`w-6 h-6 rounded-full transition-transform ${
                        newBoardColor === c.hex ? 'scale-125 ring-2 ring-white ring-offset-2 ring-offset-slate-900' : 'hover:scale-110 opacity-80 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c.hex }}
                      title={c.name}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="rounded-xl px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newBoardName.trim() || createWorkspace.isPending}
                  className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  {createWorkspace.isPending ? 'Creating...' : 'Create Board'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Board Modal */}
      {editingWorkspace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl text-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-white mb-1">Edit Board</h3>
            <p className="text-xs text-slate-400 mb-4">
              Update board title and accent color.
            </p>

            <form onSubmit={handleUpdateBoard} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Board Name
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={editBoardName}
                  onChange={(e) => setEditBoardName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Accent Color
                </label>
                <div className="flex items-center gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setEditBoardColor(c.hex)}
                      className={`w-6 h-6 rounded-full transition-transform ${
                        editBoardColor === c.hex ? 'scale-125 ring-2 ring-white ring-offset-2 ring-offset-slate-900' : 'hover:scale-110 opacity-80 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c.hex }}
                      title={c.name}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingWorkspace(null)}
                  className="rounded-xl px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!editBoardName.trim() || updateWorkspace.isPending}
                  className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  {updateWorkspace.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl border border-rose-900/60 bg-slate-900 p-5 shadow-2xl text-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-rose-400 mb-1">Delete Board?</h3>
            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Are you sure you want to delete this workspace board? Cards placed on this board will be removed from this board view.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="rounded-xl px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteWorkspace.isPending}
                onClick={() => handleDeleteBoard(deleteConfirmId)}
                className="rounded-xl bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-rose-500 disabled:opacity-50 transition-colors"
              >
                {deleteWorkspace.isPending ? 'Deleting...' : 'Delete Board'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
