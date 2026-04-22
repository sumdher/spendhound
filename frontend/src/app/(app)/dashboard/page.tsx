"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, Line, LineChart } from "recharts";
import { getDashboardAnalytics, listExpenses, listLedgers, sendMonthlyReportEmail, type DashboardAnalytics, type Expense, type Ledger } from "@/lib/api";
import { DASHBOARD_CHART_COLORS, getDashboardSummaryStats } from "@/lib/dashboard-report";
import { convertToBase, fetchAndStoreRates, getDefaultCurrency, getStoredRates, getStoredRatesUpdatedAt } from "@/lib/fx-rates";
import { currentMonthString, formatCurrency, formatDate, monthLabel, transactionCadenceLabel, transactionTypeLabel } from "@/lib/utils";



function RefreshIcon({ spinning }: { spinning: boolean }) {
  return spinning ? (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  ) : (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

/**
 * Formats a currency amount with an optional EUR approximation suffix for non-EUR currencies.
 * e.g. for INR: "₹1,234.56 ~ €11.21". For EUR (or missing rate): "€11.21".
 */
function formatFxHint(amount: number, currency: string, defaultCurrency: string, fxRates: Record<string, number>): string {
  const native = formatCurrency(amount, currency);
  if (!currency || currency === defaultCurrency) return native;
  const rate = fxRates[currency];
  if (!rate) return native;
  return `${native} ~ ${formatCurrency(convertToBase(amount, currency, defaultCurrency, fxRates), defaultCurrency)}`;
}

/**
 * Same as formatFxHint but applies the debit/credit sign before formatting.
 */
function formatSignedFxHint(
  amount: number,
  transactionType: string | null | undefined,
  currency: string,
  defaultCurrency: string,
  fxRates: Record<string, number>,
): string {
  const signed = transactionType === "credit" ? amount : -amount;
  return formatFxHint(signed, currency, defaultCurrency, fxRates);
}

export default function DashboardPage() {
  const [month, setMonth] = useState(currentMonthString());
  const [data, setData] = useState<DashboardAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emailPending, setEmailPending] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  // FX rate state — initialised from localStorage (or defaults) synchronously
  const [fxRates, setFxRates] = useState<Record<string, number>>(() => getStoredRates());
  const [fxUpdatedAt, setFxUpdatedAt] = useState<string | null>(() => getStoredRatesUpdatedAt());
  const [fxLoading, setFxLoading] = useState(false);
  const [fxError, setFxError] = useState<string | null>(null);
  const [defaultCurrency] = useState<string>(() => getDefaultCurrency());

  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [dashLedgerIds, setDashLedgerIds] = useState<string[]>([]);

  // Raw per-expense data for the selected month (for FX-aware re-aggregation)
  const [monthExpenses, setMonthExpenses] = useState<Expense[]>([]);

  useEffect(() => {
    setLoading(true);
    setEmailSuccess(null);
    setEmailError(null);
    getDashboardAnalytics(month)
      .then((value) => {
        setData(value);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, [month]);

  useEffect(() => {
    listLedgers().then((res) => setLedgers(res.ledgers)).catch(() => {});
  }, []);

  // Fetch raw expenses for the month so we can re-aggregate with FX rates
  useEffect(() => {
    setMonthExpenses([]);
    const filters: Record<string, string | boolean | undefined> = { month };
    if (dashLedgerIds.length > 0) filters.ledger_ids = dashLedgerIds.join(",");
    listExpenses(filters)
      .then((res) => setMonthExpenses(res.items))
      .catch(() => { /* silently degrade — charts fall back to backend totals */ });
  }, [month, dashLedgerIds]);

  async function handleSendMonthlyEmail() {
    setEmailPending(true);
    setEmailSuccess(null);
    setEmailError(null);

    try {
      const response = await sendMonthlyReportEmail({ month });
      const detail = typeof response.detail === "string" ? response.detail : null;
      const message = typeof response.message === "string" ? response.message : null;
      setEmailSuccess(detail ?? message ?? `Monthly digest for ${monthLabel(month)} sent successfully.`);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Failed to send monthly digest email.");
    } finally {
      setEmailPending(false);
    }
  }

  // All non-EUR currencies detected from the current month's analytics summary maps
  const detectedCurrencies = useMemo<string[]>(() => {
    if (!data) return [];
    const seen = new Set<string>();
    Object.keys(data.summary.money_out_by_currency ?? {}).forEach((c) => seen.add(c));
    Object.keys(data.summary.money_in_by_currency ?? {}).forEach((c) => seen.add(c));
    seen.delete(defaultCurrency);
    return Array.from(seen).sort();
  }, [data, defaultCurrency]);

  // FX-aware "spend by category" — re-aggregated from raw debit expenses converted to EUR.
  // Falls back to the backend-provided totals when raw expenses are not yet loaded.
  const fxSpendByCategory = useMemo(() => {
    const debits = monthExpenses.filter((e) => e.transaction_type === "debit");
    if (debits.length === 0) return data?.spend_by_category ?? [];

    const map = new Map<string, number>();
    for (const expense of debits) {
      const name = expense.category_name ?? "Uncategorised";
      map.set(name, (map.get(name) ?? 0) + convertToBase(expense.amount, expense.currency, defaultCurrency, fxRates));
    }
    return Array.from(map.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [monthExpenses, fxRates, defaultCurrency, data?.spend_by_category]);

  // FX-aware "top merchants" — same approach, top 10 by EUR-equivalent spend.
  const fxTopMerchants = useMemo(() => {
    const debits = monthExpenses.filter((e) => e.transaction_type === "debit");
    if (debits.length === 0) return data?.top_merchants ?? [];

    const map = new Map<string, number>();
    for (const expense of debits) {
      const merchant = expense.merchant ?? "Unknown";
      map.set(merchant, (map.get(merchant) ?? 0) + convertToBase(expense.amount, expense.currency, defaultCurrency, fxRates));
    }
    return Array.from(map.entries())
      .map(([merchant, amount]) => ({ merchant, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
  }, [monthExpenses, fxRates, defaultCurrency, data?.top_merchants]);

  // FX-aware "grocery subcategory insights" — re-aggregated from expense items converted to EUR.
  // Each item's total is converted using its parent expense's currency. Falls back to the
  // backend-provided grocery_insights when no expenses with items are available yet.
  const fxGroceryInsights = useMemo(() => {
    const expensesWithItems = monthExpenses.filter((e) => e.items && e.items.length > 0);
    if (expensesWithItems.length === 0) return data?.grocery_insights ?? null;

    const subcategoryMap = new Map<string, { amount: number; item_count: number }>();
    let totalItemizedSpend = 0;
    let uncategorizedCount = 0;

    for (const expense of expensesWithItems) {
      for (const item of expense.items ?? []) {
        const total = item.total ?? 0;
        const eurAmount = convertToBase(total, expense.currency, defaultCurrency, fxRates);
        totalItemizedSpend += eurAmount;
        const subcategory = item.subcategory ?? null;
        if (!subcategory) { uncategorizedCount++; continue; }
        const existing = subcategoryMap.get(subcategory) ?? { amount: 0, item_count: 0 };
        subcategoryMap.set(subcategory, {
          amount: existing.amount + eurAmount,
          item_count: existing.item_count + 1,
        });
      }
    }

    const sorted = Array.from(subcategoryMap.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.amount - a.amount);

    return {
      item_count: sorted.reduce((s, c) => s + c.item_count, 0) + uncategorizedCount,
      total_itemized_spend: totalItemizedSpend,
      summary: data?.grocery_insights.summary ?? "",
      top_subcategories: sorted.slice(0, 5),
      least_subcategories: [...sorted].reverse().slice(0, 5),
      uncategorized_count: uncategorizedCount,
    };
  }, [monthExpenses, fxRates, defaultCurrency, data?.grocery_insights]);

  // Stable grocery data reference: prefers FX-re-aggregated data, falls back to backend totals.
  const groceryData = fxGroceryInsights ?? data?.grocery_insights ?? null;

  async function handleUpdateRates() {
    if (detectedCurrencies.length === 0) return;
    setFxLoading(true);
    setFxError(null);
    try {
      const newRates = await fetchAndStoreRates(detectedCurrencies, defaultCurrency);
      setFxRates(newRates);
      setFxUpdatedAt(getStoredRatesUpdatedAt());
    } catch {
      setFxError("Could not fetch rates");
    } finally {
      setFxLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        {/* LEFT — title + description + desktop controls */}
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between md:block">
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <Link href="/account" className="text-sm text-muted-foreground hover:text-foreground transition-colors md:hidden">My Account</Link>
          </div>
          <p className="text-sm text-muted-foreground">Monthly visibility into cashflow, spending, income, budgets, and recurring transactions.</p>

          {/* Desktop: month + email below description */}
          <div className="hidden md:flex items-end gap-2 mt-1">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Month</span>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-border bg-card px-3 py-2" />
            </label>
            <button
              type="button"
              onClick={handleSendMonthlyEmail}
              disabled={emailPending}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-70"
            >
              {emailPending ? "Sending digest..." : "Email me charts + data"}
            </button>
          </div>

          {/* Mobile: compact single-row controls */}
          <div className="flex items-center gap-1.5 flex-wrap md:hidden">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm w-32 shrink-0" />
            <Link href="/expenses/new" className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground whitespace-nowrap">
              + Add
            </Link>
            <Link href="/expenses" className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent whitespace-nowrap">
              Expenses
            </Link>
            <button
              type="button"
              onClick={handleSendMonthlyEmail}
              disabled={emailPending}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-70 whitespace-nowrap"
            >
              {emailPending ? "Sending..." : "Email digest"}
            </button>
          </div>
        </div>

        {/* RIGHT (desktop) — My Account + stats card + action buttons */}
        <div className="hidden md:flex md:shrink-0 md:flex-col md:items-end md:gap-3">
          <Link href="/account" className="text-sm text-muted-foreground hover:text-foreground transition-colors">My Account</Link>
          {data ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Transactions</p>
                <p className="font-semibold leading-tight">{data.summary.transaction_count}</p>
              </div>
              <div className="w-px h-6 bg-border" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Review</p>
                <p className={`font-semibold leading-tight ${data.summary.review_count > 0 ? "text-yellow-400" : ""}`}>{data.summary.review_count}</p>
              </div>
            </div>
          ) : (
            <div className="h-14 w-40 animate-pulse rounded-xl bg-card" />
          )}
          <div className="flex flex-col items-end gap-1.5">
            <Link href="/expenses/new" className="w-full rounded-lg bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground">
              + Add Expense
            </Link>
            <Link href="/expenses" className="w-full rounded-lg border border-border bg-card px-4 py-2 text-center text-sm font-medium hover:bg-accent">
              Expenses
            </Link>
          </div>
        </div>
      </div>

      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div> : null}
      {emailError ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{emailError}</div> : null}
      {emailSuccess ? <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">{emailSuccess}</div> : null}

      {loading || !data ? (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-16 w-36 animate-pulse rounded-xl bg-card" />)}
        </div>
      ) : (
        <>
          {/* Desktop: single-row KPI strip — cards shrink to natural width */}
          <div className="hidden md:flex flex-wrap items-stretch gap-2">
            {getDashboardSummaryStats(data).slice(0, 3).map((item) => (
              <div key={item.label} className="flex shrink-0 flex-col rounded-xl border border-border bg-card px-4 py-2.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">{item.label}</p>
                {item.lines && item.lines.length > 0 ? (
                  <div className="mt-0.5">
                    {item.lines.map((line, i) => (
                      <p key={i} className={`font-semibold whitespace-nowrap ${line.primary ? "text-xl leading-tight" : "text-[10px] opacity-70"} ${line.colorClass}`}>{line.value}</p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-0.5 text-xl font-semibold">{item.value}</p>
                )}
              </div>
            ))}
            {detectedCurrencies.length > 0 && (
              <>
                <div className="w-px self-stretch bg-border" />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleUpdateRates}
                    disabled={fxLoading}
                    title={fxUpdatedAt ? `Rates updated ${new Date(fxUpdatedAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}` : "Fetch live ECB rates"}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshIcon spinning={fxLoading} />
                    Update exchange rates
                  </button>
                  {fxError && <p className="text-xs text-red-400">{fxError}</p>}
                </div>
              </>
            )}
          </div>

          {/* Mobile: compact layout */}
          <div className="space-y-2 md:hidden">
            {/* Transactions + Needs review as small info row */}
            <div className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-2.5">
              <div className="text-sm"><span className="text-muted-foreground">Transactions </span><span className="font-semibold">{data.summary.transaction_count}</span></div>
              <div className="w-px h-4 bg-border" />
              <div className="text-sm"><span className="text-muted-foreground">Needs review </span><span className={`font-semibold ${data.summary.review_count > 0 ? "text-yellow-400" : ""}`}>{data.summary.review_count}</span></div>
            </div>
            {/* 3 money boxes in a row */}
            <div className="grid grid-cols-3 gap-2">
              {([
                { label: `Money out · ${data.month.slice(0, 7)}`, byCurrency: data.summary.money_out_by_currency, colorClass: "text-red-400" },
                { label: "Money in", byCurrency: data.summary.money_in_by_currency, colorClass: "text-emerald-400" },
                { label: "Net", byCurrency: data.summary.net_by_currency, colorClass: "" },
              ] as const).map(({ label, byCurrency, colorClass }) => {
                const entries = Object.entries(byCurrency).sort(([a], [b]) => a === defaultCurrency ? -1 : b === defaultCurrency ? 1 : 0);
                const primaryEntry = entries.find(([c]) => c === defaultCurrency) ?? entries[0];
                const primaryVal = primaryEntry?.[1] ?? 0;
                const primaryCur = primaryEntry?.[0] ?? defaultCurrency;
                const netColor = label === "Net" ? (primaryVal >= 0 ? "text-emerald-400" : "text-red-400") : colorClass;
                return (
                  <div key={label} className="rounded-xl border border-border bg-card px-2 py-2">
                    <div className="text-[10px] text-muted-foreground leading-tight">{label.includes("·") ? label.split("·")[0].trim() : label}</div>
                    <div className={`text-base font-semibold ${netColor}`}>{formatCurrency(primaryVal, primaryCur)}</div>
                    {entries.filter(([c]) => c !== primaryCur).map(([c, v]) => (
                      <div key={c} className={`text-[10px] opacity-70 ${netColor}`}>{formatCurrency(v, c)}</div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* FX rate refresh — mobile only; desktop has it inline in the KPI strip above */}
          {detectedCurrencies.length > 0 && (
            <div className="flex items-center gap-2 md:hidden">
              <button
                type="button"
                onClick={handleUpdateRates}
                disabled={fxLoading}
                title={fxUpdatedAt ? `Rates updated ${new Date(fxUpdatedAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}` : "Fetch live ECB rates for detected currencies"}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshIcon spinning={fxLoading} />
                Update exchange rates
              </button>
              {fxError && <p className="text-xs text-red-400">{fxError}</p>}
            </div>
          )}

          {/* Ledger filter chips — scope the spend charts to specific ledgers */}
          {ledgers.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Spend charts:</span>
              <button type="button" onClick={() => setDashLedgerIds([])}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${dashLedgerIds.length === 0 ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-accent"}`}>
                General
              </button>
              {ledgers.map((l) => (
                <button key={l.id} type="button"
                  onClick={() => setDashLedgerIds((prev) => prev.includes(l.id) ? prev.filter((id) => id !== l.id) : [...prev, l.id])}
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${dashLedgerIds.includes(l.id) ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-accent"}`}>
                  {l.name}
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="font-semibold">Spend by category</h2>
                <p className="text-sm text-muted-foreground">Where your money went this month.</p>
              </div>
              {fxSpendByCategory.length === 0 ? <div className="py-16 text-center text-muted-foreground">No expenses yet for this month.</div> : (
                <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={fxSpendByCategory} dataKey="amount" nameKey="name" innerRadius={70} outerRadius={100}>
                          {fxSpendByCategory.map((item, index) => <Cell key={item.name} fill={DASHBOARD_CHART_COLORS[index % DASHBOARD_CHART_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2">
                    {fxSpendByCategory.map((item, index) => (
                      <div key={item.name} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                        <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: DASHBOARD_CHART_COLORS[index % DASHBOARD_CHART_COLORS.length] }} />{item.name}</div>
                        <span>{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="font-semibold">Top spending merchants</h2>
                <p className="text-sm text-muted-foreground">Where most of your money out went this month.</p>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={fxTopMerchants} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(110,231,183,0.12)" />
                    <XAxis dataKey="merchant" tick={{ fontSize: 12 }} interval={0} angle={-15} textAnchor="end" height={60} />
                    <YAxis tickFormatter={(value) => `${value}`} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Bar dataKey="amount" fill="#34d399" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="font-semibold">Money in by category</h2>
                <p className="text-sm text-muted-foreground">How income and credits were categorised this month.</p>
              </div>
              {data.income_by_category.length === 0 ? <div className="py-16 text-center text-muted-foreground">No income transactions yet for this month.</div> : (
                <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={data.income_by_category} dataKey="amount" nameKey="name" innerRadius={70} outerRadius={100}>
                          {data.income_by_category.map((item, index) => <Cell key={item.name} fill={DASHBOARD_CHART_COLORS[index % DASHBOARD_CHART_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2">
                    {data.income_by_category.map((item, index) => (
                      <div key={item.name} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                        <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: DASHBOARD_CHART_COLORS[index % DASHBOARD_CHART_COLORS.length] }} />{item.name}</div>
                        <span>{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="font-semibold">Grocery subcategory insights</h2>
                <p className="text-sm text-muted-foreground">LLM-assisted grouping of stored receipt line items to show what grocery things you buy most and least.</p>
              </div>
              {!groceryData || groceryData.item_count === 0 ? <div className="py-16 text-center text-muted-foreground">No itemized grocery receipts yet for this month.</div> : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">{groceryData.summary}</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="mb-2 text-sm font-medium">Top grocery subcategories</div>
                      <div className="space-y-2">
                        {groceryData.top_subcategories.map((item) => (
                          <div key={item.name} className="flex items-center justify-between rounded-xl border border-border px-3 py-3 text-sm">
                            <div>
                              <div className="font-medium">{item.name}</div>
                              <div className="text-xs text-muted-foreground">{item.item_count} items</div>
                            </div>
                            <div>{formatCurrency(item.amount)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-sm font-medium">Lowest-spend grocery subcategories</div>
                      <div className="space-y-2">
                        {groceryData.least_subcategories.map((item) => (
                          <div key={item.name} className="flex items-center justify-between rounded-xl border border-border px-3 py-3 text-sm">
                            <div>
                              <div className="font-medium">{item.name}</div>
                              <div className="text-xs text-muted-foreground">{item.item_count} items</div>
                            </div>
                            <div>{formatCurrency(item.amount)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3 text-sm">
                    <span>Itemized grocery spend</span>
                    <span className="font-medium">{formatCurrency(groceryData.total_itemized_spend)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="font-semibold">Monthly trend</h2>
                <p className="text-sm text-muted-foreground">Rolling 12-month view of money in, money out, and net cashflow.</p>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.monthly_trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(110,231,183,0.12)" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Line type="monotone" dataKey="money_out" name="Money out" stroke="#f87171" strokeWidth={3} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="money_in" name="Money in" stroke="#34d399" strokeWidth={3} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="net" name="Net" stroke="#86efac" strokeWidth={3} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="font-semibold">Recurring transactions</h2>
                <p className="text-sm text-muted-foreground">Transactions that look like monthly subscriptions, bills, salary, or other repeating cashflow.</p>
              </div>
              <div className="space-y-3">
                {data.recurring_transactions.length === 0 ? <div className="py-16 text-center text-muted-foreground">No recurring patterns detected yet.</div> : data.recurring_transactions.map((expense) => (
                  <div key={expense.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                    <div>
                      <div className="font-medium">{expense.merchant}</div>
                      <div className="text-sm text-muted-foreground">{expense.category_name} · {formatDate(expense.expense_date)} · {transactionTypeLabel(expense.transaction_type)} · {transactionCadenceLabel(expense.cadence, (expense as { cadence_interval?: number | null }).cadence_interval)}</div>
                    </div>
                    <div className={`text-right font-medium ${expense.transaction_type === "credit" ? "text-emerald-400" : "text-red-400"}`}>{formatSignedFxHint(expense.amount, expense.transaction_type, expense.currency, defaultCurrency, fxRates)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4">
              <h2 className="font-semibold">Prepaid subscriptions</h2>
              <p className="text-sm text-muted-foreground">Lump-sum payments covering a fixed window of service. Coverage status is computed relative to today.</p>
            </div>
            <div className="space-y-3">
              {data.prepaid_subscriptions.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">No prepaid subscriptions recorded.</div>
              ) : data.prepaid_subscriptions.map((sub) => {
                const statusClasses = sub.status === "active" ? "bg-blue-500/15 text-blue-300" : sub.status === "expiring_soon" ? "bg-amber-500/15 text-amber-300" : "bg-gray-500/15 text-gray-400";
                const statusLabel = sub.status === "expired"
                  ? `Expired ${new Date(sub.prepaid_end_date).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`
                  : sub.days_remaining === 0
                    ? "Expires today"
                    : sub.status === "expiring_soon"
                      ? `Expires in ${sub.days_remaining}d`
                      : `${sub.days_remaining}d remaining`;
                return (
                  <div key={sub.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                    <div>
                      <div className="font-medium">{sub.merchant}</div>
                      <div className="text-sm text-muted-foreground">
                        {sub.category_name} · {sub.prepaid_months}mo coverage · starts {new Date(sub.prepaid_start_date).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <div className="font-medium text-red-400">{formatFxHint(sub.amount, sub.currency, defaultCurrency, fxRates)}</div>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${statusClasses}`}>{statusLabel}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4">
              <h2 className="font-semibold">Major one-time purchases</h2>
              <p className="text-sm text-muted-foreground">Large irregular spending called out separately from recurring cashflow so big buys like phones or watches stay visible.</p>
            </div>
            <div className="space-y-3">
              {data.major_one_time_purchases.length === 0 ? <div className="py-12 text-center text-muted-foreground">No major one-time purchases marked for this month.</div> : data.major_one_time_purchases.map((expense) => (
                <div key={expense.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                  <div>
                    <div className="font-medium">{expense.merchant}</div>
                    <div className="text-sm text-muted-foreground">{expense.category_name} · {formatDate(expense.expense_date)} · {transactionCadenceLabel(expense.cadence)}</div>
                  </div>
                  <div className="text-right font-medium text-red-400">{formatSignedFxHint(expense.amount, expense.transaction_type, expense.currency, defaultCurrency, fxRates)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4">
              <h2 className="font-semibold">Top income sources</h2>
              <p className="text-sm text-muted-foreground">Largest money-in sources detected this month.</p>
            </div>
            <div className="space-y-3">
              {data.top_income_sources.length === 0 ? <div className="py-12 text-center text-muted-foreground">No income sources recorded for this month.</div> : data.top_income_sources.map((source) => (
                <div key={source.merchant} className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm">
                  <div className="font-medium">{source.merchant}</div>
                  <div className="text-emerald-400">{formatCurrency(source.amount)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4">
              <h2 className="font-semibold">Budget vs actual</h2>
              <p className="text-sm text-muted-foreground">Compare this month&apos;s spending against your configured budgets.</p>
            </div>
            {data.budgets.length === 0 ? <div className="py-16 text-center text-muted-foreground">No budgets configured for {monthLabel(data.month)}.</div> : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-border text-left text-muted-foreground">
                    <tr>
                      <th className="py-3 pr-4">Budget</th>
                      <th className="py-3 pr-4">Category</th>
                      <th className="py-3 pr-4">Target</th>
                      <th className="py-3 pr-4">Actual</th>
                      <th className="py-3 pr-0">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.budgets.map((budget) => (
                      <tr key={budget.id} className="border-b border-border/60">
                        <td className="py-3 pr-4 font-medium">{budget.name}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{budget.category_name ?? "Overall"}</td>
                        <td className="py-3 pr-4">{formatCurrency(budget.amount, budget.currency)}</td>
                        <td className="py-3 pr-4">{formatCurrency(budget.actual, budget.currency)}</td>
                        <td className={`py-3 pr-0 ${budget.remaining < 0 ? "text-red-400" : "text-green-400"}`}>{formatCurrency(budget.remaining, budget.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
