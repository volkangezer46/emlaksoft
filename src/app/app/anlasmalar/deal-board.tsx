"use client";

import {
  useEffect,
  useId,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  defaultDropAnimationSideEffects,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import { ArrowRight, FileCheck2, GripVertical, Loader2, MessageSquare, Pencil, Sparkles, X } from "lucide-react";
import { updateDealStage, updateDeal } from "@/app/actions/deals";
import { useToast } from "@/components/app/toast-provider";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { DAY_MS, daysAgoIso, msSince } from "@/lib/clock";
import { defaultStageLabels, type StageLabels } from "@/lib/deal-stage-labels";
import { isDealStage, type DealStage } from "@/lib/workflow-state";
import { StatusTransitionBar } from "./status-transition";
import {
  BOARD_AUTO_SCROLL,
  BoardPointerSensor,
  BoardTouchSensor,
  KEYBOARD_SENSOR_OPTIONS,
  KEYBOARD_SENSOR_OPTIONS_REDUCED,
  NO_DRAG_PROPS,
  POINTER_SENSOR_OPTIONS,
  TOUCH_SENSOR_OPTIONS,
  boardCollisionDetection,
  type BoardDragData,
} from "./board-dnd";
import {
  BOARD_SCREEN_READER_INSTRUCTIONS,
  adjacentColumn,
  announceDragCancel,
  announceDragEnd,
  announceDragOver,
  announceDragStart,
  canDropOn,
  columnOf,
  isClosingStage,
  resolveBoardDrop,
  resolveStageChange,
  type BoardAction,
  type StageNames,
} from "./board-logic";

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

/** Bırakılan kart yuvasına kısa bir geçişle oturur; hareket azaltmada geçiş hiç oynatılmaz. */
const DROP_ANIMATION: DropAnimation = {
  duration: 180,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0" } } }),
};

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
  const days = Math.floor(msSince(iso) / DAY_MS);
  if (days <= 0) return "Bugün güncellendi";
  if (days === 1) return "Dün güncellendi";
  return `${days} gün önce güncellendi`;
}

function dealTitle(d: BoardDeal) {
  return d.property_title ?? d.property_code ?? "Anlaşma";
}

/** Ekran okuyucu duyurularında anlaşmayı ayırt eden ad (portföy yoksa müşteri). */
function dealSpokenName(d: BoardDeal) {
  return d.property_title ?? d.property_code ?? (d.customer_name ? `${d.customer_name} (portföysüz)` : "portföysüz");
}

