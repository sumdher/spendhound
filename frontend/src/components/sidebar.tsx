"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteChatSession, listChatSessions, type ChatSession } from "@/lib/api";
import { CHAT_SESSIONS_UPDATED_EVENT, emitAppEvent, subscribeAppEvent } from "@/lib/app-events";
import { cn } from "@/lib/utils";

const STATIC_NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/expenses", label: "Expenses", icon: "💸" },
  { href: "/expenses/new", label: "Add expense", icon: "✚" },
  { href: "/budgets", label: "Budgets", icon: "🎯" },
  { href: "/rules", label: "Rules", icon: "🧭" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
    </svg>
  );
}

interface DeleteState {
  id: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  const activeSessionId = pathname.startsWith("/chat") ? searchParams.get("s") : null;
  const avatarUrl = session?.user?.image || session?.user?.avatar_url;
  const initials = (session?.user?.name || session?.user?.email || "SH")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() || "")
    .join("");

  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [chatLoading, setChatLoading] = useState(true);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const value = localStorage.getItem("spendhound_sidebar_chat_open");
    return value === null ? true : value === "true";
  });
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [confirmSession, setConfirmSession] = useState<DeleteState>({ id: null, timer: null });

  const confirmSessionRef = useRef(confirmSession);
  confirmSessionRef.current = confirmSession;

  const loadChatSessions = useCallback(async () => {
    try {
      setChatLoading(true);
      const sessions = await listChatSessions();
      setChatSessions(sessions);
      setChatError(null);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Failed to load chats");
    } finally {
      setChatLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChatSessions();
  }, [loadChatSessions]);

  useEffect(
    () => subscribeAppEvent(CHAT_SESSIONS_UPDATED_EVENT, () => {
      void loadChatSessions();
    }),
    [loadChatSessions],
  );

  useEffect(() => {
    return () => {
      if (confirmSessionRef.current.timer) clearTimeout(confirmSessionRef.current.timer);
    };
  }, []);

  useEffect(() => {
    onClose();
    setShowSignOutConfirm(false);
  }, [onClose, pathname, searchParams]);

  const handleNewChat = useCallback(() => {
    router.push("/chat?new=1");
  }, [router]);

  const toggleChat = useCallback(() => {
    const next = !chatOpen;
    setChatOpen(next);
    localStorage.setItem("spendhound_sidebar_chat_open", String(next));
  }, [chatOpen]);

  const startDeleteSession = useCallback((id: string) => {
    if (confirmSessionRef.current.timer) clearTimeout(confirmSessionRef.current.timer);
    const timer = setTimeout(() => {
      setConfirmSession({ id: null, timer: null });
    }, 3000);
    setConfirmSession({ id, timer });
  }, []);

  const cancelDeleteSession = useCallback(() => {
    if (confirmSessionRef.current.timer) clearTimeout(confirmSessionRef.current.timer);
    setConfirmSession({ id: null, timer: null });
  }, []);

  const confirmDeleteSession = useCallback(
    async (id: string) => {
      if (confirmSessionRef.current.timer) clearTimeout(confirmSessionRef.current.timer);
      setConfirmSession({ id: null, timer: null });

      try {
        await deleteChatSession(id);
        emitAppEvent(CHAT_SESSIONS_UPDATED_EVENT, { sessionId: id, reason: "deleted" });
        setChatSessions((current) => current.filter((session) => session.id !== id));
        if (activeSessionId === id) {
          router.replace("/chat");
        }
      } catch (error) {
        setChatError(error instanceof Error ? error.message : "Failed to delete chat");
      }
    },
    [activeSessionId, router],
  );

  const isChatActive = pathname === "/chat";
  const hasEmptyChat = chatSessions.some((chatSession) => chatSession.message_count === 0);

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 lg:hidden",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-full w-72 flex-col border-r border-border bg-card",
          "transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 lg:transition-none",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-4">
          <Link href="/dashboard" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <Image src="/icon.svg" alt="SpendHound" width={38} height={38} priority unoptimized />
            <span className="text-xl font-bold tracking-tight">SpendHound</span>
          </Link>
          <button
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground lg:hidden"
            aria-label="Close menu"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {STATIC_NAV.slice(0, 4).map((item) => {
            const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}

          <div>
            <div
              className={cn(
                "flex items-center rounded-lg text-sm font-medium transition-colors",
                isChatActive ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <button onClick={handleNewChat} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left">
                <span className="text-base">💬</span>
                <span className="truncate">AI Chat</span>
              </button>
              <button
                onClick={toggleChat}
                className="shrink-0 rounded-r-lg px-3 py-2"
                aria-label={chatOpen ? "Collapse Expense Chat" : "Expand Expense Chat"}
              >
                <ChevronIcon open={chatOpen} />
              </button>
            </div>

            {chatOpen && (
              <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2">
                {chatLoading ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground/70">Loading chats…</p>
                ) : chatError ? (
                  <p className="px-2 py-1.5 text-xs text-destructive">{chatError}</p>
                ) : chatSessions.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs italic text-muted-foreground/60">No chats yet</p>
                ) : (
                  chatSessions.map((chatSession) => {
                    const isItemActive = isChatActive && activeSessionId === chatSession.id;
                    const isConfirming = confirmSession.id === chatSession.id;

                    return (
                      <div
                        key={chatSession.id}
                        className={cn(
                          "group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
                          isItemActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        <Link
                          href={`/chat?s=${encodeURIComponent(chatSession.id)}`}
                          className="min-w-0 flex-1 truncate"
                          title={chatSession.title}
                        >
                          {chatSession.title}
                        </Link>
                        {isConfirming ? (
                          <span className="flex shrink-0 items-center gap-0.5">
                            <button
                              onClick={cancelDeleteSession}
                              title="Cancel"
                              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                            >
                              ✕
                            </button>
                            <button
                              onClick={() => void confirmDeleteSession(chatSession.id)}
                              title="Confirm delete"
                              className="rounded p-0.5 text-destructive hover:text-destructive/80"
                            >
                              ✓
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={(event) => {
                              event.preventDefault();
                              startDeleteSession(chatSession.id);
                            }}
                            title="Delete chat"
                            className="shrink-0 rounded p-0.5 text-transparent transition-colors group-hover:text-muted-foreground hover:!text-destructive"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })
                )}

                {!chatLoading && !hasEmptyChat && (
                  <button
                    onClick={handleNewChat}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <span className="font-medium">+ New Chat</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {STATIC_NAV.slice(4).map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}

          {session?.isAdmin && (
            <Link
              href="/admin"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname.startsWith("/admin") ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <span className="text-base">🛡️</span>
              Admin Panel
            </Link>
          )}
        </nav>

        {session?.user && (
          <div className="border-t border-border p-3">
            <div className="space-y-2">
              <Link
                href="/account"
                className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent transition-colors"
                title="My account"
              >
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={session.user.name ?? session.user.email ?? "User"}
                      className="h-8 w-8 shrink-0 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-primary">
                      {initials || "SH"}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{session.user.name || session.user.email}</p>
                    <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
                  </div>

                <button
                  onClick={(e) => { e.preventDefault(); setShowSignOutConfirm((current) => !current); }}
                  className={cn(
                    "shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors",
                    showSignOutConfirm ? "bg-destructive/10 text-destructive" : "hover:bg-accent hover:text-foreground",
                  )}
                  title={showSignOutConfirm ? "Close sign out confirmation" : "Sign out"}
                  aria-expanded={showSignOutConfirm}
                  aria-label={showSignOutConfirm ? "Close sign out confirmation" : "Sign out"}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                  </svg>
                </button>
              </Link>

              {showSignOutConfirm && (
                <div className="rounded-xl border border-border bg-muted/40 p-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                        />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">Sign out of SpendHound?</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        You&apos;ll be returned to the login screen and can sign back in at any time.
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setShowSignOutConfirm(false)}
                      className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => signOut({ callbackUrl: "/login" })}
                      className="flex-1 rounded-md bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
