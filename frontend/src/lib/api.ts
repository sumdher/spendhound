import { getSession } from "next-auth/react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/backend";

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | string;
  content: string;
  client_id: string;
  parent_client_id?: string | null;
  provider?: string | null;
  model?: string | null;
  token_count?: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ChatSession {
  id: string;
  title: string;
  summary?: string | null;
  token_count: number;
  max_tokens: number;
  message_count: number;
  last_message_preview?: string | null;
  last_message_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatHistory {
  session: ChatSession;
  messages: ChatMessage[];
}

export interface ChatStreamRequest {
  message: string;
  clientId?: string;
  parentClientId?: string | null;
  assistantClientId?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatSummarizeRequest {
  sessionId?: string;
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatSSEMetaEvent {
  mode?: "chat" | "summary";
  session?: ChatSession;
  session_id?: string | null;
  request_message?: {
    id?: string;
    client_id?: string;
    parent_client_id?: string | null;
  };
  assistant_client_id?: string;
  provider?: string;
  model?: string;
}

export interface ChatSSEDoneEvent {
  ok?: boolean;
  session?: ChatSession;
  message?: ChatMessage;
  summary?: string;
}

export interface ChatSSEErrorEvent {
  error?: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
  description?: string | null;
  transaction_type: string;
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
  is_global: boolean;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemKeywordRule {
  id: string;
  keyword: string;
  subcategory_label: string;
  pattern_type: string;
  priority: number;
  is_active: boolean;
  is_global: boolean;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeBaseEntry {
  id: string;
  description_text: string;
  subcategory_label: string;
  is_global: boolean;
  source: string;
  notes?: string | null;
  created_at: string;
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
  transaction_type?: string;
  cadence?: string | null;
  recurring_variable?: boolean;
  recurring_auto_add?: boolean;
  currency?: string;
  expense_date?: string | null;
  description?: string | null;
  category_name?: string | null;
  notes?: string | null;
  items?: ReceiptPreviewItem[];
  confidence?: number;
  is_major_purchase?: boolean;
}

export interface StatementImportEntry {
  merchant?: string;
  amount?: number | null;
  transaction_type?: string;
  cadence?: string | null;
  recurring_variable?: boolean;
  recurring_auto_add?: boolean;
  currency?: string;
  expense_date?: string | null;
  description?: string | null;
  category_name?: string | null;
  notes?: string | null;
  confidence?: number;
  is_major_purchase?: boolean;
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
  signed_amount: number;
  transaction_type: string;
  currency: string;
  expense_date: string;
  source: string;
  confidence: number;
  needs_review: boolean;
  notes?: string | null;
  is_recurring: boolean;
  recurring_group?: string | null;
  cadence: string;
  cadence_override?: string | null;
  recurring_variable: boolean;
  recurring_auto_add: boolean;
  recurring_source_expense_id?: string | null;
  auto_generated: boolean;
  generated_for_month?: string | null;
  cadence_interval?: number | null;
  prepaid_months?: number | null;
  prepaid_start_date?: string | null;
  prepaid_end_date?: string | null;
  is_major_purchase: boolean;
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
    total_income: number;
    money_in: number;
    money_out: number;
    net: number;
    money_out_by_currency: Record<string, number>;
    money_in_by_currency: Record<string, number>;
    net_by_currency: Record<string, number>;
    transaction_count: number;
    average_transaction: number;
    average_outflow: number;
    average_inflow: number;
    review_count: number;
  };
  spend_by_category: { name: string; amount: number }[];
  income_by_category: { name: string; amount: number }[];
  top_merchants: { merchant: string; amount: number }[];
  top_income_sources: { merchant: string; amount: number }[];
  monthly_trend: { month: string; amount: number; money_in: number; money_out: number; net: number }[];
  recurring_transactions: Array<{
    id: string;
    merchant: string;
    amount: number;
    signed_amount: number;
    transaction_type: string;
    currency: string;
    expense_date: string;
    category_name: string;
    cadence: string;
    is_major_purchase: boolean;
  }>;
  recurring_expenses: Array<{
    id: string;
    merchant: string;
    amount: number;
    signed_amount: number;
    transaction_type: string;
    currency: string;
    expense_date: string;
    category_name: string;
    cadence: string;
    is_major_purchase: boolean;
  }>;
  major_one_time_purchases: Array<{
    id: string;
    merchant: string;
    amount: number;
    signed_amount: number;
    transaction_type: string;
    currency: string;
    expense_date: string;
    category_name: string;
    cadence: string;
    is_major_purchase: boolean;
  }>;
  prepaid_subscriptions: Array<{
    id: string;
    merchant: string;
    amount: number;
    currency: string;
    expense_date: string;
    category_name: string;
    prepaid_months: number;
    prepaid_start_date: string;
    prepaid_end_date: string;
    days_remaining: number;
    status: "active" | "expiring_soon" | "expired";
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
  is_admin: boolean;
  expense_count: number;
  created_at: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name?: string | null;
  avatar_url?: string | null;
  status: string;
  is_admin: boolean;
  automatic_monthly_reports: boolean;
  receipt_prompt_override?: string | null;
  llm_provider?: string | null;
  llm_model?: string | null;
  llm_base_url?: string | null;
  has_llm_api_key: boolean;
  created_at: string;
  updated_at?: string;
}

export interface UserLLMSettings {
  llm_provider?: string | null;
  llm_model?: string | null;
  llm_api_key?: string | null;
  llm_base_url?: string | null;
  clear_api_key?: boolean;
}

export interface UpdateUserProfileRequest {
  automatic_monthly_reports: boolean;
}

export interface UpdateReceiptPromptRequest {
  receipt_prompt_override?: string | null;
}

export interface MonthlyReportSendRequest {
  month: string;
}

export interface MonthlyReportSendResponse {
  delivery_id?: string;
  status?: string;
  recipient?: string;
  sent_at?: string | null;
  message?: string;
  detail?: string;
  [key: string]: unknown;
}

let sessionPromise: ReturnType<typeof getSession> | null = null;
let sessionTimestamp = 0;
const SESSION_CACHE_MS = 5_000;

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

async function proxyStream(body: Record<string, unknown>): Promise<Response> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    const error = await response.json().catch(async () => ({ detail: await response.text().catch(() => response.statusText) }));
    throw new Error((error as { detail?: string }).detail ?? `HTTP ${response.status}`);
  }

  return response;
}

export async function consumeSSE(
  response: Response,
  handlers: {
    onMeta?: (data: ChatSSEMetaEvent) => void;
    onToken?: (data: { text?: string; token?: string }) => void;
    onError?: (data: ChatSSEErrorEvent) => void;
    onDone?: (data: ChatSSEDoneEvent) => void;
    onEvent?: (event: string, data: unknown) => void;
  }
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Streaming response body is unavailable");

  const decoder = new TextDecoder();
  let buffer = "";

  const dispatchBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    let eventName = "message";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim() || "message";
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (!dataLines.length) return;

    const raw = dataLines.join("\n");
    const parsed: unknown = (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    })();

    handlers.onEvent?.(eventName, parsed);

    if (eventName === "meta") handlers.onMeta?.(parsed as ChatSSEMetaEvent);
    if (eventName === "token") handlers.onToken?.(parsed as { text?: string; token?: string });
    if (eventName === "error") handlers.onError?.(parsed as ChatSSEErrorEvent);
    if (eventName === "done") handlers.onDone?.(parsed as ChatSSEDoneEvent);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let boundaryIndex = buffer.indexOf("\n\n");
    while (boundaryIndex >= 0) {
      const block = buffer.slice(0, boundaryIndex).trim();
      buffer = buffer.slice(boundaryIndex + 2);
      if (block) dispatchBlock(block);
      boundaryIndex = buffer.indexOf("\n\n");
    }

    if (done) break;
  }

  const trailing = buffer.trim();
  if (trailing) dispatchBlock(trailing);
}

export async function listCategories(): Promise<Category[]> {
  return apiFetch<Category[]>("/api/categories");
}

export async function listChatSessions(): Promise<ChatSession[]> {
  return apiFetch<ChatSession[]>("/api/chat/sessions");
}

export async function createChatSession(title?: string): Promise<ChatSession> {
  return apiFetch<ChatSession>("/api/chat/sessions", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export async function renameChatSession(sessionId: string, title: string): Promise<ChatSession> {
  return apiFetch<ChatSession>(`/api/chat/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  return apiFetch<void>(`/api/chat/sessions/${sessionId}`, { method: "DELETE" });
}

export async function getChatHistory(sessionId: string): Promise<ChatHistory> {
  return apiFetch<ChatHistory>(`/api/chat/sessions/${sessionId}/history`);
}

export async function clearChatHistory(sessionId: string): Promise<ChatHistory> {
  return apiFetch<ChatHistory>(`/api/chat/sessions/${sessionId}/history`, { method: "DELETE" });
}

export async function streamChatSession(sessionId: string, request: ChatStreamRequest): Promise<Response> {
  return proxyStream({
    mode: "chat",
    sessionId,
    message: request.message,
    clientId: request.clientId,
    parentClientId: request.parentClientId,
    assistantClientId: request.assistantClientId,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
  });
}

export async function streamChatSummary(request: ChatSummarizeRequest): Promise<Response> {
  return proxyStream({
    mode: "summary",
    sessionId: request.sessionId,
    prompt: request.prompt,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
  });
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

export async function listItemKeywordRules(): Promise<ItemKeywordRule[]> {
  return apiFetch<ItemKeywordRule[]>("/api/categories/item-rules");
}

export async function createItemKeywordRule(data: Partial<ItemKeywordRule> & { keyword: string; subcategory_label: string }): Promise<ItemKeywordRule> {
  return apiFetch<ItemKeywordRule>("/api/categories/item-rules", { method: "POST", body: JSON.stringify(data) });
}

export async function updateItemKeywordRule(id: string, data: Partial<ItemKeywordRule>): Promise<ItemKeywordRule> {
  return apiFetch<ItemKeywordRule>(`/api/categories/item-rules/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteItemKeywordRule(id: string): Promise<void> {
  return apiFetch<void>(`/api/categories/item-rules/${id}`, { method: "DELETE" });
}

// ── Knowledge base (RAG embeddings) ──────────────────────────────────────────

export async function listKnowledgeBase(isGlobal?: boolean, source?: string): Promise<KnowledgeBaseEntry[]> {
  const params = new URLSearchParams();
  if (isGlobal !== undefined) params.set("is_global", String(isGlobal));
  if (source !== undefined) params.set("source", source);
  const query = params.size ? `?${params.toString()}` : "";
  return apiFetch<KnowledgeBaseEntry[]>(`/api/categories/knowledge-base${query}`);
}

export async function listLearntEntries(): Promise<KnowledgeBaseEntry[]> {
  return apiFetch<KnowledgeBaseEntry[]>(
    "/api/categories/knowledge-base?source=correction&is_global=false"
  );
}

export async function uploadKnowledgeBase(file: File, isGlobal: boolean): Promise<{ total_parsed: number; inserted: number }> {
  const session = await getSession();
  const token = (session as { accessToken?: string } | null)?.accessToken;
  const formData = new FormData();
  formData.append("file", file);
  const url = `${API_URL}/api/categories/knowledge-base/upload?is_global=${isGlobal}`;
  const response = await fetch(url, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `Upload failed: ${response.status}`);
  }
  return response.json() as Promise<{ total_parsed: number; inserted: number }>;
}

export async function deleteKnowledgeBaseEntry(id: string): Promise<void> {
  return apiFetch<void>(`/api/categories/knowledge-base/${id}`, { method: "DELETE" });
}

// ── Expense item subcategory correction ──────────────────────────────────────

export interface ExpenseItemCorrectionResult {
  item: ExpenseItem;
  rule_created?: ItemKeywordRule | null;
}

export async function updateExpenseItemSubcategory(
  expenseId: string,
  itemId: string,
  subcategory: string | null,
  learn = true,
): Promise<ExpenseItemCorrectionResult> {
  return apiFetch<ExpenseItemCorrectionResult>(`/api/expenses/${expenseId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify({ subcategory, learn }),
  });
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
  return apiFetch<Receipt>("/api/receipts/upload", { method: "POST", body: formData });
}

export async function uploadStatement(file: File): Promise<Receipt> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<Receipt>("/api/receipts/upload-statement", { method: "POST", body: formData });
}

export async function createExpenseFromStatementEntry(data: Record<string, unknown>): Promise<StatementFinalizeResponse> {
  return apiFetch<StatementFinalizeResponse>("/api/expenses/from-statement-entry", { method: "POST", body: JSON.stringify(data) });
}

export async function getDashboardAnalytics(month?: string): Promise<DashboardAnalytics> {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  return apiFetch<DashboardAnalytics>(`/api/analytics/dashboard${query}`);
}

export async function getCurrentUserProfile(): Promise<UserProfile> {
  return apiFetch<UserProfile>("/api/auth/me");
}

export async function updateCurrentUserProfile(data: UpdateUserProfileRequest): Promise<UserProfile> {
  return apiFetch<UserProfile>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function updateReceiptPrompt(data: UpdateReceiptPromptRequest): Promise<UserProfile> {
  return apiFetch<UserProfile>("/api/auth/me/receipt-prompt", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function updateLLMSettings(settings: UserLLMSettings): Promise<UserProfile> {
  return apiFetch<UserProfile>("/api/auth/me/llm-settings", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export interface LLMModelPricing {
  input_per_1m: number | null;
  output_per_1m: number | null;
}

export interface LLMModelInfo {
  id: string;
  name: string;
  description: string | null;
  context_length: number | null;
  pricing: LLMModelPricing | null;
  supports_vision: boolean;
}

export interface LLMTestRequest {
  provider?: string;
  model?: string;
  api_key?: string;
  base_url?: string;
}

export interface LLMTestResponse {
  success: boolean;
  response?: string;
  error?: string;
}

export async function testLLMSettings(payload: LLMTestRequest): Promise<LLMTestResponse> {
  return apiFetch<LLMTestResponse>("/api/auth/me/test-llm", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getOllamaModels(): Promise<string[]> {
  try {
    return await apiFetch<string[]>("/api/ollama/models");
  } catch {
    return [];
  }
}

export async function getLLMModels(
  provider: string,
  apiKey?: string,
): Promise<LLMModelInfo[]> {
  try {
    const params = new URLSearchParams({ provider });
    if (apiKey) params.set("api_key", apiKey);
    return await apiFetch<LLMModelInfo[]>(`/api/llm/models?${params.toString()}`);
  } catch {
    return [];
  }
}

export async function sendMonthlyReportEmail(data: MonthlyReportSendRequest): Promise<MonthlyReportSendResponse> {
  return apiFetch<MonthlyReportSendResponse>("/api/monthly-reports/send", {
    method: "POST",
    body: JSON.stringify(data),
  });
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