function dragDataOf(active: Active): BoardDragData {
  return (active.data.current as BoardDragData | undefined) ?? { title: "anlaşma", stage: "new" };
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Sunucuda ve ilk hidrasyonda `false`; istemcide kullanıcının hareket azaltma tercihini izler. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

const subscribeNever = () => () => {};

/** Önizleme katmanı `document.body`'ye taşındığı için yalnız istemcide çizilir. */
function useIsClient(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

export function DealBoard({
  deals,
  canEdit = false,
  members = [],
  stageLabels = defaultStageLabels(),
}: {
  deals: BoardDeal[];
  /** Düzenleme yetkisi yoksa sürükleme tamamen kapalıdır (tutamaç çizilmez). */
  canEdit?: boolean;
  members?: Member[];
  /** Ofisin görünen aşama adı/rengi (aşama anahtarları sabit). */
  stageLabels?: StageLabels;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<BoardDeal | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [droppedId, setDroppedId] = useState<string | null>(null);
  const editReturnFocusRef = useRef<HTMLElement | null>(null);
  const overReportsRef = useRef(0);
  const clickGuardRef = useRef<(() => void) | null>(null);
  // dnd-kit'in talimat düğümü kimliği: sabit verilmezse sunucu ve istemci sayaçları ayrışır
  // (aria-describedby hidrasyon uyuşmazlığı).
  const dndId = useId();
  const isClient = useIsClient();
  const reducedMotion = usePrefersReducedMotion();

  const sensors = useSensors(
    useSensor(BoardPointerSensor, POINTER_SENSOR_OPTIONS),
    useSensor(BoardTouchSensor, TOUCH_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, reducedMotion ? KEYBOARD_SENSOR_OPTIONS_REDUCED : KEYBOARD_SENSOR_OPTIONS),
  );

  // React 19 optimistic desen: kart bırakıldığı anda hedef sütunda görünür,
  // server action arkada çalışır. Transition bitince taban `deals` prop'una
  // geri dönülür — başarıda revalidate edilmiş veri zaten aynı sütunu gösterir,
  // hatada kart kendiliğinden eski sütununa döner (+ toast ve refresh).
  const [optimisticDeals, applyStagePatch] = useOptimistic(
    deals,
    (state, patch: { id: string; stage: DealStage }) =>
      state.map((d) => (d.id === patch.id ? { ...d, stage: patch.stage, updated_at: daysAgoIso(0) } : d)),
  );

  const columns = useMemo(() => {
    const map = Object.fromEntries(STAGES.map((s) => [s.key, [] as BoardDeal[]])) as Record<DealStage, BoardDeal[]>;
    for (const d of optimisticDeals) map[columnOf(d.stage)].push(d);
    return map;
  }, [optimisticDeals]);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m.full_name])), [members]);

  const stageNames = useMemo(
    () => Object.fromEntries(STAGES.map((s) => [s.key, stageLabels[s.key].label])) as StageNames,
    [stageLabels],
  );

  // Türkçe ekran okuyucu duyuruları. Bırakma duyurusu, uygulanan kararla aynı saf fonksiyondan türer.
  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart({ active }) {
        overReportsRef.current = 0;
        const data = dragDataOf(active);
        return announceDragStart(data.title, data.stage, stageNames);
      },
      onDragOver({ active, over }) {
        const first = overReportsRef.current === 0;
        overReportsRef.current += 1;
        const overId = over ? String(over.id) : null;
        return announceDragOver({
          from: dragDataOf(active).stage,
          over: overId !== null && isDealStage(overId) ? overId : null,
          first,
          names: stageNames,
        });
      },
      onDragEnd({ active, over }) {
        const data = dragDataOf(active);
        const action = resolveBoardDrop({ canEdit, deal: { id: String(active.id), stage: data.stage }, target: over?.id });
        return announceDragEnd(data.title, action, stageNames);
      },
      onDragCancel({ active }) {
        const data = dragDataOf(active);
        return announceDragCancel(data.title, data.stage, stageNames);
      },
    }),
    [canEdit, stageNames],
  );

  // Sürükleme biterken tarayıcının ürettiği tıklama (özellikle dokunmatikte "bas, kaldır") kartın
  // örtü linkini açmasın: sürükleme boyunca ve bitişten hemen sonra tıklamalar yutulur.
  function armClickGuard() {
    if (clickGuardRef.current) return;
    const swallow = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("click", swallow, true);
    clickGuardRef.current = () => window.removeEventListener("click", swallow, true);
  }

  function releaseClickGuard() {
    const release = clickGuardRef.current;
    clickGuardRef.current = null;
    if (release) window.setTimeout(release, 80);
  }

  useEffect(() => () => clickGuardRef.current?.(), []);

  function move(dealId: string, stage: DealStage) {
    if (busyId === dealId && pending) return; // çifte tıklama koruması
    setBusyId(dealId);
    // Yeni sütununa inen karta kısa vurgu (animate-rise + brand halka) — kozmetik
    setDroppedId(dealId);
    window.setTimeout(() => setDroppedId((v) => (v === dealId ? null : v)), 900);
    startTransition(async () => {
      applyStagePatch({ id: dealId, stage }); // kart HEMEN hedef sütuna taşınır
      const fd = new FormData();
      fd.set("deal_id", dealId);
      fd.set("stage", stage);
      try {
        const res = await updateDealStage(fd);
        if (res.error) {
          push(res.error || "Taşınamadı", "err");
          router.refresh(); // optimistic durum geri sarılır, sunucu gerçeği gelir
        } else {
          push("Aşama güncellendi", "ok");
          router.refresh();
        }
      } catch {
        push("Taşınamadı", "err");
        router.refresh();
      } finally {
        setBusyId(null);
      }
    });
  }

  /** Sürükle-bırak, kart düğmeleri ve klavye aynı kararı (board-logic) uygular. */
  function apply(action: BoardAction) {
    if (action.kind === "unsupported") {
      push("Bu taşıma desteklenmiyor", "err");
    } else if (action.kind === "stage") {
      move(action.dealId, action.stage);
    } else if (action.kind === "closing") {
      // Kazanıldı/Kaybedildi: popup YOK. Kart sütununda kalır; aşama, anlaşma detayındaki
      // Kapanış sekmesinde (sihirbaz) onaylanınca değişir.
      setBusyId(action.dealId);
      push(`${stageLabels[action.outcome].label}: kapanış sihirbazı açılıyor`, "info");
      startTransition(() => router.push(action.href));
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    armClickGuard();
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    releaseClickGuard();
    const deal = optimisticDeals.find((x) => x.id === event.active.id);
    apply(resolveBoardDrop({ canEdit, deal, target: event.over?.id }));
  }

  function handleDragCancel() {
    setActiveId(null);
    releaseClickGuard();
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

  const activeDeal = activeId ? (optimisticDeals.find((d) => d.id === activeId) ?? null) : null;

  return (
    <div>
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={boardCollisionDetection}
        autoScroll={BOARD_AUTO_SCROLL}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: BOARD_SCREEN_READER_INSTRUCTIONS },
        }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div id="tahta" className="flex scroll-mt-24 gap-3 overflow-x-auto pb-2">
          {STAGES.map((col, colIdx) => {
            const rows = columns[col.key];
            const sum = rows.reduce((s, d) => s + (Number(d.deal_value) || 0), 0);
            const next = isClosingStage(col.key) ? null : adjacentColumn(col.key, 1);
            return (
              <BoardColumn
                key={col.key}
                stage={col.key}
                tone={col.tone}
                ring={col.ring}
                label={stageLabels[col.key].label}
                color={stageLabels[col.key].color}
                count={rows.length}
                sum={sum}
                index={colIdx}
                dragFrom={activeDeal ? activeDeal.stage : null}
              >
                {rows.map((d) => {
                  const busy = busyId === d.id && pending;
                  return (
                    <BoardCard
                      key={d.id}
                      deal={d}
                      stage={col.key}
                      next={d.stage === col.key ? next : null}
                      stageLabels={stageLabels}
                      memberName={d.assigned_to ? (memberById.get(d.assigned_to) ?? null) : null}
                      busy={busy}
                      canEdit={canEdit}
                      justDropped={droppedId === d.id}
                      onStage={(to) => apply(resolveStageChange(d, to))}
                      onEdit={(trigger) => {
                        editReturnFocusRef.current = trigger;
                        setEditing(d);
                      }}
                    />
                  );
                })}
              </BoardColumn>
            );
          })}
        </div>

        {/* Sürüklenen kartın önizlemesi. Uygulama şablonu dönüşüm (transform) içerdiğinden katman
            body'ye taşınır; aksi halde `position: fixed` görünüm alanına göre konumlanmaz. */}
        {isClient
          ? createPortal(
              <DragOverlay
                dropAnimation={reducedMotion ? null : DROP_ANIMATION}
                transition={reducedMotion ? "none" : undefined}
              >
                {activeDeal ? <CardPreview deal={activeDeal} /> : null}
              </DragOverlay>,
              document.body,
            )
          : null}
      </DndContext>

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
              <DialogDescription className="text-sm text-text-muted">{dealTitle(editing)} · {editing.customer_name ?? "Müşteri atanmadı"}</DialogDescription>
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
    </div>
  );
}

