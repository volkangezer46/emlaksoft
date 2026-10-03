"use client";

import { useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, FileCheck2, GripVertical, Loader2, MessageSquare, Pencil, Sparkles, X } from "lucide-react";
import { updateDealStage, updateDeal, type DealStage } from "@/app/actions/deals";
import { useToast } from "@/components/app/toast-provider";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusTransitionBar, isAllowedTransition } from "./status-transition";
import { WinCelebrationDialog } from "./win-celebration-dialog";
import { LossReasonDialog, type LossReasonOption } from "./loss-reason-dialog";
import { defaultStageLabels, type StageLabels } from "@/lib/deal-stage-labels";

export type BoardDeal = {
  id: string;
  stage: string;
  deal_type: string;
  deal_value: number | null;
  probability: number | null;
  assigned_to: string | null;
  updated_at: string;
  property_title: string | null;
  property_code: string | null;
  property_id: string | null;
  customer_name: string | null;
  customer_id: string | null;
  customer_phone: string | null;
  /** İYS SMS onayı (channel=sms, status=granted) — kazanma sihirbazının tebrik SMS'i için */
  sms_consent: boolean;
  /** Not sayısı (deal_notes gömülü count) — kartta rozet olarak gösterilir */
  note_count: number;
  /** Tamamlanan zorunlu evrak sayısı (deal_checklist_items) — evrak rozeti için */
  checklist_done: number;
  /** Toplam zorunlu evrak sayısı; 0 ise liste oluşturulmamış, rozet gizlenir */
  checklist_total: number;
};

type Member = { id: string; full_name: string };

const STAGES: { key: DealStage; tone: string; ring: string }[] = [
  { key: "new", tone: "text-cyan-600", ring: "border-cyan-400/30 bg-cyan-400/5" },
  { key: "qualified", tone: "text-brand-600", ring: "border-brand-400/30 bg-brand-600/5" },
  { key: "negotiation", tone: "text-amber-600", ring: "border-amber-400/35 bg-amber-400/5" },
  { key: "won", tone: "text-mint-600", ring: "border-mint-500/35 bg-mint-500/5" },
  { key: "lost", tone: "text-danger-500", ring: "border-danger-500/25 bg-danger-500/5" },
];

function money(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Kartta hareketsizliği gösterir: bayat anlaşma tek bakışta seçilsin. */
function updatedAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Bugün güncellendi";
  if (days === 1) return "Dün güncellendi";
  return `${days} gün önce güncellendi`;
}

