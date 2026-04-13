"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { deleteUser, listAllUsers, updateUserStatus, type AdminUser } from "@/lib/api";
import { formatDate } from "@/lib/utils";

type UserStatusFilter = "all" | "pending" | "approved" | "rejected";

const STATUS_STYLES: Record<string, string> = {
  pending: "border border-yellow-500/20 bg-yellow-500/10 text-yellow-300",
  approved: "border border-green-500/20 bg-green-500/10 text-green-300",
  rejected: "border border-orange-500/20 bg-orange-500/10 text-orange-300",
};

const ACTION_BUTTON_STYLES: Record<"approve" | "reject" | "delete", string> = {
  approve: "border-green-500/30 bg-green-500/10 text-green-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-green-400/50 hover:bg-green-500/15",
  reject: "border-orange-500/30 bg-orange-500/10 text-orange-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-orange-400/50 hover:bg-orange-500/15",
  delete: "border-red-500/30 bg-red-500/10 text-red-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-red-400/50 hover:bg-red-500/15",
};

const FILTER_LABELS: Record<UserStatusFilter, string> = {
  all: "All",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

function getInitials(user: AdminUser) {
  return (user.name || user.email || "SH")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() || "")
    .join("");
}

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<UserStatusFilter>("all");

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.isAdmin) {
      router.replace("/dashboard");
      return;
    }
    listAllUsers()
      .then((data) => setUsers(data))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load users"))
      .finally(() => setLoading(false));
  }, [router, session, status]);

  if (status === "loading" || !session?.isAdmin) {
    return <div className="flex min-h-[60vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  const filterCounts: Record<UserStatusFilter, number> = {
    all: users.length,
    pending: users.filter((user) => user.status === "pending").length,
    approved: users.filter((user) => user.status === "approved").length,
    rejected: users.filter((user) => user.status === "rejected").length,
  };

  const filteredUsers = users.filter((user) => activeFilter === "all" || user.status === activeFilter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Admin Panel</h1>
        <p className="text-sm text-muted-foreground">Approve accounts and monitor SpendHound usage.</p>
      </div>
      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div> : null}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-wrap gap-2 border-b border-border pb-4">
          {(Object.keys(FILTER_LABELS) as UserStatusFilter[]).map((filterKey) => {
            const isActive = activeFilter === filterKey;
            return (
              <button
                key={filterKey}
                type="button"
                onClick={() => setActiveFilter(filterKey)}
                className={[
                  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground",
                ].join(" ")}
              >
                <span>{FILTER_LABELS[filterKey]}</span>
                <span className={[
                  "rounded-full px-2 py-0.5 text-xs",
                  isActive ? "bg-primary-foreground/15 text-primary-foreground" : "bg-muted text-foreground",
                ].join(" ")}>
                  {filterCounts[filterKey]}
                </span>
              </button>
            );
          })}
        </div>
        {loading ? <div className="py-20 text-center text-muted-foreground">Loading users…</div> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-border text-left text-muted-foreground"><tr><th className="py-3 pr-4">User</th><th className="py-3 pr-4">Status</th><th className="py-3 pr-4">Expenses</th><th className="py-3 pr-4">Joined</th><th className="py-3 text-right">Actions</th></tr></thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const isSelf = user.email === session.user?.email;
                  const isAdminUser = user.is_admin;
                  const statusLabel = `${user.status.charAt(0).toUpperCase()}${user.status.slice(1)}`;
                  return (
                    <tr key={user.id} className={isAdminUser ? "border-b border-border/50 bg-muted/20 text-muted-foreground" : "border-b border-border/50"}>
                      <td className="py-4 pr-4">
                        <div className="flex items-center gap-3">
                          {user.avatar_url ? (
                            <img
                              src={user.avatar_url}
                              alt={user.name || user.email}
                              className="h-11 w-11 rounded-full border border-border object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-primary/10 text-xs font-semibold text-primary">
                              {getInitials(user) || "SH"}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className={isAdminUser ? "font-medium text-foreground/75" : "font-medium text-foreground"}>{user.name || user.email}</div>
                            <div className="text-xs text-muted-foreground">{user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 pr-4"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[user.status] ?? "border border-border bg-muted text-muted-foreground"}`}>{statusLabel}</span></td>
                      <td className="py-3 pr-4">{user.expense_count}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{formatDate(user.created_at)}</td>
                      <td className="py-3 text-right">
                        {isAdminUser ? (
                          <span className="inline-flex rounded-full border border-border bg-background/70 px-3 py-1 text-xs italic text-muted-foreground">admin account</span>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <button disabled={isSelf || user.status === "approved"} onClick={() => updateUserStatus(user.id, "approved").then(() => setUsers((prev) => prev.map((item) => item.id === user.id ? { ...item, status: "approved" } : item)))} className={`inline-flex min-w-[88px] items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${ACTION_BUTTON_STYLES.approve}`}>Approve</button>
                            <button disabled={isSelf || user.status === "rejected"} onClick={() => updateUserStatus(user.id, "rejected").then(() => setUsers((prev) => prev.map((item) => item.id === user.id ? { ...item, status: "rejected" } : item)))} className={`inline-flex min-w-[88px] items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${ACTION_BUTTON_STYLES.reject}`}>Reject</button>
                            <button disabled={isSelf} onClick={() => { if (window.confirm(`Delete ${user.email} and all data?`)) deleteUser(user.id).then(() => setUsers((prev) => prev.filter((item) => item.id !== user.id))); }} className={`inline-flex min-w-[88px] items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${ACTION_BUTTON_STYLES.delete}`}>Delete</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!filteredUsers.length ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      No users found for the selected filter.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
