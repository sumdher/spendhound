"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createExpenseFromReceipt, listCategories, listReceipts, uploadReceipt, type Category, type Receipt } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [draft, setDraft] = useState({ merchant: "", amount: "", currency: "EUR", expense_date: "", description: "", category_id: "", category_name: "", notes: "", confidence: "0.5" });

  const refresh = useCallback(async () => {
    const [receiptData, categoryData] = await Promise.all([listReceipts(), listCategories()]);
    setReceipts(receiptData);
    setCategories(categoryData);
    if (!selectedId && receiptData.length > 0) setSelectedId(receiptData[0].id);
  }, [selectedId]);

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : "Failed to load receipts"));
  }, [refresh]);

  const selectedReceipt = useMemo(() => receipts.find((receipt) => receipt.id === selectedId) ?? null, [receipts, selectedId]);

  useEffect(() => {
    if (!selectedReceipt?.preview) return;
    setDraft({
      merchant: selectedReceipt.preview.merchant ?? "",
      amount: selectedReceipt.preview.amount ? String(selectedReceipt.preview.amount) : "",
      currency: selectedReceipt.preview.currency ?? "EUR",
      expense_date: selectedReceipt.preview.expense_date ?? new Date().toISOString().slice(0, 10),
      description: selectedReceipt.preview.description ?? "",
      category_id: "",
      category_name: selectedReceipt.preview.category_name ?? "",
      notes: selectedReceipt.preview.notes ?? "",
      confidence: String(selectedReceipt.preview.confidence ?? 0.5),
    });
  }, [selectedReceipt]);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const receipt = await uploadReceipt(file);
      await refresh();
      setSelectedId(receipt.id);
      setSuccess(`Uploaded ${receipt.original_filename}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleFinalize() {
    if (!selectedReceipt) return;
    setSaving(true);
    setError(null);
    try {
      await createExpenseFromReceipt({
        receipt_id: selectedReceipt.id,
        merchant: draft.merchant,
        description: draft.description || null,
        amount: Number(draft.amount),
        currency: draft.currency,
        expense_date: draft.expense_date,
        category_id: draft.category_id || null,
        category_name: draft.category_id ? null : draft.category_name || null,
        notes: draft.notes || null,
        confidence: Number(draft.confidence),
      });
      setSuccess("Receipt saved as an expense.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save receipt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-card p-4">
          <h1 className="text-2xl font-bold">Receipts</h1>
          <p className="mt-1 text-sm text-muted-foreground">Upload receipts, inspect extracted fields, and approve before saving.</p>
          <label className="mt-4 flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm hover:bg-accent">
            <input type="file" className="hidden" onChange={handleUpload} />
            {uploading ? "Uploading…" : "Choose a receipt file"}
          </label>
        </div>

        <div className="rounded-2xl border border-border bg-card p-2">
          <div className="px-2 py-2 text-sm font-medium text-muted-foreground">Review queue</div>
          <div className="space-y-2">
            {receipts.length === 0 ? <div className="px-3 py-6 text-sm text-muted-foreground">No receipts uploaded yet.</div> : receipts.map((receipt) => (
              <button key={receipt.id} onClick={() => setSelectedId(receipt.id)} className={`w-full rounded-xl border px-3 py-3 text-left ${selectedId === receipt.id ? "border-primary bg-primary/10" : "border-border hover:bg-accent"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{receipt.original_filename}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(receipt.created_at)} · {receipt.preview?.merchant || "Pending extraction"}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs ${receipt.needs_review ? "bg-yellow-500/15 text-yellow-400" : "bg-green-500/15 text-green-400"}`}>{receipt.needs_review ? "Review" : "Ready"}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        {error ? <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div> : null}
        {success ? <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">{success}</div> : null}
        {!selectedReceipt ? <div className="py-20 text-center text-muted-foreground">Select a receipt to review.</div> : (
          <div className="space-y-5">
            <div className="flex flex-col gap-2 border-b border-border pb-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-semibold">{selectedReceipt.original_filename}</h2>
                <p className="text-sm text-muted-foreground">Extraction confidence: {Math.round((selectedReceipt.extraction_confidence ?? 0) * 100)}%</p>
              </div>
              <div className="rounded-full bg-secondary px-3 py-1 text-sm">Status: {selectedReceipt.extraction_status}</div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm"><span className="mb-1 block text-muted-foreground">Merchant</span><input value={draft.merchant} onChange={(e) => setDraft({ ...draft, merchant: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
              <label className="text-sm"><span className="mb-1 block text-muted-foreground">Amount</span><input type="number" step="0.01" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
              <label className="text-sm"><span className="mb-1 block text-muted-foreground">Date</span><input type="date" value={draft.expense_date} onChange={(e) => setDraft({ ...draft, expense_date: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
              <label className="text-sm"><span className="mb-1 block text-muted-foreground">Currency</span><input value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
            </div>

            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Description</span><input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Category</span>
                <select value={draft.category_id} onChange={(e) => setDraft({ ...draft, category_id: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                  <option value="">Use custom or extracted category</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
              <label className="text-sm"><span className="mb-1 block text-muted-foreground">Custom category name</span><input value={draft.category_name} onChange={(e) => setDraft({ ...draft, category_name: e.target.value })} disabled={!!draft.category_id} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:opacity-50" /></label>
            </div>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Confidence override</span><input type="number" min="0" max="1" step="0.01" value={draft.confidence} onChange={(e) => setDraft({ ...draft, confidence: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Notes</span><textarea rows={4} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>

            <div className="rounded-xl border border-border bg-background p-4">
              <div className="mb-2 text-sm font-medium">OCR text preview</div>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{selectedReceipt.ocr_text || "No local OCR text extracted. You can still save the edited preview manually."}</pre>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Estimated amount: {draft.amount ? formatCurrency(Number(draft.amount), draft.currency) : "—"}</div>
              <button onClick={handleFinalize} disabled={saving || !draft.merchant || !draft.amount || !draft.expense_date} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving ? "Saving…" : "Approve and save expense"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
