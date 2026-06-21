/**
 * NextAuth.js route handler.
 * Configures Google OAuth, exchanges ID token for a backend JWT,
 * and stores the backend token and user status on the session.
 */

import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import type { JWT } from "next-auth/jwt";
import type { Session, Account, User } from "next-auth";

// Server-side (NextAuth callbacks run inside the container): use internal Docker
// service name. Client-side API calls use NEXT_PUBLIC_API_URL via api.ts.
const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: { prompt: "select_account" },
      },
    }),
    CredentialsProvider({
      id: "demo",
      name: "Demo",
      credentials: {},
      async authorize() {
        try {
          const res = await fetch(`${API_URL}/api/auth/demo-login`, { method: "POST" });
          if (!res.ok) return null;
          const data = (await res.json()) as {
            access_token: string;
            user: { id: string; email: string; name: string; avatar_url?: string };
          };
          return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            image: data.user.avatar_url ?? null,
            accessToken: data.access_token,
            userStatus: "approved",
            isAdmin: false,
            isDemo: true,
          };
        } catch {
          return null;
        }
      },
    }),
  ],

  callbacks: {
    async jwt({
      token,
      account,
      user,
      trigger,
    }: {
      token: JWT;
      account: Account | null;
      user: User;
      trigger?: string;
    }) {
      // Demo credentials sign-in: backend JWT already in user object
      if (account?.provider === "demo" && user) {
        token.accessToken = (user as User & { accessToken?: string }).accessToken;
        token.avatar_url = user.image ?? undefined;
        token.userStatus = "approved";
        token.isAdmin = false;
        token.isDemo = true;
        return token;
      }

      // On first sign-in, exchange Google ID token for backend JWT
      if (account?.id_token) {
        try {
          const res = await fetch(`${API_URL}/api/auth/google`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id_token: account.id_token }),
          });

          if (res.ok) {
            const data = (await res.json()) as {
              access_token: string;
              user: { avatar_url?: string; status?: string; is_admin?: boolean };
            };
            token.accessToken = data.access_token;
            token.avatar_url = data.user?.avatar_url ?? undefined;
            token.userStatus = data.user?.status ?? "pending";
            token.isAdmin = data.user?.is_admin ?? false;
          }
        } catch (e) {
          console.error("Backend auth exchange failed", e);
        }
      }

      // On explicit update() call (e.g. after admin approval), re-fetch status
      if (trigger === "update" && token.accessToken) {
        try {
          const res = await fetch(`${API_URL}/api/auth/status`, {
            headers: { Authorization: `Bearer ${String(token.accessToken)}` },
          });
          if (res.ok) {
            const data = (await res.json()) as { status: string; is_admin?: boolean };
            token.userStatus = data.status;
            token.isAdmin = data.is_admin ?? false;
          }
        } catch {
          // Non-critical — keep existing token as-is
        }
      }

      return token;
    },

    async session({ session, token }: { session: Session; token: JWT }) {
      session.accessToken = token.accessToken;
      session.userStatus = token.userStatus;
      session.isAdmin = token.isAdmin;
      session.isDemo = token.isDemo;
      if (session.user) {
        session.user.avatar_url = token.avatar_url;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },

  session: {
    strategy: "jwt",
  },
});

export { handler as GET, handler as POST };
