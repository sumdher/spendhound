"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, Line, LineChart } from "recharts";
import { getDashboardAnalytics, type DashboardAnalytics } from "@/lib/api";
import { currentMonthString, formatCurrency, formatDate, formatSignedCurrency, monthLabel, transactionCadenceLabel, transactionTypeLabel } from "@/lib/utils";

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
          <p className="text-sm text-muted-foreground">Monthly visibility into cashflow, spending, income, budgets, and recurring transactions.</p>
        </div>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Month</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-border bg-card px-3 py-2" />
        </label>
      </div>

      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div> : null}

      {loading || !data ? (
        <div className="grid gap-4 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl bg-card" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-5">
            <StatCard label={`Money out · ${monthLabel(data.month)}`} value={formatCurrency(data.summary.money_out)} />
            <StatCard label="Money in" value={formatCurrency(data.summary.money_in)} />
            <StatCard label="Net" value={formatCurrency(data.summary.net)} />
            <StatCard label="Transactions" value={String(data.summary.transaction_count)} />
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
                <h2 className="font-semibold">Top spending merchants</h2>
                <p className="text-sm text-muted-foreground">Where most of your money out went this month.</p>
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
                          {data.income_by_category.map((item, index) => <Cell key={item.name} fill={COLORS[index % COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2">
                    {data.income_by_category.map((item, index) => (
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
                <h2 className="font-semibold">Grocery subcategory insights</h2>
                <p className="text-sm text-muted-foreground">LLM-assisted grouping of stored receipt line items to show what grocery things you buy most and least.</p>
              </div>
              {data.grocery_insights.item_count === 0 ? <div className="py-16 text-center text-muted-foreground">No itemized grocery receipts yet for this month.</div> : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">{data.grocery_insights.summary}</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="mb-2 text-sm font-medium">Top grocery subcategories</div>
                      <div className="space-y-2">
                        {data.grocery_insights.top_subcategories.map((item) => (
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
                        {data.grocery_insights.least_subcategories.map((item) => (
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
                    <span className="font-medium">{formatCurrency(data.grocery_insights.total_itemized_spend)}</span>
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
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Line type="monotone" dataKey="money_out" name="Money out" stroke="#f87171" strokeWidth={3} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="money_in" name="Money in" stroke="#34d399" strokeWidth={3} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="net" name="Net" stroke="#60a5fa" strokeWidth={3} dot={{ r: 3 }} />
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
                      <div className="text-sm text-muted-foreground">{expense.category_name} · {formatDate(expense.expense_date)} · {transactionTypeLabel(expense.transaction_type)} · {transactionCadenceLabel(expense.cadence)}</div>
                    </div>
                    <div className={`text-right font-medium ${expense.transaction_type === "credit" ? "text-emerald-400" : "text-red-400"}`}>{formatSignedCurrency(expense.amount, expense.transaction_type, expense.currency)}</div>
                  </div>
                ))}
              </div>
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
                  <div className="text-right font-medium text-red-400">{formatSignedCurrency(expense.amount, expense.transaction_type, expense.currency)}</div>
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
