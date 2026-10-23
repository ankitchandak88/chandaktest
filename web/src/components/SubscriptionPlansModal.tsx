import { useState } from 'react'
import {
  useBillingPlans,
  useCurrentOrganization,
  useUpgradeSubscription,
} from '@/lib/queries'
import { api, apiErrorMessage } from '@/lib/api'
import { Button, Spinner } from '@/components/ui'

interface SubscriptionPlansModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function SubscriptionPlansModal({ isOpen, onClose }: SubscriptionPlansModalProps) {
  const { isLoading: loadingPlans } = useBillingPlans()
  const { data: orgData, refetch: refetchOrg } = useCurrentOrganization()
  const upgradeSubscription = useUpgradeSubscription()

  const [upgradingCode, setUpgradingCode] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  if (!isOpen) return null

  const currentPlanCode = orgData?.data?.subscription?.plan?.code ?? 'free'

  async function handleSelectPlan(planCode: string) {
    if (planCode === currentPlanCode) return
    setUpgradingCode(planCode)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      const checkout = await upgradeSubscription.mutateAsync(planCode)
      // If we are in local development / fake gateway mode, simulate checkout right away!
      if (checkout.subscription_id) {
        try {
          await api.get(`/billing/fake/simulate/${checkout.subscription_id}`)
          await refetchOrg()
          setSuccessMessage(`✓ Congratulations! Your firm has been upgraded to ${planCode.toUpperCase()} plan!`)
          setUpgradingCode(null)
          return
        } catch {
          // If simulation fails, fall through to redirect
        }
      }

      if (checkout.checkout_url) {
        window.location.href = checkout.checkout_url
      }
    } catch (err) {
      setErrorMessage(apiErrorMessage(err, 'Failed to start upgrade checkout.'))
      setUpgradingCode(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4">
      <div className="w-full max-w-4xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">⚖️</span>
              <h2 className="text-xl font-black text-slate-100">
                Advocate Chambers & Law Firm Subscription Plans
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Select the plan tailored for your court practice, senior advocate chambers, or multi-partner law firm.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            ✕
          </button>
        </div>

        {/* Plan Cards Container */}
        <div className="flex-1 overflow-y-auto p-6">
          {errorMessage && (
            <div className="mb-4 rounded-md border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-300">
              {errorMessage}
            </div>
          )}
          {successMessage && (
            <div className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-950/40 p-3 text-xs text-emerald-300">
              {successMessage}
            </div>
          )}

          {loadingPlans ? (
            <div className="py-16 flex justify-center">
              <Spinner />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Solo Advocate Plan */}
              <div
                className={`relative flex flex-col justify-between rounded-xl border p-5 transition-all ${
                  currentPlanCode === 'free'
                    ? 'border-cyan-500/60 bg-cyan-950/20 shadow-lg shadow-cyan-950/40'
                    : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                }`}
              >
                {currentPlanCode === 'free' && (
                  <span className="absolute -top-3 left-4 rounded-full bg-cyan-500 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-950 shadow">
                    Active Plan
                  </span>
                )}
                <div>
                  <h3 className="text-base font-bold text-slate-100">Solo Advocate</h3>
                  <p className="mt-0.5 text-xs text-slate-400">Individual Court Practice</p>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold text-slate-100">Free</span>
                  </div>

                  <ul className="mt-5 space-y-2.5 text-xs text-slate-300">
                    <li className="flex items-center gap-2">
                      <span className="text-cyan-400">✓</span>
                      <span><strong>1 Advocate Seat</strong></span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-cyan-400">✓</span>
                      <span><strong>5 Active Cases</strong></span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-cyan-400">✓</span>
                      <span><strong>1 GB</strong> Cloud Paper Storage</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-cyan-400">✓</span>
                      <span>Court Paper Mode & Font Scaler</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-cyan-400">✓</span>
                      <span>1-Tap Court Citation Copier</span>
                    </li>
                  </ul>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-800">
                  <Button
                    variant="secondary"
                    disabled={currentPlanCode === 'free'}
                    onClick={() => handleSelectPlan('free')}
                    className="w-full text-xs"
                  >
                    {currentPlanCode === 'free' ? 'Current Plan' : 'Downgrade to Free'}
                  </Button>
                </div>
              </div>

              {/* Advocate Chambers Plan (POPULAR) */}
              <div
                className={`relative flex flex-col justify-between rounded-xl border p-5 transition-all ${
                  currentPlanCode === 'chambers'
                    ? 'border-amber-500/80 bg-amber-950/20 shadow-xl shadow-amber-950/40 ring-1 ring-amber-500/50'
                    : 'border-amber-500/40 bg-slate-950/80 hover:border-amber-500/70'
                }`}
              >
                <span className="absolute -top-3 left-4 rounded-full bg-gradient-to-r from-amber-500 to-amber-400 px-3 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-950 shadow">
                  ★ Chambers Choice (Most Popular)
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-100 flex items-center gap-1.5">
                    <span>Advocate Chambers</span>
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-400">Advocate Firm & Junior Team (10 Seats)</p>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-3xl font-black text-amber-300">₹1,999</span>
                    <span className="text-xs text-slate-400">/ month</span>
                  </div>

                  <ul className="mt-5 space-y-2.5 text-xs text-slate-200">
                    <li className="flex items-center gap-2 font-medium">
                      <span className="text-amber-400 font-bold">✓</span>
                      <span className="text-amber-200 font-bold">10 Advocate & Junior Seats</span>
                    </li>
                    <li className="flex items-center gap-2 font-medium">
                      <span className="text-amber-400 font-bold">✓</span>
                      <span><strong>100 Active Cases</strong></span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-amber-400">✓</span>
                      <span><strong>25 GB</strong> High-Speed Cloud Storage</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-amber-400">✓</span>
                      <span><strong>Courtroom Hearing Dais Mode</strong></span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-amber-400">✓</span>
                      <span>List of Dates & Court Synopsis Export</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-amber-400">✓</span>
                      <span>Court Paper-Book Reordering & Indexing</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-amber-400">✓</span>
                      <span>Realtime Team Brief Annotation Sync</span>
                    </li>
                  </ul>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-800">
                  <Button
                    disabled={currentPlanCode === 'chambers' || upgradingCode === 'chambers'}
                    onClick={() => handleSelectPlan('chambers')}
                    className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black hover:brightness-110 text-xs py-2 shadow-lg"
                  >
                    {currentPlanCode === 'chambers'
                      ? '✓ Current Plan'
                      : upgradingCode === 'chambers'
                      ? 'Activating Chambers…'
                      : 'Upgrade to Chambers (10 Seats)'}
                  </Button>
                </div>
              </div>

              {/* Law Firm Enterprise Plan */}
              <div
                className={`relative flex flex-col justify-between rounded-xl border p-5 transition-all ${
                  currentPlanCode === 'firm'
                    ? 'border-purple-500/80 bg-purple-950/20 shadow-xl shadow-purple-950/40 ring-1 ring-purple-500/50'
                    : 'border-slate-800 bg-slate-950/60 hover:border-purple-500/50'
                }`}
              >
                {currentPlanCode === 'firm' && (
                  <span className="absolute -top-3 left-4 rounded-full bg-purple-500 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white shadow">
                    Active Plan
                  </span>
                )}
                <div>
                  <h3 className="text-base font-bold text-slate-100">Law Firm Enterprise</h3>
                  <p className="mt-0.5 text-xs text-slate-400">Multi-Partner Law Firm (20+ Seats)</p>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold text-purple-300">₹4,999</span>
                    <span className="text-xs text-slate-400">/ month</span>
                  </div>

                  <ul className="mt-5 space-y-2.5 text-xs text-slate-300">
                    <li className="flex items-center gap-2 font-medium">
                      <span className="text-purple-400 font-bold">✓</span>
                      <span className="text-purple-200 font-bold">25 Advocate Seats (Scalable)</span>
                    </li>
                    <li className="flex items-center gap-2 font-medium">
                      <span className="text-purple-400 font-bold">✓</span>
                      <span><strong>Unlimited Cases (1,000+)</strong></span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-purple-400">✓</span>
                      <span><strong>100 GB</strong> Secure Cloud Storage</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-purple-400">✓</span>
                      <span>Partner & Associate Role Hierarchy</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-purple-400">✓</span>
                      <span>Multi-Bench Parallel PDF Compare</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-purple-400">✓</span>
                      <span>AI Court Synopsis Auto-Extractor</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-purple-400">✓</span>
                      <span>Bar Council Audit Trail & Compliance</span>
                    </li>
                  </ul>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-800">
                  <Button
                    variant="secondary"
                    disabled={currentPlanCode === 'firm' || upgradingCode === 'firm'}
                    onClick={() => handleSelectPlan('firm')}
                    className="w-full border-purple-500/50 text-purple-300 hover:bg-purple-500/20 text-xs py-2"
                  >
                    {currentPlanCode === 'firm'
                      ? '✓ Current Plan'
                      : upgradingCode === 'firm'
                      ? 'Activating Enterprise…'
                      : 'Upgrade to Law Firm (25 Seats)'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950 px-6 py-4">
          <p className="text-xs text-slate-400">
            GST Invoices provided with Firm GSTIN for tax compliance. Cancel or upgrade anytime.
          </p>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
