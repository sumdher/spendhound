"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  consumeSSE,
  createChatSession,
  getChatHistory,
  listChatSessions,
  streamChatSession,
  type ChatHistory,
  type ChatMessage,
  type ChatSession,
} from "@/lib/api";
import {
  CHAT_SESSIONS_UPDATED_EVENT,
  emitAppEvent,
  subscribeAppEvent,
} from "@/lib/app-events";
import { cn } from "@/lib/utils";

const CHAT_DRAFTS_STORAGE_KEY = "spendhound_chat_drafts_v1";
const MAX_TEXTAREA_HEIGHT = 180;

const SUGGESTIONS = [
  "What categories are driving this month's spending?",
  "Which merchants look recurring right now?",
  "Where am I most at risk of overspending?",
  "What stands out in my recent receipt activity?",
];

type DraftMap = Record<string, string>;

function createClientId(prefix: "user" | "assistant") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sortMessages(messages: ChatMessage[]) {
  return [...messages].sort((left, right) => {
    const leftTime = new Date(left.created_at).getTime();
    const rightTime = new Date(right.created_at).getTime();

    if (leftTime !== rightTime) return leftTime - rightTime;

    if (left.role !== right.role) {
      if (left.role === "user" && right.parent_client_id === left.client_id) return -1;
      if (right.role === "user" && left.parent_client_id === right.client_id) return 1;
      if (left.role === "user") return -1;
      if (right.role === "user") return 1;
    }

    return left.client_id.localeCompare(right.client_id);
  });
}

function loadDraftMap(): DraftMap {
  if (typeof window === "undefined") return {};

  try {
    const raw = localStorage.getItem(CHAT_DRAFTS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DraftMap) : {};
  } catch {
    return {};
  }
}

function saveDraftMap(drafts: DraftMap) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CHAT_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
}

