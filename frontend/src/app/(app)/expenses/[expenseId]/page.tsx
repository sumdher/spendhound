"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getExpense, type Expense, type ReceiptPreview, type StatementImportPreview } from "@/lib/api";
import { formatCurrency, formatDate, monthLabel } from "@/lib/utils";

function isStatementPreview(preview: Expense["receipt_preview"]): preview is StatementImportPreview {
  return Boolean(preview && typeof preview === "object" && "entries" in preview);
}

function isReceiptPreview(preview: Expense["receipt_preview"]): preview is ReceiptPreview {
  return Boolean(preview && typeof preview === "object" && !isStatementPreview(preview));
}

export default function ExpenseDetailPage() {
  const params = useParams<{ expenseId: string }>();
  const searchParams = useSearchParams();
  const [expense, setExpense] = useState<Expense | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getExpense(params.expenseId)
      .then((value) => {
        setExpense(value);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load expense"))
      .finally(() => setLoading(false));
  }, [params.expenseId]);

  const backMonth = useMemo(() => searchParams.get("month") || (expense?.expense_date?.slice(0, 7) ?? undefined), [expense?.expense_date, searchParams]);

  if (loading) return <div className="py-20 text-center text-muted-foreground">Loading expense details…</div>;
  if (error || !expense) return <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error ?? "Expense not found"}</div>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <Link href={backMonth ? `/expenses?month=${backMonth}` : "/expenses"} className="text-sm text-primary underline-offset-4 hover:underline">← Back to expenses</Link>
          <h1 className="mt-2 text-3xl font-bold">{expense.merchant}</h1>
          <p className="text-sm text-muted-foreground">{expense.category_name ?? "Uncategorized"} · {formatDate(expense.expense_date)} · {expense.source}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card px-5 py-4 text-right">
          <div className="text-sm text-muted-foreground">Amount</div>
          <div className="text-3xl font-semibold">{formatCurrency(expense.amount, expense.currency)}</div>
          <div className="mt-1 text-xs text-muted-foreground">Month: {monthLabel(expense.expense_date.slice(0, 7))}</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Expense details</h2>
            <dl className="mt-4 grid gap-4 md:grid-cols-2">
              <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Description</dt><dd className="mt-1 text-sm">{expense.description || "—"}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Receipt / import file</dt><dd className="mt-1 text-sm">{expense.receipt_filename || "—"}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Confidence</dt><dd className="mt-1 text-sm">{Math.round(expense.confidence * 100)}%</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Review status</dt><dd className="mt-1 text-sm">{expense.needs_review ? "Needs review" : expense.is_recurring ? "Recurring" : "Tracked"}</dd></div>
              <div className="md:col-span-2"><dt className="text-xs uppercase tracking-wide text-muted-foreground">Notes</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{expense.notes || "—"}</dd></div>
            </dl>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Receipt-derived items</h2>
                <p className="text-sm text-muted-foreground">Stored line items, quantities, prices, and grocery subcategories when available.</p>
              </div>
              <div className="rounded-full bg-secondary px-3 py-1 text-sm">{expense.items?.length ?? 0} items</div>
            </div>
            {!expense.items?.length ? <div className="rounded-xl border border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">No itemized receipt lines were stored for this expense.</div> : (
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
                    {expense.items.map((item) => (
                      <tr key={item.id} className="border-b border-border/50">
                        <td className="py-3 pr-4 font-medium">{item.description}</td>
                        <td className="py-3 pr-4">{item.subcategory || "—"}</td>
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
