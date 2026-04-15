import { getToken } from "next-auth/jwt";
import { NextRequest } from "next/server";

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://backend:8000";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ChatProxyRequestBody {
  mode?: "chat" | "summary";
  sessionId?: string;
  message?: string;
  clientId?: string;
  parentClientId?: string | null;
  assistantClientId?: string;
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export async function POST(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const accessToken = typeof token?.accessToken === "string" ? token.accessToken : null;

  if (!accessToken) {
    return Response.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ChatProxyRequestBody | null;
  if (!body || (body.mode !== "chat" && body.mode !== "summary")) {
    return Response.json({ detail: "Invalid chat stream request" }, { status: 400 });
  }

  let targetPath = "/api/chat/summarize/stream";
  let upstreamBody: Record<string, unknown> = {
    session_id: body.sessionId,
    prompt: body.prompt,
    temperature: body.temperature ?? 0.1,
    max_tokens: body.maxTokens ?? 1024,
  };

  if (body.mode === "chat") {
    if (!body.sessionId || !body.message?.trim()) {
      return Response.json({ detail: "Session and message are required" }, { status: 400 });
    }

    targetPath = `/api/chat/sessions/${encodeURIComponent(body.sessionId)}/stream`;
    upstreamBody = {
      message: body.message,
      client_id: body.clientId,
      parent_client_id: body.parentClientId,
      assistant_client_id: body.assistantClientId,
      temperature: body.temperature ?? 0.1,
      max_tokens: body.maxTokens ?? 4096,
    };
  }

  const upstream = await fetch(`${API_URL}${targetPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(upstreamBody),
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => upstream.statusText);
    return Response.json({ detail: detail || "Unable to start chat stream" }, { status: upstream.status || 502 });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
