"use client";

import { useActionState, useTransition, useState } from "react";
import {
  MessageSquare, Mail, FileText, Users, Plus, Trash2, Clock,
  PhoneIncoming, PhoneOutgoing, PhoneMissed, ChevronDown,
} from "lucide-react";
import { createCommunication, type CommResult } from "@/app/actions/communications";
import { COMM_CHANNELS, COMM_OUTCOMES } from "@/lib/comm-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CommRow = {
  id: string;
  channel: string;
  direction: string;
  subject: string | null;
  body: string | null;
  outcome: string | null;
  duration_sec: number | null;
  scheduled_at: string | null;
  created_at: string;
  created_by: { full_name?: string } | { full_name?: string }[] | null;
};

const channelIcon = (channel: string, direction: string) => {
  if (channel === "call") {
    if (direction === "inbound")  return <PhoneIncoming  className="h-4 w-4" />;
    if (direction === "missed")   return <PhoneMissed    className="h-4 w-4" />;
    return <PhoneOutgoing className="h-4 w-4" />;
  }
  if (channel === "whatsapp") return <MessageSquare className="h-4 w-4" />;
  if (channel === "sms")      return <MessageSquare className="h-4 w-4" />;
  if (channel === "email")    return <Mail          className="h-4 w-4" />;
  if (channel === "meeting")  return <Users         className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
};

const channelColor = (channel: string) => {
  const map: Record<string, string> = {
    call:      "bg-brand-600/10 text-brand-600",
    whatsapp:  "bg-mint-500/12 text-mint-700",
    sms:       "bg-cyan-400/12 text-cyan-600",
    email:     "bg-amber-400/15 text-amber-700",
    meeting:   "bg-ink-950/[0.07] text-ink-800",
    note:      "bg-canvas text-text-muted",
  };
  return map[channel] ?? "bg-canvas text-text-muted";
};

function authorName(p: CommRow["created_by"]) {
  if (!p) return "—";
  return Array.isArray(p) ? p[0]?.full_name ?? "—" : p.full_name ?? "—";
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return "az önce";
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}d ${s}s` : `${s}s`;
}

const init: CommResult = {};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CommunicationTimeline({
  customerId,
  initialItems,
  canCreate,
}: {
  customerId: string;
  initialItems: CommRow[];
  canCreate: boolean;
}) {
  const [items, setItems] = useState<CommRow[]>(initialItems);
  const [showForm, setShowForm] = useState(false);
  const [state, , isPending] = useActionState(createCommunication, init);
  const [, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("customer_id", customerId);
    startTransition(async () => {
      const result = await createCommunication(init, fd);
      if (result.ok) {
        setShowForm(false);
        // Optimistic: reload sayfası yerine basit refresh
        window.location.reload();
      }
    });
  }

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      {/* Başlık */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <MessageSquare className="h-4 w-4 text-brand-600" /> İletişim geçmişi
        </h2>
        {canCreate && (
          <button
            type="button"
            onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-600/5"
          >
            <Plus className="h-3.5 w-3.5" />
            {showForm ? "İptal" : "Yeni kayıt"}
            <ChevronDown className={`h-3 w-3 transition ${showForm ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {/* Yeni kayıt formu */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mt-4 rounded-[14px] border border-brand-300/40 bg-brand-600/[0.03] p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Kanal */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-950">Kanal</label>
              <select name="channel" defaultValue="call" className="w-full appearance-none rounded-[9px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300">
                {COMM_CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>
                ))}
              </select>
            </div>

            {/* Yön */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-950">Yön</label>
              <select name="direction" defaultValue="outbound" className="w-full appearance-none rounded-[9px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300">
                <option value="outbound">Giden (ben aradım/yazdım)</option>
                <option value="inbound">Gelen (müşteri aradı/yazdı)</option>
                <option value="internal">İç not</option>
              </select>
            </div>

            {/* Sonuç */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-950">Sonuç</label>
              <select name="outcome" defaultValue="" className="w-full appearance-none rounded-[9px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300">
                <option value="">— Seçin —</option>
                {COMM_OUTCOMES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Süre */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-950">Süre (sn, opsiyonel)</label>
              <input name="duration_sec" type="number" min="0" placeholder="örn. 120" className="w-full rounded-[9px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300" />
            </div>
          </div>

          {/* Not */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-950">Not / Mesaj</label>
            <textarea name="body" rows={3} placeholder="Görüşme özeti, mesaj içeriği veya not…" className="w-full resize-none rounded-[9px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300" />
          </div>

          {state?.error && (
            <p className="rounded-[8px] bg-red-50 px-3 py-2 text-xs text-red-600">{state.error}</p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-[9px] bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> {isPending ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </form>
      )}

      {/* Zaman çizgisi */}
      {items.length === 0 ? (
        <p className="mt-4 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
          Henüz iletişim kaydı yok. İlk kaydı ekleyin.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {items.map((item) => {
            const channelDef = COMM_CHANNELS.find((c) => c.value === item.channel);
            const outcomeDef = COMM_OUTCOMES.find((o) => o.value === item.outcome);
            return (
              <div key={item.id} className="flex items-start gap-3 rounded-[12px] border border-line bg-canvas/50 px-3 py-3 transition hover:bg-canvas/80">
                {/* İkon */}
                <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[9px] ${channelColor(item.channel)}`}>
                  {channelIcon(item.channel, item.direction)}
                </span>

                {/* İçerik */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-ink-950">{channelDef?.label ?? item.channel}</span>
                    {item.direction === "inbound" && (
                      <span className="rounded-full bg-brand-600/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand-600">Gelen</span>
                    )}
                    {outcomeDef && (
                      <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-medium text-text-muted">{outcomeDef.label}</span>
                    )}
                    {item.duration_sec && (
                      <span className="flex items-center gap-1 text-[11px] text-text-faint">
                        <Clock className="h-3 w-3" /> {formatDuration(item.duration_sec)}
                      </span>
                    )}
                  </div>
                  {item.subject && <p className="mt-0.5 text-xs font-semibold text-text-muted">{item.subject}</p>}
                  {item.body && <p className="mt-1 text-xs leading-relaxed text-text-muted line-clamp-3">{item.body}</p>}
                  <p className="mt-1 text-[11px] text-text-faint">{authorName(item.created_by)} · {relTime(item.created_at)}</p>
                </div>

                {/* Sil */}
                {canCreate && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm("Bu kayıt silinsin mi?")) return;
                      startTransition(async () => {
                        const { deleteCommunication } = await import("@/app/actions/communications");
                        await deleteCommunication(item.id, customerId);
                        setItems((prev) => prev.filter((i) => i.id !== item.id));
                      });
                    }}
                    className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-text-faint transition hover:bg-red-50 hover:text-red-600"
                    aria-label="Kaydı sil"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
