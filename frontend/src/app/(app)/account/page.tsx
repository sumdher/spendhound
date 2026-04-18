"use client";

import { signOut, useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptPartnerRequest,
  cancelPartnerRequest,
  clearMyData,
  deleteMyAccount,
  getMyStats,
  handlePartnerToken,
  listBudgets,
  listCategories,
  listItemKeywordRules,
  listLedgers,
  listMerchantRules,
  listPartners,
  rejectPartnerRequest,
  searchUsers,
  sendPartnerRequest,
  type Budget,
  type Category,
  type ItemKeywordRule,
  type Ledger,
  type MerchantRule,
  type Partner,
  type PartnerRequest,
  type UserSearchResult,
} from "@/lib/api";

type Period = "all" | "this_month" | "month";

function Avatar({ name, avatarUrl, size = 8 }: { name?: string | null; avatarUrl?: string | null; size?: number }) {
  const initials = (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((c) => c[0]?.toUpperCase() || "").join("");
  if (avatarUrl) return <img src={avatarUrl} alt={name ?? ""} className={`h-${size} w-${size} rounded-full object-cover shrink-0`} referrerPolicy="no-referrer" />;
  return <div className={`flex h-${size} w-${size} shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary`}>{initials || "?"}</div>;
}

function WarningBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{children}</div>;
}

// ---- Partners section ----

