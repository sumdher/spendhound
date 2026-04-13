"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { deleteUser, listAllUsers, updateUserStatus, type AdminUser } from "@/lib/api";
import { formatDate } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-500/15 text-yellow-400",
  approved: "bg-green-500/15 text-green-400",
  rejected: "bg-orange-500/15 text-orange-400",
};

const ACTION_BUTTON_STYLES = {
  approve: "border-green-500/30 text-green-400 hover:bg-green-500/10",
  reject: "border-orange-500/30 text-orange-400 hover:bg-orange-500/10",
  delete: "border-red-500/30 text-red-400 hover:bg-red-500/10",
};

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Admin</h1>
        <p className="text-sm text-muted-foreground">Approve accounts and monitor SpendHound usage.</p>
      </div>
      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div> : null}
      <div className="rounded-2xl border border-border bg-card p-4">
        {loading ? <div className="py-20 text-center text-muted-foreground">Loading users…</div> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-border text-left text-muted-foreground"><tr><th className="py-3 pr-4">User</th><th className="py-3 pr-4">Status</th><th className="py-3 pr-4">Expenses</th><th className="py-3 pr-4">Joined</th><th className="py-3 text-right">Actions</th></tr></thead>
              <tbody>
                {users.map((user) => {
                  const isSelf = user.email === session.user?.email;
                  const statusLabel = `${user.status.charAt(0).toUpperCase()}${user.status.slice(1)}`;
                  return (
                    <tr key={user.id} className="border-b border-border/50">
                      <td className="py-3 pr-4"><div className="font-medium">{user.name || user.email}</div><div className="text-xs text-muted-foreground">{user.email}</div></td>
                      <td className="py-3 pr-4"><span className={`rounded-full px-2 py-1 text-xs ${STATUS_STYLES[user.status] ?? "bg-muted text-muted-foreground"}`}>{statusLabel}</span></td>
                      <td className="py-3 pr-4">{user.expense_count}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{formatDate(user.created_at)}</td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button disabled={isSelf || user.status === "approved"} onClick={() => updateUserStatus(user.id, "approved").then(() => setUsers((prev) => prev.map((item) => item.id === user.id ? { ...item, status: "approved" } : item)))} className={`rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50 ${ACTION_BUTTON_STYLES.approve}`}>Approve</button>
                          <button disabled={isSelf || user.status === "rejected"} onClick={() => updateUserStatus(user.id, "rejected").then(() => setUsers((prev) => prev.map((item) => item.id === user.id ? { ...item, status: "rejected" } : item)))} className={`rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50 ${ACTION_BUTTON_STYLES.reject}`}>Reject</button>
                          <button disabled={isSelf} onClick={() => { if (window.confirm(`Delete ${user.email} and all data?`)) deleteUser(user.id).then(() => setUsers((prev) => prev.filter((item) => item.id !== user.id))); }} className={`rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50 ${ACTION_BUTTON_STYLES.delete}`}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
