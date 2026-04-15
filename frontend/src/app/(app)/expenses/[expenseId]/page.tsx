"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  apiFetch,
  getExpense,
  listCategories,
  updateExpense,
  updateExpenseItemSubcategory,
  type Category,
  type Expense,
  type ExpenseItem,
  type ItemKeywordRule,
  type ReceiptPreview,
  type StatementImportPreview,
} from "@/lib/api";
import {
  formatCurrency,
  formatDate,
  formatSignedCurrency,
  monthLabel,
  transactionCadenceLabel,
  transactionTypeLabel,
} from "@/lib/utils";

const GROCERY_SUBCATEGORIES = [
  "Vegetables", "Fruit", "Meat", "Fish & Seafood", "Dairy & Eggs",
  "Bakery", "Frozen", "Snacks", "Beverages", "Cleaning Products",
  "Personal Care", "Baby", "Pet Care", "Household",
  "Breakfast & Cereal", "Condiments & Spices", "Pantry", "Prepared Meals",
  "Other Grocery",
];

const CADENCE_OPTIONS = [
  { value: "one_time", label: "One-time / irregular" },
  { value: "monthly", label: "Monthly recurring" },
  { value: "yearly", label: "Yearly recurring" },
  { value: "custom", label: "Every N months" },
  { value: "prepaid", label: "Prepaid subscription" },
];

const COMMON_CURRENCIES = [
  "EUR", "USD", "GBP", "INR", "JPY", "CHF", "CAD", "AUD", "CNY",
  "SEK", "NOK", "DKK", "PLN", "BRL", "MXN", "SGD", "HKD", "NZD", "ZAR",
];

type EditFormState = {
  merchant: string;
  description: string;
  amount: string;
  transaction_type: string;
  cadence: string;
  cadence_interval: string;
  prepaid_months: string;
  prepaid_start_date: string;
  recurring_variable: boolean;
  recurring_auto_add: boolean;
  is_major_purchase: boolean;
  currency: string;
  expense_date: string;
  category_id: string;
  notes: string;
};

type EditItemState = {
  /** Stable React key — equals real id for existing items, a temp string for new ones */
  _tempId: string;
  /** Real DB id; undefined for items that haven't been saved yet */
  id?: string;
  description: string;
  subcategory: string;
  quantity: string;
  unit_price: string;
  total: string;
  _deleted: boolean;
  _new: boolean;
};

function expenseToEditForm(expense: Expense): EditFormState {
  return {
    merchant: expense.merchant,
    description: expense.description ?? "",
    amount: String(expense.amount),
    transaction_type: expense.transaction_type,
    cadence: expense.cadence,
    cadence_interval: String(expense.cadence_interval ?? 3),
    prepaid_months: String(expense.prepaid_months ?? 12),
    prepaid_start_date: expense.prepaid_start_date ?? expense.expense_date,
    recurring_variable: expense.recurring_variable,
    recurring_auto_add: expense.recurring_auto_add,
    is_major_purchase: expense.is_major_purchase,
    currency: expense.currency,
    expense_date: expense.expense_date,
    category_id: expense.category_id ?? "",
    notes: expense.notes ?? "",
  };
}

function itemsToEditState(items: ExpenseItem[]): EditItemState[] {
  return items.map((item) => ({
    _tempId: item.id,
    id: item.id,
    description: item.description,
    subcategory: item.subcategory ?? "",
    quantity: item.quantity != null ? String(item.quantity) : "",
    unit_price: item.unit_price != null ? String(item.unit_price) : "",
    total: item.total != null ? String(item.total) : "",
    _deleted: false,
    _new: false,
  }));
}

function isStatementPreview(preview: Expense["receipt_preview"]): preview is StatementImportPreview {
  return Boolean(preview && typeof preview === "object" && "entries" in preview);
}

function isReceiptPreview(preview: Expense["receipt_preview"]): preview is ReceiptPreview {
  return Boolean(preview && typeof preview === "object" && !isStatementPreview(preview));
}

function isRecurringCadence(cadence: string) {
  return cadence === "monthly" || cadence === "yearly" || cadence === "custom";
}

