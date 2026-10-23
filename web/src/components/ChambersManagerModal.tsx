import { useState, type FormEvent } from 'react'
import {
  useAddOrganizationMember,
  useCurrentOrganization,
  useOrganizationMembers,
  useRemoveOrganizationMember,
} from '@/lib/queries'
import { apiErrorMessage } from '@/lib/api'
import { Button, Spinner } from '@/components/ui'

interface ChambersManagerModalProps {
  isOpen: boolean
  onClose: () => void
  onOpenPlans: () => void
}

export default function ChambersManagerModal({ isOpen, onClose, onOpenPlans }: ChambersManagerModalProps) {
  const { data: orgData, isLoading: loadingOrg } = useCurrentOrganization()
  const { data: membersData, isLoading: loadingMembers } = useOrganizationMembers()
  const addMember = useAddOrganizationMember()
  const removeMember = useRemoveOrganizationMember()

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState('associate')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  if (!isOpen) return null

  const org = orgData?.data
  const members = membersData?.data ?? []
  const seats = membersData?.seats ?? { used: members.length, limit: 1 }

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      await addMember.mutateAsync({
        email: inviteEmail.trim(),
        name: inviteName.trim() || undefined,
        role: inviteRole,
      })
      setSuccessMessage(`✓ Colleague ${inviteEmail} invited to Chambers successfully!`)
      setInviteEmail('')
      setInviteName('')
      setInviteRole('associate')
    } catch (err) {
      setErrorMessage(apiErrorMessage(err, 'Could not add member to Chambers.'))
    }
  }

  async function handleRemove(membershipId: string, memberName: string) {
    if (!confirm(`Are you sure you want to remove ${memberName} from this Chambers workspace?`)) return
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      await removeMember.mutateAsync(membershipId)
      setSuccessMessage(`Member removed from Chambers.`)
    } catch (err) {
      setErrorMessage(apiErrorMessage(err, 'Could not remove member.'))
    }
  }

  function roleBadge(role: string) {
    switch (role.toLowerCase()) {
      case 'owner':
        return <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300 border border-amber-500/30">👑 Senior Partner</span>
      case 'partner':
        return <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-bold text-purple-300 border border-purple-500/30">⚖️ Partner Advocate</span>
      case 'associate':
        return <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-xs font-bold text-cyan-300 border border-cyan-500/30">📜 Associate</span>
      case 'junior':
        return <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300 border border-emerald-500/30">🎓 Junior Advocate</span>
      case 'clerk':
        return <span className="rounded bg-slate-500/20 px-2 py-0.5 text-xs font-bold text-slate-300 border border-slate-500/30">📋 Court Clerk</span>
      default:
        return <span className="rounded bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-300">Member</span>
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏛️</span>
            <div>
              <h2 className="text-lg font-bold text-slate-100">
                {org?.name ?? 'Advocate Chambers & Law Firm'}
              </h2>
              <p className="text-xs text-slate-400">
                Manage advocate colleagues, associates, juniors & courtroom seat quotas
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            ✕
          </button>
        </div>

        {/* Plan / Seat Quota Meter */}
        <div className="border-b border-slate-800 bg-slate-900/60 px-6 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-xs text-slate-400">Firm Subscription:</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="rounded bg-cyan-500/20 px-2.5 py-0.5 text-xs font-bold text-cyan-300 border border-cyan-500/30">
                  {org?.subscription?.plan?.name ?? 'Solo Advocate (Starter)'}
                </span>
                <span className="text-xs text-slate-400">
                  ({seats.used} / {seats.limit} Seats Used)
                </span>
              </div>
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              onClose()
              onOpenPlans()
            }}
            className="border-amber-500/40 text-amber-300 hover:bg-amber-500/20 text-xs py-1"
          >
            ⭐ Upgrade Chambers / Add Seats
          </Button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loadingOrg || loadingMembers ? (
            <div className="py-12 flex justify-center">
              <Spinner />
            </div>
          ) : (
            <>
              {errorMessage && (
                <div className="rounded-md border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-300">
                  {errorMessage}
                </div>
              )}
              {successMessage && (
                <div className="rounded-md border border-emerald-500/40 bg-emerald-950/40 p-3 text-xs text-emerald-300">
                  {successMessage}
                </div>
              )}

              {/* Invite Form */}
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
                  <span>➕</span>
                  <span>Invite Advocate, Associate or Junior to Chambers</span>
                </h3>
                <form onSubmit={handleInvite} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-5">
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      Email Address *
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="advocate@chandaklaw.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      Full Name (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Adv. Rajesh Sharma"
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      Role / Designation
                    </label>
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                    >
                      <option value="partner">⚖️ Partner</option>
                      <option value="associate">📜 Associate</option>
                      <option value="junior">🎓 Junior / Intern</option>
                      <option value="clerk">📋 Clerk / Steno</option>
                      <option value="owner">👑 Senior Partner</option>
                    </select>
                  </div>
                  <div className="sm:col-span-12 flex justify-end">
                    <Button
                      type="submit"
                      disabled={addMember.isPending || !inviteEmail.trim()}
                      className="text-xs"
                    >
                      {addMember.isPending ? 'Inviting…' : 'Send Chambers Invite'}
                    </Button>
                  </div>
                </form>
              </div>

              {/* Members List */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-200">
                    Chambers Team Members ({members.length})
                  </h3>
                  <span className="text-xs text-slate-400">
                    Quota: {seats.used} of {seats.limit} seats
                  </span>
                </div>

                <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 bg-slate-900/80 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-2.5">Advocate / Member</th>
                        <th className="px-4 py-2.5">Email</th>
                        <th className="px-4 py-2.5">Designation</th>
                        <th className="px-4 py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {members.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-900/40 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-200 flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300">
                              {m.user?.name?.charAt(0) ?? 'A'}
                            </div>
                            <span>{m.user?.name ?? 'Advocate'}</span>
                          </td>
                          <td className="px-4 py-3 text-slate-400">{m.user?.email}</td>
                          <td className="px-4 py-3">{roleBadge(m.role)}</td>
                          <td className="px-4 py-3 text-right">
                            {m.role !== 'owner' ? (
                              <button
                                onClick={() => handleRemove(m.id, m.user?.name || m.user?.email)}
                                className="text-xs text-red-400 hover:text-red-300 hover:underline"
                              >
                                Remove
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-500">Firm Owner</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950 px-6 py-3">
          <p className="text-[11px] text-slate-500">
            All invited advocates get instant access to case matters & shared trial preparation.
          </p>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
