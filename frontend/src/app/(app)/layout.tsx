"use client";

import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar";

function secsUntilNextReset(): number {
  const now = new Date();
  const utcMin = now.getUTCMinutes();
  const utcSec = now.getUTCSeconds();
  const minsLeft = utcMin < 30 ? 30 - utcMin : 60 - utcMin;
  return minsLeft * 60 - utcSec;
}

function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isChatRoute = pathname === "/chat";
  const isDemo = session?.isDemo === true;
  const demoCharacter = session?.demoCharacter ?? "bruce";
  const handleSidebarClose = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  const [demoSecondsLeft, setDemoSecondsLeft] = useState(secsUntilNextReset);

  useEffect(() => {
    if (!isDemo) return;
    const id = setInterval(() => setDemoSecondsLeft(secsUntilNextReset()), 1000);
    return () => clearInterval(id);
  }, [isDemo]);

  const nearReset = demoSecondsLeft <= 120;

  useEffect(() => {
    if (status === "unauthenticated") {
      const callbackUrl = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?callbackUrl=${callbackUrl}`);
    } else if (status === "authenticated" && session?.userStatus !== "approved") {
      router.replace("/pending");
    }
  }, [router, session, status]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session || session.userStatus !== "approved") return null;

  const isBruce = demoCharacter === "bruce";
  const demoBorderColor = isBruce ? "border-yellow-700/40" : "border-red-800/40";
  const demoBgColor = isBruce ? "bg-yellow-950/95" : "bg-red-950/90";
  const demoTextColor = isBruce ? "text-yellow-200/90" : "text-red-200/90";
  const demoNameColor = isBruce ? "text-yellow-100" : "text-red-100";
  const demoTimerColor = isBruce ? "text-yellow-400" : "text-red-400";
  const demoExitBorder = isBruce ? "border-yellow-600/40" : "border-red-600/40";
  const demoExitHover = isBruce ? "hover:bg-yellow-500/20 hover:text-yellow-300" : "hover:bg-red-500/20 hover:text-red-300";
  const demoNearResetMsg = isBruce
    ? "⚡ Barry Allen is running around — this timeline will be erased."
    : "⚡ The multiverse is collapsing — this timeline will be erased.";
  const demoEmoji = isBruce ? "🦇" : "🕷️";
  const demoName = isBruce ? "Bruce Wayne" : "Peter Parker";

  return (
    <div className={`flex h-dvh flex-col overflow-hidden bg-background${isDemo ? (nearReset ? " pt-12" : " pt-8") : ""}`}>
      {isDemo && (
        <div className={`fixed inset-x-0 top-0 z-[60] border-b ${demoBorderColor} ${demoBgColor} backdrop-blur-sm`}>
          <div className={`flex items-center justify-center gap-3 px-4 py-1.5 text-xs ${demoTextColor}`}>
            <span className="text-sm">{demoEmoji}</span>
            <span>
              Demo mode — browsing as <span className={`font-semibold ${demoNameColor}`}>{demoName}</span>.
              {" "}Resets in{" "}
              <span className={`font-mono ${nearReset ? "font-bold text-red-300" : ""}`}>
                {formatCountdown(demoSecondsLeft)}
              </span>.
            </span>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className={`ml-1 rounded border ${demoExitBorder} px-2 py-0.5 ${demoTimerColor} transition-colors ${demoExitHover}`}
            >
              Exit demo
            </button>
          </div>
          {nearReset && (
            <div className="pb-1.5 text-center text-xs text-yellow-400/70">
              {demoNearResetMsg}
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar open={sidebarOpen} onClose={handleSidebarClose} />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label="Open menu"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <a href="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Image src="/icon.svg" alt="SpendHound" width={24} height={24} unoptimized />
              <span className="text-base font-bold tracking-tight">SpendHound</span>
            </a>
          </header>

          <main className={isChatRoute ? "flex-1 min-h-0 overflow-hidden" : "flex-1 overflow-y-auto"}>
            <div className={isChatRoute ? "h-full min-h-0" : "p-4 md:p-6"}>{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
