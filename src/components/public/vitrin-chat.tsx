"use client";

import { useState } from "react";
import { Bot, Send } from "lucide-react";

type Turn = { role: "user" | "assistant"; content: string };

/**
 * Vitrin ilan asistanı (ofis ayarıyla açılır). İnsan devri: her yanıtta talep formuna (danışmana bağlan) bağlantı.
 * Kişisel veri istemez; ziyaretçi yazarsa sunucuda yapay zekâya gitmeden maskelenir.
 */
export function VitrinChat({ slug, propertyId, leadAnchorId }: { slug: string; propertyId: string; leadAnchorId?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    const question = q.trim();
    if (question.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    const history = turns.slice(-6);
    setTurns((t) => [...t, { role: "user", content: question }]);
    setQ("");
    try {
      const res = await fetch("/api/vitrin-sohbet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, propertyId, question, history }),
      });
      const json = (await res.json().catch(() => ({}))) as { answer?: string; error?: string };
      if (!res.ok || !json.answer) setError(json.error ?? "Yanıt alınamadı.");
      else setTurns((t) => [...t, { role: "assistant", content: json.answer! }]);
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="ilan-asistani" className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
      <h2 id="ilan-asistani" className="flex items-center gap-2 text-sm font-bold text-ink-950">
        <Bot className="h-4 w-4 text-brand-600" aria-hidden /> İlan hakkında sorun
      </h2>
      <p className="mt-1 text-xs text-text-muted">Yapay zekâ asistanı yalnız ilan bilgileriyle yanıtlar; kesin bilgi ve yer gösterme için danışmanımıza bağlanın.</p>
      {turns.length > 0 ? (
        <ol className="mt-3 max-h-72 space-y-2 overflow-y-auto" aria-live="polite">
          {turns.map((t, i) => (
            <li key={i} className={`whitespace-pre-line rounded-[var(--radius-control)] px-3 py-2 text-sm ${t.role === "user" ? "ml-6 bg-brand-600/10 text-ink-950" : "mr-6 bg-canvas text-ink-950"}`}>
              {t.content}
            </li>
          ))}
        </ol>
      ) : null}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <label htmlFor="ilan-asistani-soru" className="sr-only">Sorunuz</label>
        <input
          id="ilan-asistani-soru"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={500}
          placeholder="Ör. Isınma tipi nedir? Kaçıncı kat?"
          className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm text-ink-950 outline-none focus:border-brand-400"
        />
        <button type="submit" disabled={busy || q.trim().length < 2} className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60" aria-label="Gönder">
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </form>
      {error ? <p role="alert" className="mt-2 text-xs text-danger-600">{error}</p> : null}
      {leadAnchorId ? (
        <a href={`#${leadAnchorId}`} className="mt-2 inline-block text-xs font-semibold text-brand-600 hover:underline">
          Danışmana bağlan (talep formu) →
        </a>
      ) : null}
    </section>
  );
}
