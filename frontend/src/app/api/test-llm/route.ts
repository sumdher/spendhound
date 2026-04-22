import { getToken } from "next-auth/jwt";
import { NextRequest } from "next/server";

const API_URL = process.env.INTERNAL_API_URL ?? "http://backend:8000";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const accessToken = typeof token?.accessToken === "string" ? token.accessToken : null;

  if (!accessToken) {
    return Response.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return Response.json({ detail: "Invalid request body" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/api/auth/me/test-llm`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Connection: "close",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "LLM test failed";
    return Response.json({ success: false, error: message }, { status: 502 });
  }

  const data = await upstream.json().catch(() => ({ success: false, error: upstream.statusText }));
  return Response.json(data, { status: upstream.status });
}
