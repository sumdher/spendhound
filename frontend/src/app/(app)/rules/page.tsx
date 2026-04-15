"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createCategory, createItemKeywordRule, createMerchantRule, deleteCategory, deleteItemKeywordRule, deleteKnowledgeBaseEntry, deleteMerchantRule, getCurrentUserProfile, listCategories, listItemKeywordRules, listKnowledgeBase, listMerchantRules, updateReceiptPrompt, uploadKnowledgeBase, type Category, type ItemKeywordRule, type KnowledgeBaseEntry, type MerchantRule } from "@/lib/api";

const DEFAULT_RECEIPT_SYSTEM_PROMPT = "You extract receipt fields from images into validated JSON for a transaction draft. The JSON may represent either a debit expense or a credit refund, but default to debit when unsure. Receipt text can be in Italian. Merchant should be the store name, not a random footer or tax line. Never return prose, markdown, or code fences. Return JSON only.";

const PATTERN_TYPE_OPTIONS = [
  { value: "fuzzy", label: "Smart fuzzy" },
  { value: "contains", label: "Contains" },
  { value: "starts_with", label: "Starts with (prefix)" },
  { value: "abbrev", label: "Abbreviation (subsequence)" },
  { value: "regex", label: "Regex" },
];

const PATTERN_TYPE_HINTS: Record<string, string> = {
  fuzzy: "Tolerates minor spelling differences. Good for full or partial words.",
  contains: "Keyword must appear as-is inside the item description.",
  starts_with: "Any word in the description starts with your keyword. E.g. 'diges' → DIGES. MCVITIE'S, DIGESTIVI",
  abbrev: "Your keyword's characters appear in order inside any word. E.g. 'mcvt' → MCVITIE",
  regex: "Full regular expression matched against the description (case-insensitive).",
};

