"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addLedgerMembers,
  copyExpenses,
  createLedger,
  deleteExpense,
  deleteLedger,
  exportExpenses,
  leaveLedger,
  listCategories,
  listExpenses,
  listLedgers,
  moveExpenses,
  updateLedger,
  type Category,
  type Expense,
  type Ledger,
  type Partner,
} from "@/lib/api";
import { currentMonthString, formatCurrency, formatDate, formatSignedCurrency, monthLabel, recentMonthOptions, shiftMonth, transactionCadenceLabel, transactionTypeLabel, triggerDownload } from "@/lib/utils";
import { convertToBase, fetchAndStoreRates, getDefaultCurrency, getStoredRates, getStoredRatesUpdatedAt } from "@/lib/fx-rates";
import { listPartners } from "@/lib/api";

// ---- Helpers ----

function cadenceBadgeClasses(cadence: string) {
  switch (cadence) {
    case "monthly": case "yearly": case "custom": return "bg-red-500/15 text-red-300";
    case "prepaid": return "bg-blue-500/15 text-blue-300";
    default: return "bg-orange-500/15 text-orange-300";
  }
}
function transactionTypeBadgeClasses(t: string) { return t === "credit" ? "bg-emerald-500/15 text-emerald-400" : "bg-orange-500/15 text-orange-300"; }

const CADENCE_ORDER: Record<string, number> = { one_time: 0, monthly: 1, custom: 2, prepaid: 3, yearly: 4 };

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return spinning
    ? <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
    : <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;
}

