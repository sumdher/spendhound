/**
 * Type augmentation for next-auth to include the backend JWT accessToken,
 * user profile fields, and approval status on the session object.
 */

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    userStatus?: string;
    isAdmin?: boolean;
    user: {
      id?: string;
      avatar_url?: string;
    } & DefaultSession["user"];
  }

  interface User {
    accessToken?: string;
    avatar_url?: string;
    userStatus?: string;
    isAdmin?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    avatar_url?: string;
    userStatus?: string;
    isAdmin?: boolean;
  }
}