export function DealBoard({
  deals,
  canEdit = false,
  members = [],
  lossReasons = [],
  stageLabels = defaultStageLabels(),
}: {
  deals: BoardDeal[];
  canEdit?: boolean;
  members?: Member[];
  /** Ofisin `loss_reason` tanım listesi (kayıp diyaloğu). */
  lossReasons?: LossReasonOption[];
  /** Ofisin görünen aşama adı/rengi (aşama anahtarları sabit). */
  stageLabels?: StageLabels;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<BoardDeal | null>(null);
  const [lossFor, setLossFor] = useState<BoardDeal | null>(null);
  // Kazanma sihirbazı — yalnız won'a İLK geçişte açılır (move zaten sadece
  // won olmayan karttan tetiklenebilir); optimistic açılır, hatada kapanır.
  const [wonFor, setWonFor] = useState<BoardDeal | null>(null);
  // HTML5 sürükle-bırak durumu. Dokunmatikte dragstart hiç ateşlenmediği için
  // DnD kendiliğinden devre dışı kalır — butonlar zaten görünür (yedek akış).
  const [dragging, setDragging] = useState<{ id: string; stage: string } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<DealStage | null>(null);
  const [droppedId, setDroppedId] = useState<string | null>(null);
  const editReturnFocusRef = useRef<HTMLElement | null>(null);
  const lossReturnFocusRef = useRef<HTMLElement | null>(null);
  const winReturnFocusRef = useRef<HTMLElement | null>(null);

  // React 19 optimistic desen: kart tıklandığı anda hedef sütunda görünür,
  // server action arkada çalışır. Transition bitince taban `deals` prop'una
  // geri dönülür — başarıda revalidate edilmiş veri zaten aynı sütunu gösterir,
  // hatada kart kendiliğinden eski sütununa döner (+ toast ve refresh).
  const [optimisticDeals, applyStagePatch] = useOptimistic(
    deals,
    (state, patch: { id: string; stage: DealStage }) =>
      state.map((d) =>
        d.id === patch.id ? { ...d, stage: patch.stage, updated_at: new Date().toISOString() } : d,
      ),
  );

  const columns = useMemo(() => {
    const map = Object.fromEntries(STAGES.map((s) => [s.key, [] as BoardDeal[]])) as Record<DealStage, BoardDeal[]>;
    for (const d of optimisticDeals) {
      const key = (STAGES.some((s) => s.key === d.stage) ? d.stage : "new") as DealStage;
      map[key].push(d);
    }
    return map;
  }, [optimisticDeals]);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m.full_name])), [members]);

  function move(dealId: string, stage: DealStage, reason?: { value: string; note: string }) {
    if (busyId === dealId && pending) return; // çifte tıklama koruması
    setBusyId(dealId);
    // Won'a ilk geçiş: kutlama sihirbazı server onayı beklenmeden açılır
    // (optimistic); FLOW gereği won'dan won'a geçiş zaten mümkün değil.
    const prior = optimisticDeals.find((x) => x.id === dealId);
    if (stage === "won" && prior && prior.stage !== "won") {
      winReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setWonFor(prior);
    }
    // Yeni sütununa inen karta kısa vurgu (animate-rise + brand halka) — kozmetik
    setDroppedId(dealId);
    window.setTimeout(() => setDroppedId((v) => (v === dealId ? null : v)), 900);
    startTransition(async () => {
      applyStagePatch({ id: dealId, stage }); // kart HEMEN hedef sütuna taşınır
      const fd = new FormData();
      fd.set("deal_id", dealId);
      fd.set("stage", stage);
      if (stage === "lost") {
        fd.set("loss_reason", reason?.value ?? "");
        fd.set("loss_note", reason?.note ?? "");
      }
      try {
        const res = await updateDealStage(fd);
        if (res.error) {
          push(res.error || "Taşınamadı", "err");
          setWonFor((v) => (v?.id === dealId ? null : v)); // hata: sihirbaz kapanır
          router.refresh(); // optimistic durum geri sarılır, sunucu gerçeği gelir
        } else {
          // Won'da toast yerine kutlama sihirbazı zaten açık
          if (stage !== "won") push("Aşama güncellendi", "ok");
          router.refresh();
        }
      } catch {
        push("Taşınamadı", "err");
        setWonFor((v) => (v?.id === dealId ? null : v));
        router.refresh();
      } finally {
        setBusyId(null);
      }
    });
  }

  function submitEdit(formData: FormData) {
    startTransition(async () => {
      const res = await updateDeal(formData);
      if (res.error) push(res.error, "err");
      else {
        push("Anlaşma güncellendi", "ok");
        setEditing(null);
        router.refresh();
      }
    });
  }

  return (
    <div id="tahta" className="flex scroll-mt-24 gap-3 overflow-x-auto pb-2">
      {STAGES.map((col, colIdx) => {
        const rows = columns[col.key];
        const sum = rows.reduce((s, d) => s + (Number(d.deal_value) || 0), 0);
        // Sürükleme sırasında geçerli hedef sütun kesikli brand konturla vurgulanır
        const isDropTarget =
          dragging != null && dragOverCol === col.key && dragging.stage !== col.key && isAllowedTransition(dragging.stage, col.key);
        return (
          <section
            key={col.key}
            id={`sutun-${col.key}`}
            className={`min-w-[260px] flex-1 scroll-mt-24 rounded-[var(--radius-panel)] border backdrop-blur transition-colors duration-150 ${
              isDropTarget ? "border-dashed border-brand-400/80 bg-brand-600/10" : col.ring
            }`}
            style={{ animationDelay: `${colIdx * 60}ms` }}
            onDragOver={(e) => {
              if (!dragging) return;
              // Geçersiz hedefte de drop'u kabul ediyoruz ki bırakınca
              // "desteklenmiyor" toast'ı gösterebilelim (no-op + geri bildirim).
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragOverCol !== col.key) setDragOverCol(col.key);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDragOverCol((c) => (c === col.key ? null : c));
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = dragging?.id ?? e.dataTransfer.getData("text/plain");
              setDragging(null);
              setDragOverCol(null);
              if (!id) return;
              const deal = optimisticDeals.find((x) => x.id === id);
              if (!deal || deal.stage === col.key) return; // aynı sütun: sessiz no-op
              if (!isAllowedTransition(deal.stage, col.key)) {
                push("Bu taşıma desteklenmiyor", "err");
                return;
              }
              if (col.key === "lost") {
                // Kayıp akışı korunur: neden onaylanmadan optimistic taşıma YOK;
                // diyalog iptal edilirse kart yerinde kalır.
                lossReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                setLossFor(deal);
                return;
              }
              move(id, col.key);
            }}
          >
            <header className="flex items-center justify-between border-b border-line/60 px-3.5 py-3">
              <div>
                <p
                  className={`text-xs font-extrabold uppercase tracking-[0.12em] ${col.tone}`}
                  style={stageLabels[col.key].color ? { color: stageLabels[col.key].color ?? undefined } : undefined}
                >
                  {stageLabels[col.key].label}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">{rows.length} · {money(sum)}</p>
              </div>
              <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] bg-surface text-xs font-bold text-ink-950 shadow-[var(--shadow-xs)]">
                {rows.length}
              </span>
            </header>
            <div className="space-y-2.5 p-2.5">
              {rows.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-3 py-8 text-center text-xs text-text-faint">
                  Boş sütun
                </div>
              ) : (
                rows.map((d) => {
                  const idx = STAGES.findIndex((s) => s.key === d.stage);
                  const next = idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1] : null;
                  const busy = busyId === d.id && pending;
                  const isDragging = dragging?.id === d.id;
                  const justDropped = droppedId === d.id;
                  return (
                    <article
                      key={d.id}
                      id={`deal-card-${d.id}`}
                      tabIndex={-1}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", d.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging({ id: d.id, stage: d.stage });
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setDragOverCol(null);
                      }}
                      className={`lift group relative cursor-grab rounded-[var(--radius-card)] border bg-surface p-3 shadow-[var(--shadow-xs)] transition focus:outline-none focus:ring-2 focus:ring-brand-400/40 active:cursor-grabbing ${
                        isDragging
                          ? "border-brand-300 opacity-40 [transform:rotate(1.5deg)_scale(0.98)]"
                          : justDropped
                            ? "animate-rise border-brand-400 ring-2 ring-brand-400/35"
                            : "border-line hover:border-brand-300"
                      }`}
                    >
                      {/* Kart ustundeki ortu-link ONCEDEN MUSTERI sayfasina
                          gidiyordu; kullanici anlasma kartina tikladiginda
                          anlasmayi degil musteriyi aciyordu. Ustelik musterisi
                          olmayan anlasma HIC tiklanamiyordu. Artik anlasma
                          detayina gidiyor ve her kartta var. */}
                      <Link
                        href={`/app/anlasmalar/${d.id}`}
                        draggable={false}
                        className="focus-ring absolute inset-0 rounded-[var(--radius-card)]"
                        aria-label={`${d.property_title ?? d.property_code ?? "Anlaşma"} detayını aç`}
                      />
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink-950">
                            {d.property_title ?? d.property_code ?? "Anlaşma"}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-text-muted">
                            {d.customer_name ?? "Müşteri atanmadı"} · {d.deal_type === "rent" ? "Kiralama" : "Satış"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" /> : null}
                          {/* Evrak durumu — zorunlu evraklardan tamamlanan/toplam; liste yoksa gizli */}
                          {d.checklist_total > 0 ? (
                            <span
                              title={`${d.checklist_done}/${d.checklist_total} zorunlu evrak tamam`}
                              className={`numeric inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold ${
                                d.checklist_done === d.checklist_total
                                  ? "bg-mint-500/12 text-mint-700"
                                  : "bg-canvas text-text-muted"
                              }`}
                            >
                              <FileCheck2 className="h-3 w-3" /> {d.checklist_done}/{d.checklist_total}
                            </span>
                          ) : null}
                          {/* Not sayacı — detaydaki not akışına işaret; 0 ise gösterilmez */}
                          {d.note_count > 0 ? (
                            <span
                              title={`${d.note_count} not`}
                              className="numeric inline-flex items-center gap-0.5 rounded-full bg-canvas px-1.5 py-0.5 text-xs font-bold text-text-muted"
                            >
                              <MessageSquare className="h-3 w-3" /> {d.note_count}
                            </span>
                          ) : null}
                          {/* Klavye kullanıcıları için geçiş butonları zaten var;
                              tutamaç fare sürüklemesinin görsel ipucu + etiketi. */}
                          <span
                            aria-label="Sürükleyerek taşı"
                            title="Sürükleyerek taşı"
                            className="text-text-faint transition group-hover:text-text-muted"
                          >
                            <GripVertical className="h-3.5 w-3.5" />
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 font-display text-base font-extrabold text-ink-950">{money(d.deal_value)}</p>
                      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-canvas">
                        <div
                          className="bar-live rounded-full bg-[image:var(--grad-brand)]"
                          style={{ width: `${Math.min(100, Number(d.probability) || 20)}%` }}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        {d.assigned_to ? (
                          <Link
                            href={`/app/ekip/${d.assigned_to}`}
                            draggable={false}
                            className="focus-ring group/danisman relative z-10 flex min-w-0 items-center gap-1.5 rounded-[var(--radius-control)]"
                            title="Danışman profilini aç"
                          >
                            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[image:var(--grad-brand)] text-xs font-bold text-white">
                              {initials(memberById.get(d.assigned_to) ?? "?")}
                            </span>
                            <span className="truncate text-xs font-semibold text-text-muted transition group-hover/danisman:text-brand-600">
                              {memberById.get(d.assigned_to) ?? "Danışman"}
                            </span>
                          </Link>
                        ) : (
                          <span className="text-xs text-text-faint">Danışman atanmadı</span>
                        )}
                        <span className="shrink-0 text-xs text-text-faint">{updatedAgo(d.updated_at)}</span>
                      </div>
                      <div className="relative z-10 mt-3 flex flex-wrap items-center gap-1.5">
                        <StatusTransitionBar
                          dealId={d.id}
                          stage={d.stage}
                          stageLabels={stageLabels}
                          onLossRequest={(trigger) => {
                            lossReturnFocusRef.current = trigger;
                            setLossFor(d);
                          }}
                          onWonStart={() => {
                            winReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                            setWonFor(d);
                          }}
                          onWonError={() => setWonFor((v) => (v?.id === d.id ? null : v))}
                        />
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              editReturnFocusRef.current = event.currentTarget;
                              setEditing(d);
                            }}
                            className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-2 py-1 text-xs font-semibold text-text-muted hover:border-brand-300 hover:text-brand-600"
                          >
                            <Pencil className="h-3 w-3" /> Düzenle
                          </button>
                        ) : null}
                        {d.property_id ? (
                          <Link
                            href={`/app/portfoyler/${d.property_id}`}
                            draggable={false}
                            className="rounded-[var(--radius-control)] border border-line px-2 py-1 text-xs font-semibold text-text-muted hover:border-brand-300 hover:text-brand-600"
                          >
                            Portföy
                          </Link>
                        ) : null}
                        {d.customer_id ? (
                          <Link
                            href={`/app/musteriler/${d.customer_id}`}
                            draggable={false}
                            className="rounded-[var(--radius-control)] border border-line px-2 py-1 text-xs font-semibold text-text-muted hover:border-brand-300 hover:text-brand-600"
                          >
                            Müşteri
                          </Link>
                        ) : null}
                        {next && col.key !== "won" && col.key !== "lost" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => move(d.id, next.key)}
                            className="ml-auto inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-ink-950 px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
                          >
                            {stageLabels[next.key].label} <ArrowRight className="h-3 w-3" />
                          </button>
                        ) : null}
                        {col.key === "negotiation" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => move(d.id, "won")}
                            className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-mint-500/15 px-2 py-1 text-xs font-bold text-mint-700 disabled:opacity-50"
                          >
                            <Sparkles className="h-3 w-3" /> Kazan
                          </button>
                        ) : null}
                        {col.key !== "lost" && col.key !== "won" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={(event) => {
                              lossReturnFocusRef.current = event.currentTarget;
                              setLossFor(d);
                            }}
                            className="rounded-[var(--radius-control)] px-2 py-1 text-xs font-semibold text-danger-500 hover:bg-danger-500/10 disabled:opacity-50"
                          >
                            Kayıp
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        );
      })}

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        {editing ? (
          <DialogContent
            size="sm"
            overlayClassName="bg-ink-950/40 backdrop-blur-sm"
            className="rounded-[var(--radius-panel)] border-line shadow-[var(--shadow-lg)]"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const target = editReturnFocusRef.current;
              editReturnFocusRef.current = null;
              if (target?.isConnected) target.focus();
              else document.getElementById(`deal-card-${editing.id}`)?.focus();
            }}
          >
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <DialogTitle className="font-display text-lg font-bold text-ink-950">Anlaşmayı düzenle</DialogTitle>
              <DialogClose asChild>
                <button type="button" className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] text-text-muted hover:bg-canvas" aria-label="Kapat">
                  <X className="h-5 w-5" />
                </button>
              </DialogClose>
            </div>
            <form action={submitEdit} className="space-y-4 p-6">
              <input type="hidden" name="deal_id" value={editing.id} />
              <DialogDescription className="text-sm text-text-muted">{editing.property_title ?? editing.property_code ?? "Anlaşma"} · {editing.customer_name ?? "Müşteri atanmadı"}</DialogDescription>
              <div>
                <label htmlFor={`deal-${editing.id}-value`} className="mb-1 block text-xs font-semibold text-text-muted">Anlaşma değeri (₺)</label>
                <input id={`deal-${editing.id}-value`} name="deal_value" defaultValue={editing.deal_value ?? ""} inputMode="numeric" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`deal-${editing.id}-probability`} className="mb-1 block text-xs font-semibold text-text-muted">Olasılık (%)</label>
                  <input id={`deal-${editing.id}-probability`} name="probability" type="number" min={0} max={100} defaultValue={editing.probability ?? ""} className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label htmlFor={`deal-${editing.id}-type`} className="mb-1 block text-xs font-semibold text-text-muted">Tür</label>
                  <select id={`deal-${editing.id}-type`} name="deal_type" defaultValue={editing.deal_type} className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
                    <option value="sale">Satış</option>
                    <option value="rent">Kiralama</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor={`deal-${editing.id}-assignee`} className="mb-1 block text-xs font-semibold text-text-muted">Sorumlu danışman</label>
                <select id={`deal-${editing.id}-assignee`} name="assigned_to" defaultValue={editing.assigned_to ?? ""} className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
                  <option value="">Değiştirme</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <DialogClose asChild>
                  <button type="button" className="rounded-[var(--radius-control)] border border-line px-4 py-2.5 text-sm font-semibold text-text-muted hover:bg-canvas">Vazgeç</button>
                </DialogClose>
                <button type="submit" disabled={pending} className="rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                  {pending ? "Kaydediliyor…" : "Kaydet"}
                </button>
              </div>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>

      {wonFor ? (
        <WinCelebrationDialog
          deal={wonFor}
          returnFocus={() => {
            const target = winReturnFocusRef.current;
            winReturnFocusRef.current = null;
            if (target?.isConnected) target.focus();
            else document.getElementById(`deal-card-${wonFor.id}`)?.focus();
          }}
          onClose={() => setWonFor(null)}
        />
      ) : null}

      <LossReasonDialog
        open={lossFor !== null}
        title={lossFor ? (lossFor.property_title ?? lossFor.property_code ?? "Anlaşma") : ""}
        options={lossReasons}
        pending={pending}
        onCancel={() => setLossFor(null)}
        onConfirm={(value, note) => { const d = lossFor; setLossFor(null); if (d) move(d.id, "lost", { value, note }); }}
        onClosedFocus={(event) => {
          event.preventDefault();
          const target = lossReturnFocusRef.current;
          lossReturnFocusRef.current = null;
          if (target?.isConnected) target.focus();
          else if (lossFor) document.getElementById(`deal-card-${lossFor.id}`)?.focus();
        }}
      />
    </div>
  );
}
