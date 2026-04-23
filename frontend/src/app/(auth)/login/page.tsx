"use client";

import { signIn, useSession } from "next-auth/react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function LoginContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const approved = searchParams.get("approved") === "1";
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  useEffect(() => {
    if (session) router.replace("/dashboard");
  }, [router, session]);

  if (status === "loading") {
    return <div className="flex min-h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-border bg-card p-8 shadow-2xl">
        <div className="text-center">
          <div className="mb-4 flex justify-center"><Image src="/icon.svg" alt="SpendHound" width={64} height={64} /></div>
          <h1 className="text-3xl font-bold">SpendHound</h1>
          <p className="mt-2 text-sm text-muted-foreground">Track spending, review receipts, and stay on budget.</p>
        </div>

        {approved ? <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">Your account has been approved. Sign in to continue.</div> : null}

        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>• Add expenses manually or from receipt uploads</li>
          <li>• Review low-confidence OCR and category suggestions</li>
          <li>• See monthly analytics, budgets, recurring spend, and exports</li>
        </ul>

        <button
          onClick={() => signIn("google", { callbackUrl })}
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-secondary px-4 py-3 text-sm font-medium hover:bg-accent"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>}><LoginContent /></Suspense>;
}
