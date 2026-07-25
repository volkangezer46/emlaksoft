"use client";

import { useEffect, useRef, useState, useTransition, useCallback } from "react";
import {
  ArrowUp,
  Bot,
  Clock,
  Download,
  MessageSquarePlus,
  Sparkles,
  Trash2,
  User,
  Zap,
} from "lucide-react";
import {
  askAdvisor,
  listAdvisorSessions,
  loadAdvisorSession,
  deleteAdvisorSession,
  type SessionSummary,
  type PersistedMessage,
} from "@/app/actions/ai-advisor";
import type { AdvisorMessage } from "@/lib/ai-advisor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  "Bu ay gelirimi nasıl artırırım?",
  "Müşteri kaybı riskini azaltmak için ne yapmalıyım?",
  "Satış hunimi değerlendir ve öneri ver",
  "Bugün öncelik vermem gereken 3 şey nedir?",
];

function renderContent(text: string) {
  return text.split("\n").map((line, i) => {
    if (!line.trim()) return <span key={i} className="block h-2" />;
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

type ChatMsg = AdvisorMessage & { usedAI?: boolean };

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
  onDelete: (id: string) => void;
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
            <div
              key={s.id}
              className={`group flex cursor-pointer items-start justify-between gap-1 px-3 py-2 transition ${
                activeId === s.id ? "bg-brand-600/10" : "hover:bg-canvas"
              }`}
              onClick={() => onSelect(s.id)}
            >
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-xs font-semibold ${
                    activeId === s.id ? "text-brand-600" : "text-ink-950"
                  }`}
                >
                  {s.title ?? "Sohbet"}
                </p>
                <p className="flex items-center gap-1 text-[10px] text-text-faint">
                  <Clock className="h-2.5 w-2.5" /> {relativeTime(s.updated_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                className="focus-ring mt-0.5 hidden h-5 w-5 shrink-0 place-items-center rounded text-text-faint transition hover:text-danger-500 group-hover:grid"
                aria-label="Sohbeti sil"
              >
                <Trash2 className="h-3 w-3" />
              </button>
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
  a.download = `danisман-sohbet-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export function AdvisorChat({ aiEnabled }: { aiEnabled: boolean }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // Mesaj gelince aşağı kaydır
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  // Geçmiş oturumu yükle
  const selectSession = useCallback(async (id: string) => {
    setLoadingHistory(true);
    setSessionId(id);
    setMessages([]);
    const history: PersistedMessage[] = await loadAdvisorSession(id);
    setMessages(history.map((m) => ({ role: m.role, content: m.content, usedAI: m.used_ai })));
    setLoadingHistory(false);
  }, []);

  // Yeni sohbet
  const newChat = useCallback(() => {
    setSessionId(null);
    setMessages([]);
  }, []);

  // Oturum sil
  const handleDelete = useCallback(async (id: string) => {
    await deleteAdvisorSession(id);
    if (sessionId === id) newChat();
    await refreshSessions();
  }, [sessionId, newChat, refreshSessions]);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || pending) return;
    const next: ChatMsg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    startTransition(async () => {
      const res = await askAdvisor(
        next.map((m) => ({ role: m.role, content: m.content })),
        sessionId,
      );
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.reply, usedAI: res.usedAI },
      ]);
      // Yeni oturum oluşturulduysa ID'yi kaydet ve listeyi yenile
      if (!sessionId && res.sessionId) {
        setSessionId(res.sessionId);
        await refreshSessions();
      } else if (sessionId) {
        // updated_at güncellendi, listeyi yenile
        await refreshSessions();
      }
    });
  };

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
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${
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
                    : renderContent(m.content)}
                </div>
              </div>
            ))
          )}

          {pending ? (
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
            <button
              type="button"
              onClick={() => send(input)}
              disabled={pending || !input.trim()}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-brand-600 text-white transition hover:bg-brand-700 disabled:opacity-40"
              aria-label="Gönder"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
