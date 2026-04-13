"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createExpense, listCategories, type Category } from "@/lib/api";
import { currentMonthString } from "@/lib/utils";

export default function NewExpensePage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    merchant: "",
    description: "",
    amount: "",
    currency: "EUR",
    expense_date: `${currentMonthString()}-01`,
    category_id: "",
    category_name: "",
    notes: "",
  });

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await createExpense({
        merchant: form.merchant,
        description: form.description || null,
        amount: Number(form.amount),
        currency: form.currency,
        expense_date: form.expense_date,
        category_id: form.category_id || null,
        category_name: form.category_id ? null : form.category_name || null,
        notes: form.notes || null,
      });
      router.push("/expenses");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save expense");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Add expense</h1>
        <p className="text-sm text-muted-foreground">Manual entry is useful for cash spend, subscription fixes, and corrections.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-border bg-card p-6">
        {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm"><span className="mb-1 block text-muted-foreground">Merchant</span><input required value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block text-muted-foreground">Amount</span><input required type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block text-muted-foreground">Date</span><input required type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          <label className="text-sm"><span className="mb-1 block text-muted-foreground">Currency</span><input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
        </div>
        <label className="text-sm"><span className="mb-1 block text-muted-foreground">Description</span><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Category</span>
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2">
              <option value="">Use rule or custom name</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="mb-1 block text-muted-foreground">Custom category name</span><input value={form.category_name} onChange={(e) => setForm({ ...form, category_name: e.target.value })} disabled={!!form.category_id} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:opacity-50" /></label>
        </div>
        <label className="text-sm"><span className="mb-1 block text-muted-foreground">Notes</span><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={4} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => router.push("/expenses")} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent">Cancel</button>
          <button disabled={submitting} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">{submitting ? "Saving…" : "Save expense"}</button>
        </div>
      </form>
    </div>
  );
}
