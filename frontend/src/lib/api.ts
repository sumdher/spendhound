import { getSession } from "next-auth/react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/backend";
const LLM_CONFIG_KEY = "spendhound_llm_config";

export interface LLMConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
  description?: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface MerchantRule {
  id: string;
  category_id?: string | null;
  category_name?: string | null;
  merchant_pattern: string;
  pattern_type: string;
  priority: number;
  is_active: boolean;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Budget {
  id: string;
  name: string;
  category_id?: string | null;
  category_name?: string | null;
  amount: number;
  currency: string;
  period: string;
  month_start: string;
  notes?: string | null;
  actual: number;
  remaining: number;
  created_at: string;
  updated_at: string;
}

export interface Receipt {
  id: string;
  original_filename: string;
  stored_filename: string;
  content_type?: string | null;
  file_size?: number | null;
  ocr_text?: string | null;
  preview?: ReceiptPreview | StatementImportPreview | null;
  extraction_confidence?: number | null;
  document_kind: string;
  extraction_status: string;
  needs_review: boolean;
  review_notes?: string | null;
  created_at: string;
  updated_at: string;
  finalized_at?: string | null;
}

export interface ReceiptPreviewItem {
  id?: string;
  description?: string;
  quantity?: number | null;
  unit_price?: number | null;
  total?: number | null;
  subcategory?: string | null;
  subcategory_confidence?: number | null;
}

export interface ReceiptPreview {
  merchant?: string;
  amount?: number | null;
  currency?: string;
  expense_date?: string | null;
  description?: string | null;
  category_name?: string | null;
  notes?: string | null;
  items?: ReceiptPreviewItem[];
  confidence?: number;
}

export interface StatementImportEntry {
  merchant?: string;
  amount?: number | null;
  currency?: string;
  expense_date?: string | null;
  description?: string | null;
  category_name?: string | null;
  notes?: string | null;
  confidence?: number;
  status?: "pending" | "finalized";
  saved_expense_id?: string | null;
}

export interface StatementImportPreview {
  summary?: string | null;
  notes?: string | null;
  confidence?: number | null;
  entries: StatementImportEntry[];
}

export interface ExpenseItem {
  id: string;
  description: string;
  quantity?: number | null;
  unit_price?: number | null;
  total?: number | null;
  subcategory?: string | null;
  subcategory_confidence?: number | null;
}

export interface Expense {
  id: string;
  merchant: string;
  description?: string | null;
  amount: number;
  currency: string;
  expense_date: string;
  source: string;
  confidence: number;
  needs_review: boolean;
  notes?: string | null;
  is_recurring: boolean;
  recurring_group?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  receipt_id?: string | null;
  receipt_filename?: string | null;
  receipt_document_kind?: string | null;
  receipt_preview?: ReceiptPreview | StatementImportPreview | null;
  receipt_ocr_text?: string | null;
  items?: ExpenseItem[];
  created_at: string;
  updated_at: string;
}

export interface ExpenseListResponse {
  items: Expense[];
  total: number;
}

export interface ReviewQueue {
  receipts: Array<{
    id: string;
    original_filename: string;
    preview?: ReceiptPreview | StatementImportPreview | null;
    document_kind?: string;
    needs_review: boolean;
    extraction_status: string;
    created_at: string;
  }>;
  expenses: Expense[];
}

export interface DashboardAnalytics {
  month: string;
  summary: {
    total_spend: number;
    transaction_count: number;
    average_transaction: number;
    review_count: number;
  };
  spend_by_category: { name: string; amount: number }[];
  top_merchants: { merchant: string; amount: number }[];
  monthly_trend: { month: string; amount: number }[];
  recurring_expenses: Array<{
    id: string;
    merchant: string;
    amount: number;
    currency: string;
    expense_date: string;
    category_name: string;
  }>;
  budgets: Budget[];
  grocery_insights: {
    item_count: number;
    total_itemized_spend: number;
    summary: string;
    top_subcategories: Array<{ name: string; amount: number; item_count: number }>;
    least_subcategories: Array<{ name: string; amount: number; item_count: number }>;
    uncategorized_count: number;
  };
}

export interface StatementFinalizeResponse {
  expense: Expense;
  statement: Receipt;
}

export interface AdminUser {
  id: string;
  email: string;
  name?: string | null;
  avatar_url?: string | null;
  status: string;
  expense_count: number;
  created_at: string;
}

let sessionPromise: ReturnType<typeof getSession> | null = null;
let sessionTimestamp = 0;
const SESSION_CACHE_MS = 5_000;

export function getLLMConfig(): LLMConfig {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LLM_CONFIG_KEY);
    return raw ? (JSON.parse(raw) as LLMConfig) : {};
  } catch {
    return {};
  }
}

