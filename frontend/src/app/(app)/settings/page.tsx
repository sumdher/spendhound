"use client";

import { useState } from "react";
import { getLLMConfig, saveLLMConfig } from "@/lib/api";

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

  function handleSave() {
    saveLLMConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Receipt extraction settings</h1>
        <p className="text-sm text-muted-foreground">These values are stored in your browser and sent only when you upload a receipt for LLM-assisted extraction.</p>
      </div>
      <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
        {saved ? <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">Settings saved locally.</div> : null}
        <label className="text-sm"><span className="mb-1 block text-muted-foreground">Provider</span><select value={config.provider} onChange={(e) => setConfig({ ...config, provider: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2"><option value="ollama">Ollama</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="nebius">Nebius</option></select></label>
        <label className="text-sm"><span className="mb-1 block text-muted-foreground">Model</span><input value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
        <label className="text-sm"><span className="mb-1 block text-muted-foreground">Base URL</span><input value={config.baseUrl} onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })} placeholder="Optional custom endpoint" className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
        <label className="text-sm"><span className="mb-1 block text-muted-foreground">API key</span><input type="password" value={config.apiKey} onChange={(e) => setConfig({ ...config, apiKey: e.target.value })} placeholder="Optional cloud provider key" className="w-full rounded-lg border border-border bg-background px-3 py-2" /></label>
        <div className="rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
          Local fallback extraction works without any LLM. Configure these fields only if you want structured extraction attempts through Ollama or another provider.
        </div>
        <div className="flex justify-end"><button onClick={handleSave} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Save local settings</button></div>
      </div>
    </div>
  );
}
