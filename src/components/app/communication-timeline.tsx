"use client";

import { useEffect, useRef, useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare, Mail, FileText, Users, Plus, Trash2, Clock,
  PhoneIncoming, PhoneOutgoing, PhoneMissed, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { createCommunication, type CommResult } from "@/app/actions/communications";
import { COMM_CHANNELS, COMM_OUTCOMES } from "@/lib/comm-types";
import { msSince, now } from "@/lib/clock";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/app/toast-provider";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/inline-dialog";

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
  const diff = msSince(iso);
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return "az önce";
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}d ${s}s` : `${s}s`;
}

const init: CommResult = {};

// ---------------------------------------------------------------------------
// Not olayları (B054): hero'daki "Not ekle", Özet'teki "Notlar" kartı ve "İletişim geçmişi" aynı notu
// İYİMSER olarak (sunucu yanıtı beklenmeden) gösterir; sunucu onayı gelince geçici kimlik gerçeğiyle değişir,
// hata olursa geri alınır. Tek `router.refresh()` sunucu verisini eşitler (tam sayfa yükleme yok).
// ---------------------------------------------------------------------------

const NOTE_EVENT = "es:customer-note";

type NoteEvent =
  | { customerId: string; phase: "optimistic"; item: CommRow }
  | { customerId: string; phase: "commit"; tempId: string; id: string }
  | { customerId: string; phase: "rollback"; tempId: string };

function emitNote(detail: NoteEvent) {
  window.dispatchEvent(new CustomEvent<NoteEvent>(NOTE_EVENT, { detail }));
}

/** Bu müşterinin not olaylarını listeye uygular (iyimser ekle → gerçek kimlik → ya da geri al). */
function applyNoteEvent(prev: CommRow[], ev: NoteEvent): CommRow[] {
  if (ev.phase === "optimistic") return prev.some((i) => i.id === ev.item.id) ? prev : [ev.item, ...prev];
  if (ev.phase === "commit") {
    // Sunucu verisi önce geldiyse (refresh) gerçek kayıt zaten listede: geçiciyi düş.
    if (prev.some((i) => i.id === ev.id)) return prev.filter((i) => i.id !== ev.tempId);
    return prev.map((i) => (i.id === ev.tempId ? { ...i, id: ev.id } : i));
  }
  return prev.filter((i) => i.id !== ev.tempId);
}

function useNoteEvents(customerId: string, onEvent: (ev: NoteEvent) => void) {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });
  useEffect(() => {
    const listen = (e: Event) => {
      const detail = (e as CustomEvent<NoteEvent>).detail;
      if (detail?.customerId === customerId) handler.current(detail);
    };
    window.addEventListener(NOTE_EVENT, listen);
    return () => window.removeEventListener(NOTE_EVENT, listen);
  }, [customerId]);
}

/** Sunucudan gelen liste değişince (router.refresh) yerel listeyi eşitler; bekleyen iyimser kayıtlar korunur. */
function useSyncedItems(initialItems: CommRow[]) {
  const [items, setItems] = useState<CommRow[]>(initialItems);
  const [source, setSource] = useState(initialItems);
  if (source !== initialItems) {
    setSource(initialItems);
    setItems((prev) => {
      const pending = prev.filter((i) => i.id.startsWith(TEMP_PREFIX) && !initialItems.some((s) => s.body === i.body && s.channel === i.channel));
      return [...pending, ...initialItems];
    });
  }
  return [items, setItems] as const;
}

const TEMP_PREFIX = "tmp-";
let tempSeq = 0;

/** İletişim notu mu? (Özet "Notlar" kartı ve hızlı not bunları gösterir.) */
export function isCommNote(item: Pick<CommRow, "channel" | "direction">): boolean {
  return item.channel === "note" || item.direction === "internal";
}

/**
 * Müşteri kartı hero'su: "Not ekle" — satır içi panel (tek alan + Kaydet; kanal "Not", yön "İç not"). Akış ≤3 dokunuş,
 * not Notlar kartında ve iletişim geçmişinde İYİMSER görünür; çift tıklama tek not yazar; hata panelde görünür.
 */
export function CustomerQuickNote({ customerId, className }: { customerId: string; className?: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    const form = e.currentTarget;
    const body = String(new FormData(form).get("body") ?? "").trim();
    if (!body) {
      setError("Not boş olamaz.");
      return;
    }
    inFlight.current = true;
    setError(null);
    const tempId = `${TEMP_PREFIX}${++tempSeq}`;
    emitNote({
      customerId,
      phase: "optimistic",
      item: {
        id: tempId,
        channel: "note",
        direction: "internal",
        subject: null,
        body,
        outcome: null,
        duration_sec: null,
        scheduled_at: null,
        created_at: new Date(now()).toISOString(),
        created_by: { full_name: "Siz" },
      },
    });
    const fd = new FormData();
    fd.set("customer_id", customerId);
    fd.set("channel", "note");
    fd.set("direction", "internal");
    fd.set("body", body);
    startTransition(async () => {
      try {
        const res = await createCommunication(init, fd);
        if (res.ok && res.id) {
          emitNote({ customerId, phase: "commit", tempId, id: res.id });
          push("Not eklendi", "ok");
          form.reset();
          setOpen(false);
          router.refresh();
        } else {
          emitNote({ customerId, phase: "rollback", tempId });
          setError(res.error ?? "Not kaydedilemedi. Lütfen tekrar deneyin.");
        }
      } catch {
        emitNote({ customerId, phase: "rollback", tempId });
        setError("Bağlantı hatası: not kaydedilemedi. Lütfen tekrar deneyin.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setError(null); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" icon={MessageSquare} className={className}>
          Not ekle
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader title="Not ekle" description="İç not olarak kaydedilir; Notlar kartında ve iletişim geçmişinde görünür." />
        <form onSubmit={submit}>
          <DialogBody>
            <label htmlFor={`quick-note-${customerId}`} className="sr-only">Not</label>
            <textarea
              id={`quick-note-${customerId}`}
              aria-label="Not"
              name="body"
              rows={3}
              required
              maxLength={4000}
              placeholder="Görüşme özeti, hatırlatma…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              className="w-full resize-none rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300 touch:text-base"
            />
            {error ? (
              <p role="alert" className="mt-2 rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-xs font-medium text-danger-600">{error}</p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose className="rounded-[var(--radius-control)] border border-line px-3.5 py-2 text-sm font-semibold text-ink-950 touch:min-h-11">Vazgeç</DialogClose>
            <Button type="submit" size="sm" icon={Plus} loading={pending}>
              {pending ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Özet "Notlar" kartı: son 3 iletişim notu (iyimser eklenen dahil). Not yoksa `emptyText` (verilmediyse hiçbir şey). */
export function RecentNotes({
  customerId,
  initialItems,
  limit = 3,
  emptyText,
}: {
  customerId: string;
  initialItems: CommRow[];
  limit?: number;
  emptyText?: string;
}) {
  const [items, setItems] = useSyncedItems(initialItems);
  useNoteEvents(customerId, (ev) => setItems((prev) => applyNoteEvent(prev, ev)));
  const notes = items.filter(isCommNote).slice(0, limit);
  if (notes.length === 0) return emptyText ? <p className="mt-3 text-sm text-text-muted">{emptyText}</p> : null;
  return (
    <ul className="mt-3 space-y-2" aria-label="Son notlar">
      {notes.map((n) => (
        <li key={n.id} className={`rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3 py-2 ${n.id.startsWith(TEMP_PREFIX) ? "opacity-70" : ""}`}>
          <p className="line-clamp-3 whitespace-pre-line text-sm text-ink-950">{n.body ?? n.subject}</p>
          <p className="mt-0.5 text-xs text-text-faint">{authorName(n.created_by)} · {relTime(n.created_at)}</p>
        </li>
      ))}
    </ul>
  );
}

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
  const router = useRouter();
  const { push } = useToast();
  const [items, setItems] = useSyncedItems(initialItems);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inFlight = useRef(false);
  useNoteEvents(customerId, (ev) => setItems((prev) => applyNoteEvent(prev, ev)));

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Çift gönderim kilidi: pending bir sonraki render'a kadar güncellenmez; ref anında kilitler.
    if (inFlight.current) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("customer_id", customerId);
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await createCommunication(init, fd);
        if (result.ok && result.id) {
          const created: CommRow = {
            id: result.id,
            channel: String(fd.get("channel") ?? "note"),
            direction: String(fd.get("direction") ?? "outbound"),
            subject: null,
            body: String(fd.get("body") ?? "").trim() || null,
            outcome: String(fd.get("outcome") ?? "") || null,
            duration_sec: Number(fd.get("duration_sec")) || null,
            scheduled_at: null,
            created_at: new Date(now()).toISOString(),
            created_by: { full_name: "Siz" },
          };
          // İyimser ekleme + tek tazeleme (tam sayfa yükleme yok); Notlar kartı da aynı olayla güncellenir.
          emitNote({ customerId, phase: "optimistic", item: created });
          form.reset();
          setShowForm(false);
          push("Kayıt eklendi", "ok");
          router.refresh();
        } else {
          setError(result.error ?? "İletişim kaydı oluşturulamadı.");
        }
      } catch {
        setError("Bağlantı hatası: kayıt oluşturulamadı. Lütfen tekrar deneyin.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      {/* Başlık */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <MessageSquare className="h-4 w-4 text-brand-600" /> İletişim geçmişi
        </h2>
        {canCreate && (
          <button
            type="button"
            onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-600/5"
          >
            <Plus className="h-3.5 w-3.5" />
            {showForm ? "İptal" : "Yeni kayıt"}
            <ChevronDown className={`h-3 w-3 transition ${showForm ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {/* Yeni kayıt formu */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mt-4 rounded-[var(--radius-card)] border border-brand-300/40 bg-brand-600/[0.03] p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Kanal */}
            <div>
              <label htmlFor="ct-channel" className="mb-1 block text-xs font-semibold text-ink-950">Kanal</label>
              <select id="ct-channel" name="channel" defaultValue="call" className="w-full appearance-none rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300">
                {COMM_CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>
                ))}
              </select>
            </div>

            {/* Yön */}
            <div>
              <label htmlFor="ct-direction" className="mb-1 block text-xs font-semibold text-ink-950">Yön</label>
              <select id="ct-direction" name="direction" defaultValue="outbound" className="w-full appearance-none rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300">
                <option value="outbound">Giden (ben aradım/yazdım)</option>
                <option value="inbound">Gelen (müşteri aradı/yazdı)</option>
                <option value="internal">İç not</option>
              </select>
            </div>

            {/* Sonuç */}
            <div>
              <label htmlFor="ct-outcome" className="mb-1 block text-xs font-semibold text-ink-950">Sonuç</label>
              <select id="ct-outcome" name="outcome" defaultValue="" className="w-full appearance-none rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300">
                <option value="">— Seçin —</option>
                {COMM_OUTCOMES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Süre */}
            <div>
              <label htmlFor="ct-duration" className="mb-1 block text-xs font-semibold text-ink-950">Süre (sn, opsiyonel)</label>
              <input id="ct-duration" name="duration_sec" type="number" min="0" placeholder="örn. 120" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300" />
            </div>
          </div>

          {/* Not */}
          <div>
            <label htmlFor="ct-body" className="mb-1 block text-xs font-semibold text-ink-950">Not / Mesaj</label>
            <textarea id="ct-body" name="body" rows={3} placeholder="Görüşme özeti, mesaj içeriği veya not…" className="w-full resize-none rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300" />
          </div>

          {error && (
            <p role="alert" className="rounded-[var(--radius-control)] bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> {isPending ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </form>
      )}

      {/* Zaman çizgisi */}
      {items.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
          Henüz iletişim kaydı yok. İlk kaydı ekleyin.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {items.map((item) => {
            const channelDef = COMM_CHANNELS.find((c) => c.value === item.channel);
            const outcomeDef = COMM_OUTCOMES.find((o) => o.value === item.outcome);
            return (
              <div key={item.id} className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 px-3 py-3 transition hover:bg-canvas/80">
                {/* İkon */}
                <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] ${channelColor(item.channel)}`}>
                  {channelIcon(item.channel, item.direction)}
                </span>

                {/* İçerik */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-ink-950">{channelDef?.label ?? item.channel}</span>
                    {item.direction === "inbound" && (
                      <span className="rounded-full bg-brand-600/10 px-1.5 py-0.5 text-xs font-semibold text-brand-600">Gelen</span>
                    )}
                    {outcomeDef && (
                      <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-text-muted">{outcomeDef.label}</span>
                    )}
                    {item.duration_sec && (
                      <span className="flex items-center gap-1 text-xs text-text-faint">
                        <Clock className="h-3 w-3" /> {formatDuration(item.duration_sec)}
                      </span>
                    )}
                  </div>
                  {item.subject && <p className="mt-0.5 text-xs font-semibold text-text-muted">{item.subject}</p>}
                  {item.body && <p className="mt-1 text-xs leading-relaxed text-text-muted line-clamp-3">{item.body}</p>}
                  <p className="mt-1 text-xs text-text-faint">{authorName(item.created_by)} · {relTime(item.created_at)}</p>
                </div>

                {/* Sil */}
                {canCreate && (
                  <ConfirmDialog
                    trigger={
                      <button
                        type="button"
                        className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-faint transition hover:bg-red-50 hover:text-red-600 touch:min-h-11 touch:min-w-11"
                        aria-label="Kaydı sil"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    }
                    title="Bu kayıt silinsin mi?"
                    description="İletişim kaydı kalıcı olarak silinir."
                    confirmLabel="Sil"
                    onConfirm={() => {
                      if (item.id.startsWith(TEMP_PREFIX)) return;
                      startTransition(async () => {
                        const { deleteCommunication } = await import("@/app/actions/communications");
                        const res = await deleteCommunication(item.id, customerId);
                        if (res.error) {
                          push(res.error, "err");
                          return;
                        }
                        setItems((prev) => prev.filter((i) => i.id !== item.id));
                      });
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
