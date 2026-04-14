"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteExpense, exportExpenses, listCategories, listExpenses, type Category, type Expense } from "@/lib/api";
import { currentMonthString, formatCurrency, formatDate, formatSignedCurrency, monthLabel, recentMonthOptions, shiftMonth, transactionCadenceLabel, transactionTypeLabel, triggerDownload } from "@/lib/utils";

function cadenceBadgeClasses(cadence: string) {
  switch (cadence) {
    case "monthly":
      return "bg-red-500/15 text-red-300";
    case "yearly":
      return "bg-red-500/15 text-red-300";
    default:
      return "bg-orange-500/15 text-orange-300";
  }
}

function transactionTypeBadgeClasses(transactionType: string) {
  return transactionType === "credit" ? "bg-emerald-500/15 text-emerald-400" : "bg-orange-500/15 text-orange-300";
}

export default function ExpensesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [transactionType, setTransactionType] = useState("");
  const [cadence, setCadence] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const monthParam = searchParams.get("month");
  const isAllTime = monthParam === "all";
  const month = isAllTime ? null : monthParam || currentMonthString();
  const recentMonths = useMemo(() => recentMonthOptions(24, month || currentMonthString()), [month]);

  const updateMonth = useCallback((nextMonth: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextMonth === null || nextMonth === currentMonthString()) {
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
        listExpenses({ month: isAllTime ? "all" : month || undefined, search, category_id: categoryId || undefined, transaction_type: transactionType || undefined, cadence: cadence || undefined, review_only: reviewOnly || undefined }),
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
  }, [cadence, categoryId, isAllTime, month, reviewOnly, search, transactionType]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    const moneyIn = expenses.filter((item) => item.transaction_type === "credit").reduce((sum, item) => sum + item.amount, 0);
    const moneyOut = expenses.filter((item) => item.transaction_type !== "credit").reduce((sum, item) => sum + item.amount, 0);
    return { moneyIn, moneyOut, net: moneyIn - moneyOut };
  }, [expenses]);

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

  const detailMonthParam = isAllTime ? "all" : month && month !== currentMonthString() ? month : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Transactions</h1>
          <p className="text-sm text-muted-foreground">Track money out and money in together, including expenses, salary, refunds, gifts, and transfers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => handleExport("csv")} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent">Export CSV</button>
          <button onClick={() => handleExport("json")} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent">Export JSON</button>
          <Link href="/expenses/new" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Add transaction</Link>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
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
                {recentMonths.map((option) => <option key={option} value={option}>{monthLabel(option)}</option>)}
              </select>
              <button type="button" onClick={() => updateMonth(null)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-accent">This month</button>
              <button type="button" onClick={() => updateMonth("all")} className={`rounded-lg border px-3 py-2 text-sm ${isAllTime ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:bg-accent"}`}>All time</button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{isAllTime ? "Showing your full transaction history, including much older entries such as 2018 purchases and yearly renewals." : `Browsing ${monthLabel(month || currentMonthString())}. Use All time for full history.`}</p>
          </div>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Search</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Merchant, description, salary, refund…" className="w-full rounded-lg border border-border bg-background px-3 py-2" />
          </label>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Type</span>
            <select value={transactionType} onChange={(e) => setTransactionType(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2">
              <option value="">All transaction types</option>
              <option value="debit">Money out</option>
              <option value="credit">Money in</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Cadence</span>
            <select value={cadence} onChange={(e) => setCadence(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2">
              <option value="">All cadences</option>
              <option value="monthly">Monthly recurring</option>
              <option value="yearly">Yearly recurring</option>
              <option value="one_time">One-time / irregular</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Category</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2">
              <option value="">All categories</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="flex h-full items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm">
            <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
            <span>Only items needing review</span>
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-background px-4 py-3">
              <div className="text-sm text-muted-foreground">Money out</div>
              <div className="text-2xl font-semibold text-red-400">{formatCurrency(totals.moneyOut)}</div>
            </div>
            <div className="rounded-xl border border-border bg-background px-4 py-3">
              <div className="text-sm text-muted-foreground">Money in</div>
              <div className="text-2xl font-semibold text-emerald-400">{formatCurrency(totals.moneyIn)}</div>
            </div>
            <div className="rounded-xl border border-border bg-background px-4 py-3">
              <div className="text-sm text-muted-foreground">Net</div>
              <div className={`text-2xl font-semibold ${totals.net >= 0 ? "text-emerald-400" : "text-red-400"}`}>{formatCurrency(totals.net)}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-muted-foreground">Click any transaction to inspect items, receipt data, and import metadata.</div>
            <Link href="/expenses/new?tab=upload-receipt" className="text-sm text-primary underline-offset-4 hover:underline">Open receipt or statement import</Link>
          </div>
        </div>

        {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div> : null}
        {loading ? <div className="py-20 text-center text-muted-foreground">Loading transactions…</div> : expenses.length === 0 ? <div className="py-20 text-center text-muted-foreground">No transactions found for the current filters.</div> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-border text-left text-muted-foreground">
                <tr>
                  <th className="py-3 pr-4">Date</th>
                  <th className="py-3 pr-4">Merchant</th>
                  <th className="py-3 pr-4">Type</th>
                  <th className="py-3 pr-4">Cadence</th>
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
                      <Link href={detailMonthParam ? `/expenses/${expense.id}?month=${detailMonthParam}` : `/expenses/${expense.id}`} className="-m-1 block rounded-lg p-1 hover:bg-accent">
                        <div className="font-medium">{expense.merchant}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>{expense.description || expense.receipt_filename || "—"}</span>
                          {expense.auto_generated ? <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-300">{expense.needs_review ? "Auto-added draft" : "Auto-added"}</span> : null}
                          {expense.recurring_variable ? <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[11px] text-yellow-300">Variable recurring</span> : null}
                          {expense.is_major_purchase ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">Major purchase</span> : null}
                        </div>
                      </Link>
                    </td>
                    <td className="py-3 pr-4"><span className={`rounded-full px-2 py-1 text-xs ${transactionTypeBadgeClasses(expense.transaction_type)}`}>{transactionTypeLabel(expense.transaction_type)}</span></td>
                    <td className="py-3 pr-4"><span className={`rounded-full px-2 py-1 text-xs ${cadenceBadgeClasses(expense.cadence)}`}>{transactionCadenceLabel(expense.cadence)}</span></td>
                    <td className="py-3 pr-4">{expense.category_name ?? "Uncategorized"}</td>
                    <td className="py-3 pr-4 capitalize">{expense.source}</td>
                    <td className={`py-3 pr-4 font-medium ${expense.transaction_type === "credit" ? "text-emerald-400" : "text-red-400"}`}>{formatSignedCurrency(expense.amount, expense.transaction_type, expense.currency)}</td>
                    <td className="py-3 pr-4">
                      {expense.needs_review ? <span className="rounded-full bg-yellow-500/15 px-2 py-1 text-xs text-yellow-400">Needs review</span> : <span className="rounded-full bg-green-500/15 px-2 py-1 text-xs text-green-400">Tracked</span>}
                    </td>
                    <td className="py-3 pr-0 text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={detailMonthParam ? `/expenses/${expense.id}?month=${detailMonthParam}` : `/expenses/${expense.id}`} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">View</Link>
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