function estimateTokens(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function getLiveContextTokenCount(
  persistedTokenCount: number,
  draftInput: string,
  streamingContent: string,
) {
  return persistedTokenCount + estimateTokens(draftInput) + estimateTokens(streamingContent);
}

function ContextBar({ tokenCount, maxTokens }: { tokenCount: number; maxTokens: number }) {
  const pct = maxTokens > 0 ? Math.min(100, (tokenCount / maxTokens) * 100) : 0;

  let barColor = "bg-green-500";
  let textColor = "text-green-400";
  if (pct >= 90) {
    barColor = "bg-red-500";
    textColor = "text-red-400";
  } else if (pct >= 80) {
    barColor = "bg-orange-500";
    textColor = "text-orange-400";
  } else if (pct >= 60) {
    barColor = "bg-yellow-500";
    textColor = "text-yellow-400";
  }

  const formatK = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(0)}k` : String(value));

  return (
    <div className="mb-2 flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all duration-500", barColor)}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className={cn("shrink-0 text-xs font-medium tabular-nums", textColor)}>
        {maxTokens > 0
          ? `~${formatK(tokenCount)} / ${formatK(maxTokens)} configured tokens`
          : `~${formatK(tokenCount)} tokens tracked`}
      </span>
    </div>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSessionId = searchParams.get("s");
  const wantsNewSession = searchParams.get("new") === "1";

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [drafts, setDrafts] = useState<DraftMap>(() => loadDraftMap());
  const [composer, setComposer] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingAssistantClientId, setStreamingAssistantClientId] = useState<string | null>(null);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const createInFlightRef = useRef(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const updateDraft = useCallback((sessionId: string | null, nextValue: string) => {
    setComposer(nextValue);
    if (!sessionId) return;

    setDrafts((current) => {
      const nextDrafts = { ...current, [sessionId]: nextValue };
      saveDraftMap(nextDrafts);
      return nextDrafts;
    });
  }, []);

  const adjustComposerHeight = useCallback(() => {
    const textarea = composerRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      setLoadingSessions(true);
      const chatSessions = await listChatSessions();
      setSessions(chatSessions);
      setError(null);
      return chatSessions;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load chat sessions");
      return [] as ChatSession[];
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  const loadHistory = useCallback(async (sessionId: string) => {
    try {
      setLoadingHistory(true);
      const history: ChatHistory = await getChatHistory(sessionId);
      setActiveSession(history.session);
      setMessages(sortMessages(history.messages));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load chat history");
      setMessages([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const createAndOpenSession = useCallback(async () => {
    if (createInFlightRef.current) return;

    try {
      createInFlightRef.current = true;
      setCreatingSession(true);
      const session = await createChatSession();
      emitAppEvent(CHAT_SESSIONS_UPDATED_EVENT, { sessionId: session.id, reason: "created" });
      router.replace(`/chat?s=${encodeURIComponent(session.id)}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create chat session");
    } finally {
      createInFlightRef.current = false;
      setCreatingSession(false);
    }
  }, [router]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(
    () => subscribeAppEvent(CHAT_SESSIONS_UPDATED_EVENT, () => {
      void loadSessions();
    }),
    [loadSessions],
  );

  useEffect(() => {
    if (loadingSessions) return;

    if (wantsNewSession) {
      void createAndOpenSession();
      return;
    }

    if (!activeSessionId) {
      if (sessions.length > 0) {
        router.replace(`/chat?s=${encodeURIComponent(sessions[0].id)}`);
      } else {
        void createAndOpenSession();
      }
    }
  }, [activeSessionId, createAndOpenSession, loadingSessions, router, sessions, wantsNewSession]);

  useEffect(() => {
    if (!activeSessionId || wantsNewSession) return;
    void loadHistory(activeSessionId);
  }, [activeSessionId, loadHistory, wantsNewSession]);

  useEffect(() => {
    setComposer(activeSessionId ? drafts[activeSessionId] ?? "" : "");
  }, [activeSessionId, drafts]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streamingAssistantClientId]);

  useEffect(() => {
    adjustComposerHeight();
  }, [activeSessionId, adjustComposerHeight, composer]);

  const sendPrompt = useCallback(
    async (
      content: string,
      options?: {
        parentClientId?: string | null;
        resetComposer?: boolean;
      },
    ) => {
      if (!activeSessionId) return;

      const trimmed = content.trim();
      if (!trimmed || sending) return;

      const now = new Date().toISOString();
      const userClientId = createClientId("user");
      const assistantClientId = createClientId("assistant");

      const optimisticUser: ChatMessage = {
        id: `temp-${userClientId}`,
        session_id: activeSessionId,
        role: "user",
        content: trimmed,
        client_id: userClientId,
        parent_client_id: options?.parentClientId ?? null,
        metadata: { optimistic: true },
        created_at: now,
        updated_at: now,
      };

      const optimisticAssistant: ChatMessage = {
        id: `temp-${assistantClientId}`,
        session_id: activeSessionId,
        role: "assistant",
        content: "",
        client_id: assistantClientId,
        parent_client_id: userClientId,
        metadata: { optimistic: true },
        created_at: now,
        updated_at: now,
      };

      setMessages((current) => [...current, optimisticUser, optimisticAssistant]);
      setStreamingAssistantClientId(assistantClientId);
      setSending(true);
      setError(null);
      setEditingClientId(null);
      setEditingText("");

      if (options?.resetComposer ?? true) {
        updateDraft(activeSessionId, "");
      }

      let completed = false;

      try {
        const response = await streamChatSession(activeSessionId, {
          message: trimmed,
          clientId: userClientId,
          parentClientId: options?.parentClientId,
          assistantClientId,
          temperature: 0.1,
          maxTokens: 4096,
        });

        await consumeSSE(response, {
          onMeta: (meta) => {
            if (meta.session) {
              setActiveSession(meta.session);
            }
          },
          onToken: (data) => {
            const chunk = data.text ?? data.token ?? "";
            if (!chunk) return;

            setMessages((current) =>
              current.map((message) =>
                message.client_id === assistantClientId
                  ? {
                      ...message,
                      content: `${message.content}${chunk}`,
                      updated_at: new Date().toISOString(),
                    }
                  : message,
              ),
            );
          },
          onError: (streamError) => {
            setError(streamError.error ?? "Expense chat streaming failed");
          },
          onDone: async (doneEvent) => {
            if (!doneEvent.ok) return;

            completed = true;
            if (doneEvent.session) {
              setActiveSession(doneEvent.session);
            }

            await Promise.all([loadSessions(), loadHistory(activeSessionId)]);
            emitAppEvent(CHAT_SESSIONS_UPDATED_EVENT, { sessionId: activeSessionId, reason: "updated" });
          },
        });
      } catch (sendError) {
        setError(sendError instanceof Error ? sendError.message : "Failed to send message");
      } finally {
        setSending(false);
        setStreamingAssistantClientId(null);
        if (!completed) {
          void loadHistory(activeSessionId);
        }
      }
    },
    [activeSessionId, loadHistory, loadSessions, sending, updateDraft],
  );

  const handleRetry = useCallback(
    (message: ChatMessage) => {
      if (message.role !== "assistant" || !message.parent_client_id) return;
      const userMessage = messages.find((item) => item.client_id === message.parent_client_id && item.role === "user");
      if (!userMessage) return;

      void sendPrompt(userMessage.content, {
        parentClientId: userMessage.parent_client_id ?? null,
        resetComposer: false,
      });
    },
    [messages, sendPrompt],
  );

  const handleSaveEdit = useCallback(
    async (message: ChatMessage) => {
      const nextContent = editingText.trim();
      if (!nextContent || sending) return;

      await sendPrompt(nextContent, {
        parentClientId: message.parent_client_id ?? null,
        resetComposer: false,
      });
    },
    [editingText, sendPrompt, sending],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void sendPrompt(composer);
      }
    },
    [composer, sendPrompt],
  );

  const persistedTokenCount = activeSession?.token_count ?? 0;
  const maxTokens = activeSession?.max_tokens ?? 0;
  const streamingMessage =
    messages.find((message) => message.client_id === streamingAssistantClientId)?.content ?? "";
  const liveTokenCount = getLiveContextTokenCount(persistedTokenCount, composer, streamingMessage);
  const ready = Boolean(activeSessionId) && !creatingSession;
  const messageCount = messages.length;
  const sessionTitle = activeSession?.title ?? "Expense Chat";
  const isEmptySession = Boolean(activeSession) && messageCount === 0 && !loadingHistory;

  if (loadingSessions && !activeSessionId) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-4 py-6 md:px-6">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 px-4 pb-3 pt-4 md:px-6 md:pt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold">{sessionTitle}</h1>
            <p className="text-sm text-muted-foreground">Ask questions about your expenses and spending</p>
          </div>
          <button
            type="button"
            onClick={() => void createAndOpenSession()}
            disabled={creatingSession || isEmptySession}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creatingSession ? "Creating…" : "+ New Chat"}
          </button>
        </div>

        {ready && (messageCount > 0 || persistedTokenCount > 0 || composer.trim().length > 0) && (
          <ContextBar tokenCount={liveTokenCount} maxTokens={maxTokens} />
        )}
      </div>

      <div className="min-h-0 flex-1 px-4 pb-4 md:px-6 md:pb-6">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
            {loadingHistory ? (
              <div className="flex h-full min-h-[20rem] items-center justify-center text-sm text-muted-foreground">
                Loading expense chat…
              </div>
            ) : messageCount === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-6">
                <div className="text-center">
                  <div className="mb-2 text-4xl">💬</div>
                  <h2 className="text-lg font-semibold">Start a conversation</h2>
                  <p className="text-sm text-muted-foreground">Ask anything about your spending</p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void sendPrompt(suggestion)}
                      className="rounded-lg border border-border bg-secondary px-4 py-2 text-left text-sm transition-colors hover:bg-accent"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => {
                  const isUser = message.role === "user";
                  const isEditing = editingClientId === message.client_id;

                  return (
                    <div
                      key={message.client_id}
                      className={cn("flex", isUser ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[85%] rounded-2xl px-4 py-2.5 sm:max-w-[80%]",
                          isUser ? "bg-primary text-sm text-primary-foreground" : "bg-secondary text-foreground",
                        )}
                      >
                        {isUser ? (
                          isEditing ? (
                            <div className="space-y-3">
                              <textarea
                                value={editingText}
                                onChange={(event) => setEditingText(event.target.value)}
                                rows={3}
                                className="w-full resize-y rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-primary-foreground placeholder:text-primary-foreground/70 focus:outline-none focus:ring-2 focus:ring-white/40"
                              />
                              <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingClientId(null);
                                    setEditingText("");
                                  }}
                                  className="rounded-md border border-white/25 px-2.5 py-1 text-primary-foreground/90 transition-colors hover:bg-white/10"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleSaveEdit(message)}
                                  disabled={!editingText.trim() || sending}
                                  className="rounded-md bg-white/15 px-2.5 py-1 font-medium text-primary-foreground transition-colors hover:bg-white/20 disabled:opacity-50"
                                >
                                  Save & restart
                                </button>
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm">{message.content}</span>
                          )
                        ) : message.content ? (
                          <>
                            <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
                            {message.client_id === streamingAssistantClientId && (
                              <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current" />
                            )}
                          </>
                        ) : (
                          <span className="flex gap-1 px-1 py-1">
                            <span className="animate-bounce text-lg leading-none">·</span>
                            <span className="animate-bounce text-lg leading-none [animation-delay:0.1s]">·</span>
                            <span className="animate-bounce text-lg leading-none [animation-delay:0.2s]">·</span>
                          </span>
                        )}

                        {!isEditing && !(message.client_id === streamingAssistantClientId && !message.content) && (
                          <div
                            className={cn(
                              "mt-3 flex flex-wrap items-center gap-2 text-xs",
                              isUser ? "text-primary-foreground/85" : "text-muted-foreground",
                            )}
                          >
                            {isUser ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingClientId(message.client_id);
                                  setEditingText(message.content);
                                }}
                                disabled={sending}
                                className="rounded-md border border-current/20 px-2 py-1 transition-colors hover:bg-white/10 disabled:opacity-50"
                              >
                                Edit
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleRetry(message)}
                                disabled={sending}
                                className="rounded-md border border-current/20 px-2 py-1 transition-colors hover:bg-black/5 disabled:opacity-50"
                              >
                                Try again
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-border bg-background/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur sm:px-4">
            {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

            <div className="flex items-end gap-2">
              <textarea
                ref={composerRef}
                value={composer}
                onChange={(event) => updateDraft(activeSessionId, event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your expenses… (Shift+Enter for newline)"
                disabled={sending || !ready}
                rows={1}
                style={{ maxHeight: `${MAX_TEXTAREA_HEIGHT}px` }}
                className="flex-1 resize-none overflow-y-auto rounded-xl border border-border bg-input px-4 py-3 text-sm leading-relaxed placeholder:text-muted-foreground transition-[height] focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void sendPrompt(composer)}
                disabled={!composer.trim() || sending || !ready}
                className="shrink-0 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
