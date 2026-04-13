"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/expenses", label: "Expenses", icon: "💸" },
  { href: "/expenses/new", label: "Add expense", icon: "✚" },
  { href: "/budgets", label: "Budgets", icon: "🎯" },
  { href: "/categories", label: "Categories", icon: "🏷️" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const avatarUrl = session?.user?.image || session?.user?.avatar_url;
  const initials = (session?.user?.name || session?.user?.email || "SH")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() || "")
    .join("");

  const handleSignOutClick = () => {
    setConfirmingSignOut(true);
  };

  const handleSignOutCancel = () => {
    if (isSigningOut) return;
    setConfirmingSignOut(false);
  };

  const handleSignOutConfirm = async () => {
    try {
      setIsSigningOut(true);
      await signOut({ callbackUrl: "/login" });
    } finally {
      setIsSigningOut(false);
      setConfirmingSignOut(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-72 flex-col overflow-y-auto border-r border-border bg-card transition-transform duration-300 lg:static lg:h-screen lg:translate-x-0 lg:overflow-hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4">
          <Link href="/dashboard" className="flex items-center gap-3" onClick={onClose}>
            <Image src="/icon.svg?v=2" alt="SpendHound" width={30} height={30} unoptimized />
            <div>
              <div className="text-lg font-semibold">SpendHound</div>
              <div className="text-xs text-muted-foreground">Personal expense tracker</div>
            </div>
          </Link>
          <button onClick={onClose} className="ml-auto rounded-md p-1 hover:bg-accent lg:hidden">✕</button>
        </div>

        <nav className="space-y-1 p-3 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}

          {session?.isAdmin ? (
            <Link
              href="/admin"
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname.startsWith("/admin") ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <span>🛡️</span>
              <span>Admin Panel</span>
            </Link>
          ) : null}
        </nav>

        <div className="mt-auto shrink-0 border-t border-border p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-background p-3">
            {avatarUrl ? (
              <img src={avatarUrl} alt={session?.user?.name || session?.user?.email || "Profile photo"} className="h-11 w-11 rounded-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">{initials || "SH"}</div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{session?.user?.name || session?.user?.email}</div>
              <div className="truncate text-xs text-muted-foreground">{session?.user?.email}</div>
            </div>
          </div>
          {confirmingSignOut ? (
            <div className="mb-3 rounded-xl border border-border bg-background p-3 shadow-sm">
              <p className="text-sm font-medium text-foreground">Sign out of SpendHound?</p>
              <p className="mt-1 text-xs text-muted-foreground">You&apos;ll need to sign in again to access your dashboard.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={handleSignOutCancel}
                  disabled={isSigningOut}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Stay signed in
                </button>
                <button
                  type="button"
                  onClick={handleSignOutConfirm}
                  disabled={isSigningOut}
                  className="w-full rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSigningOut ? "Signing out..." : "Yes, sign out"}
                </button>
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleSignOutClick}
            className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
