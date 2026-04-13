/**
 * Client-side providers wrapper.
 * Includes SessionProvider for next-auth and ThemeProvider for dark/light toggle.
 */

"use client";

import { SessionProvider } from "next-auth/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