// ── SubcategoryCell (view-mode quick edit) ────────────────────────────────────

function SubcategoryCell({
  item,
  expenseId,
  onUpdated,
}: {
  item: ExpenseItem;
  expenseId: string;
  onUpdated: (item: ExpenseItem, ruleCreated: ItemKeywordRule | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  async function handleChange(newSubcat: string) {
    const value = newSubcat === "" ? null : newSubcat;
    setSaving(true);
    try {
      const result = await updateExpenseItemSubcategory(expenseId, item.id, value);
      onUpdated(result.item, result.rule_created ?? null);
    } catch {
      // silently ignore — item stays as-is
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  if (saving) {
    return <span className="text-xs text-muted-foreground">Saving…</span>;
  }

  if (editing) {
    return (
      <select
        ref={selectRef}
        defaultValue={item.subcategory ?? ""}
        autoFocus
        onBlur={() => setEditing(false)}
        onChange={(e) => void handleChange(e.target.value)}
        className="rounded border border-border bg-background px-2 py-1 text-xs"
      >
        <option value="">— unset —</option>
        {GROCERY_SUBCATEGORIES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    );
  }

  return (
    <button
      type="button"
      title="Click to correct subcategory"
      onClick={() => setEditing(true)}
      className="rounded px-1 py-0.5 text-left text-sm hover:bg-accent"
    >
      {item.subcategory ?? <span className="text-muted-foreground">—</span>}
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ExpenseDetailPage() {
  const params = useParams<{ expenseId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [expense, setExpense] = useState<Expense | null>(null);
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRuleCreated, setLastRuleCreated] = useState<ItemKeywordRule | null>(null);

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [editItems, setEditItems] = useState<EditItemState[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  // Counter for generating unique temp IDs for new items
  const nextTempId = useRef(0);
  function newTempId() {
    nextTempId.current += 1;
    return `_new_${nextTempId.current}`;
  }

  const modeParam = searchParams.get("mode");

  useEffect(() => {
    setLoading(true);
    Promise.all([getExpense(params.expenseId), listCategories()])
      .then(([expenseData, categoryData]) => {
        setExpense(expenseData);
        setItems(expenseData.items ?? []);
        setCategories(categoryData);
        setError(null);
        if (modeParam === "edit") {
          setEditForm(expenseToEditForm(expenseData));
          setEditItems(itemsToEditState(expenseData.items ?? []));
          setEditMode(true);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load expense"))
      .finally(() => setLoading(false));
  }, [params.expenseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const backMonth = useMemo(
    () => searchParams.get("month") || (expense?.expense_date?.slice(0, 7) ?? undefined),
    [expense?.expense_date, searchParams],
  );

  function handleItemUpdated(updated: ExpenseItem, ruleCreated: ItemKeywordRule | null) {
    setItems((prev) => prev.map((it) => (it.id === updated.id ? { ...it, ...updated } : it)));
    if (ruleCreated) {
      setLastRuleCreated(ruleCreated);
      setTimeout(() => setLastRuleCreated(null), 4000);
    }
  }

  function handleEnterEditMode() {
    if (!expense) return;
    setEditForm(expenseToEditForm(expense));
    setEditItems(itemsToEditState(items));
    setSaveError(null);
    setEditMode(true);
  }

  function handleCancelEdit() {
    setEditMode(false);
    setEditForm(null);
    setEditItems([]);
    setSaveError(null);
    // Remove ?mode=edit from URL cleanly
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.delete("mode");
    const qs = newParams.toString();
    router.replace(qs ? `/expenses/${params.expenseId}?${qs}` : `/expenses/${params.expenseId}`);
  }

  // ── Edit-items helpers ─────────────────────────────────────────────────────

  function handleEditItemField(
    tempId: string,
    field: keyof Pick<EditItemState, "description" | "subcategory" | "quantity" | "unit_price" | "total">,
    value: string,
  ) {
    setEditItems((prev) =>
      prev.map((it) => (it._tempId === tempId ? { ...it, [field]: value } : it)),
    );
  }

  function handleMarkDeleted(tempId: string) {
    setEditItems((prev) =>
      prev.map((it) => (it._tempId === tempId ? { ...it, _deleted: true } : it)),
    );
  }

  function handleAddItem() {
    const tid = newTempId();
    setEditItems((prev) => [
      ...prev,
      {
        _tempId: tid,
        id: undefined,
        description: "",
        subcategory: "",
        quantity: "",
        unit_price: "",
        total: "",
        _deleted: false,
        _new: true,
      },
    ]);
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!expense || !editForm) return;
    setSaving(true);
    setSaveError(null);
    try {
      const isRecurring = isRecurringCadence(editForm.cadence);
      const updated = await updateExpense(expense.id, {
        merchant: editForm.merchant,
        description: editForm.description || null,
        amount: Number(editForm.amount),
        transaction_type: editForm.transaction_type,
        cadence: editForm.cadence,
        cadence_interval: editForm.cadence === "custom" ? Number(editForm.cadence_interval) : null,
        prepaid_months: editForm.cadence === "prepaid" ? Number(editForm.prepaid_months) : null,
        prepaid_start_date: editForm.cadence === "prepaid" ? editForm.prepaid_start_date : null,
        recurring_variable: isRecurring ? editForm.recurring_variable : false,
        recurring_auto_add: isRecurring ? editForm.recurring_auto_add : false,
        is_major_purchase: editForm.is_major_purchase,
        currency: editForm.currency,
        expense_date: editForm.expense_date,
        category_id: editForm.category_id || null,
        notes: editForm.notes || null,
      });

      // ── Delete removed items ───────────────────────────────────────────────
      const toDelete = editItems.filter((it) => it._deleted && it.id);
      for (const item of toDelete) {
        await apiFetch<{ ok: boolean }>(`/api/expenses/${expense.id}/items/${item.id}`, {
          method: "DELETE",
        });
      }

      // ── Create new items ───────────────────────────────────────────────────
      const toCreate = editItems.filter(
        (it) => it._new && !it._deleted && it.description.trim() !== "",
      );
      for (const item of toCreate) {
        await apiFetch<{ id: string }>(`/api/expenses/${expense.id}/items`, {
          method: "POST",
          body: JSON.stringify({
            description: item.description,
            subcategory: item.subcategory || null,
            quantity: item.quantity !== "" ? parseFloat(item.quantity) : null,
            unit_price: item.unit_price !== "" ? parseFloat(item.unit_price) : null,
            total: item.total !== "" ? parseFloat(item.total) : null,
          }),
        });
      }

      // ── Update changed existing items ──────────────────────────────────────
      const toUpdate = editItems.filter((it) => !it._new && !it._deleted && it.id);
      for (const item of toUpdate) {
        const original = items.find((it) => it.id === item.id);
        const changedFields: Record<string, unknown> = {};
        if (item.description !== (original?.description ?? "")) {
          changedFields.description = item.description;
        }
        if (item.subcategory !== (original?.subcategory ?? "")) {
          changedFields.subcategory = item.subcategory || null;
        }
        if (item.quantity !== (original?.quantity != null ? String(original.quantity) : "")) {
          changedFields.quantity = item.quantity !== "" ? parseFloat(item.quantity) : null;
        }
        if (item.unit_price !== (original?.unit_price != null ? String(original.unit_price) : "")) {
          changedFields.unit_price = item.unit_price !== "" ? parseFloat(item.unit_price) : null;
        }
        if (item.total !== (original?.total != null ? String(original.total) : "")) {
          changedFields.total = item.total !== "" ? parseFloat(item.total) : null;
        }
        if (Object.keys(changedFields).length > 0) {
          await apiFetch<{ item: ExpenseItem }>(`/api/expenses/${expense.id}/items/${item.id}`, {
            method: "PATCH",
            body: JSON.stringify({ ...changedFields, learn: false }),
          });
        }
      }

      // Reload items from server to get fresh state (new ids, server-side updates, etc.)
      const refreshed = await getExpense(expense.id);
      setExpense(updated);
      setItems(refreshed.items ?? []);
      setEditMode(false);
      setEditForm(null);
      setEditItems([]);

      // Clean up URL
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete("mode");
      const qs = newParams.toString();
      router.replace(qs ? `/expenses/${updated.id}?${qs}` : `/expenses/${updated.id}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading) {
    return <div className="py-20 text-center text-muted-foreground">Loading transaction details…</div>;
  }
  if (error || !expense) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        {error ?? "Transaction not found"}
      </div>
    );
  }

  // ── Edit mode UI ───────────────────────────────────────────────────────────

  if (editMode && editForm) {
    const filteredCats = categories.filter((c) => c.transaction_type === editForm.transaction_type);
    // Visible items = not marked as deleted
    const visibleEditItems = editItems.filter((it) => !it._deleted);

    return (
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Edit mode header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <Link
              href={backMonth ? `/expenses?month=${backMonth}` : "/expenses"}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              ← Back to expenses
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-muted-foreground">Editing transaction</h1>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancelEdit}
              disabled={saving}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

        {saveError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {saveError}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            {/* Core fields card */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <h2 className="text-lg font-semibold">Transaction details</h2>

              {/* Transaction type */}
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Transaction type</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: "debit", label: "Money out", desc: "Expenses, bills, purchases" },
                    { value: "credit", label: "Money in", desc: "Salary, gifts, refunds" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setEditForm({ ...editForm, transaction_type: opt.value, category_id: "" })}
                      className={`rounded-xl border px-4 py-3 text-left text-sm ${editForm.transaction_type === opt.value ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-accent"}`}
                    >
                      <div className="font-medium">{opt.label}</div>
                      <div className="text-xs text-muted-foreground">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Cadence */}
              <div className="space-y-1">
                <label className="text-sm text-muted-foreground">Cadence</label>
                <select
                  value={editForm.cadence}
                  onChange={(e) => {
                    const cadence = e.target.value;
                    const recurring = isRecurringCadence(cadence);
                    setEditForm({
                      ...editForm,
                      cadence,
                      is_major_purchase: cadence === "one_time" ? editForm.is_major_purchase : false,
                      recurring_variable: recurring ? editForm.recurring_variable : false,
                      recurring_auto_add: recurring ? editForm.recurring_auto_add : false,
                    });
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {CADENCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Custom interval */}
              {editForm.cadence === "custom" && (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Every</span>
                  <input
                    type="number"
                    min={2}
                    max={120}
                    value={editForm.cadence_interval}
                    onChange={(e) => setEditForm({ ...editForm, cadence_interval: e.target.value })}
                    className="w-20 rounded-lg border border-border bg-card px-3 py-2 text-center"
                  />
                  <span className="text-muted-foreground">months</span>
                </div>
              )}

              {/* Prepaid settings */}
              {editForm.cadence === "prepaid" && (
                <div className="space-y-3 rounded-xl border border-border bg-background px-4 py-3 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">Covers</span>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={editForm.prepaid_months}
                      onChange={(e) => setEditForm({ ...editForm, prepaid_months: e.target.value })}
                      className="w-20 rounded-lg border border-border bg-card px-3 py-2 text-center"
                    />
                    <span className="text-muted-foreground">months</span>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Coverage starts</span>
                    <input
                      type="date"
                      value={editForm.prepaid_start_date}
                      onChange={(e) => setEditForm({ ...editForm, prepaid_start_date: e.target.value })}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2"
                    />
                  </label>
                </div>
              )}

              {/* Recurring settings */}
              {isRecurringCadence(editForm.cadence) && (
                <div className="space-y-2 rounded-xl border border-border bg-background px-4 py-3">
                  <div className="text-sm font-medium">Recurring behavior</div>
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={editForm.recurring_variable}
                      onChange={(e) => setEditForm({ ...editForm, recurring_variable: e.target.checked })}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block font-medium">Variable over months</span>
                      <span className="text-xs text-muted-foreground">Amount may change each period.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={editForm.recurring_auto_add}
                      onChange={(e) => setEditForm({ ...editForm, recurring_auto_add: e.target.checked })}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block font-medium">Auto-add at the start of each due month</span>
                    </span>
                  </label>
                </div>
              )}

              {/* Major purchase toggle */}
              {editForm.transaction_type === "debit" && editForm.cadence === "one_time" && (
                <label className="flex items-start gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={editForm.is_major_purchase}
                    onChange={(e) => setEditForm({ ...editForm, is_major_purchase: e.target.checked })}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium">Mark as major one-time purchase</span>
                    <span className="text-xs text-muted-foreground">Large irregular purchases (phone, laptop, appliance…)</span>
                  </span>
                </label>
              )}

              {/* Core fields grid */}
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">
                    {editForm.transaction_type === "credit" ? "Source / payer" : "Merchant"}
                  </span>
                  <input
                    value={editForm.merchant}
                    onChange={(e) => setEditForm({ ...editForm, merchant: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Amount</span>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.amount}
                    onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Date</span>
                  <input
                    type="date"
                    value={editForm.expense_date}
                    onChange={(e) => setEditForm({ ...editForm, expense_date: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Currency</span>
                  <select
                    value={editForm.currency}
                    onChange={(e) => setEditForm({ ...editForm, currency: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                  >
                    {COMMON_CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Description */}
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Description</span>
                <input
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2"
                />
              </label>

              {/* Category */}
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Category</span>
                <select
                  value={editForm.category_id}
                  onChange={(e) => setEditForm({ ...editForm, category_id: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2"
                >
                  <option value="">— Uncategorized —</option>
                  {filteredCats.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>

              {/* Notes */}
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Notes</span>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  rows={4}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2"
                />
              </label>
            </div>

            {/* Receipt-derived items (edit mode) — always visible in edit mode */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Receipt-derived items</h2>
                  <p className="text-sm text-muted-foreground">
                    Edit item details. Use ✕ to remove a row, or &ldquo;+ Add item&rdquo; to add a new one.
                  </p>
                </div>
                <div className="rounded-full bg-secondary px-3 py-1 text-sm">
                  {visibleEditItems.length} item{visibleEditItems.length !== 1 ? "s" : ""}
                </div>
              </div>

              {visibleEditItems.length === 0 ? (
                <p className="mb-4 rounded-xl border border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
                  No items yet
                </p>
              ) : (
                <div className="mb-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-border text-left text-muted-foreground">
                      <tr>
                        <th className="py-3 pr-3">Item</th>
                        <th className="py-3 pr-3">Subcategory</th>
                        <th className="py-3 pr-3 w-20">Qty</th>
                        <th className="py-3 pr-3 w-28">Unit price</th>
                        <th className="py-3 pr-3 w-28">Total</th>
                        <th className="py-3 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEditItems.map((item) => (
                        <tr key={item._tempId} className="border-b border-border/50">
                          {/* Item name */}
                          <td className="py-2 pr-3">
                            <input
                              type="text"
                              value={item.description}
                              onChange={(e) =>
                                handleEditItemField(item._tempId, "description", e.target.value)
                              }
                              placeholder="Item name"
                              className="w-full min-w-[120px] rounded border border-border bg-background px-2 py-1 text-xs"
                            />
                          </td>
                          {/* Subcategory */}
                          <td className="py-2 pr-3">
                            <select
                              value={item.subcategory}
                              onChange={(e) =>
                                handleEditItemField(item._tempId, "subcategory", e.target.value)
                              }
                              className="rounded border border-border bg-background px-2 py-1 text-xs"
                            >
                              <option value="">— unset —</option>
                              {GROCERY_SUBCATEGORIES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          </td>
                          {/* Qty */}
                          <td className="py-2 pr-3">
                            <input
                              type="number"
                              step="0.001"
                              min="0"
                              value={item.quantity}
                              onChange={(e) =>
                                handleEditItemField(item._tempId, "quantity", e.target.value)
                              }
                              placeholder="—"
                              className="w-20 rounded border border-border bg-background px-2 py-1 text-xs"
                            />
                          </td>
                          {/* Unit price */}
                          <td className="py-2 pr-3">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.unit_price}
                              onChange={(e) =>
                                handleEditItemField(item._tempId, "unit_price", e.target.value)
                              }
                              placeholder="—"
                              className="w-28 rounded border border-border bg-background px-2 py-1 text-xs"
                            />
                          </td>
                          {/* Total */}
                          <td className="py-2 pr-3">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.total}
                              onChange={(e) =>
                                handleEditItemField(item._tempId, "total", e.target.value)
                              }
                              placeholder="—"
                              className="w-28 rounded border border-border bg-background px-2 py-1 text-xs"
                            />
                          </td>
                          {/* Remove button */}
                          <td className="py-2">
                            <button
                              type="button"
                              title="Remove item"
                              onClick={() => handleMarkDeleted(item._tempId)}
                              className="flex h-6 w-6 items-center justify-center rounded-full text-red-400 hover:bg-red-500/10 hover:text-red-500"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Add item button */}
              <button
                type="button"
                onClick={handleAddItem}
                className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary"
              >
                <span className="text-base leading-none">+</span> Add item
              </button>
            </div>
          </div>

          {/* Right column: source preview (read-only in edit mode) */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-lg font-semibold">Source preview</h2>
              {isReceiptPreview(expense.receipt_preview) ? (
                <div className="mt-4 space-y-3 text-sm">
                  <div className="rounded-xl border border-border bg-background p-3">
                    {expense.receipt_preview.notes || "Direct receipt extraction preview"}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-border bg-background p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Preview merchant</div>
                      <div className="mt-1">{expense.receipt_preview.merchant || "—"}</div>
                    </div>
                    <div className="rounded-xl border border-border bg-background p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Preview amount</div>
                      <div className="mt-1">
                        {expense.receipt_preview.amount != null
                          ? formatCurrency(expense.receipt_preview.amount, expense.receipt_preview.currency)
                          : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              ) : isStatementPreview(expense.receipt_preview) ? (
                <div className="mt-4 space-y-3 text-sm">
                  <div className="rounded-xl border border-border bg-background p-3">
                    {expense.receipt_preview.summary || "Statement import preview"}
                  </div>
                  <div className="rounded-xl border border-border bg-background p-3 text-muted-foreground">
                    {expense.receipt_preview.notes || "Imported from a reviewed PDF bank statement queue."}
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
                  No saved preview is available for this expense source.
                </div>
              )}
            </div>

            {expense.receipt_ocr_text ? (
              <div className="rounded-2xl border border-border bg-card p-5">
                <h2 className="text-lg font-semibold">Extracted text</h2>
                <pre className="mt-4 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-4 text-xs text-muted-foreground">
                  {expense.receipt_ocr_text}
                </pre>
              </div>
            ) : null}
          </div>
        </div>

        {/* Bottom save/cancel bar */}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={handleCancelEdit}
            disabled={saving}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    );
  }

  // ── View mode UI ───────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <Link
            href={backMonth ? `/expenses?month=${backMonth}` : "/expenses"}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            ← Back to expenses
          </Link>
          <h1 className="mt-2 text-3xl font-bold">{expense.merchant}</h1>
          <p className="text-sm text-muted-foreground">
            {expense.category_name ?? "Uncategorized"} · {formatDate(expense.expense_date)} · {expense.source} ·{" "}
            {transactionTypeLabel(expense.transaction_type)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="rounded-2xl border border-border bg-card px-5 py-4 text-right">
            <div className="text-sm text-muted-foreground">Amount</div>
            <div
              className={`text-3xl font-semibold ${expense.transaction_type === "credit" ? "text-emerald-400" : "text-red-400"}`}
            >
              {formatSignedCurrency(expense.amount, expense.transaction_type, expense.currency)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Month: {monthLabel(expense.expense_date.slice(0, 7))}
            </div>
          </div>
          <button
            type="button"
            onClick={handleEnterEditMode}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Edit
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          {/* Transaction details */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Transaction details</h2>
            <dl className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Description</dt>
                <dd className="mt-1 text-sm">{expense.description || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Receipt / import file</dt>
                <dd className="mt-1 text-sm">{expense.receipt_filename || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Transaction type</dt>
                <dd className="mt-1 text-sm">{transactionTypeLabel(expense.transaction_type)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Cadence</dt>
                <dd className="mt-1 text-sm">{transactionCadenceLabel(expense.cadence)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Recurring setup</dt>
                <dd className="mt-1 text-sm">
                  {expense.is_recurring
                    ? `${expense.recurring_variable ? "Variable" : "Constant"} · ${expense.recurring_auto_add ? "Auto-add on" : "Manual add"}`
                    : "Not recurring"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Generation</dt>
                <dd className="mt-1 text-sm">
                  {expense.auto_generated
                    ? `Auto-generated for ${expense.generated_for_month ? monthLabel(expense.generated_for_month) : "a scheduled month"}`
                    : "Created directly by you or import review"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Confidence</dt>
                <dd className="mt-1 text-sm">{Math.round(expense.confidence * 100)}%</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Review status</dt>
                <dd className="mt-1 text-sm">
                  {expense.needs_review
                    ? expense.auto_generated
                      ? "Needs review (auto-added draft)"
                      : "Needs review"
                    : expense.is_major_purchase
                      ? "Major one-time purchase"
                      : expense.is_recurring
                        ? "Recurring"
                        : "Tracked"}
                </dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Notes</dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm">{expense.notes || "—"}</dd>
              </div>
            </dl>
          </div>

          {/* Receipt-derived items — only rendered when there is at least 1 item */}
          {items.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Receipt-derived items</h2>
                  <p className="text-sm text-muted-foreground">
                    Click any subcategory to correct it — the system will learn from your correction.
                  </p>
                </div>
                <div className="rounded-full bg-secondary px-3 py-1 text-sm">{items.length} items</div>
              </div>

              {lastRuleCreated ? (
                <div className="mb-3 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-xs text-green-400">
                  Rule created: <strong>{lastRuleCreated.keyword}</strong> → {lastRuleCreated.subcategory_label} (
                  {lastRuleCreated.pattern_type})
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-border text-left text-muted-foreground">
                    <tr>
                      <th className="py-3 pr-4">Item</th>
                      <th className="py-3 pr-4">Subcategory</th>
                      <th className="py-3 pr-4">Qty</th>
                      <th className="py-3 pr-4">Unit price</th>
                      <th className="py-3 pr-0">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className="border-b border-border/50">
                        <td className="py-3 pr-4 font-medium">{item.description}</td>
                        <td className="py-3 pr-4">
                          <SubcategoryCell item={item} expenseId={expense.id} onUpdated={handleItemUpdated} />
                        </td>
                        <td className="py-3 pr-4">{item.quantity ?? "—"}</td>
                        <td className="py-3 pr-4">
                          {item.unit_price != null ? formatCurrency(item.unit_price, expense.currency) : "—"}
                        </td>
                        <td className="py-3 pr-0">
                          {item.total != null ? formatCurrency(item.total, expense.currency) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Source preview</h2>
            {isReceiptPreview(expense.receipt_preview) ? (
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-xl border border-border bg-background p-3">
                  {expense.receipt_preview.notes || "Direct receipt extraction preview"}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-border bg-background p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Preview merchant</div>
                    <div className="mt-1">{expense.receipt_preview.merchant || "—"}</div>
                  </div>
                  <div className="rounded-xl border border-border bg-background p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Preview amount</div>
                    <div className="mt-1">
                      {expense.receipt_preview.amount != null
                        ? formatCurrency(expense.receipt_preview.amount, expense.receipt_preview.currency)
                        : "—"}
                    </div>
                  </div>
                </div>
              </div>
            ) : isStatementPreview(expense.receipt_preview) ? (
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-xl border border-border bg-background p-3">
                  {expense.receipt_preview.summary || "Statement import preview"}
                </div>
                <div className="rounded-xl border border-border bg-background p-3 text-muted-foreground">
                  {expense.receipt_preview.notes || "Imported from a reviewed PDF bank statement queue."}
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
                No saved preview is available for this expense source.
              </div>
            )}
          </div>

          {expense.receipt_ocr_text ? (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-lg font-semibold">Extracted text</h2>
              <pre className="mt-4 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-4 text-xs text-muted-foreground">
                {expense.receipt_ocr_text}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