function Avatar({ name, avatarUrl }: { name?: string | null; avatarUrl?: string | null }) {
  const initials = (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((c) => c[0]?.toUpperCase() || "").join("");
  if (avatarUrl) return <img src={avatarUrl} alt={name ?? ""} className="h-5 w-5 rounded-full object-cover border border-border" referrerPolicy="no-referrer" title={name ?? ""} />;
  return <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[9px] font-bold text-primary border border-border" title={name ?? ""}>{initials}</div>;
}

// ---- Simple pie chart ----
function MiniPieChart({ slices }: { slices: { label: string; value: number; color: string }[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return null;
  let cumAngle = -Math.PI / 2;
  const paths = slices.map((slice) => {
    const angle = (slice.value / total) * 2 * Math.PI;
    const x1 = 50 + 40 * Math.cos(cumAngle);
    const y1 = 50 + 40 * Math.sin(cumAngle);
    cumAngle += angle;
    const x2 = 50 + 40 * Math.cos(cumAngle);
    const y2 = 50 + 40 * Math.sin(cumAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    return { d: `M50,50 L${x1},${y1} A40,40 0 ${largeArc},1 ${x2},${y2} Z`, color: slice.color, label: slice.label, value: slice.value };
  });
  return (
    <div className="flex items-center gap-3">
      <svg width="60" height="60" viewBox="0 0 100 100">
        {paths.map((p, i) => <path key={i} d={p.d} fill={p.color} />)}
      </svg>
      <div className="space-y-0.5">
        {paths.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs">
            <div className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.label}</span>
            <span className="font-medium">{((p.value / total) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- New Ledger Modal ----
function NewLedgerModal({ partners, onClose, onCreate }: { partners: Partner[]; onClose: () => void; onCreate: (l: Ledger) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"personal" | "shared">("personal");
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const ledger = await createLedger({ name: name.trim(), type, member_user_ids: type === "shared" ? selectedPartnerIds : undefined });
      onCreate(ledger);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create ledger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">New ledger</h2>
        <label className="text-sm space-y-1 block">
          <span className="text-muted-foreground">Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2" placeholder="e.g. Trip to Italy" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(["personal", "shared"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setType(t)} className={`rounded-xl border px-4 py-3 text-left text-sm ${type === t ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-accent"}`}>
              <div className="font-medium capitalize">{t}</div>
              <div className="text-xs text-muted-foreground">{t === "personal" ? "Only you can access" : "Share with partners"}</div>
            </button>
          ))}
        </div>
        {type === "shared" && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Select partners to share with</p>
            {partners.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No partners yet. Add them via My Account.</p>
            ) : partners.map((p) => (
              <label key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm cursor-pointer">
                <input type="checkbox" checked={selectedPartnerIds.includes(p.id)} onChange={(e) => setSelectedPartnerIds(prev => e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id))} />
                <span>{p.name || p.email}</span>
                <span className="text-xs text-muted-foreground">{p.email}</span>
              </label>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
          <button type="button" onClick={handleCreate} disabled={saving || !name.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {saving ? "Creating…" : "Create ledger"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Move/Copy Modal ----
function MoveCopyModal({
  mode,
  expenseIds,
  ledgers,
  onClose,
  onDone,
}: {
  mode: "move" | "copy";
  expenseIds: string[];
  ledgers: Ledger[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<(string | null)[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = [{ id: null as string | null, name: "General", type: "personal" as const }, ...ledgers.map(l => ({ id: l.id, name: l.name, type: l.type }))];

  function toggle(id: string | null) {
    if (mode === "move") {
      setSelectedIds([id]);
    } else {
      setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }
  }

  async function handleConfirm() {
    if (selectedIds.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === "move") {
        await moveExpenses({ expense_ids: expenseIds, target_ledger_id: selectedIds[0] });
      } else {
        await copyExpenses({ expense_ids: expenseIds, target_ledger_ids: selectedIds });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{mode === "move" ? "Move" : "Copy"} {expenseIds.length} expense{expenseIds.length !== 1 ? "s" : ""} to…</h2>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {options.map((opt) => (
            <label key={String(opt.id)} className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm cursor-pointer hover:bg-accent">
              <input type={mode === "move" ? "radio" : "checkbox"} name="ledger" checked={selectedIds.includes(opt.id)} onChange={() => toggle(opt.id)} />
              <span className="flex-1">{opt.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${opt.type === "shared" ? "bg-blue-500/15 text-blue-300" : "bg-muted text-muted-foreground"}`}>{opt.type}</span>
            </label>
          ))}
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
          <button type="button" onClick={handleConfirm} disabled={saving || selectedIds.length === 0} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {saving ? `${mode === "move" ? "Moving" : "Copying"}…` : `Confirm ${mode}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Row 3-dot menu ----
function RowActions({
  editHref,
  onDelete,
  onMove,
  onCopy,
}: {
  editHref: string;
  onDelete: () => void;
  onMove: () => void;
  onCopy: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative flex justify-end gap-1" ref={ref} onClick={(e) => e.stopPropagation()}>
      <Link href={editHref} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">Edit</Link>
      <button onClick={onDelete} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">Delete</button>
      <button onClick={() => setOpen((v) => !v)} className="rounded-lg border border-border px-2 py-1.5 text-xs hover:bg-accent" title="More options">⋯</button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 min-w-[180px] rounded-xl border border-border bg-card shadow-lg py-1">
          <button onClick={() => { onMove(); setOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-accent text-left">
            ↗ Move to ledger…
          </button>
          <button onClick={() => { onCopy(); setOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-accent text-left">
            ⎘ Copy to ledger…
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Shared ledger pie ----
const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];
function SharedLedgerStats({ expenses }: { expenses: Expense[] }) {
  const byUser: Record<string, { name: string | null; email: string; total: number }> = {};
  for (const e of expenses) {
    const uid = e.added_by?.id ?? "me";
    const name = e.added_by?.name ?? "You";
    const email = e.added_by?.email ?? "";
    if (!byUser[uid]) byUser[uid] = { name, email, total: 0 };
    byUser[uid].total += e.amount;
  }
  const slices = Object.values(byUser).map((u, i) => ({ label: u.name ?? u.email, value: u.total, color: PIE_COLORS[i % PIE_COLORS.length] }));
  if (slices.length < 2) return null;
  return (
    <div className="mb-4 rounded-xl border border-border bg-background px-4 py-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Shared ledger breakdown</p>
      <MiniPieChart slices={slices} />
    </div>
  );
}

// ---- Ledger chip 3-dot menu ----
function LedgerChipMenu({ ledger, isOwner, onRename, onAddUsers, onLeaveDelete }: {
  ledger: Ledger; isOwner: boolean;
  onRename: () => void; onAddUsers: () => void; onLeaveDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="relative shrink-0" ref={ref}>
      <button type="button" title="Ledger options"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        className="ml-0.5 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">⋯</button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[170px] rounded-xl border border-border bg-card shadow-lg py-1">
          <button onClick={() => { onRename(); setOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-accent text-left">Rename</button>
          {ledger.type === "shared" && <button onClick={() => { onAddUsers(); setOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-accent text-left">Add users</button>}
          {ledger.type === "shared" && !isOwner
            ? <button onClick={() => { onLeaveDelete(); setOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-accent text-left">Leave and delete ledger</button>
            : <button onClick={() => { onLeaveDelete(); setOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-accent text-left">Delete ledger</button>}
        </div>
      )}
    </div>
  );
}

// ---- Ledger rename modal ----
function LedgerRenameModal({ ledger, onClose, onRenamed }: { ledger: Ledger; onClose: () => void; onRenamed: (l: Ledger) => void }) {
  const [name, setName] = useState(ledger.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try { onRenamed(await updateLedger(ledger.id, { name: name.trim() }) as unknown as Ledger); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed"); setSaving(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Rename ledger</h2>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void handleSave()} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
          <button onClick={() => void handleSave()} disabled={saving || !name.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving ? "Saving…" : "Rename"}</button>
        </div>
      </div>
    </div>
  );
}

// ---- Ledger add users modal ----
function LedgerAddUsersModal({ ledger, partners, onClose, onUpdated }: { ledger: Ledger; partners: Partner[]; onClose: () => void; onUpdated: (l: Ledger) => void }) {
  const existingIds = new Set(ledger.members.map((m) => m.user_id));
  const available = partners.filter((p) => !existingIds.has(p.id));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function handleAdd() {
    setSaving(true);
    try { onUpdated(await addLedgerMembers(ledger.id, selectedIds) as unknown as Ledger); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed"); setSaving(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Add users to {ledger.name}</h2>
        {partners.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">You have no expense partners yet. Add them via My Account.</p>
        ) : available.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">All your partners are already in this ledger.</p>
        ) : (
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {available.map((p) => (
              <label key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm cursor-pointer">
                <input type="checkbox" checked={selectedIds.includes(p.id)} onChange={(e) => setSelectedIds((prev) => e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id))} />
                <span className="flex-1 truncate">{p.name || p.email}</span>
                <span className="text-xs text-muted-foreground truncate">{p.email}</span>
              </label>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
          <button onClick={() => void handleAdd()} disabled={saving || selectedIds.length === 0} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving ? "Adding…" : "Add users"}</button>
        </div>
      </div>
    </div>
  );
}

// ---- Ledger leave / delete modal ----
function LedgerLeaveDeleteModal({ ledger, isOwner, ownExpenseIds, allLedgers, onClose, onDone }: {
  ledger: Ledger; isOwner: boolean; ownExpenseIds: string[]; allLedgers: Ledger[];
  onClose: () => void; onDone: () => void;
}) {
  const isLeave = ledger.type === "shared" && !isOwner;
  const [step, setStep] = useState<"confirm" | "copy">("confirm");
  const [copyTargetIds, setCopyTargetIds] = useState<(string | null)[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copyOptions = [{ id: null as string | null, name: "General", type: "personal" as const }, ...allLedgers.filter((l) => l.id !== ledger.id).map((l) => ({ id: l.id, name: l.name, type: l.type }))];

  async function execute(withCopy: boolean) {
    setSaving(true);
    setError(null);
    try {
      if (withCopy && ownExpenseIds.length > 0 && copyTargetIds.length > 0) {
        await copyExpenses({ expense_ids: ownExpenseIds, target_ledger_ids: copyTargetIds });
      }
      if (isLeave) await leaveLedger(ledger.id);
      else await deleteLedger(ledger.id);
      onDone();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        {step === "confirm" ? (
          <>
            <h2 className="text-lg font-semibold text-red-400">{isLeave ? "Leave and delete" : "Delete"} &ldquo;{ledger.name}&rdquo;?</h2>
            <p className="text-sm text-muted-foreground">{isLeave ? "You will be removed from this shared ledger and lose access to all its expenses." : "This ledger will be permanently deleted for all members."}</p>
            {ownExpenseIds.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                You have {ownExpenseIds.length} expense{ownExpenseIds.length !== 1 ? "s" : ""} in this ledger. Copy them to another ledger first?
              </div>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex flex-col gap-2">
              {ownExpenseIds.length > 0 && <button onClick={() => setStep("copy")} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/20">Copy my expenses first…</button>}
              <button onClick={() => void execute(false)} disabled={saving} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {saving ? `${isLeave ? "Leaving" : "Deleting"}…` : ownExpenseIds.length > 0 ? `${isLeave ? "Leave and delete" : "Delete"} without copying` : `${isLeave ? "Leave and delete" : "Delete"} ledger`}
              </button>
              <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">Copy expenses to…</h2>
            <p className="text-xs text-muted-foreground">Select destinations, then the ledger will be {isLeave ? "left" : "deleted"}.</p>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {copyOptions.map((opt) => (
                <label key={String(opt.id)} className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm cursor-pointer hover:bg-accent">
                  <input type="checkbox" checked={copyTargetIds.includes(opt.id)} onChange={() => setCopyTargetIds((prev) => prev.includes(opt.id) ? prev.filter((x) => x !== opt.id) : [...prev, opt.id])} />
                  <span className="flex-1">{opt.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${opt.type === "shared" ? "bg-blue-500/15 text-blue-300" : "bg-muted text-muted-foreground"}`}>{opt.type}</span>
                </label>
              ))}
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep("confirm")} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">Back</button>
              <button onClick={() => void execute(true)} disabled={saving || copyTargetIds.length === 0} className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {saving ? "Working…" : `Copy & ${isLeave ? "leave" : "delete"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Main page ----

export default function ExpensesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  // Existing state
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [transactionType, setTransactionType] = useState("");
  const [cadence, setCadence] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fxRates, setFxRates] = useState<Record<string, number>>(() => getStoredRates());
  const [fxUpdatedAt, setFxUpdatedAt] = useState<string | null>(() => getStoredRatesUpdatedAt());
  const [fxLoading, setFxLoading] = useState(false);
  const [fxError, setFxError] = useState<string | null>(null);
  const [defaultCurrency] = useState<string>(() => getDefaultCurrency());
  const [sortField, setSortField] = useState<"date" | "merchant" | "type" | "cadence" | "category" | "amount" | "status">("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Ledger state
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [selectedLedgerIds, setSelectedLedgerIds] = useState<(string | "general")[]>(["general"]);
  const [showNewLedger, setShowNewLedger] = useState(false);
  const [partners, setPartners] = useState<import("@/lib/api").Partner[]>([]);

  // Move/copy state
  const [moveCopyModal, setMoveCopyModal] = useState<{ mode: "move" | "copy"; expenseIds: string[] } | null>(null);
  // Ledger action modal state
  const [ledgerAction, setLedgerAction] = useState<{ type: "rename" | "addUsers" | "leaveDelete"; ledger: Ledger } | null>(null);

  const monthParam = searchParams.get("month");
  const isAllTime = monthParam === "all";
  const month = isAllTime ? null : monthParam || currentMonthString();
  const recentMonths = useMemo(() => recentMonthOptions(24, month || currentMonthString()), [month]);

  const updateMonth = useCallback((nextMonth: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextMonth === null || nextMonth === currentMonthString()) params.delete("month"); else params.set("month", nextMonth);
    const query = params.toString();
    router.replace(query ? `/expenses?${query}` : "/expenses");
  }, [router, searchParams]);

  // Derive ledger_ids param
  const ledgerIdsParam = useMemo(() => {
    if (selectedLedgerIds.length === 0) return "general";
    return selectedLedgerIds.join(",");
  }, [selectedLedgerIds]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [expenseData, categoryData] = await Promise.all([
        listExpenses({
          month: isAllTime ? "all" : month || undefined,
          search,
          category_id: categoryId || undefined,
          transaction_type: transactionType || undefined,
          cadence: cadence || undefined,
          review_only: reviewOnly || undefined,
          ledger_ids: ledgerIdsParam,
          show_duplicates: showDuplicates || undefined,
        } as Record<string, string | boolean | undefined>),
        listCategories(),
      ]);
      setExpenses(expenseData.items);
      setCategories(categoryData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load expenses");
    } finally {
      setLoading(false);
    }
  }, [cadence, categoryId, isAllTime, month, reviewOnly, search, transactionType, ledgerIdsParam, showDuplicates]);

  useEffect(() => { void load(); }, [load]);

  // Load ledgers and partners once
  useEffect(() => {
    listLedgers().then((data) => setLedgers(data.ledgers)).catch(() => {});
    listPartners().then((data) => setPartners(data.partners)).catch(() => {});
  }, []);

  function toggleLedger(id: string | "general") {
    setSelectedLedgerIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      return next.length === 0 ? ["general"] : next;
    });
  }

  function selectAllLedgers() {
    setSelectedLedgerIds(["general", ...ledgers.map((l) => l.id)]);
  }

  const byCurrency = useMemo(() => {
    const map: Record<string, { moneyIn: number; moneyOut: number }> = {};
    for (const item of expenses) {
      const cur = item.currency || defaultCurrency;
      if (!map[cur]) map[cur] = { moneyIn: 0, moneyOut: 0 };
      if (item.transaction_type === "credit") map[cur].moneyIn += item.amount;
      else map[cur].moneyOut += item.amount;
    }
    const sorted = Object.entries(map).sort(([a], [b]) => a === defaultCurrency ? -1 : b === defaultCurrency ? 1 : 0);
    return {
      moneyOutEntries: sorted.filter(([, v]) => v.moneyOut > 0),
      moneyInEntries: sorted.filter(([, v]) => v.moneyIn > 0),
      netEntries: sorted.map(([currency, { moneyIn, moneyOut }]) => ({ currency, net: moneyIn - moneyOut })).filter(({ net }) => net !== 0 || sorted.length === 1),
    };
  }, [expenses, defaultCurrency]);

  const detectedCurrencies = useMemo(() => {
    const seen = new Set<string>();
    for (const e of expenses) if (e.currency && e.currency !== defaultCurrency) seen.add(e.currency);
    return Array.from(seen).sort();
  }, [expenses, defaultCurrency]);

  const showLedgerColumn = selectedLedgerIds.length > 1;
  const activeSingleSharedLedger = useMemo(() => {
    if (selectedLedgerIds.length !== 1 || selectedLedgerIds[0] === "general") return null;
    return ledgers.find((l) => l.id === selectedLedgerIds[0] && l.type === "shared") ?? null;
  }, [selectedLedgerIds, ledgers]);

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this expense?")) return;
    await deleteExpense(id);
    await load();
  }

  async function handleExport(format: "json" | "csv") {
    const exportMonth = isAllTime ? undefined : month || undefined;
    const fileMonth = isAllTime ? "all-time" : month || currentMonthString();
    const blob = await exportExpenses(format, exportMonth);
    triggerDownload(blob, `spendhound-transactions-${fileMonth}.${format === "json" ? "json" : "csv"}`);
  }

  async function handleUpdateRates() {
    if (detectedCurrencies.length === 0) return;
    setFxLoading(true);
    setFxError(null);
    try {
      const newRates = await fetchAndStoreRates(detectedCurrencies, defaultCurrency);
      setFxRates(newRates);
      setFxUpdatedAt(getStoredRatesUpdatedAt());
    } catch { setFxError("Could not fetch rates"); } finally { setFxLoading(false); }
  }

  const handleSort = useCallback((field: typeof sortField) => {
    if (sortField === field) setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDirection("asc"); }
  }, [sortField]);

  const sortedExpenses = useMemo(() => {
    const arr = [...expenses];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date": cmp = a.expense_date.localeCompare(b.expense_date); break;
        case "merchant": cmp = (a.merchant ?? "").toLowerCase().localeCompare((b.merchant ?? "").toLowerCase()); break;
        case "type": cmp = a.transaction_type.localeCompare(b.transaction_type); break;
        case "cadence": cmp = (CADENCE_ORDER[a.cadence] ?? 99) - (CADENCE_ORDER[b.cadence] ?? 99); break;
        case "category": cmp = (a.category_name ?? "").toLowerCase().localeCompare((b.category_name ?? "").toLowerCase()); break;
        case "amount": cmp = convertToBase(a.amount, a.currency, defaultCurrency, fxRates) - convertToBase(b.amount, b.currency, defaultCurrency, fxRates); break;
        case "status": cmp = (b.needs_review ? 1 : 0) - (a.needs_review ? 1 : 0); break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [expenses, sortField, sortDirection, fxRates, defaultCurrency]);

  const detailMonthParam = isAllTime ? "all" : month && month !== currentMonthString() ? month : null;

  function SortTh({ field, label }: { field: typeof sortField; label: string }) {
    return (
      <th className="py-3 pr-4 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort(field)}>
        <span className="inline-flex items-center gap-1">
          <span className={sortField === field ? "font-bold text-foreground" : ""}>{label}</span>
          {sortField === field ? <span className="text-xs">{sortDirection === "asc" ? "↑" : "↓"}</span> : <span className="text-xs opacity-30">↕</span>}
        </span>
      </th>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Transactions</h1>
          <p className="text-sm text-muted-foreground">Track money out and money in, including expenses, salary, refunds, gifts, and transfers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => handleExport("csv")} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent">Export CSV</button>
          <button onClick={() => handleExport("json")} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent">Export JSON</button>
          <button onClick={() => setShowNewLedger(true)} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent">+ New ledger</button>
          <Link href="/expenses/new" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Add transaction</Link>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <button type="button" onClick={() => setFiltersOpen((prev) => !prev)} className="flex w-full items-center justify-between">
          <span className="text-sm font-medium">Filters</span>
          <svg className={`h-4 w-4 transition-transform duration-200 ${filtersOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </button>
        <div className={filtersOpen ? "mt-3 block" : "hidden"}>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
            <div className="min-w-0 text-sm">
              <span className="mb-1 block text-muted-foreground">Period</span>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex min-w-[220px] max-w-full flex-1 items-center rounded-lg border border-border bg-background sm:flex-none">
                  <button type="button" disabled={isAllTime} onClick={() => month && updateMonth(shiftMonth(month, -1))} className="px-3 py-2 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40">←</button>
                  <div className="min-w-0 flex-1 border-x border-border px-3 py-2 text-center font-medium">{isAllTime ? "All time" : monthLabel(month || currentMonthString())}</div>
                  <button type="button" disabled={isAllTime} onClick={() => month && updateMonth(shiftMonth(month, 1))} className="px-3 py-2 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40">→</button>
                </div>
                <select value={isAllTime ? "" : month || currentMonthString()} onChange={(e) => e.target.value && updateMonth(e.target.value)} className="min-w-[11rem] flex-1 rounded-lg border border-border bg-background px-3 py-2 sm:flex-none">
                  {isAllTime ? <option value="">Jump to a month…</option> : null}
                  {recentMonths.map((opt) => <option key={opt} value={opt}>{monthLabel(opt)}</option>)}
                </select>
                <button type="button" onClick={() => updateMonth(null)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-accent">This month</button>
                <button type="button" onClick={() => updateMonth("all")} className={`rounded-lg border px-3 py-2 text-sm ${isAllTime ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:bg-accent"}`}>All time</button>
              </div>
            </div>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Search</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Merchant, description…" className="w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Type</span>
              <select value={transactionType} onChange={(e) => setTransactionType(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                <option value="">All types</option><option value="debit">Money out</option><option value="credit">Money in</option>
              </select>
            </label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Cadence</span>
              <select value={cadence} onChange={(e) => setCadence(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                <option value="">All cadences</option><option value="monthly">Monthly recurring</option><option value="yearly">Yearly recurring</option><option value="custom">Custom interval</option><option value="prepaid">Prepaid</option><option value="one_time">One-time</option>
              </select>
            </label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Category</span>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <div className="flex gap-2 text-sm">
              <label className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 cursor-pointer">
                <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
                <span>Needs review</span>
              </label>
              <label className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 cursor-pointer">
                <input type="checkbox" checked={showDuplicates} onChange={(e) => setShowDuplicates(e.target.checked)} />
                <span>Duplicates</span>
              </label>
            </div>
          </div>

        </div>
      </div>

      {/* Stats + table */}
      <div className="rounded-2xl border border-border bg-card p-4">
        {/* Ledger label above table */}
        {selectedLedgerIds.length === 1 && selectedLedgerIds[0] !== "general" && (() => {
          const l = ledgers.find((x) => x.id === selectedLedgerIds[0]);
          return l ? (
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm font-medium">{l.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${l.type === "shared" ? "bg-blue-500/15 text-blue-300" : "bg-muted text-muted-foreground"}`}>{l.type} ledger</span>
              {l.type === "shared" && <span className="text-xs text-muted-foreground">· {l.members.length} member{l.members.length !== 1 ? "s" : ""}</span>}
            </div>
          ) : null;
        })()}

        {/* Mobile: update exchange rates button — above money boxes */}
        {detectedCurrencies.length > 0 && (
          <div className="mb-3 lg:hidden">
            <button type="button" onClick={handleUpdateRates} disabled={fxLoading} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-60">
              <RefreshIcon spinning={fxLoading} />Update exchange rates
            </button>
            {fxError && <p className="mt-1 text-xs text-red-400">{fxError}</p>}
          </div>
        )}

        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          {/* Money boxes — compact on mobile (always 3-col), full on desktop */}
          <div className="grid grid-cols-3 gap-2 lg:gap-3">
            <div className="rounded-xl border border-border bg-background px-2 py-2 lg:px-4 lg:py-3">
              <div className="text-xs text-muted-foreground lg:text-sm">Money out</div>
              {byCurrency.moneyOutEntries.length === 0
                ? <div className="text-base font-semibold text-red-400 lg:text-2xl">{formatCurrency(0)}</div>
                : byCurrency.moneyOutEntries.map(([currency, amounts], i) => <div key={currency} className={`font-semibold text-red-400 ${i === 0 ? "text-base lg:text-2xl" : "mt-0.5 text-xs opacity-70 hidden lg:block"}`}>{formatCurrency(amounts.moneyOut, currency)}</div>)}
            </div>
            <div className="rounded-xl border border-border bg-background px-2 py-2 lg:px-4 lg:py-3">
              <div className="text-xs text-muted-foreground lg:text-sm">Money in</div>
              {byCurrency.moneyInEntries.length === 0
                ? <div className="text-base font-semibold text-emerald-400 lg:text-2xl">{formatCurrency(0)}</div>
                : byCurrency.moneyInEntries.map(([currency, amounts], i) => <div key={currency} className={`font-semibold text-emerald-400 ${i === 0 ? "text-base lg:text-2xl" : "mt-0.5 text-xs opacity-70 hidden lg:block"}`}>{formatCurrency(amounts.moneyIn, currency)}</div>)}
            </div>
            <div className="rounded-xl border border-border bg-background px-2 py-2 lg:px-4 lg:py-3">
              <div className="text-xs text-muted-foreground lg:text-sm">Net</div>
              {byCurrency.netEntries.map(({ currency, net }, i) => <div key={currency} className={`font-semibold ${net >= 0 ? "text-emerald-400" : "text-red-400"} ${i === 0 ? "text-base lg:text-2xl" : "mt-0.5 text-xs opacity-70 hidden lg:block"}`}>{formatCurrency(net, currency)}</div>)}
            </div>
          </div>

          {/* Desktop: FX toolbar on the right of money boxes */}
          {detectedCurrencies.length > 0 && (
            <div className="hidden lg:flex lg:flex-col lg:items-end lg:gap-1.5 lg:shrink-0">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>Amount sort — {defaultCurrency}-equivalent</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{detectedCurrencies.join(" · ")}</span>
              </div>
              <div className="flex items-center gap-3">
                {fxUpdatedAt ? <p className="text-xs text-muted-foreground">Rates updated {new Date(fxUpdatedAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</p> : <p className="text-xs text-muted-foreground">Using default rates</p>}
                {fxError && <p className="text-xs text-red-400">{fxError}</p>}
                <button type="button" onClick={handleUpdateRates} disabled={fxLoading} className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-60">
                  <RefreshIcon spinning={fxLoading} />Update rates
                </button>
              </div>
            </div>
          )}
        </div>

        {activeSingleSharedLedger && <SharedLedgerStats expenses={expenses} />}

        {/* Ledger filter — above the table */}
        {(ledgers.length > 0) && (
          <div className="mb-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Ledgers</span>
              <div className="flex gap-3">
                <button type="button" onClick={selectAllLedgers} className="text-xs text-primary hover:underline">Select all</button>
                <button type="button" onClick={() => setSelectedLedgerIds(["general"])} className="text-xs text-muted-foreground hover:underline">Reset</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${selectedLedgerIds.includes("general") ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-accent"}`}>
                <input type="checkbox" className="sr-only" checked={selectedLedgerIds.includes("general")} onChange={() => toggleLedger("general")} />
                <span>General</span>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">personal</span>
              </label>
              {ledgers.map((l) => {
                const currentMember = l.members.find((m) => m.email === session?.user?.email);
                const isOwner = currentMember?.role === "owner";
                return (
                  <div key={l.id} className="flex items-center">
                    <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${selectedLedgerIds.includes(l.id) ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-accent"}`}>
                      <input type="checkbox" className="sr-only" checked={selectedLedgerIds.includes(l.id)} onChange={() => toggleLedger(l.id)} />
                      <span>{l.name}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${l.type === "shared" ? "bg-blue-500/15 text-blue-300" : "bg-muted text-muted-foreground"}`}>{l.type}</span>
                    </label>
                    <LedgerChipMenu
                      ledger={l}
                      isOwner={isOwner}
                      onRename={() => setLedgerAction({ type: "rename", ledger: l })}
                      onAddUsers={() => setLedgerAction({ type: "addUsers", ledger: l })}
                      onLeaveDelete={() => setLedgerAction({ type: "leaveDelete", ledger: l })}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div> : null}
        {loading ? <div className="py-20 text-center text-muted-foreground">Loading transactions…</div>
          : expenses.length === 0 ? <div className="py-20 text-center text-muted-foreground">No transactions found for the current filters.</div>
          : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-border text-left text-muted-foreground">
                <tr>
                  <SortTh field="date" label="Date" />
                  <SortTh field="merchant" label="Merchant" />
                  <SortTh field="amount" label="Amount" />
                  <SortTh field="category" label="Category" />
                  <SortTh field="cadence" label="Cadence" />
                  <SortTh field="type" label="Type" />
                  <SortTh field="status" label="Status" />
                  {showLedgerColumn && <th className="py-3 pr-4">Ledger</th>}
                  <th className="py-3 pr-0 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedExpenses.map((expense) => {
                  const detailHref = detailMonthParam ? `/expenses/${expense.id}?month=${detailMonthParam}` : `/expenses/${expense.id}`;
                  const editHref = detailMonthParam ? `/expenses/${expense.id}?month=${detailMonthParam}&mode=edit` : `/expenses/${expense.id}?mode=edit`;
                  return (
                    <tr key={expense.id} className="cursor-pointer border-b border-border/50 hover:bg-accent/40 transition-colors" onClick={() => router.push(detailHref)}>
                      <td className="py-3 pr-4">{formatDate(expense.expense_date)}</td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-1.5">
                          {expense.added_by && <Avatar name={expense.added_by.name} avatarUrl={expense.added_by.avatar_url} />}
                          <div>
                            <div className="font-medium">{expense.merchant}</div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <span>{expense.description || expense.receipt_filename || "—"}</span>
                              {expense.auto_generated ? <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-300">{expense.needs_review ? "Auto-added draft" : "Auto-added"}</span> : null}
                              {expense.is_major_purchase ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">Major purchase</span> : null}
                              {expense.cadence === "prepaid" && expense.prepaid_end_date ? (() => {
                                const daysLeft = Math.floor((new Date(expense.prepaid_end_date).getTime() - Date.now()) / 86400000);
                                const cls = daysLeft < 0 ? "bg-gray-500/15 text-gray-400" : daysLeft <= 30 ? "bg-amber-500/15 text-amber-300" : "bg-blue-500/15 text-blue-300";
                                return <span className={`rounded-full px-2 py-0.5 text-[11px] ${cls}`}>{daysLeft < 0 ? "Expired" : daysLeft === 0 ? "Expires today" : daysLeft <= 30 ? `Expires in ${daysLeft}d` : `Until ${new Date(expense.prepaid_end_date).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`}</span>;
                              })() : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className={`py-3 pr-4 font-medium ${expense.transaction_type === "credit" ? "text-emerald-400" : "text-red-400"}`}>{formatSignedCurrency(expense.amount, expense.transaction_type, expense.currency)}</td>
                      <td className="py-3 pr-4">{expense.category_name ?? "Uncategorized"}</td>
                      <td className="py-3 pr-4"><span className={`rounded-full px-2 py-1 text-xs ${cadenceBadgeClasses(expense.cadence)}`}>{transactionCadenceLabel(expense.cadence, expense.cadence_interval)}</span></td>
                      <td className="py-3 pr-4"><span className={`rounded-full px-2 py-1 text-xs ${transactionTypeBadgeClasses(expense.transaction_type)}`}>{transactionTypeLabel(expense.transaction_type)}</span></td>
                      <td className="py-3 pr-4">
                        {expense.needs_review ? <span className="rounded-full bg-yellow-500/15 px-2 py-1 text-xs text-yellow-400">Needs review</span> : <span className="rounded-full bg-green-500/15 px-2 py-1 text-xs text-green-400">Tracked</span>}
                      </td>
                      {showLedgerColumn && <td className="py-3 pr-4 text-xs text-muted-foreground">{expense.ledger_name ?? "General"}</td>}
                      <td className="py-3 pr-0 text-right">
                        <RowActions
                          editHref={editHref}
                          onDelete={() => void handleDelete(expense.id)}
                          onMove={() => setMoveCopyModal({ mode: "move", expenseIds: [expense.id] })}
                          onCopy={() => setMoveCopyModal({ mode: "copy", expenseIds: [expense.id] })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNewLedger && (
        <NewLedgerModal
          partners={partners}
          onClose={() => setShowNewLedger(false)}
          onCreate={(l) => { setLedgers((prev) => [...prev, l]); setShowNewLedger(false); setSelectedLedgerIds([l.id]); }}
        />
      )}

      {moveCopyModal && (
        <MoveCopyModal
          mode={moveCopyModal.mode}
          expenseIds={moveCopyModal.expenseIds}
          ledgers={ledgers}
          onClose={() => setMoveCopyModal(null)}
          onDone={() => { setMoveCopyModal(null); void load(); }}
        />
      )}

      {ledgerAction?.type === "rename" && (
        <LedgerRenameModal
          ledger={ledgerAction.ledger}
          onClose={() => setLedgerAction(null)}
          onRenamed={(updated) => { setLedgers((prev) => prev.map((l) => l.id === updated.id ? updated : l)); setLedgerAction(null); }}
        />
      )}

      {ledgerAction?.type === "addUsers" && (
        <LedgerAddUsersModal
          ledger={ledgerAction.ledger}
          partners={partners}
          onClose={() => setLedgerAction(null)}
          onUpdated={(updated) => { setLedgers((prev) => prev.map((l) => l.id === updated.id ? updated : l)); setLedgerAction(null); }}
        />
      )}

      {ledgerAction?.type === "leaveDelete" && (() => {
        const la = ledgerAction;
        const currentMember = la.ledger.members.find((m) => m.email === session?.user?.email);
        const isOwner = currentMember?.role === "owner";
        const ownExpenseIds = expenses.filter((e) => e.ledger_id === la.ledger.id && (!e.added_by || e.added_by.email === session?.user?.email)).map((e) => e.id);
        return (
          <LedgerLeaveDeleteModal
            ledger={la.ledger}
            isOwner={isOwner}
            ownExpenseIds={ownExpenseIds}
            allLedgers={ledgers}
            onClose={() => setLedgerAction(null)}
            onDone={() => {
              setLedgers((prev) => prev.filter((l) => l.id !== la.ledger.id));
              setSelectedLedgerIds((prev) => { const next = prev.filter((id) => id !== la.ledger.id); return next.length === 0 ? ["general"] : next; });
              setLedgerAction(null);
              void load();
            }}
          />
        );
      })()}
    </div>
  );
}
