"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createExpense, createExpenseFromReceipt, createExpenseFromStatementEntry, createLedger, listCategories, listLedgers, listPartners, uploadReceipt, uploadStatement, type Category, type Ledger, type Partner, type Receipt, type ReceiptPreview, type ReceiptPreviewItem, type StatementImportEntry, type StatementImportPreview } from "@/lib/api";
import { currentMonthString, formatSignedCurrency, transactionCadenceLabel, transactionTypeLabel } from "@/lib/utils";

type ExpenseFormState = {
  merchant: string;
  description: string;
  amount: string;
  transaction_type: string;
  cadence: string;
  cadence_interval: number;
  prepaid_months: number;
  prepaid_start_date: string;
  recurring_variable: boolean;
  recurring_auto_add: boolean;
  is_major_purchase: boolean;
  currency: string;
  expense_date: string;
  category_id: string;
  category_name: string;
  notes: string;
};

type ReceiptDraftState = ExpenseFormState & {
  confidence: string;
  items: ReceiptPreviewItem[];
};

const ITEM_SUBCATEGORY_OPTIONS = [
  "Vegetables",
  "Fruit",
  "Meat",
  "Fish & Seafood",
  "Dairy & Eggs",
  "Bakery",
  "Frozen",
  "Snacks",
  "Beverages",
  "Cleaning Products",
  "Personal Care",
  "Baby",
  "Pet Care",
  "Household",
  "Breakfast & Cereal",
  "Condiments & Spices",
  "Pantry",
  "Prepared Meals",
];

const MANUAL_TAB = "manual";
const RECEIPT_TAB = "upload-receipt";
const STATEMENT_TAB = "import-statement";
const ITEM_QUANTITY_OPTIONS = ["1", "2", "3", "4", "5", "6", "8", "10"];

