"use client";

import { useEffect, useMemo, useState } from "react";
import { createCategory, createItemKeywordRule, createMerchantRule, deleteCategory, deleteItemKeywordRule, deleteMerchantRule, getCurrentUserProfile, listCategories, listItemKeywordRules, listMerchantRules, updateReceiptPrompt, type Category, type ItemKeywordRule, type MerchantRule } from "@/lib/api";

const DEFAULT_RECEIPT_SYSTEM_PROMPT = "You extract receipt fields from images into validated JSON for a transaction draft. The JSON may represent either a debit expense or a credit refund, but default to debit when unsure. Receipt text can be in Italian. Merchant should be the store name, not a random footer or tax line. Never return prose, markdown, or code fences. Return JSON only.";

export default function RulesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [merchantRules, setMerchantRules] = useState<MerchantRule[]>([]);
  const [itemRules, setItemRules] = useState<ItemKeywordRule[]>([]);
  const [categoryForm, setCategoryForm] = useState({ name: "", color: "#34d399", description: "", transaction_type: "debit" });
  const [merchantForm, setMerchantForm] = useState({ merchant_pattern: "", category_id: "", pattern_type: "fuzzy", priority: "100" });
  const [itemForm, setItemForm] = useState({ keyword: "", subcategory_label: "", pattern_type: "fuzzy", priority: "100" });
  const [receiptPrompt, setReceiptPrompt] = useState(DEFAULT_RECEIPT_SYSTEM_PROMPT);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);

  const displayedPrompt = useMemo(() => receiptPrompt || DEFAULT_RECEIPT_SYSTEM_PROMPT, [receiptPrompt]);
  const visibleCategories = categoriesExpanded ? categories : categories.slice(0, 2);

  async function load() {
    const [categoryData, merchantRuleData, itemRuleData, profile] = await Promise.all([
      listCategories(),
      listMerchantRules(),
      listItemKeywordRules(),
      getCurrentUserProfile(),
    ]);
    setCategories(categoryData);
    setMerchantRules(merchantRuleData);
    setItemRules(itemRuleData);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Rules</h1>
        <p className="text-sm text-muted-foreground">Manage categories, merchant and item matching rules, and your per-user receipt system prompt.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <form onSubmit={async (event) => {
          event.preventDefault();
          await createCategory({ name: categoryForm.name, color: categoryForm.color, description: categoryForm.description || null, transaction_type: categoryForm.transaction_type });
          setCategoryForm({ name: "", color: "#34d399", description: "", transaction_type: "debit" });
          await load();
        }} className="flex h-full flex-col space-y-4 rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Categories</h2>
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
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Add category</button>
          <div className="space-y-2 border-t border-border pt-4">
            {visibleCategories.map((category) => (
              <div key={category.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <div className="flex items-center gap-3"><span className="h-4 w-4 rounded-full" style={{ backgroundColor: category.color }} /><div><div className="font-medium">{category.name}</div><div className="text-xs text-muted-foreground">{category.description || (category.is_system ? "Default category" : "Custom category")} · {category.transaction_type === "credit" ? "Money in" : "Money out"}</div></div></div>
                <button type="button" onClick={() => deleteCategory(category.id).then(load)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">Delete</button>
              </div>
            ))}
          </div>
        </form>

        <form onSubmit={async (event) => {
          event.preventDefault();
          await createMerchantRule({ merchant_pattern: merchantForm.merchant_pattern, category_id: merchantForm.category_id || null, pattern_type: merchantForm.pattern_type, priority: Number(merchantForm.priority), is_active: true });
          setMerchantForm({ merchant_pattern: "", category_id: "", pattern_type: "fuzzy", priority: "100" });
          await load();
        }} className="flex h-full flex-col space-y-4 rounded-2xl border border-border bg-card p-6">
          <div>
            <h2 className="text-xl font-semibold">Merchant rules</h2>
            <p className="mt-1 text-sm text-muted-foreground">Examples: Esselunga → Groceries, MD → Groceries, Tina & Reema → Shopping.</p>
          </div>
          <label className="text-sm"><span className="mb-1 block text-muted-foreground">Merchant text</span><input required value={merchantForm.merchant_pattern} onChange={(e) => setMerchantForm({ ...merchantForm, merchant_pattern: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" placeholder="e.g. esselunga" /></label>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Category</span><select value={merchantForm.category_id} onChange={(e) => setMerchantForm({ ...merchantForm, category_id: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2"><option value="">Choose category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Matching</span><select value={merchantForm.pattern_type} onChange={(e) => setMerchantForm({ ...merchantForm, pattern_type: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2"><option value="fuzzy">Smart fuzzy</option><option value="contains">Contains</option><option value="regex">Regex</option></select></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Priority</span><input type="number" value={merchantForm.priority} onChange={(e) => setMerchantForm({ ...merchantForm, priority: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          </div>
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Save merchant rule</button>
          <div className="space-y-2 border-t border-border pt-4">
            {merchantRules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <div>
                  <div className="font-medium">{rule.merchant_pattern}</div>
                  <div className="text-xs text-muted-foreground">{rule.pattern_type} → {rule.category_name ?? "Uncategorized"} · priority {rule.priority}</div>
                </div>
                <button type="button" onClick={() => deleteMerchantRule(rule.id).then(load)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">Delete</button>
              </div>
            ))}
          </div>
        </form>

        <form onSubmit={async (event) => {
          event.preventDefault();
          await createItemKeywordRule({ keyword: itemForm.keyword, subcategory_label: itemForm.subcategory_label, pattern_type: itemForm.pattern_type, priority: Number(itemForm.priority), is_active: true });
          setItemForm({ keyword: "", subcategory_label: "", pattern_type: "fuzzy", priority: "100" });
          await load();
        }} className="flex h-full flex-col space-y-4 rounded-2xl border border-border bg-card p-6">
          <div>
            <h2 className="text-xl font-semibold">Item rules</h2>
            <p className="mt-1 text-sm text-muted-foreground">Examples: pomodoro → Vegetables, pomodori → Vegetables, cien → Personal Care.</p>
          </div>
          <label className="text-sm"><span className="mb-1 block text-muted-foreground">Item keyword</span><input required value={itemForm.keyword} onChange={(e) => setItemForm({ ...itemForm, keyword: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" placeholder="e.g. pomodori" /></label>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Subcategory</span><input required value={itemForm.subcategory_label} onChange={(e) => setItemForm({ ...itemForm, subcategory_label: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" placeholder="e.g. Vegetables" /></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Matching</span><select value={itemForm.pattern_type} onChange={(e) => setItemForm({ ...itemForm, pattern_type: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2"><option value="fuzzy">Smart fuzzy</option><option value="contains">Contains</option><option value="regex">Regex</option></select></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Priority</span><input type="number" value={itemForm.priority} onChange={(e) => setItemForm({ ...itemForm, priority: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          </div>
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Save item rule</button>
          <div className="space-y-2 border-t border-border pt-4">
            {itemRules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <div>
                  <div className="font-medium">{rule.keyword}</div>
                  <div className="text-xs text-muted-foreground">{rule.pattern_type} → {rule.subcategory_label} · priority {rule.priority}</div>
                </div>
                <button type="button" onClick={() => deleteItemKeywordRule(rule.id).then(load)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">Delete</button>
              </div>
            ))}
          </div>
        </form>

        <div className="flex h-full flex-col space-y-4 rounded-2xl border border-border bg-card p-6">
          <div>
            <h2 className="text-xl font-semibold">Receipt system prompt</h2>
            <p className="mt-1 text-sm text-muted-foreground">This prompt is stored per user and used only for your receipt extraction. The default prompt already includes the Italian receipt guidance and local-model instructions.</p>
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
    </div>
  );
}
