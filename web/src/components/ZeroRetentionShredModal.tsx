import { useState } from 'react'
import { useExportAndPurge } from '@/lib/queries'
import { apiErrorMessage } from '@/lib/api'
import { Button, Spinner } from '@/components/ui'

interface ZeroRetentionShredModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectName?: string
}

export default function ZeroRetentionShredModal({
  isOpen,
  onClose,
  projectId,
  projectName = 'Matter',
}: ZeroRetentionShredModalProps) {
  const exportAndPurge = useExportAndPurge(projectId)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [certificateData, setCertificateData] = useState<{
    certificate_id: string
    timestamp: string
    documents_destroyed: Array<{ filename: string; checksum_sha256: string; size_bytes: number }>
    legal_declaration: string
  } | null>(null)
  const [copiedCert, setCopiedCert] = useState(false)

  if (!isOpen) return null

  async function handleShred() {
    if (!confirmed) return
    setError(null)

    try {
      const result = await exportAndPurge.mutateAsync()
      setCertificateData(result.certificate)

      // Auto-download Certificate of Destruction JSON
      const certBlob = new Blob([JSON.stringify(result.certificate, null, 2)], {
        type: 'application/json',
      })
      const certUrl = URL.createObjectURL(certBlob)
      const certLink = document.createElement('a')
      certLink.href = certUrl
      certLink.download = `Certificate_Of_Destruction_${projectName.replace(/\s+/g, '_')}.json`
      certLink.click()
      URL.revokeObjectURL(certUrl)

      // Auto-download Case Brief Archive summary text
      let archiveText = `CHANDAKTEXT CASE BRIEF ARCHIVE\n`
      archiveText += `MATTER: ${result.archive.project_name}\n`
      archiveText += `PURGE CERTIFICATE ID: ${result.certificate.certificate_id}\n`
      archiveText += `DATE PURGED: ${result.certificate.timestamp}\n\n`
      archiveText += `--- CASE EXCERPTS (${result.archive.excerpts.length}) ---\n`
      for (const exc of result.archive.excerpts) {
        archiveText += `Page ${exc.page_number}: "${exc.text}"\n`
      }
      archiveText += `\n--- CASE NOTES (${result.archive.notes.length}) ---\n`
      for (const note of result.archive.notes) {
        archiveText += `${note.title || 'Note'}: ${note.content}\n`
      }

      const archiveBlob = new Blob([archiveText], { type: 'text/plain' })
      const archiveUrl = URL.createObjectURL(archiveBlob)
      const archiveLink = document.createElement('a')
      archiveLink.href = archiveUrl
      archiveLink.download = `Case_Brief_Archive_${projectName.replace(/\s+/g, '_')}.txt`
      archiveLink.click()
      URL.revokeObjectURL(archiveUrl)
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to purge cloud documents.'))
    }
  }

  function handleCopyCertificate() {
    if (!certificateData) return
    navigator.clipboard.writeText(JSON.stringify(certificateData, null, 2))
    setCopiedCert(true)
    setTimeout(() => setCopiedCert(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-rose-500/40 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-rose-500/30 bg-rose-950/40 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20 text-rose-300 text-xl border border-rose-500/40">
              🔒
            </span>
            <div>
              <h2 className="text-lg font-black text-rose-100">
                Zero-Retention Cloud Shredder ("Burn After Hearing")
              </h2>
              <p className="text-xs text-rose-300/80">
                Attorney-Client Privilege Protocol: Permanent Server File Wipe & Proof of Destruction
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

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-300">
              {error}
            </div>
          )}

          {!certificateData ? (
            <>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
                <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <span>⚠️</span>
                  <span>How Zero-Retention Purge Works</span>
                </h3>
                <ul className="text-xs text-slate-300 space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-rose-400 font-bold">1.</span>
                    <span>
                      <strong>Downloads Complete Local Archive:</strong> Your excerpts, argument notes, and a cryptographic Certificate of Destruction will be saved to your device.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-rose-400 font-bold">2.</span>
                    <span>
                      <strong>Permanent Physical Wipe:</strong> All uploaded petition/pleading PDF files, extracted OCR text, and cached thumbnails will be permanently erased from cloud disks.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-rose-400 font-bold">3.</span>
                    <span>
                      <strong>Storage Quota Freed:</strong> Your chambers cloud storage quota is immediately freed up for new cases.
                    </span>
                  </li>
                </ul>
              </div>

              <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3.5">
                <label className="flex items-start gap-2.5 cursor-pointer text-xs text-amber-200">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="mt-0.5 rounded border-amber-500/40 bg-slate-950 text-amber-500 focus:ring-0"
                  />
                  <span>
                    I confirm that I have prepared my brief and authorize the permanent destruction of all server copies of documents in <strong>{projectName}</strong> pursuant to the Zero-Retention standard.
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button variant="secondary" onClick={onClose} className="text-xs">
                  Cancel
                </Button>
                <Button
                  disabled={!confirmed || exportAndPurge.isPending}
                  onClick={handleShred}
                  className="bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs py-2 shadow-lg"
                >
                  {exportAndPurge.isPending ? (
                    <span className="flex items-center gap-2">
                      <Spinner />
                      <span>Shredding Cloud Files…</span>
                    </span>
                  ) : (
                    '🔥 Confirm & Shred Cloud Copies'
                  )}
                </Button>
              </div>
            </>
          ) : (
            /* Certificate of Destruction Displayed */
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-500/50 bg-emerald-950/30 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">✓</span>
                    <h3 className="text-sm font-bold text-emerald-300">
                      Cloud Purge Complete — 0 Bytes Retained
                    </h3>
                  </div>
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-300 border border-emerald-500/40">
                    VERIFIED PURGE
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {certificateData.legal_declaration}
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs space-y-2">
                <div className="flex justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Certificate ID:</span>
                  <span className="text-amber-300 font-bold">{certificateData.certificate_id}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Timestamp:</span>
                  <span className="text-slate-200">{certificateData.timestamp}</span>
                </div>
                <div className="pt-1">
                  <span className="text-slate-400 block mb-1">Destroyed Document Hashes:</span>
                  {certificateData.documents_destroyed.map((d, i) => (
                    <div key={i} className="text-[11px] text-slate-300 truncate">
                      • {d.filename} ({d.size_bytes} bytes) — SHA-256: <span className="text-cyan-300">{d.checksum_sha256}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleCopyCertificate}
                  className="flex items-center gap-1 rounded bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 font-medium"
                >
                  <span>{copiedCert ? '✓ Copied!' : '📋 Copy Certificate'}</span>
                </button>
                <Button onClick={onClose} className="text-xs">
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