const DEFAULT_CURRENCY = "EUR";
const COMMON_CURRENCIES = [
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "CHF", symbol: "Fr", name: "Swiss Franc" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan" },
  { code: "SEK", symbol: "kr", name: "Swedish Krona" },
  { code: "NOK", symbol: "kr", name: "Norwegian Krone" },
  { code: "DKK", symbol: "kr", name: "Danish Krone" },
  { code: "PLN", symbol: "zł", name: "Polish Zloty" },
  { code: "BRL", symbol: "R$", name: "Brazilian Real" },
  { code: "MXN", symbol: "$", name: "Mexican Peso" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar" },
  { code: "HKD", symbol: "HK$", name: "Hong Kong Dollar" },
  { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar" },
  { code: "ZAR", symbol: "R", name: "South African Rand" },
  { code: "TRY", symbol: "₺", name: "Turkish Lira" },
  { code: "KRW", symbol: "₩", name: "South Korean Won" },
  { code: "THB", symbol: "฿", name: "Thai Baht" },
  { code: "IDR", symbol: "Rp", name: "Indonesian Rupiah" },
  { code: "MYR", symbol: "RM", name: "Malaysian Ringgit" },
  { code: "PHP", symbol: "₱", name: "Philippine Peso" },
  { code: "ILS", symbol: "₪", name: "Israeli Shekel" },
  { code: "CZK", symbol: "Kč", name: "Czech Koruna" },
  { code: "HUF", symbol: "Ft", name: "Hungarian Forint" },
  { code: "RON", symbol: "lei", name: "Romanian Leu" },
  { code: "BGN", symbol: "лв", name: "Bulgarian Lev" },
];

function getCurrencySymbol(code: string): string {
  return COMMON_CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

function createEmptyExpenseForm(): ExpenseFormState {
  return {
    merchant: "",
    description: "",
    amount: "",
    transaction_type: "debit",
    cadence: "one_time",
    cadence_interval: 3,
    prepaid_months: 12,
    prepaid_start_date: `${currentMonthString()}-01`,
    recurring_variable: false,
    recurring_auto_add: false,
    is_major_purchase: false,
    currency: "EUR",
    expense_date: new Date().toISOString().slice(0, 10),
    category_id: "",
    category_name: "",
    notes: "",
  };
}

function createEmptyReceiptDraft(): ReceiptDraftState {
  return {
    ...createEmptyExpenseForm(),
    confidence: "0.5",
    items: [],
  };
}

function createEmptyStatementDraft(): ReceiptDraftState {
  return {
    ...createEmptyExpenseForm(),
    confidence: "0.5",
    items: [],
  };
}

function isStatementPreview(preview: Receipt["preview"] | null | undefined): preview is StatementImportPreview {
  return Boolean(preview && typeof preview === "object" && "entries" in preview);
}

function isReceiptPreview(preview: Receipt["preview"] | null | undefined): preview is ReceiptPreview {
  return Boolean(preview && typeof preview === "object" && !isStatementPreview(preview));
}

function findNextPendingIndex(entries: StatementImportEntry[]) {
  return entries.findIndex((entry) => entry.status !== "finalized");
}

function filteredCategories(categories: Category[], transactionType: string) {
  return categories.filter((category) => category.transaction_type === transactionType);
}

function findCategoryIdByName(categories: Category[], transactionType: string, categoryName: string) {
  const normalizedName = categoryName.trim().toLowerCase();
  if (!normalizedName) return "";
  return categories.find((category) => category.transaction_type === transactionType && category.name.trim().toLowerCase() === normalizedName)?.id ?? "";
}

function isRecurringCadence(cadence: string) {
  return cadence === "monthly" || cadence === "yearly" || cadence === "custom";
}

function applyCadenceSelection<T extends ExpenseFormState>(form: T, cadence: string): T {
  const recurring = isRecurringCadence(cadence);
  return {
    ...form,
    cadence,
    is_major_purchase: cadence === "one_time" ? form.is_major_purchase : false,
    recurring_variable: recurring ? form.recurring_variable : false,
    recurring_auto_add: recurring ? form.recurring_auto_add : false,
  } as T;
}

function createReceiptDraftFromPreview(preview: ReceiptPreview, categories: Category[]): ReceiptDraftState {
  const categoryId = findCategoryIdByName(categories, preview.transaction_type ?? "debit", preview.category_name ?? "");

  return {
    merchant: preview.merchant ?? "",
    amount: preview.amount != null ? String(preview.amount) : "",
    transaction_type: preview.transaction_type ?? "debit",
    cadence: preview.cadence ?? "one_time",
    cadence_interval: 3,
    prepaid_months: 12,
    prepaid_start_date: preview.expense_date ?? new Date().toISOString().slice(0, 10),
    recurring_variable: preview.recurring_variable ?? false,
    recurring_auto_add: preview.recurring_auto_add ?? false,
    is_major_purchase: preview.is_major_purchase ?? false,
    currency: preview.currency ?? "EUR",
    expense_date: preview.expense_date ?? new Date().toISOString().slice(0, 10),
    description: preview.description ?? "",
    category_id: categoryId,
    category_name: categoryId ? "" : preview.category_name ?? "",
    notes: preview.notes ?? "",
    confidence: String(preview.confidence ?? 0.5),
    items: (preview.items ?? []).map((item) => ({ ...item, id: item.id ?? crypto.randomUUID() })),
  };
}

function TransactionTypeSelector({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="text-sm text-muted-foreground">Transaction type</div>
      <div className="grid grid-cols-2 gap-2">
        {[
          { value: "debit", label: "Money out", description: "Expenses, bills, purchases" },
          { value: "credit", label: "Money in", description: "Salary, gifts, refunds" },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-xl border px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60 ${value === option.value ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-accent"}`}
          >
            <div className="font-medium">{option.label}</div>
            <div className="text-xs text-muted-foreground">{option.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

const CADENCE_OPTIONS = [
  { value: "one_time", label: "One-time / irregular", description: "Occasional spending, large purchases, ad-hoc income" },
  { value: "monthly", label: "Recurring monthly", description: "Subscriptions, rent, salary, utilities" },
  { value: "yearly", label: "Recurring yearly", description: "Insurance, annual renewals, yearly fees" },
  { value: "custom", label: "Every N months", description: "Quarterly plans, bi-annual charges, custom intervals" },
  { value: "prepaid", label: "Prepaid subscription", description: "One lump-sum payment covering N months of service" },
];

function CadenceSelector({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const selected = CADENCE_OPTIONS.find((o) => o.value === value) ?? CADENCE_OPTIONS[0];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">Transaction cadence</div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((prev) => !prev)}
          className="text-xs text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          {open ? "Close" : "Change cadence"}
        </button>
      </div>
      {open ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CADENCE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => { onChange(option.value); setOpen(false); }}
              className={`rounded-xl border px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60 ${value === option.value ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-accent"}`}
            >
              <div className="font-medium text-sm">{option.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{option.description}</div>
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-3 rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="font-medium">{selected.label}</span>
          <span className="text-xs text-muted-foreground">{selected.description}</span>
          <span className="ml-auto text-xs text-muted-foreground/60">tap to change</span>
        </button>
      )}
    </div>
  );
}

function CustomIntervalPanel({
  cadence,
  interval,
  onIntervalChange,
  disabled = false,
}: {
  cadence: string;
  interval: number;
  onIntervalChange: (value: number) => void;
  disabled?: boolean;
}) {
  if (cadence !== "custom") return null;
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-background p-4">
      <div>
        <div className="text-sm font-medium">Recurrence interval</div>
        <p className="text-xs text-muted-foreground">How many months between each charge.</p>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Every</span>
        <input
          type="number"
          min={2}
          max={120}
          value={interval}
          onChange={(e) => onIntervalChange(Math.max(2, Math.min(120, parseInt(e.target.value) || 2)))}
          disabled={disabled}
          className="w-20 rounded-lg border border-border bg-card px-3 py-2 text-center disabled:cursor-not-allowed disabled:opacity-60"
        />
        <span className="text-muted-foreground">months</span>
      </label>
      <p className="text-xs text-muted-foreground">Common: 3 (quarterly), 6 (bi-annual), 24 (bi-annual 2-year plan). Minimum is 2 — use &quot;Monthly&quot; for every month.</p>
    </div>
  );
}

function PrepaidSettingsPanel({
  cadence,
  prepaidMonths,
  prepaidStartDate,
  onPrepaidMonthsChange,
  onPrepaidStartDateChange,
  disabled = false,
}: {
  cadence: string;
  prepaidMonths: number;
  prepaidStartDate: string;
  onPrepaidMonthsChange: (value: number) => void;
  onPrepaidStartDateChange: (value: string) => void;
  disabled?: boolean;
}) {
  if (cadence !== "prepaid") return null;

  const endDateLabel = (() => {
    if (!prepaidStartDate || !prepaidMonths) return null;
    try {
      const start = new Date(prepaidStartDate);
      const totalMonths = start.getMonth() + prepaidMonths;
      const endYear = start.getFullYear() + Math.floor(totalMonths / 12);
      const endMonth = totalMonths % 12;
      const lastDay = new Date(endYear, endMonth + 1, 0).getDate();
      return new Date(endYear, endMonth, lastDay).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
    } catch {
      return null;
    }
  })();

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-background p-4">
      <div>
        <div className="text-sm font-medium">Prepaid coverage</div>
        <p className="text-xs text-muted-foreground">A single payment covering multiple months of a service. No recurring generation — tracked as one expense.</p>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Covers</span>
        <input
          type="number"
          min={1}
          max={120}
          value={prepaidMonths}
          onChange={(e) => onPrepaidMonthsChange(Math.max(1, Math.min(120, parseInt(e.target.value) || 1)))}
          disabled={disabled}
          className="w-20 rounded-lg border border-border bg-card px-3 py-2 text-center disabled:cursor-not-allowed disabled:opacity-60"
        />
        <span className="text-muted-foreground">months</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Coverage starts</span>
        <input
          type="date"
          value={prepaidStartDate}
          onChange={(e) => onPrepaidStartDateChange(e.target.value)}
          disabled={disabled}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <span className="text-xs text-muted-foreground">Defaults to the purchase date if unchanged.</span>
      </label>
      {endDateLabel ? (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-xs text-blue-300">
          Coverage active until <span className="font-medium">{endDateLabel}</span>.
        </div>
      ) : null}
    </div>
  );
}

function MajorPurchaseToggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} className="mt-0.5" />
      <span>
        <span className="block font-medium">Mark as major one-time purchase</span>
        <span className="text-xs text-muted-foreground">Use this for larger irregular purchases such as a phone, watch, laptop, appliance, or other meaningful one-off buy.</span>
      </span>
    </label>
  );
}

function CurrencySelector({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const isInList = COMMON_CURRENCIES.some((c) => c.code === value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {!isInList && value ? <option value={value}>{value}</option> : null}
      {COMMON_CURRENCIES.map((c) => (
        <option key={c.code} value={c.code}>{c.symbol} {c.code} — {c.name}</option>
      ))}
    </select>
  );
}

function CurrencyDisplayToggle({
  currency,
  amount,
  displayAsEur,
  rate,
  onToggle,
  disabled = false,
}: {
  currency: string;
  amount: string;
  displayAsEur: boolean;
  rate: number | null;
  onToggle: (displayAsEur: boolean, rate: number | null) => void;
  disabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setError(null); }, [currency]);

  const numAmount = parseFloat(amount) || 0;
  const eurPreview = rate != null ? numAmount * rate : null;

  async function handleConvertToEur() {
    if (rate != null) { onToggle(true, rate); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`https://api.frankfurter.app/latest?from=${currency}&to=EUR`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const fetchedRate: number = data.rates?.EUR;
      if (!fetchedRate) throw new Error();
      onToggle(true, fetchedRate);
    } catch {
      setError("Couldn't fetch live rate. Check connection or try a supported currency.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 space-y-2">
      <div className="text-xs font-medium text-amber-400/80">Non-default currency — how to show in dashboard</div>
      <div className="flex gap-2 flex-wrap">
        <button type="button" disabled={disabled} onClick={() => onToggle(false, null)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${!displayAsEur ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:bg-accent"}`}>
          Keep as {getCurrencySymbol(currency)} {currency}
        </button>
        <button type="button" disabled={disabled || loading} onClick={handleConvertToEur}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${displayAsEur ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:bg-accent"}`}>
          {loading ? "Fetching rate…" : "Convert to € EUR"}
        </button>
      </div>
      {displayAsEur && eurPreview != null && rate != null ? (
        <div className="text-xs text-muted-foreground">
          {getCurrencySymbol(currency)}{numAmount.toFixed(2)} → <span className="font-medium text-foreground">€{eurPreview.toFixed(2)}</span>
          <span className="ml-1.5 opacity-60">@ {rate.toFixed(5)} · live rate</span>
        </div>
      ) : null}
      {error ? <div className="text-xs text-red-400">{error}</div> : null}
    </div>
  );
}

function RecurringSettingsPanel({
  cadence,
  recurringVariable,
  recurringAutoAdd,
  onRecurringVariableChange,
  onRecurringAutoAddChange,
  disabled = false,
}: {
  cadence: string;
  recurringVariable: boolean;
  recurringAutoAdd: boolean;
  onRecurringVariableChange: (value: boolean) => void;
  onRecurringAutoAddChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  if (!isRecurringCadence(cadence)) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-background p-4">
      <div>
        <div className="text-sm font-medium">Recurring behavior</div>
        <p className="text-xs text-muted-foreground">Choose whether the amount stays the same and whether SpendHound should create the next due entry automatically.</p>
      </div>
      <label className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <input type="checkbox" checked={recurringVariable} onChange={(e) => onRecurringVariableChange(e.target.checked)} disabled={disabled} className="mt-0.5" />
        <span>
          <span className="block font-medium">Variable over months</span>
          <span className="text-xs text-muted-foreground">Use this for bills like electricity or water where the amount often changes.</span>
        </span>
      </label>
      <label className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <input type="checkbox" checked={recurringAutoAdd} onChange={(e) => onRecurringAutoAddChange(e.target.checked)} disabled={disabled} className="mt-0.5" />
        <span>
          <span className="block font-medium">Auto-add at the start of each due month</span>
          <span className="text-xs text-muted-foreground">Monthly recurring items are added at the start of each month. Yearly and custom-interval items are added when their due month comes around.</span>
        </span>
      </label>
      {recurringVariable && recurringAutoAdd ? (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-300">
          Variable recurring entries are auto-added as drafts using the previous amount, then marked for review so you can adjust them before relying on them.
        </div>
      ) : null}
    </div>
  );
}

function LedgerSelector({
  ledgers, selectedLedgerId, onSelect,
  newLedgerFormOpen, onToggleNewForm,
  newLedgerName, onNewLedgerNameChange,
  newLedgerType, onNewLedgerTypeChange,
  partners, selectedMemberIds, onMemberIdsChange,
  onCreateLedger, creatingLedger, disabled = false,
}: {
  ledgers: Ledger[];
  selectedLedgerId: string;
  onSelect: (id: string) => void;
  newLedgerFormOpen: boolean;
  onToggleNewForm: () => void;
  newLedgerName: string;
  onNewLedgerNameChange: (v: string) => void;
  newLedgerType: "personal" | "shared";
  onNewLedgerTypeChange: (v: "personal" | "shared") => void;
  partners: Partner[];
  selectedMemberIds: string[];
  onMemberIdsChange: (ids: string[]) => void;
  onCreateLedger: () => void;
  creatingLedger: boolean;
  disabled?: boolean;
}) {
  function toggleMember(userId: string) {
    onMemberIdsChange(
      selectedMemberIds.includes(userId)
        ? selectedMemberIds.filter((id) => id !== userId)
        : [...selectedMemberIds, userId]
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-background p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">Save to ledger</div>
        <button type="button" disabled={disabled} onClick={onToggleNewForm} className="text-xs text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60">
          {newLedgerFormOpen ? "Cancel" : "+ New ledger"}
        </button>
      </div>
      <select value={selectedLedgerId} onChange={(e) => onSelect(e.target.value)} disabled={disabled} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60">
        <option value="">General</option>
        {ledgers.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
      </select>
      {newLedgerFormOpen && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-3">
          <input placeholder="Ledger name" value={newLedgerName} onChange={(e) => onNewLedgerNameChange(e.target.value)} disabled={creatingLedger} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-60" />
          <div className="flex gap-2">
            {(["personal", "shared"] as const).map((t) => (
              <button key={t} type="button" disabled={creatingLedger} onClick={() => onNewLedgerTypeChange(t)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize ${newLedgerType === t ? "border-primary bg-primary/5 text-primary" : "border-border bg-background hover:bg-accent"} disabled:cursor-not-allowed disabled:opacity-60`}>
                {t}
              </button>
            ))}
          </div>
          {newLedgerType === "shared" && partners.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground font-medium">Add partners</div>
              {partners.map((p) => (
                <label key={p.id} className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs cursor-pointer hover:bg-accent">
                  <input type="checkbox" checked={selectedMemberIds.includes(p.id)} onChange={() => toggleMember(p.id)} disabled={creatingLedger} className="shrink-0" />
                  <span className="flex flex-col">
                    <span className="font-medium">{p.name || p.email}</span>
                    {p.name && <span className="text-muted-foreground">{p.email}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
          <button type="button" onClick={onCreateLedger} disabled={creatingLedger || !newLedgerName.trim()} className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60">
            {creatingLedger ? "Creating…" : "Create ledger"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function NewExpensePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const receiptFinalizeInFlightRef = useRef(false);
  const statementFinalizeInFlightRef = useRef(false);
  const draftRestoredFromStorageRef = useRef(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptSuccess, setReceiptSuccess] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [finalizingReceipt, setFinalizingReceipt] = useState(false);
  const [lastReceiptFile, setLastReceiptFile] = useState<File | null>(null);
  const [manualForm, setManualForm] = useState<ExpenseFormState>(createEmptyExpenseForm);
  const [receiptDraft, setReceiptDraft] = useState<ReceiptDraftState>(createEmptyReceiptDraft);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [statementDraft, setStatementDraft] = useState<ReceiptDraftState>(createEmptyStatementDraft);
  const [selectedStatement, setSelectedStatement] = useState<Receipt | null>(null);
  const [statementIndex, setStatementIndex] = useState(0);
  const [statementError, setStatementError] = useState<string | null>(null);
  const [statementSuccess, setStatementSuccess] = useState<string | null>(null);
  const [uploadingStatement, setUploadingStatement] = useState(false);
  const [finalizingStatement, setFinalizingStatement] = useState(false);
  const [itemsCurrency, setItemsCurrency] = useState(DEFAULT_CURRENCY);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedLedgerId, setSelectedLedgerId] = useState("");
  const [newLedgerFormOpen, setNewLedgerFormOpen] = useState(false);
  const [newLedgerName, setNewLedgerName] = useState("");
  const [newLedgerType, setNewLedgerType] = useState<"personal" | "shared">("personal");
  const [newLedgerMemberIds, setNewLedgerMemberIds] = useState<string[]>([]);
  const [creatingLedger, setCreatingLedger] = useState(false);
  const [manualItems, setManualItems] = useState<ReceiptPreviewItem[]>([]);
  const [manualItemsCurrency, setManualItemsCurrency] = useState(DEFAULT_CURRENCY);
  const [manualDisplayAsEur, setManualDisplayAsEur] = useState(false);
  const [manualEurRate, setManualEurRate] = useState<number | null>(null);
  const [receiptDisplayAsEur, setReceiptDisplayAsEur] = useState(false);
  const [receiptEurRate, setReceiptEurRate] = useState<number | null>(null);
  const [statementDisplayAsEur, setStatementDisplayAsEur] = useState(false);
  const [statementEurRate, setStatementEurRate] = useState<number | null>(null);

  const activeTab = [RECEIPT_TAB, STATEMENT_TAB].includes(searchParams.get("tab") || "") ? searchParams.get("tab") as string : MANUAL_TAB;

  useEffect(() => { setReceiptDisplayAsEur(false); setReceiptEurRate(null); }, [receiptDraft.currency]);
  useEffect(() => { setStatementDisplayAsEur(false); setStatementEurRate(null); }, [statementDraft.currency]);

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
    listLedgers().then((res) => setLedgers(res.ledgers)).catch(() => {});
    listPartners().then((res) => setPartners(res.partners)).catch(() => {});
  }, []);

  // Restore receipt draft from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("spendhound_receipt_draft");
      if (stored) {
        const { receipt, draft } = JSON.parse(stored);
        if (receipt) {
          draftRestoredFromStorageRef.current = true;
          setSelectedReceipt(receipt);
          if (draft) setReceiptDraft(draft);
        }
      }
    } catch {}
  }, []);

  // Save receipt draft to localStorage whenever it changes
  useEffect(() => {
    if (!selectedReceipt) return;
    try {
      localStorage.setItem("spendhound_receipt_draft", JSON.stringify({ receipt: selectedReceipt, draft: receiptDraft }));
    } catch {}
  }, [selectedReceipt, receiptDraft]);

  useEffect(() => {
    if (draftRestoredFromStorageRef.current) return;
    const preview = selectedReceipt?.preview;
    if (!isReceiptPreview(preview)) return;
    setReceiptDraft(createReceiptDraftFromPreview(preview, categories));
    setItemsCurrency(preview.currency ?? DEFAULT_CURRENCY);
  }, [categories, selectedReceipt]);

  const receiptPreview = useMemo(() => (isReceiptPreview(selectedReceipt?.preview) ? selectedReceipt.preview : null), [selectedReceipt]);
  const extractedItems = useMemo(() => receiptDraft.items ?? [], [receiptDraft.items]);
  const statementEntries = useMemo(() => (selectedStatement?.preview && isStatementPreview(selectedStatement.preview) ? selectedStatement.preview.entries : []), [selectedStatement]);
  const currentStatementEntry = statementEntries[statementIndex] ?? null;

  useEffect(() => {
    if (!currentStatementEntry) return;
    setStatementDraft({
      merchant: currentStatementEntry.merchant ?? "",
      amount: currentStatementEntry.amount != null ? String(currentStatementEntry.amount) : "",
      transaction_type: currentStatementEntry.transaction_type ?? "debit",
      cadence: currentStatementEntry.cadence ?? "one_time",
      cadence_interval: 3,
      prepaid_months: 12,
      prepaid_start_date: currentStatementEntry.expense_date ?? new Date().toISOString().slice(0, 10),
      recurring_variable: currentStatementEntry.recurring_variable ?? false,
      recurring_auto_add: currentStatementEntry.recurring_auto_add ?? false,
      is_major_purchase: currentStatementEntry.is_major_purchase ?? false,
      currency: currentStatementEntry.currency ?? "EUR",
      expense_date: currentStatementEntry.expense_date ?? new Date().toISOString().slice(0, 10),
      description: currentStatementEntry.description ?? "",
      category_id: "",
      category_name: currentStatementEntry.category_name ?? "",
      notes: currentStatementEntry.notes ?? "",
      confidence: String(currentStatementEntry.confidence ?? 0.5),
      items: [],
    });
  }, [currentStatementEntry]);

  useEffect(() => {
    if (draftRestoredFromStorageRef.current) return;
    const preview = selectedReceipt?.preview;
    if (!isReceiptPreview(preview) || !preview.category_name) return;
    const categoryId = findCategoryIdByName(categories, preview.transaction_type ?? "debit", preview.category_name);
    if (!categoryId) return;
    setReceiptDraft((current) => current.category_id === categoryId ? current : { ...current, category_id: categoryId, category_name: "" });
  }, [categories, selectedReceipt]);

  useEffect(() => {
    if (!currentStatementEntry?.category_name) return;
    const categoryId = findCategoryIdByName(categories, currentStatementEntry.transaction_type ?? "debit", currentStatementEntry.category_name);
    if (!categoryId) return;
    setStatementDraft((current) => current.category_id === categoryId ? current : { ...current, category_id: categoryId, category_name: "" });
  }, [categories, currentStatementEntry]);

  function addManualItem() {
    setManualItems((current) => [...current, { id: crypto.randomUUID(), description: "", quantity: null, unit_price: null, total: null, subcategory: null }]);
  }

  function removeManualItem(index: number) {
    setManualItems((current) => current.filter((_, i) => i !== index));
  }

  function updateManualItem(index: number, field: keyof ReceiptPreviewItem, value: string) {
    setManualItems((current) => current.map((item, i) => i !== index ? item : {
      ...item,
      [field]: value === "" ? null : field === "description" || field === "subcategory" ? value : Number(value),
    }));
  }

  function updateReceiptItem(index: number, field: keyof ReceiptPreviewItem, value: string) {
    setReceiptDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex !== index ? item : {
        ...item,
        [field]: value === "" ? null : field === "description" || field === "subcategory" ? value : Number(value),
      }),
    }));
  }

  function quantityModeForItem(item: ReceiptPreviewItem) {
    if (item.quantity == null) return "1";
    const normalized = String(item.quantity);
    return ITEM_QUANTITY_OPTIONS.includes(normalized) ? normalized : "custom";
  }

  function removeReceiptItem(index: number) {
    setReceiptDraft((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }));
  }

  function addReceiptItem() {
    setReceiptDraft((current) => ({ ...current, items: [...current.items, { id: crypto.randomUUID(), description: "", quantity: null, unit_price: null, total: null, subcategory: null }] }));
  }

  function resetReceiptDraft() {
    setSelectedReceipt(null);
    setLastReceiptFile(null);
    setReceiptDraft(createEmptyReceiptDraft());
    setReceiptSuccess(null);
    setItemsCurrency(DEFAULT_CURRENCY);
    draftRestoredFromStorageRef.current = false;
    localStorage.removeItem("spendhound_receipt_draft");
  }

  async function handleCreateLedger() {
    if (!newLedgerName.trim()) return;
    setCreatingLedger(true);
    try {
      const ledger = await createLedger({
        name: newLedgerName.trim(),
        type: newLedgerType,
        member_user_ids: newLedgerType === "shared" ? newLedgerMemberIds : undefined,
      });
      setLedgers((prev) => [...prev, ledger]);
      setSelectedLedgerId(ledger.id);
      setNewLedgerFormOpen(false);
      setNewLedgerName("");
      setNewLedgerType("personal");
      setNewLedgerMemberIds([]);
    } catch {}
    finally { setCreatingLedger(false); }
  }

  function setTab(tab: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === MANUAL_TAB) {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    const query = params.toString();
    router.replace(query ? `/expenses/new?${query}` : "/expenses/new");
  }

  async function handleManualSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setManualError(null);
    const manualFinalAmount = manualDisplayAsEur && manualEurRate ? Math.round(Number(manualForm.amount) * manualEurRate * 100) / 100 : Number(manualForm.amount);
    const manualFinalCurrency = manualDisplayAsEur ? DEFAULT_CURRENCY : manualForm.currency;
    const manualOriginalNote = manualDisplayAsEur ? `[Converted from ${manualForm.currency}: ${getCurrencySymbol(manualForm.currency)}${manualForm.amount}]` : null;
    try {
      await createExpense({
        merchant: manualForm.merchant,
        description: manualForm.description || null,
        amount: manualFinalAmount,
        transaction_type: manualForm.transaction_type,
        cadence: manualForm.cadence,
        cadence_interval: manualForm.cadence === "custom" ? manualForm.cadence_interval : undefined,
        prepaid_months: manualForm.cadence === "prepaid" ? manualForm.prepaid_months : undefined,
        prepaid_start_date: manualForm.cadence === "prepaid" ? manualForm.prepaid_start_date : undefined,
        recurring_variable: manualForm.recurring_variable,
        recurring_auto_add: manualForm.recurring_auto_add,
        is_major_purchase: manualForm.is_major_purchase,
        currency: manualFinalCurrency,
        expense_date: manualForm.expense_date,
        category_id: manualForm.category_id || null,
        category_name: manualForm.category_id ? null : manualForm.category_name || null,
        notes: manualOriginalNote ? [manualOriginalNote, manualForm.notes].filter(Boolean).join("\n") : manualForm.notes || null,
        items: manualItems.length > 0 ? manualItems : null,
        ledger_id: selectedLedgerId || null,
      });
      router.push("/expenses");
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Failed to save expense");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setLastReceiptFile(file);
    setUploading(true);
    setReceiptError(null);
    setReceiptSuccess(null);
    try {
      const receipt = await uploadReceipt(file);
      draftRestoredFromStorageRef.current = false;
      setSelectedReceipt(receipt);
      setReceiptSuccess(`Uploaded ${receipt.original_filename}. Review the extracted fields before saving.`);
      setTab(RECEIPT_TAB);
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function retryReceiptUpload() {
    if (!lastReceiptFile) return;
    setUploading(true);
    setReceiptError(null);
    setReceiptSuccess(null);
    try {
      const receipt = await uploadReceipt(lastReceiptFile);
      setSelectedReceipt(receipt);
      setReceiptSuccess(`Retried ${receipt.original_filename}. Review the refreshed extraction before saving.`);
      setTab(RECEIPT_TAB);
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleReceiptFinalize() {
    if (!selectedReceipt || receiptFinalizeInFlightRef.current) return;
    receiptFinalizeInFlightRef.current = true;
    setFinalizingReceipt(true);
    setReceiptError(null);
    setReceiptSuccess(null);
    const receiptFinalAmount = receiptDisplayAsEur && receiptEurRate ? Math.round(Number(receiptDraft.amount) * receiptEurRate * 100) / 100 : Number(receiptDraft.amount);
    const receiptFinalCurrency = receiptDisplayAsEur ? DEFAULT_CURRENCY : receiptDraft.currency;
    const receiptOriginalNote = receiptDisplayAsEur ? `[Converted from ${receiptDraft.currency}: ${getCurrencySymbol(receiptDraft.currency)}${receiptDraft.amount}]` : null;
    try {
      const savedExpense = await createExpenseFromReceipt({
        receipt_id: selectedReceipt.id,
        merchant: receiptDraft.merchant,
        description: receiptDraft.description || null,
        amount: receiptFinalAmount,
        transaction_type: receiptDraft.transaction_type,
        cadence: receiptDraft.cadence,
        cadence_interval: receiptDraft.cadence === "custom" ? receiptDraft.cadence_interval : undefined,
        prepaid_months: receiptDraft.cadence === "prepaid" ? receiptDraft.prepaid_months : undefined,
        prepaid_start_date: receiptDraft.cadence === "prepaid" ? receiptDraft.prepaid_start_date : undefined,
        recurring_variable: receiptDraft.recurring_variable,
        recurring_auto_add: receiptDraft.recurring_auto_add,
        is_major_purchase: receiptDraft.is_major_purchase,
        currency: receiptFinalCurrency,
        expense_date: receiptDraft.expense_date,
        category_id: receiptDraft.category_id || null,
        category_name: receiptDraft.category_id ? null : receiptDraft.category_name || null,
        notes: receiptOriginalNote ? [receiptOriginalNote, receiptDraft.notes].filter(Boolean).join("\n") : receiptDraft.notes || null,
        items: receiptDraft.items,
        confidence: Number(receiptDraft.confidence),
        ledger_id: selectedLedgerId || null,
      });
      localStorage.removeItem("spendhound_receipt_draft");
      router.push(`/expenses?month=${savedExpense.expense_date.slice(0, 7)}`);
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : "Failed to save receipt");
    } finally {
      receiptFinalizeInFlightRef.current = false;
      setFinalizingReceipt(false);
    }
  }

  async function handleStatementFinalize() {
    if (!selectedStatement || statementFinalizeInFlightRef.current) return;
    statementFinalizeInFlightRef.current = true;
    setFinalizingStatement(true);
    setStatementError(null);
    setStatementSuccess(null);
    const stmtFinalAmount = statementDisplayAsEur && statementEurRate ? Math.round(Number(statementDraft.amount) * statementEurRate * 100) / 100 : Number(statementDraft.amount);
    const stmtFinalCurrency = statementDisplayAsEur ? DEFAULT_CURRENCY : statementDraft.currency;
    const stmtOriginalNote = statementDisplayAsEur ? `[Converted from ${statementDraft.currency}: ${getCurrencySymbol(statementDraft.currency)}${statementDraft.amount}]` : null;
    try {
      const result = await createExpenseFromStatementEntry({
        receipt_id: selectedStatement.id,
        entry_index: statementIndex,
        merchant: statementDraft.merchant,
        description: statementDraft.description || null,
        amount: stmtFinalAmount,
        transaction_type: statementDraft.transaction_type,
        cadence: statementDraft.cadence,
        cadence_interval: statementDraft.cadence === "custom" ? statementDraft.cadence_interval : undefined,
        prepaid_months: statementDraft.cadence === "prepaid" ? statementDraft.prepaid_months : undefined,
        prepaid_start_date: statementDraft.cadence === "prepaid" ? statementDraft.prepaid_start_date : undefined,
        recurring_variable: statementDraft.recurring_variable,
        recurring_auto_add: statementDraft.recurring_auto_add,
        is_major_purchase: statementDraft.is_major_purchase,
        currency: stmtFinalCurrency,
        expense_date: statementDraft.expense_date,
        category_id: statementDraft.category_id || null,
        category_name: statementDraft.category_id ? null : statementDraft.category_name || null,
        notes: stmtOriginalNote ? [stmtOriginalNote, statementDraft.notes].filter(Boolean).join("\n") : statementDraft.notes || null,
        confidence: Number(statementDraft.confidence),
        ledger_id: selectedLedgerId || null,
      });
      setSelectedStatement(result.statement);
      const nextEntries = result.statement.preview && isStatementPreview(result.statement.preview) ? result.statement.preview.entries : [];
      const nextIndex = findNextPendingIndex(nextEntries);
      if (nextIndex === -1) {
        router.push(`/expenses?month=${result.expense.expense_date.slice(0, 7)}`);
        return;
      }
      setStatementIndex(nextIndex);
      setStatementSuccess(`Saved ${result.expense.merchant}. Continue reviewing the remaining statement entries.`);
    } catch (err) {
      setStatementError(err instanceof Error ? err.message : "Failed to save statement entry");
    } finally {
      statementFinalizeInFlightRef.current = false;
      setFinalizingStatement(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Add transaction</h1>
        <p className="text-sm text-muted-foreground">Add money out or money in manually, or review imported receipt and statement drafts before anything is saved.</p>
      </div>
      <div className="flex gap-2 border-b border-border">
        <button type="button" onClick={() => setTab(MANUAL_TAB)} className={`rounded-t-xl px-4 py-2 text-sm font-medium ${activeTab === MANUAL_TAB ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Manual</button>
        <button type="button" onClick={() => setTab(RECEIPT_TAB)} className={`rounded-t-xl px-4 py-2 text-sm font-medium ${activeTab === RECEIPT_TAB ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Upload receipt</button>
        <button type="button" onClick={() => setTab(STATEMENT_TAB)} className={`rounded-t-xl px-4 py-2 text-sm font-medium ${activeTab === STATEMENT_TAB ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Import statement PDF</button>
      </div>

      {activeTab === MANUAL_TAB ? (
        <form onSubmit={handleManualSubmit} className="space-y-4 rounded-2xl border border-border bg-card p-6">
          {manualError ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{manualError}</div> : null}
          <TransactionTypeSelector value={manualForm.transaction_type} onChange={(transaction_type) => setManualForm({ ...manualForm, transaction_type, category_id: "", category_name: "" })} />
          <CadenceSelector value={manualForm.cadence} onChange={(cadence) => setManualForm(applyCadenceSelection(manualForm, cadence))} />
          <CustomIntervalPanel
            cadence={manualForm.cadence}
            interval={manualForm.cadence_interval}
            onIntervalChange={(cadence_interval) => setManualForm({ ...manualForm, cadence_interval })}
          />
          <PrepaidSettingsPanel
            cadence={manualForm.cadence}
            prepaidMonths={manualForm.prepaid_months}
            prepaidStartDate={manualForm.prepaid_start_date}
            onPrepaidMonthsChange={(prepaid_months) => setManualForm({ ...manualForm, prepaid_months })}
            onPrepaidStartDateChange={(prepaid_start_date) => setManualForm({ ...manualForm, prepaid_start_date })}
          />
          <RecurringSettingsPanel
            cadence={manualForm.cadence}
            recurringVariable={manualForm.recurring_variable}
            recurringAutoAdd={manualForm.recurring_auto_add}
            onRecurringVariableChange={(recurring_variable) => setManualForm({ ...manualForm, recurring_variable })}
            onRecurringAutoAddChange={(recurring_auto_add) => setManualForm({ ...manualForm, recurring_auto_add })}
          />
          {manualForm.transaction_type === "debit" && manualForm.cadence === "one_time" ? <MajorPurchaseToggle checked={manualForm.is_major_purchase} onChange={(is_major_purchase) => setManualForm({ ...manualForm, is_major_purchase })} /> : null}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">{manualForm.transaction_type === "credit" ? "Source / payer" : "Merchant"}</span><input required value={manualForm.merchant} onChange={(e) => setManualForm({ ...manualForm, merchant: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Amount</span><input required type="number" step="0.01" value={manualForm.amount} onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Date</span><input required type="date" value={manualForm.expense_date} onChange={(e) => setManualForm({ ...manualForm, expense_date: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Currency</span>
              <CurrencySelector value={manualForm.currency} onChange={(currency) => { setManualForm({ ...manualForm, currency }); if (currency === DEFAULT_CURRENCY) { setManualDisplayAsEur(false); setManualEurRate(null); } }} />
            </label>
          </div>
          {manualForm.currency !== DEFAULT_CURRENCY ? (
            <CurrencyDisplayToggle currency={manualForm.currency} amount={manualForm.amount} displayAsEur={manualDisplayAsEur} rate={manualEurRate} onToggle={(dae, r) => { setManualDisplayAsEur(dae); setManualEurRate(r); }} />
          ) : null}
          <label className="text-sm"><span className="mb-1 block text-muted-foreground">Description</span><input value={manualForm.description} onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Category</span>
              <select value={manualForm.category_id} onChange={(e) => setManualForm({ ...manualForm, category_id: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                <option value="">Use rule or custom name</option>
                {filteredCategories(categories, manualForm.transaction_type).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Custom category name</span><input value={manualForm.category_name} onChange={(e) => setManualForm({ ...manualForm, category_name: e.target.value })} disabled={!!manualForm.category_id} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:opacity-50" /></label>
          </div>
          <div className="rounded-2xl border border-border bg-background p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">Nested items</div>
                <p className="text-xs text-muted-foreground">Optionally break this expense into line-items (e.g. grocery products).</p>
              </div>
              <div className="flex items-center gap-2">
                {manualItems.length > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>Currency</span>
                    <select value={manualItemsCurrency} onChange={(e) => setManualItemsCurrency(e.target.value)} className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground">
                      {COMMON_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
                    </select>
                  </label>
                )}
                <button type="button" onClick={addManualItem} className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-accent">Add item</button>
              </div>
            </div>
            {manualItems.length > 0 && (
              <table className="w-full text-sm border-collapse table-fixed">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Item</th>
                    <th className="pb-2 font-medium w-12 text-center">Qty</th>
                    <th className="pb-2 font-medium w-24">Total</th>
                    <th className="pb-2 font-medium w-32">Subcategory</th>
                    <th className="pb-2 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {manualItems.map((item, index) => (
                    <tr key={item.id ?? index} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-4 min-w-0">
                        <input type="text" value={item.description ?? ""} onChange={(e) => updateManualItem(index, "description", e.target.value)} placeholder={`Item ${index + 1}`} className="w-full min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
                      </td>
                      <td className="py-2 pr-3 text-center w-12">
                        <select value={quantityModeForItem(item)} onChange={(e) => updateManualItem(index, "quantity", e.target.value === "custom" ? "" : e.target.value)} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                          {ITEM_QUANTITY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                          <option value="custom">…</option>
                        </select>
                      </td>
                      <td className="py-2 pr-3 w-24">
                        <div className="flex items-center rounded-md border border-border bg-background px-2 py-1.5 w-full">
                          <span className="text-xs text-muted-foreground select-none mr-1">{getCurrencySymbol(manualItemsCurrency)}</span>
                          <input type="number" step="0.01" value={item.total ?? ""} onChange={(e) => updateManualItem(index, "total", e.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none" />
                        </div>
                      </td>
                      <td className="py-2 pr-3 w-32">
                        <select value={ITEM_SUBCATEGORY_OPTIONS.includes(item.subcategory ?? "") ? item.subcategory ?? "" : item.subcategory ? "__custom__" : ""} onChange={(e) => updateManualItem(index, "subcategory", e.target.value === "__custom__" ? (item.subcategory && !ITEM_SUBCATEGORY_OPTIONS.includes(item.subcategory) ? item.subcategory : "") : e.target.value)} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                          <option value="">None</option>
                          {ITEM_SUBCATEGORY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                          <option value="__custom__">Custom…</option>
                        </select>
                        {!ITEM_SUBCATEGORY_OPTIONS.includes(item.subcategory ?? "") && item.subcategory ? (
                          <input value={item.subcategory} onChange={(e) => updateManualItem(index, "subcategory", e.target.value)} className="mt-1.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground" placeholder="Custom subcategory" />
                        ) : null}
                      </td>
                      <td className="py-2 w-8">
                        <button type="button" onClick={() => removeManualItem(index)} aria-label={`Remove item ${index + 1}`} className="flex h-6 w-6 items-center justify-center rounded-md bg-red-600 text-xs font-bold text-white hover:bg-red-700">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <LedgerSelector ledgers={ledgers} selectedLedgerId={selectedLedgerId} onSelect={setSelectedLedgerId} newLedgerFormOpen={newLedgerFormOpen} onToggleNewForm={() => setNewLedgerFormOpen((v) => !v)} newLedgerName={newLedgerName} onNewLedgerNameChange={setNewLedgerName} newLedgerType={newLedgerType} onNewLedgerTypeChange={setNewLedgerType} partners={partners} selectedMemberIds={newLedgerMemberIds} onMemberIdsChange={setNewLedgerMemberIds} onCreateLedger={handleCreateLedger} creatingLedger={creatingLedger} />
          <label className="text-sm"><span className="mb-1 block text-muted-foreground">Notes</span><textarea value={manualForm.notes} onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })} rows={4} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => router.push("/expenses")} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent">Cancel</button>
            <button disabled={submitting} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">{submitting ? "Saving…" : "Save transaction"}</button>
          </div>
        </form>
      ) : activeTab === RECEIPT_TAB ? (
        <>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Left column: upload + big selectors + extraction notes */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-xl font-semibold">Upload receipt</h2>
              <p className="mt-1 text-sm text-muted-foreground">Receipt import stays expense-focused by default, but you can switch the reviewed draft to money in if the document is clearly a refund or reimbursement.</p>
              <label className="mt-4 flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm hover:bg-accent">
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleUpload} />
                {uploading ? "Uploading…" : "Choose a receipt image or PDF"}
              </label>
              {selectedReceipt ? (
                <div className="mt-4 rounded-xl border border-border bg-background p-3 text-sm">
                  <div className="font-medium">Current receipt</div>
                  <div className="mt-1 text-muted-foreground">{selectedReceipt.original_filename}</div>
                  <div className="mt-2 text-xs text-muted-foreground">Confidence: {Math.round((selectedReceipt.extraction_confidence ?? 0) * 100)}% · Status: {selectedReceipt.extraction_status}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={retryReceiptUpload} disabled={uploading || finalizingReceipt || !lastReceiptFile} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60">{uploading ? "Retrying…" : "Try again"}</button>
                    <button type="button" onClick={resetReceiptDraft} disabled={finalizingReceipt} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
                  </div>
                </div>
              ) : null}
            </div>

            {selectedReceipt ? (
              <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                {finalizingReceipt ? <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">Saving approved receipt… Please wait.</div> : null}
                <TransactionTypeSelector value={receiptDraft.transaction_type} onChange={(transaction_type) => setReceiptDraft({ ...receiptDraft, transaction_type, category_id: "", category_name: "" })} disabled={finalizingReceipt} />
                <CadenceSelector value={receiptDraft.cadence} onChange={(cadence) => setReceiptDraft(applyCadenceSelection(receiptDraft, cadence))} disabled={finalizingReceipt} />
                <CustomIntervalPanel
                  cadence={receiptDraft.cadence}
                  interval={receiptDraft.cadence_interval}
                  onIntervalChange={(cadence_interval) => setReceiptDraft({ ...receiptDraft, cadence_interval })}
                  disabled={finalizingReceipt}
                />
                <PrepaidSettingsPanel
                  cadence={receiptDraft.cadence}
                  prepaidMonths={receiptDraft.prepaid_months}
                  prepaidStartDate={receiptDraft.prepaid_start_date}
                  onPrepaidMonthsChange={(prepaid_months) => setReceiptDraft({ ...receiptDraft, prepaid_months })}
                  onPrepaidStartDateChange={(prepaid_start_date) => setReceiptDraft({ ...receiptDraft, prepaid_start_date })}
                  disabled={finalizingReceipt}
                />
                <RecurringSettingsPanel
                  cadence={receiptDraft.cadence}
                  recurringVariable={receiptDraft.recurring_variable}
                  recurringAutoAdd={receiptDraft.recurring_auto_add}
                  onRecurringVariableChange={(recurring_variable) => setReceiptDraft({ ...receiptDraft, recurring_variable })}
                  onRecurringAutoAddChange={(recurring_auto_add) => setReceiptDraft({ ...receiptDraft, recurring_auto_add })}
                  disabled={finalizingReceipt}
                />
                {receiptDraft.transaction_type === "debit" && receiptDraft.cadence === "one_time" ? <MajorPurchaseToggle checked={receiptDraft.is_major_purchase} onChange={(is_major_purchase) => setReceiptDraft({ ...receiptDraft, is_major_purchase })} disabled={finalizingReceipt} /> : null}
              </div>
            ) : null}

          </div>

          {/* Right column: extracted items + detail fields */}
          <div className="space-y-4">
            {receiptError ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{receiptError}</div> : null}

            {extractedItems.length > 0 ? (
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between gap-2 text-sm font-medium">
                  <span>Extracted items</span>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>Currency</span>
                      <select value={itemsCurrency} onChange={(e) => setItemsCurrency(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground">
                        {COMMON_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={addReceiptItem} className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-accent">Add item</button>
                  </div>
                </div>
                <table className="w-full text-sm border-collapse table-fixed">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Item</th>
                      <th className="pb-2 font-medium w-12 text-center">Qty</th>
                      <th className="pb-2 font-medium w-24">Total</th>
                      <th className="pb-2 font-medium w-32">Subcategory</th>
                      <th className="pb-2 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {extractedItems.map((item, index) => (
                      <tr key={item.id ?? index} className="border-b border-border/40 last:border-0">
                        <td className="py-2 pr-4 min-w-0">
                          <input
                            type="text"
                            value={item.description ?? ""}
                            onChange={(e) => updateReceiptItem(index, "description", e.target.value)}
                            placeholder={`Item ${index + 1}`}
                            className="w-full min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                          />
                        </td>
                        <td className="py-2 pr-3 text-center w-12">
                          <select value={quantityModeForItem(item)} onChange={(e) => updateReceiptItem(index, "quantity", e.target.value === "custom" ? "" : e.target.value)} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                            {ITEM_QUANTITY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                            <option value="custom">…</option>
                          </select>
                        </td>
                        <td className="py-2 pr-3 w-24">
                          <div className="flex items-center rounded-md border border-border bg-background px-2 py-1.5 w-full">
                            <span className="text-xs text-muted-foreground select-none mr-1">{getCurrencySymbol(itemsCurrency)}</span>
                            <input type="number" step="0.01" value={item.total ?? ""} onChange={(e) => updateReceiptItem(index, "total", e.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none" />
                          </div>
                        </td>
                        <td className="py-2 pr-3 w-32">
                          <select value={ITEM_SUBCATEGORY_OPTIONS.includes(item.subcategory ?? "") ? item.subcategory ?? "" : item.subcategory ? "__custom__" : ""} onChange={(e) => updateReceiptItem(index, "subcategory", e.target.value === "__custom__" ? (item.subcategory && !ITEM_SUBCATEGORY_OPTIONS.includes(item.subcategory) ? item.subcategory : "") : e.target.value)} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                            <option value="">None</option>
                            {ITEM_SUBCATEGORY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                            <option value="__custom__">Custom…</option>
                          </select>
                          {!ITEM_SUBCATEGORY_OPTIONS.includes(item.subcategory ?? "") && item.subcategory ? (
                            <input value={item.subcategory} onChange={(e) => updateReceiptItem(index, "subcategory", e.target.value)} className="mt-1.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground" placeholder="Custom subcategory" />
                          ) : null}
                        </td>
                        <td className="py-2 w-8">
                          <button type="button" onClick={() => removeReceiptItem(index)} aria-label={`Remove item ${index + 1}`} className="flex h-6 w-6 items-center justify-center rounded-md bg-red-600 text-xs font-bold text-white hover:bg-red-700">×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {!selectedReceipt ? (
              <div className="rounded-2xl border border-border bg-card py-20 text-center text-muted-foreground">Upload a receipt to review extracted fields.</div>
            ) : (
              <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">{receiptDraft.transaction_type === "credit" ? "Source / payer" : "Merchant"}</span><input value={receiptDraft.merchant} onChange={(e) => setReceiptDraft({ ...receiptDraft, merchant: e.target.value })} disabled={finalizingReceipt} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Amount</span><input type="number" step="0.01" value={receiptDraft.amount} onChange={(e) => setReceiptDraft({ ...receiptDraft, amount: e.target.value })} disabled={finalizingReceipt} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Date</span><input type="date" value={receiptDraft.expense_date} onChange={(e) => setReceiptDraft({ ...receiptDraft, expense_date: e.target.value })} disabled={finalizingReceipt} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                  <label className="text-sm">
                    <span className="mb-1 block text-muted-foreground">Currency</span>
                    <CurrencySelector value={receiptDraft.currency} onChange={(currency) => setReceiptDraft({ ...receiptDraft, currency })} disabled={finalizingReceipt} />
                  </label>
                </div>
                {receiptDraft.currency !== DEFAULT_CURRENCY ? (
                  <CurrencyDisplayToggle currency={receiptDraft.currency} amount={receiptDraft.amount} displayAsEur={receiptDisplayAsEur} rate={receiptEurRate} onToggle={(dae, r) => { setReceiptDisplayAsEur(dae); setReceiptEurRate(r); }} disabled={finalizingReceipt} />
                ) : null}
                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Description</span><input value={receiptDraft.description} onChange={(e) => setReceiptDraft({ ...receiptDraft, description: e.target.value })} disabled={finalizingReceipt} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm">
                    <span className="mb-1 block text-muted-foreground">Category</span>
                    <select value={receiptDraft.category_id} onChange={(e) => setReceiptDraft({ ...receiptDraft, category_id: e.target.value })} disabled={finalizingReceipt} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60">
                      <option value="">Use custom or extracted category</option>
                      {filteredCategories(categories, receiptDraft.transaction_type).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Custom category name</span><input value={receiptDraft.category_name} onChange={(e) => setReceiptDraft({ ...receiptDraft, category_name: e.target.value })} disabled={finalizingReceipt || !!receiptDraft.category_id} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                </div>
                <LedgerSelector ledgers={ledgers} selectedLedgerId={selectedLedgerId} onSelect={setSelectedLedgerId} newLedgerFormOpen={newLedgerFormOpen} onToggleNewForm={() => setNewLedgerFormOpen((v) => !v)} newLedgerName={newLedgerName} onNewLedgerNameChange={setNewLedgerName} newLedgerType={newLedgerType} onNewLedgerTypeChange={setNewLedgerType} partners={partners} selectedMemberIds={newLedgerMemberIds} onMemberIdsChange={setNewLedgerMemberIds} onCreateLedger={handleCreateLedger} creatingLedger={creatingLedger} disabled={finalizingReceipt} />
                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Confidence override</span><input type="number" min="0" max="1" step="0.01" value={receiptDraft.confidence} onChange={(e) => setReceiptDraft({ ...receiptDraft, confidence: e.target.value })} disabled={finalizingReceipt} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Notes</span><textarea rows={3} value={receiptDraft.notes} onChange={(e) => setReceiptDraft({ ...receiptDraft, notes: e.target.value })} disabled={finalizingReceipt} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>

                {selectedReceipt.ocr_text ? (
                  <div className="rounded-xl border border-border bg-background p-4">
                    <div className="mb-2 text-sm font-medium">Secondary text fallback preview</div>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{selectedReceipt.ocr_text}</pre>
                  </div>
                ) : null}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-muted-foreground">Estimated: {receiptDraft.amount ? formatSignedCurrency(Number(receiptDraft.amount), receiptDraft.transaction_type, receiptDraft.currency) : "—"} · {transactionCadenceLabel(receiptDraft.cadence)}</div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <button type="button" onClick={resetReceiptDraft} disabled={finalizingReceipt} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
                    <button type="button" onClick={handleReceiptFinalize} disabled={finalizingReceipt || !receiptDraft.merchant || !receiptDraft.amount || !receiptDraft.expense_date} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">{finalizingReceipt ? "Saving transaction…" : "Approve and save transaction"}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        {receiptSuccess ? <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">{receiptSuccess}</div> : null}
        {receiptPreview?.notes ? (
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="text-sm font-medium">Extraction notes</div>
            <p className="mt-2 text-sm text-muted-foreground">{receiptPreview.notes}</p>
          </div>
        ) : null}
        </>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-xl font-semibold">Import bank statement PDF</h2>
              <p className="mt-1 text-sm text-muted-foreground">Upload a statement PDF, extract both debit and credit transactions, then review and approve them one by one before save. Grocery item lines stay empty for statement imports.</p>
              <label className="mt-4 flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm hover:bg-accent">
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setUploadingStatement(true);
                    setStatementError(null);
                    setStatementSuccess(null);
                    try {
                      const receipt = await uploadStatement(file);
                      setSelectedStatement(receipt);
                      const entries = receipt.preview && isStatementPreview(receipt.preview) ? receipt.preview.entries : [];
                      const nextIndex = Math.max(findNextPendingIndex(entries), 0);
                      setStatementIndex(nextIndex);
                      setStatementSuccess(`Imported ${entries.length} candidate transactions from ${receipt.original_filename}. Review each one before saving.`);
                      setTab(STATEMENT_TAB);
                    } catch (err) {
                      setStatementError(err instanceof Error ? err.message : "Statement upload failed");
                    } finally {
                      setUploadingStatement(false);
                      event.target.value = "";
                    }
                  }}
                />
                {uploadingStatement ? "Uploading…" : "Choose a bank statement PDF"}
              </label>
              {selectedStatement ? (
                <div className="mt-4 rounded-xl border border-border bg-background p-3 text-sm">
                  <div className="font-medium">Current statement import</div>
                  <div className="mt-1 text-muted-foreground">{selectedStatement.original_filename}</div>
                  <div className="mt-2 text-xs text-muted-foreground">{statementEntries.length} candidates · Confidence {Math.round((selectedStatement.extraction_confidence ?? 0) * 100)}%</div>
                </div>
              ) : null}
            </div>

            {statementEntries.length > 0 ? (
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-medium">Review queue</div>
                  <div className="text-xs text-muted-foreground">{statementEntries.filter((entry) => entry.status === "pending").length} pending</div>
                </div>
                <div className="space-y-2">
                  {statementEntries.map((entry, index) => (
                    <button
                      key={`${entry.merchant ?? "entry"}-${index}`}
                      type="button"
                      onClick={() => setStatementIndex(index)}
                      disabled={finalizingStatement}
                      className={`w-full rounded-xl border px-3 py-3 text-left text-sm ${index === statementIndex ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-accent"} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">{entry.merchant || `Entry ${index + 1}`}</div>
                        <span className={`rounded-full px-2 py-1 text-[11px] ${entry.status === "finalized" ? "bg-green-500/15 text-green-400" : "bg-yellow-500/15 text-yellow-400"}`}>{entry.status === "finalized" ? "Saved" : "Pending"}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{entry.expense_date || "Unknown date"} · {entry.amount != null ? formatSignedCurrency(entry.amount, entry.transaction_type, entry.currency) : "Unknown amount"} · {transactionTypeLabel(entry.transaction_type)} · {transactionCadenceLabel(entry.cadence)}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            {statementError ? <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{statementError}</div> : null}
            {statementSuccess ? <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">{statementSuccess}</div> : null}
            {!selectedStatement || !currentStatementEntry ? <div className="py-20 text-center text-muted-foreground">Upload a statement PDF to start the multi-transaction review queue.</div> : (
              <div className="space-y-5">
                <div className="flex flex-col gap-2 border-b border-border pb-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-xl font-semibold">Review statement entry {statementIndex + 1} of {statementEntries.length}</h2>
                    <p className="text-sm text-muted-foreground">Each approved entry becomes one transaction. Item-level fields are intentionally left empty for statement imports.</p>
                  </div>
                  <div className="rounded-full bg-secondary px-3 py-1 text-sm">{selectedStatement.original_filename}</div>
                </div>

                {selectedStatement.preview && isStatementPreview(selectedStatement.preview) ? (
                  <div className="rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">{selectedStatement.preview.summary || selectedStatement.preview.notes}</div>
                ) : null}

                {finalizingStatement ? <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">Saving approved statement entry… Please wait.</div> : null}

                <TransactionTypeSelector value={statementDraft.transaction_type} onChange={(transaction_type) => setStatementDraft({ ...statementDraft, transaction_type, category_id: "", category_name: "" })} disabled={finalizingStatement} />
                <CadenceSelector value={statementDraft.cadence} onChange={(cadence) => setStatementDraft(applyCadenceSelection(statementDraft, cadence))} disabled={finalizingStatement} />
                <CustomIntervalPanel
                  cadence={statementDraft.cadence}
                  interval={statementDraft.cadence_interval}
                  onIntervalChange={(cadence_interval) => setStatementDraft({ ...statementDraft, cadence_interval })}
                  disabled={finalizingStatement}
                />
                <PrepaidSettingsPanel
                  cadence={statementDraft.cadence}
                  prepaidMonths={statementDraft.prepaid_months}
                  prepaidStartDate={statementDraft.prepaid_start_date}
                  onPrepaidMonthsChange={(prepaid_months) => setStatementDraft({ ...statementDraft, prepaid_months })}
                  onPrepaidStartDateChange={(prepaid_start_date) => setStatementDraft({ ...statementDraft, prepaid_start_date })}
                  disabled={finalizingStatement}
                />
                <RecurringSettingsPanel
                  cadence={statementDraft.cadence}
                  recurringVariable={statementDraft.recurring_variable}
                  recurringAutoAdd={statementDraft.recurring_auto_add}
                  onRecurringVariableChange={(recurring_variable) => setStatementDraft({ ...statementDraft, recurring_variable })}
                  onRecurringAutoAddChange={(recurring_auto_add) => setStatementDraft({ ...statementDraft, recurring_auto_add })}
                  disabled={finalizingStatement}
                />
                {statementDraft.transaction_type === "debit" && statementDraft.cadence === "one_time" ? <MajorPurchaseToggle checked={statementDraft.is_major_purchase} onChange={(is_major_purchase) => setStatementDraft({ ...statementDraft, is_major_purchase })} disabled={finalizingStatement} /> : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">{statementDraft.transaction_type === "credit" ? "Source / payer" : "Merchant"}</span><input value={statementDraft.merchant} onChange={(e) => setStatementDraft({ ...statementDraft, merchant: e.target.value })} disabled={finalizingStatement} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Amount</span><input type="number" step="0.01" value={statementDraft.amount} onChange={(e) => setStatementDraft({ ...statementDraft, amount: e.target.value })} disabled={finalizingStatement} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Date</span><input type="date" value={statementDraft.expense_date} onChange={(e) => setStatementDraft({ ...statementDraft, expense_date: e.target.value })} disabled={finalizingStatement} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                  <label className="text-sm">
                    <span className="mb-1 block text-muted-foreground">Currency</span>
                    <CurrencySelector value={statementDraft.currency} onChange={(currency) => setStatementDraft({ ...statementDraft, currency })} disabled={finalizingStatement} />
                  </label>
                </div>
                {statementDraft.currency !== DEFAULT_CURRENCY ? (
                  <CurrencyDisplayToggle currency={statementDraft.currency} amount={statementDraft.amount} displayAsEur={statementDisplayAsEur} rate={statementEurRate} onToggle={(dae, r) => { setStatementDisplayAsEur(dae); setStatementEurRate(r); }} disabled={finalizingStatement} />
                ) : null}

                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Description</span><input value={statementDraft.description} onChange={(e) => setStatementDraft({ ...statementDraft, description: e.target.value })} disabled={finalizingStatement} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm">
                    <span className="mb-1 block text-muted-foreground">Category</span>
                    <select value={statementDraft.category_id} onChange={(e) => setStatementDraft({ ...statementDraft, category_id: e.target.value })} disabled={finalizingStatement} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60">
                      <option value="">Use custom or extracted category</option>
                      {filteredCategories(categories, statementDraft.transaction_type).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Custom category name</span><input value={statementDraft.category_name} onChange={(e) => setStatementDraft({ ...statementDraft, category_name: e.target.value })} disabled={finalizingStatement || !!statementDraft.category_id} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                </div>
                <LedgerSelector ledgers={ledgers} selectedLedgerId={selectedLedgerId} onSelect={setSelectedLedgerId} newLedgerFormOpen={newLedgerFormOpen} onToggleNewForm={() => setNewLedgerFormOpen((v) => !v)} newLedgerName={newLedgerName} onNewLedgerNameChange={setNewLedgerName} newLedgerType={newLedgerType} onNewLedgerTypeChange={setNewLedgerType} partners={partners} selectedMemberIds={newLedgerMemberIds} onMemberIdsChange={setNewLedgerMemberIds} onCreateLedger={handleCreateLedger} creatingLedger={creatingLedger} disabled={finalizingStatement} />
                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Confidence override</span><input type="number" min="0" max="1" step="0.01" value={statementDraft.confidence} onChange={(e) => setStatementDraft({ ...statementDraft, confidence: e.target.value })} disabled={finalizingStatement} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Notes</span><textarea rows={4} value={statementDraft.notes} onChange={(e) => setStatementDraft({ ...statementDraft, notes: e.target.value })} disabled={finalizingStatement} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>

                {selectedStatement.ocr_text ? (
                  <div className="rounded-xl border border-border bg-background p-4">
                    <div className="mb-2 text-sm font-medium">Extracted statement text</div>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{selectedStatement.ocr_text}</pre>
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-muted-foreground">Pending after this: {Math.max(statementEntries.filter((entry) => entry.status !== "finalized").length - (currentStatementEntry.status === "finalized" ? 0 : 1), 0)} · {transactionCadenceLabel(statementDraft.cadence)}</div>
                  <button
                    type="button"
                    onClick={handleStatementFinalize}
                    disabled={finalizingStatement || !statementDraft.merchant || !statementDraft.amount || !statementDraft.expense_date || currentStatementEntry.status === "finalized"}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {finalizingStatement ? "Saving entry…" : currentStatementEntry.status === "finalized" ? "Already saved" : "Approve and save transaction"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
