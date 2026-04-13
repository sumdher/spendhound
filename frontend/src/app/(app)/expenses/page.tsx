"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteExpense, exportExpenses, listCategories, listExpenses, type Category, type Expense } from "@/lib/api";
import { currentMonthString, formatCurrency, formatDate, monthLabel, recentMonthOptions, shiftMonth, triggerDownload } from "@/lib/utils";

export default function ExpensesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const month = searchParams.get("month") || currentMonthString();
  const recentMonths = useMemo(() => recentMonthOptions(18, month), [month]);

  const updateMonth = useCallback((nextMonth: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextMonth === currentMonthString()) {
      params.delete("month");
    } else {
      params.set("month", nextMonth);
    }
    const query = params.toString();
    router.replace(query ? `/expenses?${query}` : "/expenses");
  }, [router, searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [expenseData, categoryData] = await Promise.all([
        listExpenses({ month, search, category_id: categoryId || undefined, review_only: reviewOnly || undefined }),
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
  }, [month, search, categoryId, reviewOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const total = useMemo(() => expenses.reduce((sum, item) => sum + item.amount, 0), [expenses]);

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this expense?")) return;
    await deleteExpense(id);
    await load();
  }

  async function handleExport(format: "json" | "csv") {
    const blob = await exportExpenses(format, month);
    triggerDownload(blob, `spendhound-expenses-${month}.${format === "json" ? "json" : "csv"}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Expenses</h1>
          <p className="text-sm text-muted-foreground">Track manual and receipt-based expenses in one place.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleExport("csv")} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent">Export CSV</button>
          <button onClick={() => handleExport("json")} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent">Export JSON</button>
          <Link href="/expenses/new" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Add expense</Link>
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-5">
        <div className="text-sm md:col-span-2">
          <span className="mb-1 block text-muted-foreground">Month</span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="inline-flex items-center rounded-lg border border-border bg-background">
              <button type="button" onClick={() => updateMonth(shiftMonth(month, -1))} className="px-3 py-2 text-sm hover:bg-accent">←</button>
              <div className="min-w-36 border-x border-border px-3 py-2 text-center font-medium">{monthLabel(month)}</div>
              <button type="button" onClick={() => updateMonth(shiftMonth(month, 1))} className="px-3 py-2 text-sm hover:bg-accent">→</button>
            </div>
            <select value={month} onChange={(e) => updateMonth(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2">
              {recentMonths.map((option) => <option key={option} value={option}>{monthLabel(option)}</option>)}
            </select>
            <button type="button" onClick={() => updateMonth(currentMonthString())} className="rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-accent">This month</button>
          </div>
        </div>
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-muted-foreground">Search</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Merchant or description" className="w-full rounded-lg border border-border bg-background px-3 py-2" />
        </label>
        <label className="text-sm md:col-span-1">
          <span className="mb-1 block text-muted-foreground">Category</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2">
            <option value="">All categories</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="flex items-end gap-2 text-sm">
          <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
          <span>Only items needing review</span>
        </label>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Visible total</div>
            <div className="text-2xl font-semibold">{formatCurrency(total)}</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-muted-foreground">Click any expense to inspect items, receipt data, and import metadata.</div>
            <Link href="/expenses/new?tab=upload-receipt" className="text-sm text-primary underline-offset-4 hover:underline">Open receipt upload in Add expense</Link>
          </div>
        </div>

        {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div> : null}
        {loading ? <div className="py-20 text-center text-muted-foreground">Loading expenses…</div> : expenses.length === 0 ? <div className="py-20 text-center text-muted-foreground">No expenses found for the current filters.</div> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-border text-left text-muted-foreground">
                <tr>
                  <th className="py-3 pr-4">Date</th>
                  <th className="py-3 pr-4">Merchant</th>
                  <th className="py-3 pr-4">Category</th>
                  <th className="py-3 pr-4">Source</th>
                  <th className="py-3 pr-4">Amount</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-0 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id} className="border-b border-border/50">
                    <td className="py-3 pr-4">{formatDate(expense.expense_date)}</td>
                     <td className="py-3 pr-4">
                      <Link href={`/expenses/${expense.id}?month=${month}`} className="block rounded-lg p-1 -m-1 hover:bg-accent">
                        <div className="font-medium">{expense.merchant}</div>
                        <div className="text-xs text-muted-foreground">{expense.description || expense.receipt_filename || "—"}</div>
                      </Link>
                     </td>
                    <td className="py-3 pr-4">{expense.category_name ?? "Uncategorized"}</td>
                    <td className="py-3 pr-4 capitalize">{expense.source}</td>
                    <td className="py-3 pr-4 font-medium">{formatCurrency(expense.amount, expense.currency)}</td>
                    <td className="py-3 pr-4">
                      {expense.needs_review ? <span className="rounded-full bg-yellow-500/15 px-2 py-1 text-xs text-yellow-400">Needs review</span> : expense.is_recurring ? <span className="rounded-full bg-blue-500/15 px-2 py-1 text-xs text-blue-400">Recurring</span> : <span className="rounded-full bg-green-500/15 px-2 py-1 text-xs text-green-400">Tracked</span>}
                    </td>
                    <td className="py-3 pr-0 text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/expenses/${expense.id}?month=${month}`} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">View</Link>
                        <button onClick={() => handleDelete(expense.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
