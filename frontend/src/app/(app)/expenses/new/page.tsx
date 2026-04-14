"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createExpense, createExpenseFromReceipt, createExpenseFromStatementEntry, listCategories, uploadReceipt, uploadStatement, type Category, type Receipt, type ReceiptPreview, type ReceiptPreviewItem, type StatementImportEntry, type StatementImportPreview } from "@/lib/api";
import { currentMonthString, formatSignedCurrency, transactionCadenceLabel, transactionTypeLabel } from "@/lib/utils";

type ExpenseFormState = {
  merchant: string;
  description: string;
  amount: string;
  transaction_type: string;
  cadence: string;
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

function createEmptyExpenseForm(): ExpenseFormState {
  return {
    merchant: "",
    description: "",
    amount: "",
    transaction_type: "debit",
    cadence: "one_time",
    recurring_variable: false,
    recurring_auto_add: false,
    is_major_purchase: false,
    currency: "EUR",
    expense_date: `${currentMonthString()}-01`,
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
  return cadence === "monthly" || cadence === "yearly";
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
    items: (preview.items ?? []).map((item) => ({ ...item })),
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

function CadenceSelector({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="text-sm text-muted-foreground">Transaction cadence</div>
      <div className="grid gap-2 md:grid-cols-3">
        {[
          { value: "one_time", label: "One-time / irregular", description: "Occasional spending, large purchases, ad-hoc income" },
          { value: "monthly", label: "Recurring monthly", description: "Subscriptions, rent, salary, utilities" },
          { value: "yearly", label: "Recurring yearly", description: "Insurance, annual renewals, yearly fees" },
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
          <span className="text-xs text-muted-foreground">Monthly recurring items are added at the start of each month. Yearly recurring items are added when that month comes around again.</span>
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

  const activeTab = [RECEIPT_TAB, STATEMENT_TAB].includes(searchParams.get("tab") || "") ? searchParams.get("tab") as string : MANUAL_TAB;

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
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
    setReceiptDraft((current) => ({ ...current, items: [...current.items, { description: "", quantity: null, unit_price: null, total: null, subcategory: null }] }));
  }

  function resetReceiptDraft() {
    setSelectedReceipt(null);
    setLastReceiptFile(null);
    setReceiptDraft(createEmptyReceiptDraft());
    setReceiptSuccess(null);
    draftRestoredFromStorageRef.current = false;
    localStorage.removeItem("spendhound_receipt_draft");
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
    try {
      await createExpense({
        merchant: manualForm.merchant,
        description: manualForm.description || null,
        amount: Number(manualForm.amount),
        transaction_type: manualForm.transaction_type,
        cadence: manualForm.cadence,
        recurring_variable: manualForm.recurring_variable,
        recurring_auto_add: manualForm.recurring_auto_add,
        is_major_purchase: manualForm.is_major_purchase,
        currency: manualForm.currency,
        expense_date: manualForm.expense_date,
        category_id: manualForm.category_id || null,
        category_name: manualForm.category_id ? null : manualForm.category_name || null,
        notes: manualForm.notes || null,
        items: null,
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
    try {
      const savedExpense = await createExpenseFromReceipt({
        receipt_id: selectedReceipt.id,
        merchant: receiptDraft.merchant,
        description: receiptDraft.description || null,
        amount: Number(receiptDraft.amount),
        transaction_type: receiptDraft.transaction_type,
        cadence: receiptDraft.cadence,
        recurring_variable: receiptDraft.recurring_variable,
        recurring_auto_add: receiptDraft.recurring_auto_add,
        is_major_purchase: receiptDraft.is_major_purchase,
        currency: receiptDraft.currency,
        expense_date: receiptDraft.expense_date,
        category_id: receiptDraft.category_id || null,
        category_name: receiptDraft.category_id ? null : receiptDraft.category_name || null,
        notes: receiptDraft.notes || null,
        items: receiptDraft.items,
        confidence: Number(receiptDraft.confidence),
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
    try {
      const result = await createExpenseFromStatementEntry({
        receipt_id: selectedStatement.id,
        entry_index: statementIndex,
        merchant: statementDraft.merchant,
        description: statementDraft.description || null,
        amount: Number(statementDraft.amount),
        transaction_type: statementDraft.transaction_type,
        cadence: statementDraft.cadence,
        recurring_variable: statementDraft.recurring_variable,
        recurring_auto_add: statementDraft.recurring_auto_add,
        is_major_purchase: statementDraft.is_major_purchase,
        currency: statementDraft.currency,
        expense_date: statementDraft.expense_date,
        category_id: statementDraft.category_id || null,
        category_name: statementDraft.category_id ? null : statementDraft.category_name || null,
        notes: statementDraft.notes || null,
        confidence: Number(statementDraft.confidence),
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
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Currency</span><input value={manualForm.currency} onChange={(e) => setManualForm({ ...manualForm, currency: e.target.value.toUpperCase() })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          </div>
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
                  <button type="button" onClick={addReceiptItem} className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-accent">Add item</button>
                </div>
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Item</th>
                      <th className="pb-2 font-medium w-20 text-center">Qty</th>
                      <th className="pb-2 font-medium w-24">Total</th>
                      <th className="pb-2 font-medium w-52">Subcategory</th>
                      <th className="pb-2 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {extractedItems.map((item, index) => (
                      <tr key={`${item.description ?? "item"}-${index}`} className="border-b border-border/40 last:border-0">
                        <td className="py-2 pr-4 text-sm">{item.description || `Item ${index + 1}`}</td>
                        <td className="py-2 pr-3 text-center">
                          <select value={quantityModeForItem(item)} onChange={(e) => updateReceiptItem(index, "quantity", e.target.value === "custom" ? "" : e.target.value)} className="w-16 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                            {ITEM_QUANTITY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                            <option value="custom">…</option>
                          </select>
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex items-center rounded-md border border-border bg-background px-2 py-1.5 w-20">
                            <span className="text-xs text-muted-foreground select-none mr-1">€</span>
                            <input type="number" step="0.01" value={item.total ?? ""} onChange={(e) => updateReceiptItem(index, "total", e.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none" />
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <select value={ITEM_SUBCATEGORY_OPTIONS.includes(item.subcategory ?? "") ? item.subcategory ?? "" : item.subcategory ? "__custom__" : ""} onChange={(e) => updateReceiptItem(index, "subcategory", e.target.value === "__custom__" ? (item.subcategory && !ITEM_SUBCATEGORY_OPTIONS.includes(item.subcategory) ? item.subcategory : "") : e.target.value)} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                            <option value="">None</option>
                            {ITEM_SUBCATEGORY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                            <option value="__custom__">Custom…</option>
                          </select>
                          {!ITEM_SUBCATEGORY_OPTIONS.includes(item.subcategory ?? "") && item.subcategory ? (
                            <input value={item.subcategory} onChange={(e) => updateReceiptItem(index, "subcategory", e.target.value)} className="mt-1.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground" placeholder="Custom subcategory" />
                          ) : null}
                        </td>
                        <td className="py-2">
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
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Currency</span><input value={receiptDraft.currency} onChange={(e) => setReceiptDraft({ ...receiptDraft, currency: e.target.value.toUpperCase() })} disabled={finalizingReceipt} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                </div>
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
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Currency</span><input value={statementDraft.currency} onChange={(e) => setStatementDraft({ ...statementDraft, currency: e.target.value.toUpperCase() })} disabled={finalizingStatement} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                </div>

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
