/**
 * Root page — redirects authenticated users to /dashboard, others to /login.
 */

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

export default async function RootPage() {
  const session = await getServerSession();
  if (session) {
    redirect("/dashboard");
  } else {
    redirect("/login");
  }
}
