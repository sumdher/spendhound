"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { getExpense, updateExpenseItemSubcategory, type Expense, type ExpenseItem, type ItemKeywordRule, type ReceiptPreview, type StatementImportPreview } from "@/lib/api";
import { formatCurrency, formatDate, formatSignedCurrency, monthLabel, transactionCadenceLabel, transactionTypeLabel } from "@/lib/utils";

const GROCERY_SUBCATEGORIES = [
  "Vegetables", "Fruit", "Meat", "Fish & Seafood", "Dairy & Eggs",
  "Bakery", "Frozen", "Snacks", "Beverages", "Cleaning Products",
  "Personal Care", "Baby", "Pet Care", "Household",
  "Breakfast & Cereal", "Condiments & Spices", "Pantry", "Prepared Meals",
  "Other Grocery",
];

function isStatementPreview(preview: Expense["receipt_preview"]): preview is StatementImportPreview {
  return Boolean(preview && typeof preview === "object" && "entries" in preview);
}

function isReceiptPreview(preview: Expense["receipt_preview"]): preview is ReceiptPreview {
  return Boolean(preview && typeof preview === "object" && !isStatementPreview(preview));
}

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

export default function ExpenseDetailPage() {
  const params = useParams<{ expenseId: string }>();
  const searchParams = useSearchParams();
  const [expense, setExpense] = useState<Expense | null>(null);
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRuleCreated, setLastRuleCreated] = useState<ItemKeywordRule | null>(null);

  useEffect(() => {
    setLoading(true);
    getExpense(params.expenseId)
      .then((value) => {
        setExpense(value);
        setItems(value.items ?? []);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load expense"))
      .finally(() => setLoading(false));
  }, [params.expenseId]);

  const backMonth = useMemo(() => searchParams.get("month") || (expense?.expense_date?.slice(0, 7) ?? undefined), [expense?.expense_date, searchParams]);

  function handleItemUpdated(updated: ExpenseItem, ruleCreated: ItemKeywordRule | null) {
    setItems((prev) => prev.map((it) => it.id === updated.id ? { ...it, ...updated } : it));
    if (ruleCreated) {
      setLastRuleCreated(ruleCreated);
      setTimeout(() => setLastRuleCreated(null), 4000);
    }
  }

  if (loading) return <div className="py-20 text-center text-muted-foreground">Loading transaction details…</div>;
  if (error || !expense) return <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error ?? "Transaction not found"}</div>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <Link href={backMonth ? `/expenses?month=${backMonth}` : "/expenses"} className="text-sm text-primary underline-offset-4 hover:underline">← Back to expenses</Link>
          <h1 className="mt-2 text-3xl font-bold">{expense.merchant}</h1>
          <p className="text-sm text-muted-foreground">{expense.category_name ?? "Uncategorized"} · {formatDate(expense.expense_date)} · {expense.source} · {transactionTypeLabel(expense.transaction_type)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card px-5 py-4 text-right">
          <div className="text-sm text-muted-foreground">Amount</div>
          <div className={`text-3xl font-semibold ${expense.transaction_type === "credit" ? "text-emerald-400" : "text-red-400"}`}>{formatSignedCurrency(expense.amount, expense.transaction_type, expense.currency)}</div>
          <div className="mt-1 text-xs text-muted-foreground">Month: {monthLabel(expense.expense_date.slice(0, 7))}</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Transaction details</h2>
            <dl className="mt-4 grid gap-4 md:grid-cols-2">
              <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Description</dt><dd className="mt-1 text-sm">{expense.description || "—"}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Receipt / import file</dt><dd className="mt-1 text-sm">{expense.receipt_filename || "—"}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Transaction type</dt><dd className="mt-1 text-sm">{transactionTypeLabel(expense.transaction_type)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Cadence</dt><dd className="mt-1 text-sm">{transactionCadenceLabel(expense.cadence)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Recurring setup</dt><dd className="mt-1 text-sm">{expense.is_recurring ? `${expense.recurring_variable ? "Variable" : "Constant"} · ${expense.recurring_auto_add ? "Auto-add on" : "Manual add"}` : "Not recurring"}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Generation</dt><dd className="mt-1 text-sm">{expense.auto_generated ? `Auto-generated for ${expense.generated_for_month ? monthLabel(expense.generated_for_month) : "a scheduled month"}` : "Created directly by you or import review"}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Confidence</dt><dd className="mt-1 text-sm">{Math.round(expense.confidence * 100)}%</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Review status</dt><dd className="mt-1 text-sm">{expense.needs_review ? (expense.auto_generated ? "Needs review (auto-added draft)" : "Needs review") : expense.is_major_purchase ? "Major one-time purchase" : expense.is_recurring ? "Recurring" : "Tracked"}</dd></div>
              <div className="md:col-span-2"><dt className="text-xs uppercase tracking-wide text-muted-foreground">Notes</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{expense.notes || "—"}</dd></div>
            </dl>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Receipt-derived items</h2>
                <p className="text-sm text-muted-foreground">Click any subcategory to correct it — the system will learn from your correction.</p>
              </div>
              <div className="rounded-full bg-secondary px-3 py-1 text-sm">{items.length} items</div>
            </div>

            {lastRuleCreated ? (
              <div className="mb-3 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-xs text-green-400">
                Rule created: <strong>{lastRuleCreated.keyword}</strong> → {lastRuleCreated.subcategory_label} ({lastRuleCreated.pattern_type})
              </div>
            ) : null}

            {!items.length ? (
              <div className="rounded-xl border border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">No itemized receipt lines were stored for this transaction.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-border text-left text-muted-foreground">
                    <tr>
                      <th className="py-3 pr-4">Item</th>
                      <th className="py-3 pr-4">Subcategory</th>
                      <th className="py-3 pr-4">Qty</th>
                      <th className="py-3 pr-4">Unit</th>
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
                        <td className="py-3 pr-4">{item.unit_price != null ? formatCurrency(item.unit_price, expense.currency) : "—"}</td>
                        <td className="py-3 pr-0">{item.total != null ? formatCurrency(item.total, expense.currency) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Source preview</h2>
            {isReceiptPreview(expense.receipt_preview) ? (
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-xl border border-border bg-background p-3">{expense.receipt_preview.notes || "Direct receipt extraction preview"}</div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-border bg-background p-3"><div className="text-xs uppercase tracking-wide text-muted-foreground">Preview merchant</div><div className="mt-1">{expense.receipt_preview.merchant || "—"}</div></div>
                  <div className="rounded-xl border border-border bg-background p-3"><div className="text-xs uppercase tracking-wide text-muted-foreground">Preview amount</div><div className="mt-1">{expense.receipt_preview.amount != null ? formatCurrency(expense.receipt_preview.amount, expense.receipt_preview.currency) : "—"}</div></div>
                </div>
              </div>
            ) : isStatementPreview(expense.receipt_preview) ? (
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-xl border border-border bg-background p-3">{expense.receipt_preview.summary || "Statement import preview"}</div>
                <div className="rounded-xl border border-border bg-background p-3 text-muted-foreground">{expense.receipt_preview.notes || "Imported from a reviewed PDF bank statement queue."}</div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">No saved preview is available for this expense source.</div>
            )}
          </div>

          {expense.receipt_ocr_text ? (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="text-lg font-semibold">Extracted text</h2>
              <pre className="mt-4 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-4 text-xs text-muted-foreground">{expense.receipt_ocr_text}</pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