export default function RulesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [merchantRules, setMerchantRules] = useState<MerchantRule[]>([]);
  const [itemRules, setItemRules] = useState<ItemKeywordRule[]>([]);
  const [kbEntries, setKbEntries] = useState<KnowledgeBaseEntry[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: "", color: "#34d399", description: "", transaction_type: "debit", is_system: false });
  const [merchantForm, setMerchantForm] = useState({ merchant_pattern: "", category_id: "", pattern_type: "fuzzy", priority: "100", is_global: false });
  const [itemForm, setItemForm] = useState({ keyword: "", subcategory_label: "", pattern_type: "fuzzy", priority: "100", is_global: false });
  const [receiptPrompt, setReceiptPrompt] = useState(DEFAULT_RECEIPT_SYSTEM_PROMPT);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const [kbFile, setKbFile] = useState<File | null>(null);
  const [kbIsGlobal, setKbIsGlobal] = useState(false);
  const [kbUploading, setKbUploading] = useState(false);
  const [kbResult, setKbResult] = useState<{ total_parsed: number; inserted: number } | null>(null);
  const [kbError, setKbError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const displayedPrompt = useMemo(() => receiptPrompt || DEFAULT_RECEIPT_SYSTEM_PROMPT, [receiptPrompt]);
  const visibleCategories = categoriesExpanded ? categories : categories.slice(0, 2);

  async function load() {
    const [categoryData, merchantRuleData, itemRuleData, profile, kbData] = await Promise.all([
      listCategories(),
      listMerchantRules(),
      listItemKeywordRules(),
      getCurrentUserProfile(),
      listKnowledgeBase(),
    ]);
    setCategories(categoryData);
    setMerchantRules(merchantRuleData);
    setItemRules(itemRuleData);
    setKbEntries(kbData);
    setIsAdmin(profile.is_admin ?? false);
    setReceiptPrompt(profile.receipt_prompt_override || DEFAULT_RECEIPT_SYSTEM_PROMPT);
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function handlePromptSave(nextPrompt: string | null) {
    setPromptSaving(true);
    setPromptError(null);
    setPromptSaved(false);
    try {
      const profile = await updateReceiptPrompt({ receipt_prompt_override: nextPrompt });
      setReceiptPrompt(profile.receipt_prompt_override || DEFAULT_RECEIPT_SYSTEM_PROMPT);
      setEditingPrompt(false);
      setPromptSaved(true);
      setTimeout(() => setPromptSaved(false), 2000);
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : "Failed to update receipt prompt.");
    } finally {
      setPromptSaving(false);
    }
  }

  async function handleKbUpload() {
    if (!kbFile) return;
    setKbUploading(true);
    setKbError(null);
    setKbResult(null);
    try {
      const result = await uploadKnowledgeBase(kbFile, kbIsGlobal);
      setKbResult(result);
      setKbFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } catch (err) {
      setKbError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setKbUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Rules</h1>
        <p className="text-sm text-muted-foreground">Manage categories, merchant and item matching rules, knowledge base, and your receipt system prompt.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Categories */}
        <form onSubmit={async (event) => {
          event.preventDefault();
          await createCategory({ name: categoryForm.name, color: categoryForm.color, description: categoryForm.description || null, transaction_type: categoryForm.transaction_type, is_system: categoryForm.is_system });
          setCategoryForm({ name: "", color: "#34d399", description: "", transaction_type: "debit", is_system: false });
          await load();
        }} className="flex h-full flex-col space-y-4 rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Categories</h2>
              {isAdmin ? <p className="mt-0.5 text-xs text-muted-foreground">As admin you can mark categories as global defaults (visible to all users).</p> : null}
            </div>
            {categories.length > 2 ? (
              <button type="button" onClick={() => setCategoriesExpanded((current) => !current)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">
                {categoriesExpanded ? "Collapse" : `Show all (${categories.length})`}
              </button>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Name</span><input required value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Color</span><input type="color" value={categoryForm.color} onChange={(e) => setCategoryForm({ ...categoryForm, color: e.target.value })} className="h-11 w-full rounded-lg border border-border bg-background px-2 py-2" /></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Type</span><select value={categoryForm.transaction_type} onChange={(e) => setCategoryForm({ ...categoryForm, transaction_type: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2"><option value="debit">Money out</option><option value="credit">Money in</option></select></label>
          </div>
          <label className="text-sm"><span className="mb-1 block text-muted-foreground">Description</span><input value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          {isAdmin ? (
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" checked={categoryForm.is_system} onChange={(e) => setCategoryForm({ ...categoryForm, is_system: e.target.checked })} className="h-4 w-4 rounded" />
              <span>Mark as global <span className="text-muted-foreground">(system default — visible to all users)</span></span>
            </label>
          ) : null}
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Add category</button>
          <div className="space-y-2 border-t border-border pt-4">
            {visibleCategories.map((category) => (
              <div key={category.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <div className="flex items-center gap-3"><span className="h-4 w-4 rounded-full" style={{ backgroundColor: category.color }} /><div><div className="flex items-center gap-2 font-medium">{category.name}{category.is_system ? <span className="rounded bg-primary/20 px-1.5 py-0.5 text-xs text-primary">global</span> : null}</div><div className="text-xs text-muted-foreground">{category.description || (category.is_system ? "System default" : "Custom")} · {category.transaction_type === "credit" ? "Money in" : "Money out"}</div></div></div>
                <button type="button" onClick={() => deleteCategory(category.id).then(load)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">Delete</button>
              </div>
            ))}
          </div>
        </form>

        {/* Merchant rules */}
        <form onSubmit={async (event) => {
          event.preventDefault();
          await createMerchantRule({ merchant_pattern: merchantForm.merchant_pattern, category_id: merchantForm.category_id || null, pattern_type: merchantForm.pattern_type, priority: Number(merchantForm.priority), is_active: true, is_global: merchantForm.is_global });
          setMerchantForm({ merchant_pattern: "", category_id: "", pattern_type: "fuzzy", priority: "100", is_global: false });
          await load();
        }} className="flex h-full flex-col space-y-4 rounded-2xl border border-border bg-card p-6">
          <div>
            <h2 className="text-xl font-semibold">Merchant rules</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Examples: Esselunga → Groceries, MD → Groceries.
              {isAdmin ? " As admin you can make rules global (applied for all users)." : " Your rules apply only to your receipts."}
            </p>
          </div>
          <label className="text-sm"><span className="mb-1 block text-muted-foreground">Merchant text</span><input required value={merchantForm.merchant_pattern} onChange={(e) => setMerchantForm({ ...merchantForm, merchant_pattern: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" placeholder="e.g. esselunga" /></label>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Category</span><select value={merchantForm.category_id} onChange={(e) => setMerchantForm({ ...merchantForm, category_id: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2"><option value="">Choose category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Matching</span><select value={merchantForm.pattern_type} onChange={(e) => setMerchantForm({ ...merchantForm, pattern_type: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2"><option value="fuzzy">Smart fuzzy</option><option value="contains">Contains</option><option value="regex">Regex</option></select></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Priority</span><input type="number" value={merchantForm.priority} onChange={(e) => setMerchantForm({ ...merchantForm, priority: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          </div>
          {isAdmin ? (
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" checked={merchantForm.is_global} onChange={(e) => setMerchantForm({ ...merchantForm, is_global: e.target.checked })} className="h-4 w-4 rounded" />
              <span>Make global <span className="text-muted-foreground">(applied for all users)</span></span>
            </label>
          ) : null}
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Save merchant rule</button>
          <div className="space-y-2 border-t border-border pt-4">
            {merchantRules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    {rule.merchant_pattern}
                    {rule.is_global ? <span className="rounded bg-primary/20 px-1.5 py-0.5 text-xs text-primary">global</span> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">{rule.pattern_type} → {rule.category_name ?? "Uncategorized"} · priority {rule.priority}</div>
                </div>
                <button type="button" onClick={() => deleteMerchantRule(rule.id).then(load)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">Delete</button>
              </div>
            ))}
          </div>
        </form>

        {/* Item rules */}
        <form onSubmit={async (event) => {
          event.preventDefault();
          await createItemKeywordRule({ keyword: itemForm.keyword, subcategory_label: itemForm.subcategory_label, pattern_type: itemForm.pattern_type, priority: Number(itemForm.priority), is_active: true, is_global: itemForm.is_global });
          setItemForm({ keyword: "", subcategory_label: "", pattern_type: "fuzzy", priority: "100", is_global: false });
          await load();
        }} className="flex h-full flex-col space-y-4 rounded-2xl border border-border bg-card p-6">
          <div>
            <h2 className="text-xl font-semibold">Item rules</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Match receipt line items to grocery subcategories.
              {isAdmin ? " As admin you can make rules global (visible to all users)." : " Your rules apply only to your receipts."}
            </p>
          </div>
          <label className="text-sm"><span className="mb-1 block text-muted-foreground">Item keyword</span><input required value={itemForm.keyword} onChange={(e) => setItemForm({ ...itemForm, keyword: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" placeholder="e.g. mcvitie, diges, pomodori" /></label>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Subcategory</span><input required value={itemForm.subcategory_label} onChange={(e) => setItemForm({ ...itemForm, subcategory_label: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" placeholder="e.g. Snacks" /></label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Matching</span>
              <select value={itemForm.pattern_type} onChange={(e) => setItemForm({ ...itemForm, pattern_type: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                {PATTERN_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Priority</span><input type="number" value={itemForm.priority} onChange={(e) => setItemForm({ ...itemForm, priority: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          </div>
          {itemForm.pattern_type && PATTERN_TYPE_HINTS[itemForm.pattern_type] ? (
            <p className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">{PATTERN_TYPE_HINTS[itemForm.pattern_type]}</p>
          ) : null}
          {isAdmin ? (
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" checked={itemForm.is_global} onChange={(e) => setItemForm({ ...itemForm, is_global: e.target.checked })} className="h-4 w-4 rounded" />
              <span>Make global <span className="text-muted-foreground">(visible to all users)</span></span>
            </label>
          ) : null}
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Save item rule</button>
          <div className="space-y-2 border-t border-border pt-4">
            {itemRules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    {rule.keyword}
                    {rule.is_global ? <span className="rounded bg-primary/20 px-1.5 py-0.5 text-xs text-primary">global</span> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">{rule.pattern_type} → {rule.subcategory_label} · priority {rule.priority}</div>
                </div>
                {/* Only owner (matched via backend) can delete — backend enforces user_id */}
                <button type="button" onClick={() => deleteItemKeywordRule(rule.id).then(load)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">Delete</button>
              </div>
            ))}
          </div>
        </form>

        {/* Receipt system prompt */}
        <div className="flex h-full flex-col space-y-4 rounded-2xl border border-border bg-card p-6">
          <div>
            <h2 className="text-xl font-semibold">Receipt system prompt</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isAdmin
                ? "Your prompt is the global default — it applies to all users who have not set their own override."
                : "Override the default prompt used for your receipt extraction. Leave it at default to inherit the system prompt."}
            </p>
          </div>
          {promptError ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{promptError}</div> : null}
          {promptSaved ? <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">Receipt prompt updated.</div> : null}
          {editingPrompt ? (
            <textarea value={receiptPrompt} onChange={(e) => setReceiptPrompt(e.target.value)} rows={10} className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm" />
          ) : (
            <div className="whitespace-pre-wrap rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">{displayedPrompt}</div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {editingPrompt ? (
              <>
                <button type="button" onClick={() => { setReceiptPrompt(displayedPrompt); setEditingPrompt(false); setPromptError(null); }} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
                <button type="button" onClick={() => void handlePromptSave(null)} disabled={promptSaving} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-60">Reset to default</button>
                <button type="button" onClick={() => void handlePromptSave(receiptPrompt)} disabled={promptSaving} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">{promptSaving ? "Saving…" : "Save prompt"}</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => void handlePromptSave(null)} disabled={promptSaving} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-60">Reset to default</button>
                <button type="button" onClick={() => setEditingPrompt(true)} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Edit</button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Knowledge base — full width */}
      <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Knowledge base <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-sm font-normal text-muted-foreground">RAG</span></h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a CSV file with <code className="rounded bg-muted px-1 py-0.5 text-xs">item description,Subcategory</code> per line.
            Entries are embedded and used to classify receipt items semantically — so even novel abbreviations are caught.
            {isAdmin ? " Admin uploads can be set as global (helps all users)." : " Your uploads are private to your account."}
          </p>
        </div>

        {kbError ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{kbError}</div> : null}
        {kbResult ? (
          <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
            Uploaded: {kbResult.inserted} new entries added ({kbResult.total_parsed} parsed).
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm flex-1 min-w-48">
            <span className="mb-1 block text-muted-foreground">CSV file</span>
            <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" onChange={(e) => setKbFile(e.target.files?.[0] ?? null)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-xs" />
          </label>
          {isAdmin ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={kbIsGlobal} onChange={(e) => setKbIsGlobal(e.target.checked)} className="h-4 w-4 rounded" />
              Global
            </label>
          ) : null}
          <button
            type="button"
            disabled={!kbFile || kbUploading}
            onClick={() => void handleKbUpload()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {kbUploading ? "Uploading…" : "Upload"}
          </button>
        </div>

        {kbEntries.length > 0 ? (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">{kbEntries.length} entries in knowledge base</p>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {kbEntries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-2 text-sm">
                  <div>
                    <span className="font-medium">{entry.description_text}</span>
                    <span className="ml-2 text-muted-foreground">→ {entry.subcategory_label}</span>
                    {entry.is_global ? <span className="ml-2 rounded bg-primary/20 px-1.5 py-0.5 text-xs text-primary">global</span> : null}
                    <span className="ml-2 text-xs text-muted-foreground">{entry.source}</span>
                  </div>
                  {(isAdmin || !entry.is_global) ? (
                    <button type="button" onClick={() => deleteKnowledgeBaseEntry(entry.id).then(load)} className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-accent">Delete</button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">No knowledge-base entries yet. Upload a CSV to get started.</div>
        )}
      </div>
    </div>
  );
}
