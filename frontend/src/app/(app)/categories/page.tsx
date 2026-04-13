"use client";

import { useEffect, useState } from "react";
import { createCategory, createMerchantRule, deleteCategory, deleteMerchantRule, listCategories, listMerchantRules, type Category, type MerchantRule } from "@/lib/api";

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<MerchantRule[]>([]);
  const [categoryForm, setCategoryForm] = useState({ name: "", color: "#60a5fa", description: "" });
  const [ruleForm, setRuleForm] = useState({ merchant_pattern: "", category_id: "", pattern_type: "contains", priority: "100" });

  async function load() {
    const [categoryData, ruleData] = await Promise.all([listCategories(), listMerchantRules()]);
    setCategories(categoryData);
    setRules(ruleData);
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Categories & rules</h1>
        <p className="text-sm text-muted-foreground">Create custom categories and define merchant matching rules for automatic categorisation.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <form onSubmit={async (event) => {
          event.preventDefault();
          await createCategory({ name: categoryForm.name, color: categoryForm.color, description: categoryForm.description || null });
          setCategoryForm({ name: "", color: "#60a5fa", description: "" });
          await load();
        }} className="space-y-4 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-xl font-semibold">Categories</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Name</span><input required value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Color</span><input type="color" value={categoryForm.color} onChange={(e) => setCategoryForm({ ...categoryForm, color: e.target.value })} className="h-11 w-full rounded-lg border border-border bg-background px-2 py-2" /></label>
          </div>
          <label className="text-sm"><span className="mb-1 block text-muted-foreground">Description</span><input value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Add category</button>
          <div className="space-y-2 border-t border-border pt-4">
            {categories.map((category) => (
              <div key={category.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <div className="flex items-center gap-3"><span className="h-4 w-4 rounded-full" style={{ backgroundColor: category.color }} /><div><div className="font-medium">{category.name}</div><div className="text-xs text-muted-foreground">{category.description || (category.is_system ? "Default category" : "Custom category")}</div></div></div>
                <button onClick={() => deleteCategory(category.id).then(load)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">Delete</button>
              </div>
            ))}
          </div>
        </form>

        <form onSubmit={async (event) => {
          event.preventDefault();
          await createMerchantRule({ merchant_pattern: ruleForm.merchant_pattern, category_id: ruleForm.category_id || null, pattern_type: ruleForm.pattern_type, priority: Number(ruleForm.priority), is_active: true });
          setRuleForm({ merchant_pattern: "", category_id: "", pattern_type: "contains", priority: "100" });
          await load();
        }} className="space-y-4 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-xl font-semibold">Merchant rules</h2>
          <label className="text-sm"><span className="mb-1 block text-muted-foreground">Match text or regex</span><input required value={ruleForm.merchant_pattern} onChange={(e) => setRuleForm({ ...ruleForm, merchant_pattern: e.target.value })} placeholder="e.g. spotify" className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Category</span><select value={ruleForm.category_id} onChange={(e) => setRuleForm({ ...ruleForm, category_id: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2"><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Type</span><select value={ruleForm.pattern_type} onChange={(e) => setRuleForm({ ...ruleForm, pattern_type: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2"><option value="contains">Contains</option><option value="regex">Regex</option></select></label>
            <label className="text-sm"><span className="mb-1 block text-muted-foreground">Priority</span><input type="number" value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
          </div>
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Add rule</button>
          <div className="space-y-2 border-t border-border pt-4">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <div>
                  <div className="font-medium">{rule.merchant_pattern}</div>
                  <div className="text-xs text-muted-foreground">{rule.pattern_type} → {rule.category_name ?? "Uncategorized"} · priority {rule.priority}</div>
                </div>
                <button onClick={() => deleteMerchantRule(rule.id).then(load)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">Delete</button>
              </div>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