export function saveLLMConfig(config: LLMConfig) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(config));
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const now = Date.now();
  if (!sessionPromise || now - sessionTimestamp > SESSION_CACHE_MS) {
    sessionPromise = getSession();
    sessionTimestamp = now;
  }
  const session = await sessionPromise;
  const token = (session as { accessToken?: string } | null)?.accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const authHeaders = await getAuthHeaders();
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(!isFormData ? { "Content-Type": "application/json" } : {}),
      ...authHeaders,
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error((error as { detail?: string }).detail ?? `HTTP ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiDownload(path: string, options: RequestInit = {}): Promise<Blob> {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders,
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `HTTP ${response.status}`);
  }
  return response.blob();
}

export async function listCategories(): Promise<Category[]> {
  return apiFetch<Category[]>("/api/categories");
}

export async function createCategory(data: Partial<Category> & { name: string }): Promise<Category> {
  return apiFetch<Category>("/api/categories", { method: "POST", body: JSON.stringify(data) });
}

export async function updateCategory(id: string, data: Partial<Category>): Promise<Category> {
  return apiFetch<Category>(`/api/categories/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteCategory(id: string): Promise<void> {
  return apiFetch<void>(`/api/categories/${id}`, { method: "DELETE" });
}

export async function listMerchantRules(): Promise<MerchantRule[]> {
  return apiFetch<MerchantRule[]>("/api/categories/rules");
}

export async function createMerchantRule(data: Partial<MerchantRule> & { merchant_pattern: string }): Promise<MerchantRule> {
  return apiFetch<MerchantRule>("/api/categories/rules", { method: "POST", body: JSON.stringify(data) });
}

export async function updateMerchantRule(id: string, data: Partial<MerchantRule>): Promise<MerchantRule> {
  return apiFetch<MerchantRule>(`/api/categories/rules/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteMerchantRule(id: string): Promise<void> {
  return apiFetch<void>(`/api/categories/rules/${id}`, { method: "DELETE" });
}

export async function listBudgets(month?: string): Promise<Budget[]> {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  return apiFetch<Budget[]>(`/api/budgets${query}`);
}

export async function createBudget(data: Record<string, unknown>): Promise<Budget> {
  return apiFetch<Budget>("/api/budgets", { method: "POST", body: JSON.stringify(data) });
}

export async function updateBudget(id: string, data: Record<string, unknown>): Promise<Budget> {
  return apiFetch<Budget>(`/api/budgets/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteBudget(id: string): Promise<void> {
  return apiFetch<void>(`/api/budgets/${id}`, { method: "DELETE" });
}

export async function listExpenses(filters: Record<string, string | boolean | undefined> = {}): Promise<ExpenseListResponse> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return apiFetch<ExpenseListResponse>(`/api/expenses${params.size ? `?${params.toString()}` : ""}`);
}

export async function getExpense(id: string): Promise<Expense> {
  return apiFetch<Expense>(`/api/expenses/${id}`);
}

export async function createExpense(data: Record<string, unknown>): Promise<Expense> {
  return apiFetch<Expense>("/api/expenses", { method: "POST", body: JSON.stringify(data) });
}

export async function updateExpense(id: string, data: Record<string, unknown>): Promise<Expense> {
  return apiFetch<Expense>(`/api/expenses/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteExpense(id: string): Promise<void> {
  return apiFetch<void>(`/api/expenses/${id}`, { method: "DELETE" });
}

export async function createExpenseFromReceipt(data: Record<string, unknown>): Promise<Expense> {
  return apiFetch<Expense>("/api/expenses/from-receipt", { method: "POST", body: JSON.stringify(data) });
}

export async function getReviewQueue(): Promise<ReviewQueue> {
  return apiFetch<ReviewQueue>("/api/expenses/review-queue");
}

export async function exportExpenses(format: "json" | "csv", month?: string): Promise<Blob> {
  const params = new URLSearchParams({ format });
  if (month) params.set("month", month);
  return apiDownload(`/api/expenses/export?${params.toString()}`);
}

export async function listReceipts(needsReview?: boolean): Promise<Receipt[]> {
  const query = typeof needsReview === "boolean" ? `?needs_review=${needsReview}` : "";
  return apiFetch<Receipt[]>(`/api/receipts${query}`);
}

export async function getReceipt(id: string): Promise<Receipt> {
  return apiFetch<Receipt>(`/api/receipts/${id}`);
}

export async function uploadReceipt(file: File): Promise<Receipt> {
  const formData = new FormData();
  formData.append("file", file);
  const llmConfig = getLLMConfig();
  if (llmConfig.provider) formData.append("provider", llmConfig.provider);
  if (llmConfig.model) formData.append("model", llmConfig.model);
  if (llmConfig.apiKey) formData.append("api_key", llmConfig.apiKey);
  if (llmConfig.baseUrl) formData.append("base_url", llmConfig.baseUrl);
  return apiFetch<Receipt>("/api/receipts/upload", { method: "POST", body: formData });
}

export async function uploadStatement(file: File): Promise<Receipt> {
  const formData = new FormData();
  formData.append("file", file);
  const llmConfig = getLLMConfig();
  if (llmConfig.provider) formData.append("provider", llmConfig.provider);
  if (llmConfig.model) formData.append("model", llmConfig.model);
  if (llmConfig.apiKey) formData.append("api_key", llmConfig.apiKey);
  if (llmConfig.baseUrl) formData.append("base_url", llmConfig.baseUrl);
  return apiFetch<Receipt>("/api/receipts/upload-statement", { method: "POST", body: formData });
}

export async function createExpenseFromStatementEntry(data: Record<string, unknown>): Promise<StatementFinalizeResponse> {
  return apiFetch<StatementFinalizeResponse>("/api/expenses/from-statement-entry", { method: "POST", body: JSON.stringify(data) });
}

export async function getDashboardAnalytics(month?: string): Promise<DashboardAnalytics> {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  return apiFetch<DashboardAnalytics>(`/api/analytics/dashboard${query}`);
}

export async function listAllUsers(): Promise<AdminUser[]> {
  return apiFetch<AdminUser[]>("/api/admin/panel/users");
}

export async function updateUserStatus(userId: string, status: string): Promise<{ id: string; status: string }> {
  return apiFetch<{ id: string; status: string }>(`/api/admin/panel/users/${userId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function deleteUser(userId: string): Promise<void> {
  return apiFetch<void>(`/api/admin/panel/users/${userId}`, { method: "DELETE" });
}
