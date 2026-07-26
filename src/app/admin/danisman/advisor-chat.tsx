"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ArrowUp,
  Bot,
  Clock,
  Download,
  MessageSquarePlus,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  User,
  Zap,
} from "lucide-react";
import {
  listAdvisorSessions,
  loadAdvisorSession,
  deleteAdvisorSession,
  type SessionSummary,
  type PersistedMessage,
} from "@/app/actions/ai-advisor";
import type { AdvisorMessage } from "@/lib/ai-advisor";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  "Bu ay gelirimi nasıl artırırım?",
  "Müşteri kaybı riskini azaltmak için ne yapmalıyım?",
  "Satış hunimi değerlendir ve öneri ver",
  "Bugün öncelik vermem gereken 3 şey nedir?",
];

function renderContent(text: string, streaming = false) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const cursor =
      streaming && i === lines.length - 1 ? (
        <span key="cursor" className="ml-0.5 animate-pulse text-brand-600">▍</span>
      ) : null;
    if (!line.trim()) {
      return cursor ? (
        <p key={i} className="leading-relaxed">{cursor}</p>
      ) : (
        <span key={i} className="block h-2" />
      );
    }
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p key={i} className="leading-relaxed">
        {parts.map((p, j) =>
          p.startsWith("**") && p.endsWith("**") ? (
            <strong key={j} className="font-semibold text-ink-950">{p.slice(2, -2)}</strong>
          ) : p.startsWith("_") && p.endsWith("_") ? (
            <em key={j} className="text-text-faint">{p.slice(1, -1)}</em>
          ) : (
            <span key={j}>{p}</span>
          ),
        )}
        {cursor}
      </p>
    );
  });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "az önce";
  if (mins < 60) return `${mins} dk önce`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} sa önce`;
  return `${Math.floor(hrs / 24)} gün önce`;
}

type ChatMsg = AdvisorMessage & { usedAI?: boolean; streaming?: boolean };

/** Akış aşaması: boşta → düşünüyor (ilk parça bekleniyor) → yazıyor. */
type Phase = "idle" | "thinking" | "streaming";

/** SSE olayı — bkz. lib/ai/streaming.ts kablo protokolü. */
type StreamEvent = {
  delta?: string;
  error?: string;
  done?: boolean;
  sessionId?: string;
  usedAI?: boolean;
};

// ---------------------------------------------------------------------------
// Session sidebar
// ---------------------------------------------------------------------------

function SessionSidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  loading,
}: {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void | Promise<void>;
  loading: boolean;
}) {
  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-line bg-canvas/40">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <p className="text-xs font-semibold text-text-muted">Geçmiş sohbetler</p>
        <button
          type="button"
          onClick={onNew}
          aria-label="Yeni sohbet başlat"
          className="focus-ring press grid h-7 w-7 place-items-center rounded-[8px] text-text-muted transition hover:bg-brand-600/10 hover:text-brand-600"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <p className="px-3 py-6 text-center text-[11px] text-text-faint">Yükleniyor…</p>
        ) : sessions.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-text-faint">Henüz sohbet yok</p>
        ) : (
          sessions.map((s) => (
            // Seçim ayrı bir buton: dialog portalından köpüren tıklamalar
            // yanlışlıkla oturumu seçmesin
            <div
              key={s.id}
              className={`group flex items-start justify-between gap-1 px-3 py-2 transition ${
                activeId === s.id ? "bg-brand-600/10" : "hover:bg-canvas"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className="focus-ring min-w-0 flex-1 cursor-pointer rounded-[6px] text-left"
              >
                <p
                  className={`truncate text-xs font-semibold ${
                    activeId === s.id ? "text-brand-600" : "text-ink-950"
                  }`}
                >
                  {s.title ?? "Sohbet"}
                </p>
                <p className="flex items-center gap-1 text-[11px] text-text-faint">
                  <Clock className="h-2.5 w-2.5" /> {relativeTime(s.updated_at)}
                </p>
              </button>
              <ConfirmDialog
                trigger={
                  <button
                    type="button"
                    className="focus-ring mt-0.5 hidden h-5 w-5 shrink-0 place-items-center rounded text-text-faint transition hover:text-danger-500 group-hover:grid"
                    aria-label="Sohbeti sil"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                }
                title="Sohbet silinsin mi?"
                description={`"${s.title ?? "Sohbet"}" oturumu ve tüm mesaj geçmişi kalıcı olarak silinir.`}
                confirmLabel="Sil"
                onConfirm={() => onDelete(s.id)}
              />
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Main chat component
// ---------------------------------------------------------------------------

/** Aktif sohbeti TXT dosyası olarak indirir (client-side, server gerektirmez). */
function exportChatAsTxt(messages: ChatMsg[], sessionTitle?: string | null): void {
  const lines: string[] = [
    "EmlakSoft — Danışman Sohbet Kaydı",
    `Tarih: ${new Date().toLocaleString("tr-TR")}`,
    sessionTitle ? `Başlık: ${sessionTitle}` : "",
    "─".repeat(50),
    "",
  ].filter((l) => l !== undefined);

  for (const m of messages) {
    const label = m.role === "user" ? "Siz" : "Danışman";
    lines.push(`[${label}]`);
    lines.push(m.content);
    lines.push("");
  }

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `danisman-sohbet-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export function AdvisorChat({ aiEnabled }: { aiEnabled: boolean }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pending = phase !== "idle";

  // Oturum listesini yükle
  // Durum güncellemeleri bilinçli olarak `.then()` içinde: `async/await`
  // gövdesinde yazıldığında React Compiler bunu efektten senkron setState
  // sayıyor (react-hooks/set-state-in-effect). Promise döndürüldüğü için
  // `await refreshSessions()` çağrı yerleri aynen çalışmaya devam eder.
  // Baştaki `setSessionsLoading(true)` de kaldırıldı — durum `true` başlıyor.
  const refreshSessions = useCallback(
    () =>
      listAdvisorSessions().then((list) => {
        setSessions(list);
        setSessionsLoading(false);
      }),
    [],
  );

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // Bileşen kaldırılırsa açık akışı iptal et
  useEffect(() => () => abortRef.current?.abort(), []);

  // Mesaj gelince aşağı kaydır
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, phase]);

  // Geçmiş oturumu yükle
  const selectSession = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setError(null);
    setLoadingHistory(true);
    setSessionId(id);
    setMessages([]);
    const history: PersistedMessage[] = await loadAdvisorSession(id);
    setMessages(history.map((m) => ({ role: m.role, content: m.content, usedAI: m.used_ai })));
    setLoadingHistory(false);
  }, []);

  // Yeni sohbet
  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setError(null);
    setSessionId(null);
    setMessages([]);
  }, []);

  // Oturum sil
  const handleDelete = useCallback(async (id: string) => {
    await deleteAdvisorSession(id);
    if (sessionId === id) newChat();
    await refreshSessions();
  }, [sessionId, newChat, refreshSessions]);

  /**
   * Bir sohbet turunu /api/ai/admin-chat üzerinden akışla çalıştırır.
   * `transcript` son kullanıcı mesajını da içerir; asistan mesajı ilk parça
   * geldiğinde eklenir ve parça parça büyütülür.
   */
  const runTurn = useCallback(
    async (transcript: ChatMsg[]) => {
      setError(null);
      setPhase("thinking");
      const controller = new AbortController();
      abortRef.current = controller;

      let gotDelta = false;
      let doneMeta: { sessionId?: string; usedAI?: boolean } | null = null;
      let streamError: string | null = null;

      const appendDelta = (chunk: string) => {
        if (!gotDelta) {
          gotDelta = true;
          setPhase("streaming");
          setMessages((prev) => [...prev, { role: "assistant", content: chunk, streaming: true }]);
          return;
        }
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            next[next.length - 1] = { ...last, content: last.content + chunk };
          }
          return next;
        });
      };

      try {
        const res = await fetch("/api/ai/admin-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: transcript.map((m) => ({ role: m.role, content: m.content })),
            sessionId,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(j?.error || "Yanıt alınamadı. Lütfen tekrar deneyin.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;
            let evt: StreamEvent;
            try {
              evt = JSON.parse(data) as StreamEvent;
            } catch {
              continue;
            }
            if (evt.error) streamError = evt.error;
            if (typeof evt.delta === "string" && evt.delta) appendDelta(evt.delta);
            if (evt.done) doneMeta = { sessionId: evt.sessionId, usedAI: evt.usedAI };
          }
        }
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") {
          streamError =
            e instanceof Error && e.message
              ? e.message
              : "Bağlantı hatası oluştu. Lütfen tekrar deneyin.";
        }
      } finally {
        abortRef.current = null;
      }

      // Akışı sonlandır: imleci kaldır, meta bilgisini işle
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant" && last.streaming) {
          next[next.length - 1] = { ...last, streaming: false, usedAI: doneMeta?.usedAI ?? last.usedAI };
        }
        return next;
      });
      setPhase("idle");

      // Hata yalnızca hiç içerik gelmediyse gösterilir (yeniden dene ile)
      if (streamError && !gotDelta) setError(streamError);

      if (doneMeta?.sessionId) {
        if (!sessionId) setSessionId(doneMeta.sessionId);
        await refreshSessions();
      }
    },
    [sessionId, refreshSessions],
  );

  const send = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q || pending) return;
      const next: ChatMsg[] = [...messages, { role: "user", content: q }];
      setMessages(next);
      setInput("");
      void runTurn(next);
    },
    [messages, pending, runTurn],
  );

  // Hata sonrası: son kullanıcı mesajı zaten listede — aynı transkriptle tekrar dene
  const retry = useCallback(() => {
    if (pending || messages.length === 0) return;
    void runTurn(messages);
  }, [messages, pending, runTurn]);

  // Akışı iptal et — o ana kadar gelen kısım korunur
  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[520px] overflow-hidden rounded-[18px] border border-line bg-surface">
      {/* Sidebar */}
      <SessionSidebar
        sessions={sessions}
        activeId={sessionId}
        onSelect={selectSession}
        onNew={newChat}
        onDelete={handleDelete}
        loading={sessionsLoading}
      />

      {/* Sohbet alanı */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Başlık */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-950">
            <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-[image:var(--grad-brand)] text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            Yapay zeka iş danışmanı
          </p>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                aiEnabled ? "bg-mint-500/12 text-mint-600" : "bg-amber-400/15 text-amber-600"
              }`}
            >
              {aiEnabled ? <Zap className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
              {aiEnabled ? "OpenAI aktif" : "Akıllı yedek kip"}
            </span>
            {messages.length > 0 && (
              <button
                type="button"
                title="Sohbeti TXT olarak indir"
                onClick={() => {
                  const activeSession = sessions.find((s) => s.id === sessionId);
                  exportChatAsTxt(messages, activeSession?.title);
                }}
                className="grid h-7 w-7 place-items-center rounded-[8px] text-text-muted transition hover:bg-brand-600/10 hover:text-brand-600"
                aria-label="Sohbeti indir"
              >
                <Download className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Mesajlar */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {loadingHistory ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-text-muted">Sohbet yükleniyor…</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="mx-auto max-w-md pt-6 text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[image:var(--grad-brand-soft)]">
                <Sparkles className="h-7 w-7 text-brand-600" />
              </span>
              <h3 className="mt-3 font-display text-lg font-bold text-ink-950">Platformunuzu birlikte büyütelim</h3>
              <p className="mt-1 text-sm text-text-muted">
                Canlı verilerinize bakarak gelir, müşteri kaybı, satış ve destek üzerine somut öneriler veririm.
              </p>
              <div className="mt-5 grid gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-[12px] border border-line bg-canvas/50 px-4 py-2.5 text-left text-sm text-ink-950 transition hover:border-brand-300 hover:bg-canvas"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${
                    m.role === "user" ? "bg-ink-950 text-white" : "bg-[image:var(--grad-brand)] text-white"
                  }`}
                >
                  {m.role === "user" ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                </span>
                <div
                  className={`max-w-[78%] rounded-[14px] px-4 py-2.5 text-sm ${
                    m.role === "user"
                      ? "bg-ink-950 text-white"
                      : "border border-line bg-canvas/60 text-text-muted"
                  }`}
                >
                  {m.role === "user"
                    ? <p className="leading-relaxed">{m.content}</p>
                    : renderContent(m.content, m.streaming)}
                </div>
              </div>
            ))
          )}

          {phase === "thinking" ? (
            <div className="flex gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[image:var(--grad-brand)] text-white">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="flex items-center gap-1.5 rounded-[14px] border border-line bg-canvas/60 px-4 py-3">
                <span className="h-2 w-2 animate-bounce rounded-full bg-brand-400 [animation-delay:-0.2s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-brand-400 [animation-delay:-0.1s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-brand-400" />
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-danger-500/30 bg-danger-500/8 px-4 py-3">
              <p className="text-sm text-danger-500">{error}</p>
              <button
                type="button"
                onClick={retry}
                className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300 hover:text-brand-600"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Yeniden dene
              </button>
            </div>
          ) : null}
        </div>

        {/* Giriş alanı */}
        <div className="border-t border-line p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder="Bir soru sorun… (örn. gelirimi nasıl artırırım?)"
              className="max-h-32 flex-1 resize-none rounded-[12px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300"
            />
            {pending ? (
              <button
                type="button"
                onClick={cancel}
                title="Yanıtı durdur"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-ink-950 text-white transition hover:opacity-85"
                aria-label="Yanıtı durdur"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => send(input)}
                disabled={!input.trim()}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-brand-600 text-white transition hover:bg-brand-700 disabled:opacity-40"
                aria-label="Gönder"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
