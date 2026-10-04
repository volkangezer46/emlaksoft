/**
 * Anlaşma panosu — saf mantık (IO yok, React yok, sürükle-bırak kütüphanesi yok).
 *
 * Bir kart bir sütuna bırakıldığında (veya düğme/menüden bir aşama seçildiğinde) NE olacağına
 * burada karar verilir; pano bileşeni yalnız kararı uygular:
 *   - açık aşama (Yeni/Nitelikli/Müzakere) → `updateDealStage` (optimistik taşıma)
 *   - Kazanıldı / Kaybedildi → popup YOK; anlaşma detayındaki Kapanış sekmesine yönlendirme.
 *     Kart eski sütununda kalır; aşama sihirbazda onaylanınca değişir.
 * Geçiş kuralı sunucunun tek kaynağından (`lib/workflow-state.ts`) okunur; nihai karar yine
 * `updateDealStage` + `transition_deal_stage_atomic` içindedir.
 */
import { DEAL_STAGES, isDealStage, isDealTransitionAllowed, type DealStage } from "@/lib/workflow-state";
import { closingTabHref, type ClosingOutcome } from "./[id]/kapanis-model";

/** Sütun sırası = aşama sırası (klavye ok tuşları bu sırada gezer). */
export const BOARD_COLUMNS: readonly DealStage[] = DEAL_STAGES;

/** Kartın durduğu sütun: tanınmayan aşama "Yeni" sütununda gösterilir. */
export function columnOf(stage: string): DealStage {
  return isDealStage(stage) ? stage : "new";
}

export function isClosingStage(stage: DealStage): stage is ClosingOutcome {
  return stage === "won" || stage === "lost";
}

/** Bırakma hedefi geçerli mi (sütun vurgusu ve duyurular için): başka sütun + izinli geçiş. */
export function canDropOn(from: string, to: DealStage): boolean {
  return isDealStage(from) && from !== to && isDealTransitionAllowed(from, to);
}

/** Karar için gereken en küçük anlaşma bilgisi. */
export type DealRef = { id: string; stage: string };

export type BoardAction =
  /** Hiçbir şey yapılmaz (sessiz). */
  | { kind: "none"; reason: "forbidden" | "no-target" | "same-column" }
  /** İzinli olmayan geçiş: kart yerinde kalır, kullanıcıya "desteklenmiyor" denir. */
  | { kind: "unsupported"; from: DealStage; to: DealStage }
  /** Açık aşamaya taşıma: `updateDealStage` çağrılır. */
  | { kind: "stage"; dealId: string; from: DealStage; stage: DealStage }
  /** Kazanıldı/Kaybedildi: Kapanış sekmesine yönlendirilir; aşama burada değişmez. */
  | { kind: "closing"; dealId: string; from: DealStage; outcome: ClosingOutcome; href: string };

/** Düğme, "Geçiş" menüsü ve sürükle-bırak için ortak karar: `deal` → `to` aşaması. */
export function resolveStageChange(deal: DealRef, to: DealStage): BoardAction {
  const from = columnOf(deal.stage);
  if (from === to) return { kind: "none", reason: "same-column" };
  if (!canDropOn(deal.stage, to)) return { kind: "unsupported", from, to };
  if (isClosingStage(to)) return { kind: "closing", dealId: deal.id, from, outcome: to, href: closingTabHref(deal.id, to) };
  return { kind: "stage", dealId: deal.id, from, stage: to };
}

/**
 * Sürükle-bırak sonucu. `target` bırakılan sütunun kimliğidir (aşama anahtarı); sütun dışına
 * bırakmada null gelir. Düzenleme yetkisi yoksa hiçbir eylem üretilmez.
 */
export function resolveBoardDrop(input: {
  canEdit: boolean;
  deal: DealRef | null | undefined;
  target: string | number | null | undefined;
}): BoardAction {
  if (!input.canEdit) return { kind: "none", reason: "forbidden" };
  const target = typeof input.target === "string" && isDealStage(input.target) ? input.target : null;
  if (!input.deal || !target) return { kind: "none", reason: "no-target" };
  return resolveStageChange(input.deal, target);
}

/** Klavye: sol/sağ okla komşu sütun. Uçta null (hareket yok). */
export function adjacentColumn(current: DealStage, direction: -1 | 1): DealStage | null {
  const index = BOARD_COLUMNS.indexOf(current);
  return BOARD_COLUMNS[index + direction] ?? null;
}

// ---------------------------------------------------------------- Ekran okuyucu metinleri

export type StageNames = Readonly<Record<DealStage, string>>;

/** Tutamağa odaklanınca okunan kullanım talimatı (dnd-kit `screenReaderInstructions`). */
export const BOARD_SCREEN_READER_INSTRUCTIONS =
  "Anlaşmayı taşımak için Boşluk veya Enter tuşuna basın. Tutarken sol ve sağ ok tuşlarıyla aşama sütunu seçin; " +
  "bırakmak için yeniden Boşluk veya Enter tuşuna, vazgeçmek için Escape tuşuna basın. " +
  "Kazanıldı veya Kaybedildi sütununa bırakınca kapanış sihirbazı açılır.";

export function announceDragStart(title: string, from: string, names: StageNames): string {
  return `Anlaşma ${title} alındı. Şu an ${names[columnOf(from)]} aşamasında.`;
}

/**
 * Sütun üzerine gelindiğinde. Tutma anında kartın kendi sütunu raporlanır; bu ilk raporda susar ki
 * "alındı" duyurusu ezilmesin. Sonradan kendi sütununa dönülürse duyurulur.
 */
export function announceDragOver(input: {
  from: string;
  over: DealStage | null;
  /** Tutma anından sonraki ilk rapor mu. */
  first: boolean;
  names: StageNames;
}): string | undefined {
  const { from, over, first, names } = input;
  if (over === null) return first ? undefined : "Hiçbir aşama sütununun üzerinde değil.";
  if (over === columnOf(from)) {
    return first ? undefined : `${names[over]} aşamasına geri dönüldü. Bırakırsanız aşama değişmez.`;
  }
  if (!canDropOn(from, over)) return `${names[over]} aşamasının üzerinde. Bu aşamaya taşınamaz.`;
  return isClosingStage(over)
    ? `${names[over]} aşamasının üzerinde. Bırakırsanız kapanış sihirbazı açılır.`
    : `${names[over]} aşamasının üzerinde. Bırakmak için Boşluk veya Enter.`;
}

export function announceDragEnd(title: string, action: BoardAction, names: StageNames): string {
  switch (action.kind) {
    case "stage":
      return `Anlaşma ${title}, ${names[action.stage]} aşamasına taşındı.`;
    case "closing":
      return `Anlaşma ${title} için kapanış sihirbazı açılıyor: ${names[action.outcome]}. Aşama, sihirbazda onaylanınca değişir.`;
    case "unsupported":
      return `Bu taşıma desteklenmiyor. Anlaşma ${title}, ${names[action.from]} aşamasında kaldı.`;
    default:
      return `Anlaşma ${title} bırakıldı. Aşama değişmedi.`;
  }
}

export function announceDragCancel(title: string, from: string, names: StageNames): string {
  return `Taşıma iptal edildi. Anlaşma ${title}, ${names[columnOf(from)]} aşamasında kaldı.`;
}
