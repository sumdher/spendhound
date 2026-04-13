"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createExpense, createExpenseFromReceipt, listCategories, uploadReceipt, type Category, type Receipt } from "@/lib/api";
import { currentMonthString, formatCurrency } from "@/lib/utils";

type ExpenseFormState = {
  merchant: string;
  description: string;
  amount: string;
  currency: string;
  expense_date: string;
  category_id: string;
  category_name: string;
  notes: string;
};

type ReceiptDraftState = ExpenseFormState & {
  confidence: string;
};

const MANUAL_TAB = "manual";
const RECEIPT_TAB = "upload-receipt";

function createEmptyExpenseForm(): ExpenseFormState {
  return {
    merchant: "",
    description: "",
    amount: "",
    currency: "EUR",
    expense_date: `${currentMonthString()}-01`,
    category_id: "",
    category_name: "",
    notes: "",
  };
}

function createEmptyReceiptDraft(): ReceiptDraftState {
  return {
    ...createEmptyExpenseForm(),
    confidence: "0.5",
  };
}

export default function NewExpensePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptSuccess, setReceiptSuccess] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [finalizingReceipt, setFinalizingReceipt] = useState(false);
  const [manualForm, setManualForm] = useState<ExpenseFormState>(createEmptyExpenseForm);
  const [receiptDraft, setReceiptDraft] = useState<ReceiptDraftState>(createEmptyReceiptDraft);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);

  const activeTab = searchParams.get("tab") === RECEIPT_TAB ? RECEIPT_TAB : MANUAL_TAB;

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedReceipt?.preview) return;
    setReceiptDraft({
      merchant: selectedReceipt.preview.merchant ?? "",
      amount: selectedReceipt.preview.amount != null ? String(selectedReceipt.preview.amount) : "",
      currency: selectedReceipt.preview.currency ?? "EUR",
      expense_date: selectedReceipt.preview.expense_date ?? new Date().toISOString().slice(0, 10),
      description: selectedReceipt.preview.description ?? "",
      category_id: "",
      category_name: selectedReceipt.preview.category_name ?? "",
      notes: selectedReceipt.preview.notes ?? "",
      confidence: String(selectedReceipt.preview.confidence ?? 0.5),
    });
  }, [selectedReceipt]);

  const extractedItems = useMemo(() => selectedReceipt?.preview?.items ?? [], [selectedReceipt]);

  function setTab(tab: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === MANUAL_TAB) {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    const query = params.toString();
    router.replace(query ? `/expenses/new?${query}` : "/expenses/new");
  }

  async function handleManualSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setManualError(null);
    try {
      await createExpense({
        merchant: manualForm.merchant,
        description: manualForm.description || null,
        amount: Number(manualForm.amount),
        currency: manualForm.currency,
        expense_date: manualForm.expense_date,
        category_id: manualForm.category_id || null,
        category_name: manualForm.category_id ? null : manualForm.category_name || null,
        notes: manualForm.notes || null,
      });
      router.push("/expenses");
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Failed to save expense");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setReceiptError(null);
    setReceiptSuccess(null);
    try {
      const receipt = await uploadReceipt(file);
      setSelectedReceipt(receipt);
      setReceiptSuccess(`Uploaded ${receipt.original_filename}. Review the extracted fields before saving.`);
      setTab(RECEIPT_TAB);
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleReceiptFinalize() {
    if (!selectedReceipt) return;
    setFinalizingReceipt(true);
    setReceiptError(null);
    setReceiptSuccess(null);
    try {
      const savedExpense = await createExpenseFromReceipt({
        receipt_id: selectedReceipt.id,
        merchant: receiptDraft.merchant,
        description: receiptDraft.description || null,
        amount: Number(receiptDraft.amount),
        currency: receiptDraft.currency,
        expense_date: receiptDraft.expense_date,
        category_id: receiptDraft.category_id || null,
        category_name: receiptDraft.category_id ? null : receiptDraft.category_name || null,
        notes: receiptDraft.notes || null,
        confidence: Number(receiptDraft.confidence),
      });
      router.push(`/expenses?month=${savedExpense.expense_date.slice(0, 7)}`);
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : "Failed to save receipt");
    } finally {
      setFinalizingReceipt(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Add expense</h1>
        <p className="text-sm text-muted-foreground">Choose manual entry or upload a receipt for direct multimodal extraction with review before save.</p>
      </div>
      <div className="flex gap-2 border-b border-border">
        <button type="button" onClick={() => setTab(MANUAL_TAB)} className={`rounded-t-xl px-4 py-2 text-sm font-medium ${activeTab === MANUAL_TAB ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Manual</button>
        <button type="button" onClick={() => setTab(RECEIPT_TAB)} className={`rounded-t-xl px-4 py-2 text-sm font-medium ${activeTab === RECEIPT_TAB ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Upload receipt</button>
      </div>

      {activeTab === MANUAL_TAB ? (
        <form onSubmit={handleManualSubmit} className="space-y-4 rounded-2xl border border-border bg-card p-6">
          {manualError ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{manualError}</div> : null}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Merchant</span><input required value={manualForm.merchant} onChange={(e) => setManualForm({ ...manualForm, merchant: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Amount</span><input required type="number" step="0.01" value={manualForm.amount} onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Date</span><input required type="date" value={manualForm.expense_date} onChange={(e) => setManualForm({ ...manualForm, expense_date: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Currency</span><input value={manualForm.currency} onChange={(e) => setManualForm({ ...manualForm, currency: e.target.value.toUpperCase() })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          </div>
          <label className="text-sm"><span className="mb-1 block text-muted-foreground">Description</span><input value={manualForm.description} onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Category</span>
              <select value={manualForm.category_id} onChange={(e) => setManualForm({ ...manualForm, category_id: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                <option value="">Use rule or custom name</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Custom category name</span><input value={manualForm.category_name} onChange={(e) => setManualForm({ ...manualForm, category_name: e.target.value })} disabled={!!manualForm.category_id} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:opacity-50" /></label>
          </div>
          <label className="text-sm"><span className="mb-1 block text-muted-foreground">Notes</span><textarea value={manualForm.notes} onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })} rows={4} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => router.push("/expenses")} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent">Cancel</button>
            <button disabled={submitting} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">{submitting ? "Saving…" : "Save expense"}</button>
          </div>
        </form>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-xl font-semibold">Upload receipt</h2>
              <p className="mt-1 text-sm text-muted-foreground">Receipt images are sent directly to the configured multimodal LLM. Structured fields are validated before anything can be saved as an expense.</p>
              <label className="mt-4 flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm hover:bg-accent">
                <input type="file" accept="image/*,.pdf,text/plain" className="hidden" onChange={handleUpload} />
                {uploading ? "Uploading…" : "Choose a receipt image or file"}
              </label>
              {selectedReceipt ? (
                <div className="mt-4 rounded-xl border border-border bg-background p-3 text-sm">
                  <div className="font-medium">Current receipt</div>
                  <div className="mt-1 text-muted-foreground">{selectedReceipt.original_filename}</div>
                  <div className="mt-2 text-xs text-muted-foreground">Confidence: {Math.round((selectedReceipt.extraction_confidence ?? 0) * 100)}% · Status: {selectedReceipt.extraction_status}</div>
                </div>
              ) : null}
            </div>

            {selectedReceipt?.preview?.notes ? (
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="text-sm font-medium">Extraction notes</div>
                <p className="mt-2 text-sm text-muted-foreground">{selectedReceipt.preview.notes}</p>
              </div>
            ) : null}

            {extractedItems.length > 0 ? (
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="mb-3 text-sm font-medium">Extracted items</div>
                <div className="space-y-2">
                  {extractedItems.map((item, index) => (
                    <div key={`${item.description ?? "item"}-${index}`} className="rounded-xl border border-border bg-background px-3 py-2 text-sm">
                      <div className="font-medium">{item.description || `Item ${index + 1}`}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Qty {item.quantity ?? "—"} · Unit {item.unit_price != null ? formatCurrency(item.unit_price, receiptDraft.currency) : "—"} · Total {item.total != null ? formatCurrency(item.total, receiptDraft.currency) : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            {receiptError ? <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{receiptError}</div> : null}
            {receiptSuccess ? <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">{receiptSuccess}</div> : null}
            {!selectedReceipt ? <div className="py-20 text-center text-muted-foreground">Upload a receipt to review extracted fields.</div> : (
              <div className="space-y-5">
                <div className="flex flex-col gap-2 border-b border-border pb-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-xl font-semibold">Review extracted expense</h2>
                    <p className="text-sm text-muted-foreground">Validate the draft before approval. The reviewed payload, not raw model output, is what becomes an expense.</p>
                  </div>
                  <div className="rounded-full bg-secondary px-3 py-1 text-sm">{selectedReceipt.original_filename}</div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Merchant</span><input value={receiptDraft.merchant} onChange={(e) => setReceiptDraft({ ...receiptDraft, merchant: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Amount</span><input type="number" step="0.01" value={receiptDraft.amount} onChange={(e) => setReceiptDraft({ ...receiptDraft, amount: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Date</span><input type="date" value={receiptDraft.expense_date} onChange={(e) => setReceiptDraft({ ...receiptDraft, expense_date: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Currency</span><input value={receiptDraft.currency} onChange={(e) => setReceiptDraft({ ...receiptDraft, currency: e.target.value.toUpperCase() })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
                </div>

                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Description</span><input value={receiptDraft.description} onChange={(e) => setReceiptDraft({ ...receiptDraft, description: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm">
                    <span className="mb-1 block text-muted-foreground">Category</span>
                    <select value={receiptDraft.category_id} onChange={(e) => setReceiptDraft({ ...receiptDraft, category_id: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                      <option value="">Use custom or extracted category</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Custom category name</span><input value={receiptDraft.category_name} onChange={(e) => setReceiptDraft({ ...receiptDraft, category_name: e.target.value })} disabled={!!receiptDraft.category_id} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:opacity-50" /></label>
                </div>
                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Confidence override</span><input type="number" min="0" max="1" step="0.01" value={receiptDraft.confidence} onChange={(e) => setReceiptDraft({ ...receiptDraft, confidence: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Notes</span><textarea rows={4} value={receiptDraft.notes} onChange={(e) => setReceiptDraft({ ...receiptDraft, notes: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>

                {selectedReceipt.ocr_text ? (
                  <div className="rounded-xl border border-border bg-background p-4">
                    <div className="mb-2 text-sm font-medium">Secondary text fallback preview</div>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{selectedReceipt.ocr_text}</pre>
                  </div>
                ) : null}

                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">Estimated amount: {receiptDraft.amount ? formatCurrency(Number(receiptDraft.amount), receiptDraft.currency) : "—"}</div>
                  <button type="button" onClick={handleReceiptFinalize} disabled={finalizingReceipt || !receiptDraft.merchant || !receiptDraft.amount || !receiptDraft.expense_date} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{finalizingReceipt ? "Saving…" : "Approve and save expense"}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
