import { useEffect, useMemo, useState } from 'react';
import { History, MinusCircle, Plus, PlusCircle, X } from 'lucide-react';
import { ActivityComputed, Program, ProgramSupplementalLog } from '../../types/ppa';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import {
  formatPHP,
  getProgramSupplementalBreakdown,
  isPersonnelServicesFund,
  round2,
  safeNum,
  summarizeProgram,
} from '../../utils/calculations';

interface SupplementalBudgetModalProps {
  program: Program | null;
  programActivities: ActivityComputed[];
  userUid: string;
  userName: string;
  onClose: () => void;
  onSaveProgram: (updatedProgram: Program) => Promise<void>;
}

export function SupplementalBudgetModal({
  program,
  programActivities,
  userUid,
  userName,
  onClose,
  onSaveProgram,
}: SupplementalBudgetModalProps) {
  const [actionType, setActionType] = useState<'ADD' | 'SUBTRACT'>('ADD');
  const [supplementalNumber, setSupplementalNumber] = useState<number>(1);
  const [maxSlotVisible, setMaxSlotVisible] = useState<number>(5);
  const [amountInput, setAmountInput] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const modalRef = useModalFocusTrap<HTMLDivElement>(Boolean(program), onClose);

  const breakdown = useMemo(() => getProgramSupplementalBreakdown(program), [program]);

  useEffect(() => {
    if (program) {
      const slotKeys = Object.keys(breakdown.byNumber).map((k) => Number(k) || 1);
      const highestExisting = Math.max(5, ...slotKeys);
      setActionType('ADD');
      setSupplementalNumber(1);
      setMaxSlotVisible(highestExisting);
      setAmountInput('');
      setNotes('');
      setError(null);
      setSaving(false);
    }
  }, [program?.id]);

  if (!program) return null;

  const summary = summarizeProgram(program, programActivities);
  const currentSupp = round2(safeNum(program.supplementalBudget));
  const currentApproved = summary.approvedBudget;
  const currentRevised = summary.revisedBudget;
  const isPsExempt =
    isPersonnelServicesFund(program.sourceOfFund) ||
    (currentApproved > 0 && currentRevised === currentApproved);

  const rawAmount = round2(Math.max(0, safeNum(amountInput)));
  const signedDelta = actionType === 'ADD' ? rawAmount : -rawAmount;
  const nextSupp = round2(currentSupp + signedDelta);
  const exceedsAvailable = actionType === 'SUBTRACT' && rawAmount > currentApproved;

  const currentSlotAmount = round2(breakdown.byNumber[supplementalNumber] || 0);
  const projectedSlotAmount = round2(currentSlotAmount + signedDelta);

  const projectedEntry: ProgramSupplementalLog | null =
    rawAmount > 0
      ? {
          id: 'preview',
          type: actionType,
          supplementalNumber,
          amount: rawAmount,
          signedAmount: signedDelta,
          notes: notes.trim() || undefined,
          updatedBy: userUid,
          updatedByName: userName,
          timestamp: new Date().toISOString(),
        }
      : null;

  const history = program.supplementalLogs || [];
  const projectedSummary = summarizeProgram(
    {
      ...program,
      supplementalBudget: nextSupp,
      supplementalLogs: projectedEntry ? [projectedEntry, ...history] : history,
    },
    programActivities
  );

  const projectedApproved = projectedSummary.approvedBudget;
  const projectedRevised = projectedSummary.revisedBudget;

  const slotOptions = Array.from({ length: maxSlotVisible }, (_, idx) => idx + 1);

  const handleAddNextSlot = () => {
    const nextSlot = Math.min(50, maxSlotVisible + 1);
    setMaxSlotVisible(nextSlot);
    setSupplementalNumber(nextSlot);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (rawAmount <= 0) {
      setError('Please enter a valid supplemental budget amount greater than zero.');
      return;
    }

    if (exceedsAvailable) {
      setError(
        `Cannot subtract ${formatPHP(rawAmount)} because the current Program Approved Budget is ${formatPHP(currentApproved)}.`
      );
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const entry: ProgramSupplementalLog = {
        id: `supp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: actionType,
        supplementalNumber,
        amount: rawAmount,
        signedAmount: signedDelta,
        notes: notes.trim() || undefined,
        updatedBy: userUid,
        updatedByName: userName,
        timestamp: now,
      };

      await onSaveProgram({
        ...program,
        supplementalBudget: nextSupp,
        supplementalLogs: [entry, ...history],
        updatedAt: now,
      });
      onClose();
    } catch {
      /* Error toast handled by parent */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-[2px] dark:bg-slate-950/75 p-4 overflow-y-auto">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="supplemental-budget-title"
        className="my-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl animate-fade-in"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-[#2563EB] dark:text-sky-400">
                {program.aipRefCode}
              </span>
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                FY {program.fiscalYear} · {program.sourceOfFund || 'General Fund'}
              </span>
            </div>
            <h3
              id="supplemental-budget-title"
              className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100"
            >
              Supplemental Budget — {program.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200"
            aria-label="Close supplemental budget prompt"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Current Program Budget Snapshot */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 p-3.5 text-xs">
          <div>
            <p className="text-slate-500 dark:text-slate-400">Current Approved</p>
            <p className="mt-1 font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatPHP(currentApproved)}
            </p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400">Net Supplemental</p>
            <p
              className={`mt-1 font-mono font-bold tabular-nums ${
                currentSupp > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : currentSupp < 0
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {currentSupp > 0 ? `+${formatPHP(currentSupp)}` : formatPHP(currentSupp)}
            </p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400">
              {isPsExempt ? 'Revised Total (PS Exempt)' : 'Revised Total (-15%)'}
            </p>
            <p className="mt-1 font-mono font-bold text-[#163A5F] dark:text-sky-400 tabular-nums">
              {formatPHP(currentRevised)}
            </p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400">Total Expenditure</p>
            <p className="mt-1 font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
              {formatPHP(summary.annualFinancialActual)}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Add vs Subtract Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Adjustment Operation *
            </label>
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Supplemental budget operation">
              <button
                type="button"
                role="radio"
                aria-checked={actionType === 'ADD'}
                onClick={() => {
                  setActionType('ADD');
                  setError(null);
                }}
                className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${
                  actionType === 'ADD'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-950/50 dark:text-emerald-300 ring-1 ring-emerald-500/30'
                    : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60'
                }`}
              >
                <PlusCircle className="h-4 w-4" aria-hidden="true" />
                <span>Add Budget (+)</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={actionType === 'SUBTRACT'}
                onClick={() => {
                  setActionType('SUBTRACT');
                  setError(null);
                }}
                className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${
                  actionType === 'SUBTRACT'
                    ? 'border-red-600 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-950/50 dark:text-red-300 ring-1 ring-red-500/30'
                    : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60'
                }`}
              >
                <MinusCircle className="h-4 w-4" aria-hidden="true" />
                <span>Subtract Budget (−)</span>
              </button>
            </div>
          </div>

          {/* Supplemental Budget Number Selector (1, 2, 3, 4, 5, ...) */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <label
                htmlFor="supplemental-slot-select"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {actionType === 'ADD'
                  ? 'Select Supplemental Budget to Add To *'
                  : 'Select Supplemental Budget to Subtract From *'}
              </label>
              {maxSlotVisible < 50 && (
                <button
                  type="button"
                  onClick={handleAddNextSlot}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  <span>Add Supplemental {maxSlotVisible + 1}</span>
                </button>
              )}
            </div>

            <div
              className="grid grid-cols-2 sm:grid-cols-3 gap-2"
              role="radiogroup"
              aria-label="Supplemental budget slot"
            >
              {slotOptions.map((slotNum) => {
                const slotBalance = round2(breakdown.byNumber[slotNum] || 0);
                const isSelected = supplementalNumber === slotNum;
                return (
                  <button
                    key={slotNum}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => {
                      setSupplementalNumber(slotNum);
                      setError(null);
                    }}
                    className={`rounded-lg border px-3 py-2 text-left transition-all ${
                      isSelected
                        ? actionType === 'ADD'
                          ? 'border-emerald-600 bg-emerald-50/90 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-950/50 dark:text-emerald-200 ring-1 ring-emerald-500/30'
                          : 'border-red-600 bg-red-50/90 text-red-900 dark:border-red-500 dark:bg-red-950/50 dark:text-red-200 ring-1 ring-red-500/30'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <p className="text-xs font-semibold truncate">
                      Supplemental Budget {slotNum}
                    </p>
                    <p
                      className={`mt-0.5 font-mono text-[11px] font-medium tabular-nums ${
                        slotBalance > 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : slotBalance < 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {slotBalance > 0 ? `+${formatPHP(slotBalance)}` : formatPHP(slotBalance)}
                    </p>
                  </button>
                );
              })}
            </div>

            <select
              id="supplemental-slot-select"
              value={supplementalNumber}
              onChange={(e) => {
                const next = Math.max(1, Math.min(50, Number(e.target.value) || 1));
                setSupplementalNumber(next);
                if (next > maxSlotVisible) setMaxSlotVisible(next);
                setError(null);
              }}
              aria-label="Supplemental Budget choice"
              className="mt-2 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
            >
              {slotOptions.map((slotNum) => {
                const slotBalance = round2(breakdown.byNumber[slotNum] || 0);
                const formatted =
                  slotBalance > 0 ? `+${formatPHP(slotBalance)}` : formatPHP(slotBalance);
                return (
                  <option key={slotNum} value={slotNum}>
                    Supplemental Budget {slotNum} (Current: {formatted})
                  </option>
                );
              })}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="supplemental-amount-input"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {actionType === 'ADD'
                  ? `Amount to Add to Supplemental Budget ${supplementalNumber} (₱) *`
                  : `Amount to Subtract from Supplemental Budget ${supplementalNumber} (₱) *`}
              </label>
              <input
                id="supplemental-amount-input"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  setError(null);
                }}
                placeholder="0.00"
                className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="supplemental-notes-input"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Ordinance / Reference Note (Optional)
              </label>
              <input
                id="supplemental-notes-input"
                type="text"
                maxLength={200}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={`e.g., Supplemental Budget No. ${supplementalNumber} Ordinance`}
                className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Live Projected Result */}
          <div className="rounded-xl border border-blue-200 dark:border-sky-800/70 bg-blue-50/70 dark:bg-sky-950/30 p-4 space-y-2 text-xs">
            <div className="flex items-center justify-between font-semibold text-slate-700 dark:text-slate-300">
              <span>
                Projected Impact After Saving (Supplemental Budget {supplementalNumber})
              </span>
              <span
                className={`font-mono font-bold tabular-nums ${
                  actionType === 'ADD'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-700 dark:text-red-400'
                }`}
              >
                {actionType === 'ADD' ? `+${formatPHP(rawAmount)}` : `−${formatPHP(rawAmount)}`}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-blue-200/70 dark:border-sky-800/60">
              <div>
                <p className="text-slate-500 dark:text-slate-400">
                  Supplemental Budget {supplementalNumber}
                </p>
                <p className="mt-0.5 font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {projectedSlotAmount > 0
                    ? `+${formatPHP(projectedSlotAmount)}`
                    : formatPHP(projectedSlotAmount)}
                </p>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">New Net Supplemental</p>
                <p className="mt-0.5 font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {nextSupp > 0 ? `+${formatPHP(nextSupp)}` : formatPHP(nextSupp)}
                </p>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">New Approved Budget</p>
                <p
                  className={`mt-0.5 font-mono font-bold tabular-nums ${
                    exceedsAvailable
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {formatPHP(Math.max(0, projectedApproved))}
                </p>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">
                  Revised Total Budget ({isPsExempt ? 'PS Exempt' : '−15%'})
                </p>
                <p className="mt-0.5 font-mono font-bold text-[#163A5F] dark:text-sky-400 tabular-nums">
                  {formatPHP(projectedRevised)}
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || exceedsAvailable || rawAmount <= 0}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                actionType === 'ADD'
                  ? 'bg-[#163A5F] hover:bg-[#1e4b7a] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8]'
                  : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {actionType === 'ADD' ? (
                <PlusCircle className="h-4 w-4" aria-hidden="true" />
              ) : (
                <MinusCircle className="h-4 w-4" aria-hidden="true" />
              )}
              <span>
                {saving
                  ? 'Applying...'
                  : actionType === 'ADD'
                    ? `Add to Supplemental Budget ${supplementalNumber}`
                    : `Subtract from Supplemental Budget ${supplementalNumber}`}
              </span>
            </button>
          </div>
        </form>

        {/* Adjustment History */}
        {history.length > 0 && (
          <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 mb-2.5">
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Supplemental Adjustment History ({history.length})</span>
            </div>
            <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
              {history.map((item) => {
                const slotNum = item.supplementalNumber || 1;
                return (
                  <div
                    key={item.id}
                    className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-slate-900"
                  >
                    <div className="min-w-0 flex flex-wrap items-center gap-2">
                      <span
                        className={`font-mono font-bold ${
                          item.type === 'ADD'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {item.type === 'ADD'
                          ? `+${formatPHP(item.amount)}`
                          : `−${formatPHP(item.amount)}`}
                      </span>
                      <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                        Supplemental Budget {slotNum}
                      </span>
                      <span className="text-slate-700 dark:text-slate-300">
                        {item.notes ||
                          (item.type === 'ADD' ? 'Budget Added' : 'Budget Subtracted')}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                      {item.updatedByName} · {new Date(item.timestamp).toLocaleDateString('en-PH')}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
