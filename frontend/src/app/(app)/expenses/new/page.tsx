"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createExpense, createExpenseFromReceipt, createExpenseFromStatementEntry, listCategories, uploadReceipt, uploadStatement, type Category, type Receipt, type ReceiptPreview, type StatementImportEntry, type StatementImportPreview } from "@/lib/api";
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
const STATEMENT_TAB = "import-statement";

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

function createEmptyStatementDraft(): ReceiptDraftState {
  return {
    ...createEmptyExpenseForm(),
    confidence: "0.5",
  };
}

function isStatementPreview(preview: Receipt["preview"] | null | undefined): preview is StatementImportPreview {
  return Boolean(preview && typeof preview === "object" && "entries" in preview);
}

function isReceiptPreview(preview: Receipt["preview"] | null | undefined): preview is ReceiptPreview {
  return Boolean(preview && typeof preview === "object" && !isStatementPreview(preview));
}

function findNextPendingIndex(entries: StatementImportEntry[]) {
  return entries.findIndex((entry) => entry.status !== "finalized");
}

export default function NewExpensePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const receiptFinalizeInFlightRef = useRef(false);
  const statementFinalizeInFlightRef = useRef(false);
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
  const [statementDraft, setStatementDraft] = useState<ReceiptDraftState>(createEmptyStatementDraft);
  const [selectedStatement, setSelectedStatement] = useState<Receipt | null>(null);
  const [statementIndex, setStatementIndex] = useState(0);
  const [statementError, setStatementError] = useState<string | null>(null);
  const [statementSuccess, setStatementSuccess] = useState<string | null>(null);
  const [uploadingStatement, setUploadingStatement] = useState(false);
  const [finalizingStatement, setFinalizingStatement] = useState(false);

  const activeTab = [RECEIPT_TAB, STATEMENT_TAB].includes(searchParams.get("tab") || "") ? searchParams.get("tab") as string : MANUAL_TAB;

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    const preview = selectedReceipt?.preview;
    if (!isReceiptPreview(preview)) return;
    setReceiptDraft({
      merchant: preview.merchant ?? "",
      amount: preview.amount != null ? String(preview.amount) : "",
      currency: preview.currency ?? "EUR",
      expense_date: preview.expense_date ?? new Date().toISOString().slice(0, 10),
      description: preview.description ?? "",
      category_id: "",
      category_name: preview.category_name ?? "",
      notes: preview.notes ?? "",
      confidence: String(preview.confidence ?? 0.5),
    });
  }, [selectedReceipt]);

  const receiptPreview = useMemo(() => (isReceiptPreview(selectedReceipt?.preview) ? selectedReceipt.preview : null), [selectedReceipt]);
  const extractedItems = useMemo(() => receiptPreview?.items ?? [], [receiptPreview]);
  const statementEntries = useMemo(() => (selectedStatement?.preview && isStatementPreview(selectedStatement.preview) ? selectedStatement.preview.entries : []), [selectedStatement]);
  const currentStatementEntry = statementEntries[statementIndex] ?? null;

  useEffect(() => {
    if (!currentStatementEntry) return;
    setStatementDraft({
      merchant: currentStatementEntry.merchant ?? "",
      amount: currentStatementEntry.amount != null ? String(currentStatementEntry.amount) : "",
      currency: currentStatementEntry.currency ?? "EUR",
      expense_date: currentStatementEntry.expense_date ?? new Date().toISOString().slice(0, 10),
      description: currentStatementEntry.description ?? "",
      category_id: "",
      category_name: currentStatementEntry.category_name ?? "",
      notes: currentStatementEntry.notes ?? "",
      confidence: String(currentStatementEntry.confidence ?? 0.5),
    });
  }, [currentStatementEntry]);

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
    if (!selectedReceipt || receiptFinalizeInFlightRef.current) return;
    receiptFinalizeInFlightRef.current = true;
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
      receiptFinalizeInFlightRef.current = false;
      setFinalizingReceipt(false);
    }
  }

  async function handleStatementFinalize() {
    if (!selectedStatement || statementFinalizeInFlightRef.current) return;
    statementFinalizeInFlightRef.current = true;
    setFinalizingStatement(true);
    setStatementError(null);
    setStatementSuccess(null);
    try {
      const result = await createExpenseFromStatementEntry({
        receipt_id: selectedStatement.id,
        entry_index: statementIndex,
        merchant: statementDraft.merchant,
        description: statementDraft.description || null,
        amount: Number(statementDraft.amount),
        currency: statementDraft.currency,
        expense_date: statementDraft.expense_date,
        category_id: statementDraft.category_id || null,
        category_name: statementDraft.category_id ? null : statementDraft.category_name || null,
        notes: statementDraft.notes || null,
        confidence: Number(statementDraft.confidence),
      });
      setSelectedStatement(result.statement);
      const nextEntries = result.statement.preview && isStatementPreview(result.statement.preview) ? result.statement.preview.entries : [];
      const nextIndex = findNextPendingIndex(nextEntries);
      if (nextIndex === -1) {
        router.push(`/expenses?month=${result.expense.expense_date.slice(0, 7)}`);
        return;
      }
      setStatementIndex(nextIndex);
      setStatementSuccess(`Saved ${result.expense.merchant}. Continue reviewing the remaining statement entries.`);
    } catch (err) {
      setStatementError(err instanceof Error ? err.message : "Failed to save statement entry");
    } finally {
      statementFinalizeInFlightRef.current = false;
      setFinalizingStatement(false);
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
        <button type="button" onClick={() => setTab(STATEMENT_TAB)} className={`rounded-t-xl px-4 py-2 text-sm font-medium ${activeTab === STATEMENT_TAB ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Import statement PDF</button>
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
      ) : activeTab === RECEIPT_TAB ? (
        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-xl font-semibold">Upload receipt</h2>
              <p className="mt-1 text-sm text-muted-foreground">Images stay on the direct multimodal extraction path. PDFs use robust local PDF text extraction first, then structured review before anything is saved.</p>
              <label className="mt-4 flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm hover:bg-accent">
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleUpload} />
                {uploading ? "Uploading…" : "Choose a receipt image or PDF"}
              </label>
              {selectedReceipt ? (
                <div className="mt-4 rounded-xl border border-border bg-background p-3 text-sm">
                  <div className="font-medium">Current receipt</div>
                  <div className="mt-1 text-muted-foreground">{selectedReceipt.original_filename}</div>
                  <div className="mt-2 text-xs text-muted-foreground">Confidence: {Math.round((selectedReceipt.extraction_confidence ?? 0) * 100)}% · Status: {selectedReceipt.extraction_status}</div>
                </div>
              ) : null}
            </div>

            {receiptPreview?.notes ? (
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="text-sm font-medium">Extraction notes</div>
                <p className="mt-2 text-sm text-muted-foreground">{receiptPreview.notes}</p>
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

                {finalizingReceipt ? <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">Saving approved receipt… Please wait.</div> : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Merchant</span><input value={receiptDraft.merchant} onChange={(e) => setReceiptDraft({ ...receiptDraft, merchant: e.target.value })} disabled={finalizingReceipt} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Amount</span><input type="number" step="0.01" value={receiptDraft.amount} onChange={(e) => setReceiptDraft({ ...receiptDraft, amount: e.target.value })} disabled={finalizingReceipt} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Date</span><input type="date" value={receiptDraft.expense_date} onChange={(e) => setReceiptDraft({ ...receiptDraft, expense_date: e.target.value })} disabled={finalizingReceipt} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Currency</span><input value={receiptDraft.currency} onChange={(e) => setReceiptDraft({ ...receiptDraft, currency: e.target.value.toUpperCase() })} disabled={finalizingReceipt} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                </div>

                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Description</span><input value={receiptDraft.description} onChange={(e) => setReceiptDraft({ ...receiptDraft, description: e.target.value })} disabled={finalizingReceipt} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm">
                    <span className="mb-1 block text-muted-foreground">Category</span>
                    <select value={receiptDraft.category_id} onChange={(e) => setReceiptDraft({ ...receiptDraft, category_id: e.target.value })} disabled={finalizingReceipt} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60">
                      <option value="">Use custom or extracted category</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Custom category name</span><input value={receiptDraft.category_name} onChange={(e) => setReceiptDraft({ ...receiptDraft, category_name: e.target.value })} disabled={finalizingReceipt || !!receiptDraft.category_id} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                </div>
                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Confidence override</span><input type="number" min="0" max="1" step="0.01" value={receiptDraft.confidence} onChange={(e) => setReceiptDraft({ ...receiptDraft, confidence: e.target.value })} disabled={finalizingReceipt} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Notes</span><textarea rows={4} value={receiptDraft.notes} onChange={(e) => setReceiptDraft({ ...receiptDraft, notes: e.target.value })} disabled={finalizingReceipt} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>

                {selectedReceipt.ocr_text ? (
                  <div className="rounded-xl border border-border bg-background p-4">
                    <div className="mb-2 text-sm font-medium">Secondary text fallback preview</div>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{selectedReceipt.ocr_text}</pre>
                  </div>
                ) : null}

                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">Estimated amount: {receiptDraft.amount ? formatCurrency(Number(receiptDraft.amount), receiptDraft.currency) : "—"}</div>
                  <button type="button" onClick={handleReceiptFinalize} disabled={finalizingReceipt || !receiptDraft.merchant || !receiptDraft.amount || !receiptDraft.expense_date} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">{finalizingReceipt ? "Saving expense…" : "Approve and save expense"}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-xl font-semibold">Import bank statement PDF</h2>
              <p className="mt-1 text-sm text-muted-foreground">Upload a statement PDF, extract multiple candidate expenses, then review and approve them one-by-one before save. Grocery item lines stay empty for statement imports.</p>
              <label className="mt-4 flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm hover:bg-accent">
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setUploadingStatement(true);
                    setStatementError(null);
                    setStatementSuccess(null);
                    try {
                      const receipt = await uploadStatement(file);
                      setSelectedStatement(receipt);
                      const entries = receipt.preview && isStatementPreview(receipt.preview) ? receipt.preview.entries : [];
                      const nextIndex = Math.max(findNextPendingIndex(entries), 0);
                      setStatementIndex(nextIndex);
                      setStatementSuccess(`Imported ${entries.length} candidate expenses from ${receipt.original_filename}. Review each one before saving.`);
                      setTab(STATEMENT_TAB);
                    } catch (err) {
                      setStatementError(err instanceof Error ? err.message : "Statement upload failed");
                    } finally {
                      setUploadingStatement(false);
                      event.target.value = "";
                    }
                  }}
                />
                {uploadingStatement ? "Uploading…" : "Choose a bank statement PDF"}
              </label>
              {selectedStatement ? (
                <div className="mt-4 rounded-xl border border-border bg-background p-3 text-sm">
                  <div className="font-medium">Current statement import</div>
                  <div className="mt-1 text-muted-foreground">{selectedStatement.original_filename}</div>
                  <div className="mt-2 text-xs text-muted-foreground">{statementEntries.length} candidates · Confidence {Math.round((selectedStatement.extraction_confidence ?? 0) * 100)}%</div>
                </div>
              ) : null}
            </div>

            {statementEntries.length > 0 ? (
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-medium">Review queue</div>
                  <div className="text-xs text-muted-foreground">{statementEntries.filter((entry) => entry.status === "pending").length} pending</div>
                </div>
                <div className="space-y-2">
                  {statementEntries.map((entry, index) => (
                    <button
                      key={`${entry.merchant ?? "entry"}-${index}`}
                      type="button"
                      onClick={() => setStatementIndex(index)}
                      disabled={finalizingStatement}
                      className={`w-full rounded-xl border px-3 py-3 text-left text-sm ${index === statementIndex ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-accent"} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">{entry.merchant || `Entry ${index + 1}`}</div>
                        <span className={`rounded-full px-2 py-1 text-[11px] ${entry.status === "finalized" ? "bg-green-500/15 text-green-400" : "bg-yellow-500/15 text-yellow-400"}`}>{entry.status === "finalized" ? "Saved" : "Pending"}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{entry.expense_date || "Unknown date"} · {entry.amount != null ? formatCurrency(entry.amount, entry.currency) : "Unknown amount"}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            {statementError ? <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{statementError}</div> : null}
            {statementSuccess ? <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">{statementSuccess}</div> : null}
            {!selectedStatement || !currentStatementEntry ? <div className="py-20 text-center text-muted-foreground">Upload a statement PDF to start the multi-expense review queue.</div> : (
              <div className="space-y-5">
                <div className="flex flex-col gap-2 border-b border-border pb-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-xl font-semibold">Review statement entry {statementIndex + 1} of {statementEntries.length}</h2>
                    <p className="text-sm text-muted-foreground">Each approved entry becomes one expense. Item-level fields are intentionally left empty for statement imports.</p>
                  </div>
                  <div className="rounded-full bg-secondary px-3 py-1 text-sm">{selectedStatement.original_filename}</div>
                </div>

                {selectedStatement.preview && isStatementPreview(selectedStatement.preview) ? (
                  <div className="rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">{selectedStatement.preview.summary || selectedStatement.preview.notes}</div>
                ) : null}

                {finalizingStatement ? <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">Saving approved statement entry… Please wait.</div> : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Merchant</span><input value={statementDraft.merchant} onChange={(e) => setStatementDraft({ ...statementDraft, merchant: e.target.value })} disabled={finalizingStatement} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Amount</span><input type="number" step="0.01" value={statementDraft.amount} onChange={(e) => setStatementDraft({ ...statementDraft, amount: e.target.value })} disabled={finalizingStatement} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Date</span><input type="date" value={statementDraft.expense_date} onChange={(e) => setStatementDraft({ ...statementDraft, expense_date: e.target.value })} disabled={finalizingStatement} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Currency</span><input value={statementDraft.currency} onChange={(e) => setStatementDraft({ ...statementDraft, currency: e.target.value.toUpperCase() })} disabled={finalizingStatement} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                </div>

                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Description</span><input value={statementDraft.description} onChange={(e) => setStatementDraft({ ...statementDraft, description: e.target.value })} disabled={finalizingStatement} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-sm">
                    <span className="mb-1 block text-muted-foreground">Category</span>
                    <select value={statementDraft.category_id} onChange={(e) => setStatementDraft({ ...statementDraft, category_id: e.target.value })} disabled={finalizingStatement} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60">
                      <option value="">Use custom or extracted category</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">Custom category name</span><input value={statementDraft.category_name} onChange={(e) => setStatementDraft({ ...statementDraft, category_name: e.target.value })} disabled={finalizingStatement || !!statementDraft.category_id} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                </div>
                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Confidence override</span><input type="number" min="0" max="1" step="0.01" value={statementDraft.confidence} onChange={(e) => setStatementDraft({ ...statementDraft, confidence: e.target.value })} disabled={finalizingStatement} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>
                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Notes</span><textarea rows={4} value={statementDraft.notes} onChange={(e) => setStatementDraft({ ...statementDraft, notes: e.target.value })} disabled={finalizingStatement} className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" /></label>

                {selectedStatement.ocr_text ? (
                  <div className="rounded-xl border border-border bg-background p-4">
                    <div className="mb-2 text-sm font-medium">Extracted statement text</div>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{selectedStatement.ocr_text}</pre>
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-muted-foreground">Pending after this: {Math.max(statementEntries.filter((entry) => entry.status !== "finalized").length - (currentStatementEntry.status === "finalized" ? 0 : 1), 0)}</div>
                  <button
                    type="button"
                    onClick={handleStatementFinalize}
                    disabled={finalizingStatement || !statementDraft.merchant || !statementDraft.amount || !statementDraft.expense_date || currentStatementEntry.status === "finalized"}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {finalizingStatement ? "Saving entry…" : currentStatementEntry.status === "finalized" ? "Already saved" : "Approve and save entry"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
