"use client";

import { useEffect, useMemo, useState } from "react";
import { getCurrentUserProfile, getLLMConfig, saveLLMConfig, updateCurrentUserProfile } from "@/lib/api";
import { SETTINGS_UPDATED_EVENT, emitAppEvent } from "@/lib/app-events";

export default function SettingsPage() {
  const [config, setConfig] = useState(() => {
    const current = getLLMConfig();
    return {
      provider: current.provider ?? "ollama",
      model: current.model ?? "gemma4:e4b",
      apiKey: current.apiKey ?? "",
      baseUrl: current.baseUrl ?? "",
    };
  });
  const [saved, setSaved] = useState(false);
  const [automaticMonthlyReports, setAutomaticMonthlyReports] = useState(true);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsSaving, setReportsSaving] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [reportsSaved, setReportsSaved] = useState(false);

  const reportsDescription = useMemo(
    () => "Controls only whether Spendhound automatically emails your monthly report digest. It does not affect manual send actions from the dashboard.",
    [],
  );

  useEffect(() => {
    let active = true;

    getCurrentUserProfile()
      .then((profile) => {
        if (!active) return;
        setAutomaticMonthlyReports(profile.automatic_monthly_reports);
        setReportsError(null);
      })
      .catch((err) => {
        if (!active) return;
        setReportsError(err instanceof Error ? err.message : "Failed to load automatic monthly email setting.");
      })
      .finally(() => {
        if (active) setReportsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function handleSave() {
    saveLLMConfig(config);
    emitAppEvent(SETTINGS_UPDATED_EVENT, config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your automatic monthly email preference and local-only AI provider settings.</p>
      </div>
      <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
        <div>
          <h2 className="text-lg font-semibold">Monthly report emails</h2>
          <p className="text-sm text-muted-foreground">{reportsDescription}</p>
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
      <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
        <div>
          <h2 className="text-lg font-semibold">AI provider settings</h2>
          <p className="text-sm text-muted-foreground">These values stay in your browser and are sent only when you use LLM-assisted receipt extraction, expense chat, or finance summaries.</p>
        </div>
        {saved ? <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">Settings saved locally for receipt extraction and chat.</div> : null}
        <label className="text-sm"><span className="mb-1 block text-muted-foreground">Provider</span><select value={config.provider} onChange={(e) => setConfig({ ...config, provider: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2"><option value="ollama">Ollama</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="nebius">Nebius</option></select></label>
        <label className="text-sm"><span className="mb-1 block text-muted-foreground">Model</span><input value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
        <label className="text-sm"><span className="mb-1 block text-muted-foreground">Base URL</span><input value={config.baseUrl} onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })} placeholder="Optional custom endpoint" className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
        <label className="text-sm"><span className="mb-1 block text-muted-foreground">API key</span><input type="password" value={config.apiKey} onChange={(e) => setConfig({ ...config, apiKey: e.target.value })} placeholder="Optional cloud provider key" className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
        <div className="rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
          Local fallback extraction still works without any LLM. Configure these fields only if you want richer receipt extraction plus AI-powered spend analysis inside expense chat.
        </div>
        <div className="flex justify-end"><button onClick={handleSave} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Save local settings</button></div>
      </div>
    </div>
  );
}
