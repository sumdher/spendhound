"use client";

import { useEffect, useState } from "react";
import {
  getCurrentUserProfile,
  updateCurrentUserProfile,
  updateLLMSettings,
  testLLMSettings,
  getLLMModels,
  LLMModelInfo,
} from "@/lib/api";
import { getDefaultCurrency, setDefaultCurrency } from "@/lib/fx-rates";

const SETTINGS_CURRENCIES = [
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "CHF", symbol: "Fr", name: "Swiss Franc" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan" },
  { code: "SEK", symbol: "kr", name: "Swedish Krona" },
  { code: "NOK", symbol: "kr", name: "Norwegian Krone" },
  { code: "DKK", symbol: "kr", name: "Danish Krone" },
  { code: "PLN", symbol: "zł", name: "Polish Zloty" },
  { code: "BRL", symbol: "R$", name: "Brazilian Real" },
  { code: "MXN", symbol: "$", name: "Mexican Peso" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar" },
  { code: "HKD", symbol: "HK$", name: "Hong Kong Dollar" },
  { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar" },
  { code: "ZAR", symbol: "R", name: "South African Rand" },
  { code: "TRY", symbol: "₺", name: "Turkish Lira" },
  { code: "KRW", symbol: "₩", name: "South Korean Won" },
  { code: "THB", symbol: "฿", name: "Thai Baht" },
  { code: "IDR", symbol: "Rp", name: "Indonesian Rupiah" },
  { code: "MYR", symbol: "RM", name: "Malaysian Ringgit" },
  { code: "PHP", symbol: "₱", name: "Philippine Peso" },
  { code: "ILS", symbol: "₪", name: "Israeli Shekel" },
  { code: "CZK", symbol: "Kč", name: "Czech Koruna" },
  { code: "HUF", symbol: "Ft", name: "Hungarian Forint" },
  { code: "RON", symbol: "lei", name: "Romanian Leu" },
  { code: "BGN", symbol: "лв", name: "Bulgarian Lev" },
];

const PROVIDERS = [
  { value: "ollama",      label: "Ollama (local)" },
  { value: "openai",      label: "OpenAI" },
  { value: "anthropic",   label: "Anthropic" },
  { value: "openrouter",  label: "OpenRouter (300+ models)" },
  { value: "groq",        label: "Groq" },
  { value: "together",    label: "Together AI" },
  { value: "mistral",     label: "Mistral" },
  { value: "nebius",      label: "Nebius" },
];

function buildOptionTitle(model: LLMModelInfo): string {
  const parts: string[] = [];
  if (model.supports_vision) parts.push("👁 Vision");
  if (model.context_length) parts.push(`Context: ${(model.context_length / 1000).toFixed(0)}K`);
  if (model.pricing) {
    parts.push(`In: $${model.pricing.input_per_1m?.toFixed(2) ?? "?"}/1M`);
    parts.push(`Out: $${model.pricing.output_per_1m?.toFixed(2) ?? "?"}/1M`);
  }
  if (model.description) parts.push(model.description.slice(0, 100));
  return parts.join(" | ");
}

export default function SettingsPage() {
  // ── LLM settings state (server-backed) ──────────────────────────────────
  const [llmProvider, setLlmProvider] = useState("ollama");
  const [llmModel, setLlmModel] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [hasLlmApiKey, setHasLlmApiKey] = useState(false);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [llmLoading, setLlmLoading] = useState(true);
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmSaved, setLlmSaved] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);

  // ── AI settings dirty / test state ──────────────────────────────────────
  const [aiSettingsDirty, setAiSettingsDirty] = useState(false);
  const [testState, setTestState] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testResponse, setTestResponse] = useState<string>("");
  const [testError, setTestError] = useState<string>("");

  // ── Model list (unified for all providers) ───────────────────────────────
  const [modelList, setModelList] = useState<LLMModelInfo[]>([]);
  const [modelListLoading, setModelListLoading] = useState(false);
  const [modelListError, setModelListError] = useState<string>("");

  // ── Monthly reports state ────────────────────────────────────────────────
  const [automaticMonthlyReports, setAutomaticMonthlyReports] = useState(true);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsSaving, setReportsSaving] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [reportsSaved, setReportsSaved] = useState(false);

  // ── Currency state (localStorage) ───────────────────────────────────────
  const [defaultCurrency, setDefaultCurrencyState] = useState<string>(() => getDefaultCurrency());

  // ── Initial data load ────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;

    getCurrentUserProfile()
      .then((profile) => {
        if (!active) return;
        setAutomaticMonthlyReports(profile.automatic_monthly_reports);
        // Use raw setters here — NOT markDirty() — to avoid dirty flag on load
        setLlmProvider(profile.llm_provider ?? "ollama");
        setLlmModel(profile.llm_model ?? "");
        setLlmBaseUrl(profile.llm_base_url ?? "");
        setHasLlmApiKey(profile.has_llm_api_key ?? false);
        setReportsError(null);
        setLlmError(null);
      })
      .catch((err) => {
        if (!active) return;
        const msg = err instanceof Error ? err.message : "Failed to load settings.";
        setReportsError(msg);
        setLlmError(msg);
      })
      .finally(() => {
        if (!active) return;
        setReportsLoading(false);
        setLlmLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // ── Model list fetch (fires when provider or base URL changes) ────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!llmProvider) return;

    setModelList([]);
    setModelListError("");
    setModelListLoading(true);

    getLLMModels(llmProvider, llmApiKey || undefined)
      .then((models) => {
        setModelList(models);
        if (models.length === 0 && llmProvider !== "ollama") {
          if (llmProvider !== "openrouter" && !hasLlmApiKey && !llmApiKey) {
            setModelListError("Enter your API key to see available models");
          }
        }
      })
      .finally(() => setModelListLoading(false));
  }, [llmProvider, llmBaseUrl]); // intentionally NOT watching llmApiKey to avoid re-fetch on every keystroke

  // ── Mark settings dirty and reset test state ─────────────────────────────
  function markDirty() {
    setAiSettingsDirty(true);
    setTestState("idle");
    setTestResponse("");
    setTestError("");
  }

  // ── Refresh model list manually ──────────────────────────────────────────
  function handleRefreshModels() {
    setModelList([]);
    setModelListError("");
    setModelListLoading(true);

    getLLMModels(llmProvider, llmApiKey || undefined)
      .then((models) => {
        setModelList(models);
        if (models.length === 0 && llmProvider !== "ollama") {
          if (llmProvider !== "openrouter" && !hasLlmApiKey && !llmApiKey) {
            setModelListError("Enter your API key to see available models");
          }
        }
      })
      .finally(() => setModelListLoading(false));
  }

  // ── Test the configured LLM ──────────────────────────────────────────────
  async function handleTestLLM() {
    setTestState("testing");
    setTestResponse("");
    setTestError("");

    try {
      const result = await testLLMSettings({
        provider: llmProvider || undefined,
        model: llmModel || undefined,
        api_key: llmApiKey || undefined,
        base_url: llmBaseUrl || undefined,
      });

      if (result.success) {
        setTestState("success");
        setTestResponse(result.response || "");
      } else {
        setTestState("error");
        setTestError(result.error || "Unknown error");
      }
    } catch (e) {
      setTestState("error");
      setTestError(String(e));
    }
  }

  // ── Save LLM settings ────────────────────────────────────────────────────
  async function handleSaveLLMSettings() {
    setLlmSaving(true);
    setLlmSaved(false);
    setLlmError(null);

    try {
      const payload: Parameters<typeof updateLLMSettings>[0] = {
        llm_provider: llmProvider || null,
        llm_model: llmModel || null,
        llm_base_url: llmBaseUrl || null,
      };

      if (clearApiKey) {
        payload.clear_api_key = true;
      } else if (llmApiKey.trim()) {
        payload.llm_api_key = llmApiKey.trim();
      }

      const updated = await updateLLMSettings(payload);
      setHasLlmApiKey(updated.has_llm_api_key ?? false);
      setLlmApiKey("");
      setClearApiKey(false);
      setLlmSaved(true);
      // Reset dirty flag — settings are now saved; keep testState as "success"
      setAiSettingsDirty(false);
      setTimeout(() => setLlmSaved(false), 3000);
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : "Failed to save AI settings.");
    } finally {
      setLlmSaving(false);
    }
  }

  function handleDefaultCurrencyChange(currency: string) {
    setDefaultCurrency(currency);
    setDefaultCurrencyState(currency);
  }

  async function handleAutomaticMonthlyReportsChange(nextValue: boolean) {
    const previousValue = automaticMonthlyReports;
    setAutomaticMonthlyReports(nextValue);
    setReportsSaving(true);
    setReportsSaved(false);
    setReportsError(null);

    try {
      const updated = await updateCurrentUserProfile({ automatic_monthly_reports: nextValue });
      setAutomaticMonthlyReports(updated.automatic_monthly_reports);
      setReportsSaved(true);
      setTimeout(() => setReportsSaved(false), 2000);
    } catch (err) {
      setAutomaticMonthlyReports(previousValue);
      setReportsError(err instanceof Error ? err.message : "Failed to update automatic monthly email setting.");
    } finally {
      setReportsSaving(false);
    }
  }

  const isOllama = llmProvider === "ollama";
  // Allow save when: settings haven't changed since load/last save, OR test passed
  const canSave = !aiSettingsDirty || testState === "success";
  // Find info for the selected model (for live pricing/details display)
  const selectedModelInfo = modelList.find((m) => m.id === llmModel);
  // If the saved model value is not in the fetched list, add it as a "(current)" option
  const currentModelInList = modelList.some((m) => m.id === llmModel);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your monthly email preference, display currency, and AI provider settings.</p>
      </div>

      {/* Monthly report emails */}
      <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
        <div>
          <h2 className="text-lg font-semibold">Monthly report emails</h2>
          <p className="text-sm text-muted-foreground">
            Controls only whether Spendhound automatically emails your monthly report digest. It does not affect manual send actions from the dashboard.
          </p>
        </div>
        {reportsError ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{reportsError}</div> : null}
        {reportsSaved ? <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">Automatic monthly email preference updated.</div> : null}
        <label className="flex items-start justify-between gap-4 rounded-xl border border-border bg-background p-4">
          <div className="space-y-1">
            <div className="text-sm font-medium">Automatic monthly emails</div>
            <div className="text-sm text-muted-foreground">Send the monthly digest email automatically each month.</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={automaticMonthlyReports}
            aria-label="Toggle automatic monthly emails"
            onClick={() => handleAutomaticMonthlyReportsChange(!automaticMonthlyReports)}
            disabled={reportsLoading || reportsSaving}
            className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border transition ${automaticMonthlyReports ? "border-primary bg-primary" : "border-border bg-muted"} ${(reportsLoading || reportsSaving) ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
          >
            <span
              className={`inline-block h-5 w-5 translate-y-[3px] rounded-full bg-white transition ${automaticMonthlyReports ? "translate-x-6" : "translate-x-1"}`}
            />
          </button>
        </label>
        <div className="text-xs text-muted-foreground">
          {reportsLoading ? "Loading current preference..." : reportsSaving ? "Saving automatic monthly email preference..." : `Automatic monthly emails are currently ${automaticMonthlyReports ? "enabled" : "disabled"}.`}
        </div>
      </div>

      {/* Default currency */}
      <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
        <div>
          <h2 className="text-lg font-semibold">Default currency</h2>
          <p className="text-sm text-muted-foreground">
            The base currency used for multi-currency totals, charts, and sorting. When your expenses include multiple currencies, all amounts are converted to this currency for comparison and aggregation. The default is EUR.
          </p>
        </div>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Display currency</span>
          <select
            value={defaultCurrency}
            onChange={(e) => handleDefaultCurrencyChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
          >
            {SETTINGS_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.symbol} {c.code} — {c.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          Saved locally in your browser. After changing, visit the dashboard or expenses page and click &quot;Update rates&quot; to fetch live conversion rates relative to your new default currency.
        </p>
      </div>

      {/* AI provider settings */}
      <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
        <div>
          <h2 className="text-lg font-semibold">AI provider settings</h2>
          <p className="text-sm text-muted-foreground">Configure your LLM provider. Settings are stored securely on the server and used for receipt extraction, expense chat, and finance summaries.</p>
        </div>

        {llmError ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{llmError}</div> : null}
        {llmSaved ? <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">AI settings saved.</div> : null}

        {llmLoading ? (
          <div className="text-sm text-muted-foreground">Loading AI settings…</div>
        ) : (
          <>
            {/* Provider */}
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Provider</span>
              <select
                value={llmProvider}
                onChange={(e) => { setLlmProvider(e.target.value); markDirty(); }}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>

            {/* Model — unified dynamic dropdown for all providers */}
            <div className="text-sm">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-muted-foreground">Model</span>
                {modelListLoading ? (
                  <span className="text-xs text-muted-foreground animate-pulse">🔄 Loading models…</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleRefreshModels}
                    className="text-xs text-muted-foreground underline ml-2"
                  >
                    🔄 Refresh
                  </button>
                )}
              </div>

              {modelListLoading ? (
                <select disabled className="w-full rounded-lg border border-border bg-background px-3 py-2 disabled:opacity-60">
                  <option>Loading models…</option>
                </select>
              ) : modelList.length > 0 || (llmModel !== "" && !currentModelInList) ? (
                <>
                  <select
                    value={llmModel}
                    onChange={(e) => { setLlmModel(e.target.value); markDirty(); }}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                  >
                    <option value="" disabled>Select a model…</option>
                    {llmModel !== "" && !currentModelInList && (
                      <option value={llmModel}>{llmModel} (current)</option>
                    )}
                    {modelList.map((m) => (
                      <option key={m.id} value={m.id} title={buildOptionTitle(m)}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  {selectedModelInfo && (
                    <p className="text-xs text-muted-foreground mt-1 flex gap-2 flex-wrap">
                      {selectedModelInfo.supports_vision && <span>👁 Vision</span>}
                      {selectedModelInfo.context_length && (
                        <span>Context: {(selectedModelInfo.context_length / 1000).toFixed(0)}K tokens</span>
                      )}
                      {selectedModelInfo.pricing && (
                        <span>
                          ${selectedModelInfo.pricing.input_per_1m?.toFixed(2)}/1M in ·{" "}
                          ${selectedModelInfo.pricing.output_per_1m?.toFixed(2)}/1M out
                        </span>
                      )}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <input
                    value={llmModel}
                    onChange={(e) => { setLlmModel(e.target.value); markDirty(); }}
                    placeholder="e.g. gpt-4o"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                  />
                  {modelListError && (
                    <p className="mt-1 text-xs text-muted-foreground">{modelListError}</p>
                  )}
                </>
              )}
            </div>

            {/* Base URL — always shown, required for Ollama */}
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">
                Base URL{isOllama ? " (required for Ollama)" : " (optional custom endpoint)"}
              </span>
              <input
                value={llmBaseUrl}
                onChange={(e) => { setLlmBaseUrl(e.target.value); markDirty(); }}
                placeholder={isOllama ? "http://localhost:11434" : "https://api.openai.com/v1"}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>

            {/* API Key — hidden for Ollama */}
            {!isOllama && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">API key</span>
                  {hasLlmApiKey && !clearApiKey && (
                    <span className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
                        ✓ API key saved
                      </span>
                      <button
                        type="button"
                        onClick={() => setClearApiKey(true)}
                        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        Clear saved key
                      </button>
                    </span>
                  )}
                  {clearApiKey && (
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-red-400">Key will be deleted on save</span>
                      <button
                        type="button"
                        onClick={() => setClearApiKey(false)}
                        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </span>
                  )}
                </div>
                <input
                  type="password"
                  value={llmApiKey}
                  onChange={(e) => { setLlmApiKey(e.target.value); markDirty(); }}
                  placeholder={hasLlmApiKey && !clearApiKey ? "●●●●●●●● (leave blank to keep saved key)" : "Enter API key"}
                  disabled={clearApiKey}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
                />
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                  <span>🔒</span>
                  <span>
                    Your API key is encrypted at rest in our database and never returned in any response.
                    It is used only server-side for your AI requests.
                  </span>
                </p>
              </div>
            )}

            {isOllama && (
              <div className="rounded-xl border border-border bg-background p-3 text-sm text-muted-foreground">
                Ollama runs locally — no API key required.
              </div>
            )}

            <div className="rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
              Local fallback extraction still works without any LLM. Configure these fields only if you want richer receipt extraction plus AI-powered spend analysis inside expense chat.
            </div>

            {/* Test Model button + result */}
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleTestLLM}
                disabled={testState === "testing"}
                className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
              >
                {testState === "testing" ? "Testing…" : "🐾 Test Model"}
              </button>

              {testState === "success" && (
                <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
                  <div className="font-medium">✅ Model responded:</div>
                  <div className="mt-1 italic">&quot;{testResponse}&quot;</div>
                </div>
              )}

              {testState === "error" && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  <div className="font-medium">❌ Test failed:</div>
                  <div className="mt-1">{testError}</div>
                </div>
              )}
            </div>

            {/* Hint shown only when dirty and test not yet passed */}
            {aiSettingsDirty && testState !== "success" && (
              <p className="text-xs text-muted-foreground">
                Run &quot;🐾 Test Model&quot; before saving to verify your settings work.
              </p>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleSaveLLMSettings}
                disabled={llmSaving || !canSave}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {llmSaving ? "Saving…" : "Save AI settings"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
