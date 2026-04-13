"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, Line, LineChart } from "recharts";
import { getDashboardAnalytics, type DashboardAnalytics } from "@/lib/api";
import { currentMonthString, formatCurrency, formatDate, monthLabel } from "@/lib/utils";

const COLORS = ["#60a5fa", "#34d399", "#f59e0b", "#f472b6", "#a78bfa", "#fb7185", "#38bdf8"];

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [month, setMonth] = useState(currentMonthString());
  const [data, setData] = useState<DashboardAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getDashboardAnalytics(month)
      .then((value) => {
        setData(value);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, [month]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Monthly visibility into spending, budgets, and recurring charges.</p>
        </div>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Month</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-border bg-card px-3 py-2" />
        </label>
      </div>

      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div> : null}

      {loading || !data ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl bg-card" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard label={`Total spend · ${monthLabel(data.month)}`} value={formatCurrency(data.summary.total_spend)} />
            <StatCard label="Transactions" value={String(data.summary.transaction_count)} />
            <StatCard label="Average expense" value={formatCurrency(data.summary.average_transaction)} />
            <StatCard label="Needs review" value={String(data.summary.review_count)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="font-semibold">Spend by category</h2>
                <p className="text-sm text-muted-foreground">Where your money went this month.</p>
              </div>
              {data.spend_by_category.length === 0 ? <div className="py-16 text-center text-muted-foreground">No expenses yet for this month.</div> : (
                <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={data.spend_by_category} dataKey="amount" nameKey="name" innerRadius={70} outerRadius={100}>
                          {data.spend_by_category.map((item, index) => <Cell key={item.name} fill={COLORS[index % COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2">
                    {data.spend_by_category.map((item, index) => (
                      <div key={item.name} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                        <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />{item.name}</div>
                        <span>{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="font-semibold">Top merchants</h2>
                <p className="text-sm text-muted-foreground">Your highest-spend merchants this month.</p>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.top_merchants} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                    <XAxis dataKey="merchant" tick={{ fontSize: 12 }} interval={0} angle={-15} textAnchor="end" height={60} />
                    <YAxis tickFormatter={(value) => `${value}`} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Bar dataKey="amount" fill="#60a5fa" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="font-semibold">Monthly trend</h2>
                <p className="text-sm text-muted-foreground">Rolling 12-month spend history.</p>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.monthly_trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Line type="monotone" dataKey="amount" stroke="#34d399" strokeWidth={3} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="font-semibold">Recurring expenses</h2>
                <p className="text-sm text-muted-foreground">Transactions that look like monthly subscriptions or bills.</p>
              </div>
              <div className="space-y-3">
                {data.recurring_expenses.length === 0 ? <div className="py-16 text-center text-muted-foreground">No recurring patterns detected yet.</div> : data.recurring_expenses.map((expense) => (
                  <div key={expense.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                    <div>
                      <div className="font-medium">{expense.merchant}</div>
                      <div className="text-sm text-muted-foreground">{expense.category_name} · {formatDate(expense.expense_date)}</div>
                    </div>
                    <div className="text-right font-medium">{formatCurrency(expense.amount, expense.currency)}</div>
                  </div>
                ))}
              </div>
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