/** Aşama sütunu = bırakma hedefi. Sürükleme sırasında geçerli hedefler vurgulanır, geçersizler soluklaşır. */
function BoardColumn({
  stage,
  tone,
  ring,
  label,
  color,
  count,
  sum,
  index,
  dragFrom,
  children,
}: {
  stage: DealStage;
  tone: string;
  ring: string;
  label: string;
  color: string | null;
  count: number;
  sum: number;
  index: number;
  /** Sürüklenen kartın aşaması; sürükleme yokken null. */
  dragFrom: string | null;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const dragging = dragFrom !== null;
  const valid = dragging && canDropOn(dragFrom, stage);
  const origin = dragging && columnOf(dragFrom) === stage;
  const blocked = dragging && !valid && !origin;

  const surface = valid
    ? isOver
      ? "border-dashed border-brand-400/80 bg-brand-600/10"
      : "border-dashed border-brand-400/50 bg-brand-600/5"
    : blocked
      ? isOver
        ? "border-danger-500/40 bg-danger-500/5 opacity-70"
        : `${ring} opacity-60`
      : ring;

  const hint =
    isOver && valid
      ? isClosingStage(stage)
        ? "Bırakın: kapanış sihirbazı açılır"
        : "Bırakın: bu aşamaya taşınır"
      : isOver && blocked
        ? "Bu aşamaya taşınamaz"
        : null;

  return (
    <section
      ref={setNodeRef}
      id={`sutun-${stage}`}
      aria-label={`${label} aşaması, ${count} anlaşma`}
      className={`min-w-[260px] flex-1 scroll-mt-24 rounded-[var(--radius-panel)] border backdrop-blur transition-[border-color,background-color,opacity] duration-150 ${surface}`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line/60 px-3.5 py-3">
        <div className="min-w-0">
          <p
            className={`text-xs font-extrabold uppercase tracking-[0.12em] ${tone}`}
            style={color ? { color } : undefined}
          >
            {label}
          </p>
          <p className={`mt-0.5 truncate text-xs ${hint ? (blocked ? "font-semibold text-danger-500" : "font-semibold text-brand-600") : "text-text-muted"}`}>
            {hint ?? `${count} · ${money(sum)}`}
          </p>
        </div>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface text-xs font-bold text-ink-950 shadow-[var(--shadow-xs)]">
          {count}
        </span>
      </header>
      <div className="space-y-2.5 p-2.5">
        {count === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-3 py-8 text-center text-xs text-text-faint">
            Boş sütun
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/** Kartın üst bölümü: gerçek kart ve sürükleme önizlemesi aynı içeriği paylaşır. */
function CardSummary({ deal, busy = false, trailing }: { deal: BoardDeal; busy?: boolean; trailing?: ReactNode }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-950">{dealTitle(deal)}</p>
          <p className="mt-0.5 truncate text-xs text-text-muted">
            {deal.customer_name ?? "Müşteri atanmadı"} · {deal.deal_type === "rent" ? "Kiralama" : "Satış"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" /> : null}
          {/* Evrak durumu — zorunlu evraklardan tamamlanan/toplam; liste yoksa gizli */}
          {deal.checklist_total > 0 ? (
            <span
              title={`${deal.checklist_done}/${deal.checklist_total} zorunlu evrak tamam`}
              className={`numeric inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold ${
                deal.checklist_done === deal.checklist_total ? "bg-mint-500/12 text-mint-700" : "bg-canvas text-text-muted"
              }`}
            >
              <FileCheck2 className="h-3 w-3" /> {deal.checklist_done}/{deal.checklist_total}
            </span>
          ) : null}
          {/* Not sayacı — detaydaki not akışına işaret; 0 ise gösterilmez */}
          {deal.note_count > 0 ? (
            <span
              title={`${deal.note_count} not`}
              className="numeric inline-flex items-center gap-0.5 rounded-full bg-canvas px-1.5 py-0.5 text-xs font-bold text-text-muted"
            >
              <MessageSquare className="h-3 w-3" /> {deal.note_count}
            </span>
          ) : null}
          {trailing}
        </div>
      </div>
      <p className="mt-2 font-display text-base font-extrabold text-ink-950">{money(deal.deal_value)}</p>
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-canvas">
        <div
          className="bar-live rounded-full bg-[image:var(--grad-brand)]"
          style={{ width: `${Math.min(100, Number(deal.probability) || 20)}%` }}
        />
      </div>
    </>
  );
}

/** DragOverlay içeriği: etkileşimsiz, kaldırılmış kart görünümü. */
function CardPreview({ deal }: { deal: BoardDeal }) {
  return (
    <div className="cursor-grabbing select-none rounded-[var(--radius-card)] border border-brand-400 bg-surface p-3 shadow-[var(--shadow-lg)] ring-2 ring-brand-400/30 [transform:rotate(1.5deg)]">
      <CardSummary deal={deal} trailing={<GripVertical className="h-4 w-4 text-brand-600" aria-hidden />} />
    </div>
  );
}

function BoardCard({
  deal: d,
  stage,
  next,
  stageLabels,
  memberName,
  busy,
  canEdit,
  justDropped,
  onStage,
  onEdit,
}: {
  deal: BoardDeal;
  /** Kartın durduğu sütun. */
  stage: DealStage;
  /** Sıradaki aşama (kapanmış sütunlarda yok). */
  next: DealStage | null;
  stageLabels: StageLabels;
  memberName: string | null;
  busy: boolean;
  canEdit: boolean;
  justDropped: boolean;
  onStage: (to: DealStage) => void;
  onEdit: (trigger: HTMLElement) => void;
}) {
  const title = dealTitle(d);
  // Kartın tamamı fare/dokunma ile sürüklenir; klavye ve ekran okuyucu tutamağı (44 px) kullanır.
  // role/aria/tabIndex tutamaçtadır: kartın kendisi link ve düğme içerdiği için düğme rolü alamaz.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: d.id,
    disabled: !canEdit || busy,
    data: { title: dealSpokenName(d), stage: d.stage } satisfies BoardDragData,
    attributes: { roleDescription: "sürüklenebilir anlaşma kartı" },
  });

  return (
    <article
      ref={setNodeRef}
      id={`deal-card-${d.id}`}
      tabIndex={-1}
      {...listeners}
      className={`lift group relative rounded-[var(--radius-card)] border bg-surface p-3 shadow-[var(--shadow-xs)] transition focus:outline-none focus:ring-2 focus:ring-brand-400/40 ${
        canEdit ? "cursor-grab select-none [-webkit-touch-callout:none] active:cursor-grabbing" : ""
      } ${
        isDragging
          ? "border-brand-300 opacity-40"
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
        aria-label={`${title} detayını aç`}
      />
      <CardSummary
        deal={d}
        busy={busy}
        trailing={
          canEdit ? (
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              aria-label={`${title} anlaşmasını taşı`}
              title="Sürükleyerek taşı (klavye: Boşluk veya Enter, sonra sol/sağ ok)"
              className="focus-ring relative z-10 -my-2 -mr-2 grid h-11 w-11 shrink-0 cursor-grab touch-none place-items-center rounded-[var(--radius-control)] text-text-faint transition hover:text-text-muted active:cursor-grabbing aria-disabled:cursor-default aria-disabled:opacity-50"
            >
              <GripVertical className="h-4 w-4" aria-hidden />
            </button>
          ) : null
        }
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        {d.assigned_to ? (
          <Link
            href={`/app/ekip/${d.assigned_to}`}
            draggable={false}
            className="focus-ring group/danisman relative z-10 flex min-w-0 items-center gap-1.5 rounded-[var(--radius-control)]"
            title="Danışman profilini aç"
          >
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[image:var(--grad-brand)] text-xs font-bold text-white">
              {initials(memberName ?? "?")}
            </span>
            <span className="truncate text-xs font-semibold text-text-muted transition group-hover/danisman:text-brand-600">
              {memberName ?? "Danışman"}
            </span>
          </Link>
        ) : (
          <span className="text-xs text-text-faint">Danışman atanmadı</span>
        )}
        <span className="shrink-0 text-xs text-text-faint">{updatedAgo(d.updated_at)}</span>
      </div>
      {/* Düğme satırı sürüklemeyi başlatmaz (bkz. board-dnd.ts NO_DRAG_PROPS). */}
      <div {...NO_DRAG_PROPS} className="relative z-10 mt-3 flex flex-wrap items-center gap-1.5">
        <StatusTransitionBar dealId={d.id} stage={d.stage} stageLabels={stageLabels} />
        {canEdit ? (
          <button
            type="button"
            onClick={(event) => onEdit(event.currentTarget)}
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
        {next ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onStage(next)}
            className="ml-auto inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-ink-950 px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
          >
            {stageLabels[next].label} <ArrowRight className="h-3 w-3" />
          </button>
        ) : null}
        {stage === "negotiation" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onStage("won")}
            className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-mint-500/15 px-2 py-1 text-xs font-bold text-mint-700 disabled:opacity-50"
          >
            <Sparkles className="h-3 w-3" /> Kazan
          </button>
        ) : null}
        {!isClosingStage(stage) ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onStage("lost")}
            className="rounded-[var(--radius-control)] px-2 py-1 text-xs font-semibold text-danger-500 hover:bg-danger-500/10 disabled:opacity-50"
          >
            Kayıp
          </button>
        ) : null}
      </div>
    </article>
  );
}
