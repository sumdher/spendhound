"use client";

import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function PendingPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [state, setState] = useState<"pending" | "approved" | "rejected">("pending");
  const redirecting = useRef(false);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
    if (status === "authenticated" && session?.userStatus === "approved") router.replace("/dashboard");
  }, [router, session, status]);

  useEffect(() => {
    if (!session?.accessToken) return;
    const poll = async () => {
      const response = await fetch("/backend/api/auth/status", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      }).catch(() => null);
      if (!response?.ok) return;
      const data = (await response.json()) as { status: string };
      if (data.status === "approved") {
        setState("approved");
        if (!redirecting.current) {
          redirecting.current = true;
          setTimeout(async () => {
            await update();
            router.replace("/dashboard");
          }, 1200);
        }
      } else if (data.status === "rejected") {
        setState("rejected");
      }
    };
    poll();
    const id = setInterval(poll, 10000);
    return () => clearInterval(id);
  }, [router, session, update]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-border bg-card p-8 text-center shadow-2xl">
        <div className="text-5xl">{state === "approved" ? "✅" : state === "rejected" ? "⛔" : "⏳"}</div>
        <h1 className="text-2xl font-bold">
          {state === "approved" ? "Access granted" : state === "rejected" ? "Access denied" : "Awaiting approval"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {state === "approved"
            ? "Your SpendHound account is ready. Redirecting now."
            : state === "rejected"
              ? "Your access request was declined by the admin."
              : "An admin must approve your SpendHound account before you can track expenses."}
        </p>
        {session?.user?.email ? <p className="text-xs text-muted-foreground">Signed in as {session.user.email}</p> : null}
        <button onClick={() => signOut({ callbackUrl: "/login" })} className="w-full rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm font-medium hover:bg-accent">
          Back to login
        </button>
      </div>
    </div>
  );
}