function PartnersSection() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [requests, setRequests] = useState<PartnerRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<UserSearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const searchRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      const data = await listPartners();
      setPartners(data.partners);
      setRequests(data.pending_requests);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!showSuggestions) return;
    function close(e: MouseEvent) { if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowSuggestions(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showSuggestions]);

  useEffect(() => {
    const token = searchParams.get("partner_token");
    const action = searchParams.get("partner_action") as "accept" | "reject" | null;
    if (token && action) {
      handlePartnerToken(token, action).then(() => reload()).catch(() => {});
    }
  }, [searchParams, reload]);

  useEffect(() => {
    if (selectedUser) return;
    const q = query.trim();
    if (q.length < 1) { setSuggestions([]); return; }
    const t = setTimeout(() => {
      searchUsers(q).then(setSuggestions).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [query, selectedUser]);

  async function handleSendInvite() {
    if (!selectedUser) return;
    setSending(true); setSendError(null); setSendSuccess(null);
    try {
      const res = await sendPartnerRequest(selectedUser.email);
      setSendSuccess(`Invite sent to ${res.recipient_email}.`);
      setQuery(""); setSelectedUser(null); setSuggestions([]);
      await reload();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send invite");
    } finally { setSending(false); }
  }

  async function handleAccept(id: string) {
    setAcceptingId(id);
    try { await acceptPartnerRequest(id); await reload(); } catch { /* ignore */ } finally { setAcceptingId(null); }
  }
  async function handleReject(id: string) {
    setRejectingId(id);
    try { await rejectPartnerRequest(id); await reload(); } catch { /* ignore */ } finally { setRejectingId(null); }
  }
  async function handleCancel(id: string) {
    try { await cancelPartnerRequest(id); await reload(); } catch { /* ignore */ }
  }

  const receivedPending = requests.filter((r) => r.direction === "received");
  const sentPending = requests.filter((r) => r.direction === "sent");
  const totalPending = receivedPending.length + sentPending.length;

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-semibold">Expense partners</h2>
            {partners.length > 0 && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">{partners.length}</span>
            )}
            {receivedPending.length > 0 && (
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-black animate-pulse">{receivedPending.length} pending</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Share ledgers and collaborate on expenses</p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Incoming requests — shown prominently at top */}
        {!loading && receivedPending.length > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/8 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-500/20 bg-amber-500/10">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                {receivedPending.length === 1 ? "1 partner request" : `${receivedPending.length} partner requests`}
              </p>
            </div>
            <div className="divide-y divide-amber-500/10">
              {receivedPending.map((req) => (
                <div key={req.id} className="flex items-center gap-3 px-4 py-3.5">
                  <Avatar name={req.name} avatarUrl={req.avatar_url} size={9} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{req.name || req.email}</p>
                    <p className="text-xs text-muted-foreground truncate">{req.email}</p>
                    <p className="text-xs text-amber-400/80 mt-0.5">wants to be your expense partner</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => void handleAccept(req.id)}
                      disabled={acceptingId === req.id}
                      className="rounded-lg bg-green-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-green-500 disabled:opacity-60 transition-colors"
                    >
                      {acceptingId === req.id ? "…" : "Accept"}
                    </button>
                    <button
                      onClick={() => void handleReject(req.id)}
                      disabled={rejectingId === req.id}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-60 transition-colors"
                    >
                      {rejectingId === req.id ? "…" : "Decline"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <span className="h-4 w-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            {/* Active partners */}
            {partners.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground px-1">Partners</p>
                <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
                  {partners.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-3 bg-background hover:bg-accent/30 transition-colors">
                      <Avatar name={p.name} avatarUrl={p.avatar_url} size={9} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{p.name || p.email}</p>
                        <p className="text-xs text-muted-foreground truncate">{p.email}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                        <span className="text-xs text-green-400 font-medium">Partner</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sent requests */}
            {sentPending.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground px-1">Sent — awaiting response</p>
                <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
                  {sentPending.map((req) => (
                    <div key={req.id} className="flex items-center gap-3 px-4 py-3 bg-background">
                      <Avatar name={req.email} avatarUrl={null} size={9} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{req.email}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                          <p className="text-xs text-muted-foreground">Invite pending</p>
                        </div>
                      </div>
                      <button
                        onClick={() => void handleCancel(req.id)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {partners.length === 0 && totalPending === 0 && (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                <p className="text-sm font-medium text-muted-foreground">No partners yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Invite someone below to start sharing ledgers</p>
              </div>
            )}
          </>
        )}

        {/* Add partner */}
        <div className="space-y-2 pt-1 border-t border-border">
          <p className="text-sm font-medium pt-1">Add an expense partner</p>
          <div className="flex gap-2" ref={searchRef}>
            <div className="relative flex-1">
              {selectedUser ? (
                <div className="flex items-center gap-2 rounded-lg border border-primary bg-primary/5 px-3 py-2 text-sm">
                  <Avatar name={selectedUser.name} avatarUrl={selectedUser.avatar_url} size={6} />
                  <span className="font-medium truncate">{selectedUser.name || selectedUser.email}</span>
                  <span className="text-xs text-muted-foreground truncate hidden sm:block">{selectedUser.email}</span>
                  <button type="button" onClick={() => { setSelectedUser(null); setQuery(""); }} className="ml-auto shrink-0 text-muted-foreground hover:text-foreground">✕</button>
                </div>
              ) : (
                <input
                  type="text"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }}
                  onFocus={() => setShowSuggestions(true)}
                  placeholder="Search by name or email…"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  autoComplete="off"
                />
              )}
              {showSuggestions && !selectedUser && suggestions.length > 0 && (
                <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-xl overflow-hidden">
                  {suggestions.map((u) => (
                    <button key={u.id} type="button"
                      onMouseDown={(e) => { e.preventDefault(); setSelectedUser(u); setQuery(u.email); setShowSuggestions(false); }}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent transition-colors">
                      <Avatar name={u.name} avatarUrl={u.avatar_url} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{u.name || u.email}</div>
                        <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {showSuggestions && !selectedUser && query.trim().length >= 1 && suggestions.length === 0 && (
                <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground shadow-xl">
                  No SpendHound users found for &ldquo;{query.trim()}&rdquo;
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleSendInvite()}
              disabled={sending || !selectedUser}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 transition-opacity"
            >
              {sending ? "Sending…" : "Invite"}
            </button>
          </div>
          {sendSuccess && <p className="text-xs text-green-400">{sendSuccess}</p>}
          {sendError && <p className="text-xs text-red-400">{sendError}</p>}
        </div>
      </div>
    </section>
  );
}

// ---- Main page ----

export default function AccountPage() {
  const { data: session } = useSession();
  const avatarUrl = session?.user?.image || (session?.user as Record<string, unknown>)?.avatar_url as string | undefined;
  const initials = (session?.user?.name || session?.user?.email || "SH")
    .split(/\s+/).filter(Boolean).slice(0, 2).map((c: string) => c[0]?.toUpperCase() || "").join("");

  // Stats
  const [stats, setStats] = useState<{ created_at: string; expense_count: number; needs_review_count: number } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [merchantRules, setMerchantRules] = useState<MerchantRule[]>([]);
  const [itemRules, setItemRules] = useState<ItemKeywordRule[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    void Promise.all([
      getMyStats().then(setStats).catch(() => {}),
      listCategories().then(setCategories).catch(() => {}),
      listLedgers().then((r) => setLedgers(r.ledgers)).catch(() => {}),
      listMerchantRules().then(setMerchantRules).catch(() => {}),
      listItemKeywordRules().then(setItemRules).catch(() => {}),
      listBudgets().then(setBudgets).catch(() => {}),
    ]).then(() => setProfileLoaded(true));
  }, []);

  // Clear data
  const [period, setPeriod] = useState<Period>("all");
  const [customMonth, setCustomMonth] = useState("");
  const [merchantFilter, setMerchantFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);

  // Delete account
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleClearData() {
    setClearing(true);
    setClearError(null);
    setClearResult(null);
    try {
      const result = await clearMyData({ period, month: period === "month" ? customMonth : undefined, merchant: merchantFilter || undefined, transaction_type: typeFilter || undefined, category_id: categoryFilter || undefined });
      setClearResult(`Deleted ${result.deleted} expense${result.deleted !== 1 ? "s" : ""} from the server.`);
      setShowClearConfirm(false);
    } catch (err) {
      setClearError(err instanceof Error ? err.message : "Failed to clear data");
    } finally {
      setClearing(false);
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMyAccount();
      await signOut({ callbackUrl: "/login" });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete account");
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold">My account</h1>
        <p className="text-sm text-muted-foreground">Manage your profile, partners, data, and account.</p>
      </div>

      {/* Profile */}
      <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Profile</h2>
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <img src={avatarUrl} alt={session?.user?.name ?? "User"} className="h-16 w-16 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/20 text-xl font-bold text-primary">{initials || "SH"}</div>
          )}
          <div>
            <p className="text-base font-semibold">{session?.user?.name || "—"}</p>
            <p className="text-sm text-muted-foreground">{session?.user?.email}</p>
          </div>
        </div>
        {profileLoaded && stats && (
          <div className="space-y-4 border-t border-border pt-4">
            {/* Activity row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
              <div className="rounded-xl bg-background border border-border px-3 py-2.5">
                <p className="text-muted-foreground text-xs mb-0.5">Member since</p>
                <p className="font-medium text-xs sm:text-sm leading-tight">{new Date(stats.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</p>
              </div>
              <div className="rounded-xl bg-background border border-border px-3 py-2.5">
                <p className="text-muted-foreground text-xs mb-0.5">Expenses</p>
                <p className="font-semibold">{stats.expense_count.toLocaleString()}</p>
              </div>
              <div className="rounded-xl bg-background border border-border px-3 py-2.5">
                <p className="text-muted-foreground text-xs mb-0.5">Ledgers</p>
                <p className="font-semibold">{ledgers.length}</p>
              </div>
              <div className={`rounded-xl border px-3 py-2.5 ${stats.needs_review_count > 0 ? "bg-amber-500/10 border-amber-500/30" : "bg-background border-border"}`}>
                <p className="text-muted-foreground text-xs mb-0.5">Needs review</p>
                <p className={`font-semibold ${stats.needs_review_count > 0 ? "text-amber-400" : ""}`}>{stats.needs_review_count.toLocaleString()}</p>
              </div>
            </div>
            {/* Customizations row */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Rules &amp; customizations</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Merchant rules", count: merchantRules.filter((r) => !r.is_global).length },
                  { label: "Item rules", count: itemRules.filter((r) => !r.is_global).length },
                  { label: "Custom categories", count: categories.filter((c) => !c.is_system).length },
                  { label: "Budgets", count: budgets.length },
                ].map(({ label, count }) => (
                  <div key={label} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${count > 0 ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"}`}>
                    <span>{label}</span>
                    <span className={`font-semibold ${count > 0 ? "text-primary" : ""}`}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Partners */}
      <PartnersSection />

      {/* Clear data */}
      <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Clear my data</h2>
        <WarningBox>Clearing data removes your expenses <strong>permanently from the server</strong>. This cannot be undone.</WarningBox>
        {clearResult && <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">{clearResult}</div>}
        {clearError && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{clearError}</div>}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-muted-foreground">Period</p>
            <div className="flex flex-wrap gap-2">
              {([{ value: "all", label: "All data" }, { value: "this_month", label: "This month" }, { value: "month", label: "Custom month" }] as { value: Period; label: string }[]).map((opt) => (
                <button key={opt.value} type="button" onClick={() => setPeriod(opt.value)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${period === opt.value ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:bg-accent"}`}>
                  {opt.label}
                </button>
              ))}
            </div>
            {period === "month" && <input type="month" value={customMonth} onChange={(e) => setCustomMonth(e.target.value)} className="mt-2 rounded-lg border border-border bg-background px-3 py-2 text-sm" />}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Filter by merchant (optional)</span>
              <input type="text" value={merchantFilter} onChange={(e) => setMerchantFilter(e.target.value)} placeholder="e.g. Amazon" className="w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Filter by type (optional)</span>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                <option value="">All types</option>
                <option value="debit">Money out only</option>
                <option value="credit">Money in only</option>
              </select>
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="text-muted-foreground">Filter by category (optional)</span>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
        </div>

        {!showClearConfirm ? (
          <button type="button" onClick={() => setShowClearConfirm(true)} className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20">Clear selected data</button>
        ) : (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-3">
            <p className="text-sm font-medium text-red-400">Are you sure? This is permanent and cannot be undone.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowClearConfirm(false)} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
              <button type="button" onClick={handleClearData} disabled={clearing || (period === "month" && !customMonth)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {clearing ? "Deleting…" : "Yes, delete permanently"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Delete account */}
      <section className="rounded-2xl border border-red-500/20 bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-red-400">Delete my account</h2>
        <WarningBox>Deleting your account removes <strong>all your data and your account</strong> permanently from the server. This cannot be undone.</WarningBox>
        {deleteError && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{deleteError}</div>}
        {!showDeleteConfirm ? (
          <button type="button" onClick={() => setShowDeleteConfirm(true)} className="rounded-lg bg-red-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Delete my account</button>
        ) : (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-3">
            <p className="text-sm font-medium text-red-400">Type <strong>DELETE</strong> to confirm permanent account deletion.</p>
            <input type="text" value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder="DELETE" className="w-full rounded-lg border border-red-500/30 bg-background px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button type="button" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(""); }} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
              <button type="button" onClick={handleDeleteAccount} disabled={deleting || deleteConfirmText !== "DELETE"} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {deleting ? "Deleting account…" : "Permanently delete account"}
              </button>
            </div>
          </div>
        )}
      </section>
      <div className="pb-8" />
    </div>
  );
}
