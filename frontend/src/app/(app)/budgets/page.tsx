"use client";

import { useCallback, useEffect, useState } from "react";
import { createBudget, deleteBudget, listBudgets, listCategories, type Budget, type Category } from "@/lib/api";
import { currentMonthString, formatCurrency, monthLabel } from "@/lib/utils";

export default function BudgetsPage() {
  const [month, setMonth] = useState(currentMonthString());
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState({ name: "", amount: "", category_id: "", notes: "" });

  const load = useCallback(async () => {
    const [budgetData, categoryData] = await Promise.all([listBudgets(month), listCategories()]);
    setBudgets(budgetData);
    setCategories(categoryData);
  }, [month]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await createBudget({
      name: form.name,
      amount: Number(form.amount),
      category_id: form.category_id || null,
      month_start: `${month}-01`,
      notes: form.notes || null,
      currency: "EUR",
    });
    setForm({ name: "", amount: "", category_id: "", notes: "" });
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Budgets</h1>
          <p className="text-sm text-muted-foreground">Set monthly spending targets for the whole month or for specific categories.</p>
        </div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-border bg-card px-3 py-2" />
      </div>

      <form onSubmit={handleCreate} className="grid gap-4 rounded-2xl border border-border bg-card p-6 md:grid-cols-4">
        <label className="text-sm md:col-span-1"><span className="mb-1 block text-muted-foreground">Budget name</span><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
        <label className="text-sm md:col-span-1"><span className="mb-1 block text-muted-foreground">Amount</span><input required type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
        <label className="text-sm md:col-span-1"><span className="mb-1 block text-muted-foreground">Category</span><select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2"><option value="">Overall</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label className="text-sm md:col-span-1"><span className="mb-1 block text-muted-foreground">Notes</span><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
        <div className="md:col-span-4 flex justify-end"><button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Create budget</button></div>
      </form>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-4">
          <h2 className="text-xl font-semibold">Budgets for {monthLabel(month)}</h2>
          <p className="text-sm text-muted-foreground">Remaining values below zero indicate overspending.</p>
        </div>
        {budgets.length === 0 ? <div className="py-16 text-center text-muted-foreground">No budgets for this month yet.</div> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-border text-left text-muted-foreground"><tr><th className="py-3 pr-4">Budget</th><th className="py-3 pr-4">Category</th><th className="py-3 pr-4">Target</th><th className="py-3 pr-4">Actual</th><th className="py-3 pr-4">Remaining</th><th className="py-3 text-right">Action</th></tr></thead>
              <tbody>
                {budgets.map((budget) => (
                  <tr key={budget.id} className="border-b border-border/50">
                    <td className="py-3 pr-4 font-medium">{budget.name}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{budget.category_name ?? "Overall"}</td>
                    <td className="py-3 pr-4">{formatCurrency(budget.amount, budget.currency)}</td>
                    <td className="py-3 pr-4">{formatCurrency(budget.actual, budget.currency)}</td>
                    <td className={`py-3 pr-4 ${budget.remaining < 0 ? "text-red-400" : "text-green-400"}`}>{formatCurrency(budget.remaining, budget.currency)}</td>
                    <td className="py-3 text-right"><button onClick={() => deleteBudget(budget.id).then(load)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">Delete</button></td>
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
