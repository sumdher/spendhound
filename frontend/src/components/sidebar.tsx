"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import Image from "next/image";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/expenses", label: "Expenses", icon: "💸" },
  { href: "/expenses/new", label: "Add expense", icon: "✚" },
  { href: "/receipts", label: "Receipts", icon: "🧾" },
  { href: "/budgets", label: "Budgets", icon: "🎯" },
  { href: "/categories", label: "Categories", icon: "🏷️" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();

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
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-card transition-transform duration-300 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-border px-4">
          <Link href="/dashboard" className="flex items-center gap-3" onClick={onClose}>
            <Image src="/icon.svg" alt="SpendHound" width={30} height={30} unoptimized />
            <div>
              <div className="text-lg font-semibold">SpendHound</div>
              <div className="text-xs text-muted-foreground">Personal expense tracker</div>
            </div>
          </Link>
          <button onClick={onClose} className="ml-auto rounded-md p-1 hover:bg-accent lg:hidden">✕</button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
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
              <span>Admin</span>
            </Link>
          ) : null}
        </nav>

        <div className="border-t border-border p-4">
          <div className="mb-3 text-xs text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{session?.user?.email}</span>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
