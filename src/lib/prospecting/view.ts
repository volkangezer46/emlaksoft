import { DAY_MS } from "@/lib/clock";
import { formatPhoneDisplay } from "@/lib/phone";
import { formatTry } from "@/lib/utils";
import type { FsboRow } from "./load";
import { OPEN_STATUSES, TRANSACTION_LABELS, type FsboPortal, type FsboStatus, type FsboTransaction } from "./types";

/** Kart verisi: sunucuda, sunucu saatiyle hazırlanır (istemci hidrasyonu saat farkından etkilenmez). */
export type FsboCardData = {
  id: string;
  title: string;
  url: string | null;
  portal: FsboPortal;
  status: FsboStatus;
  lostReason: string | null;
  priceText: string;
  dropText: string | null;
  place: string;
  specs: string;
  ageText: string;
  lastContactText: string;
  nextText: string;
  overdue: boolean;
  assigneeName: string | null;
  assignedTo: string | null;
  ownerName: string | null;
  phoneDisplay: string | null;
  phoneTel: string | null;
  attempts: number;
  doNotCall: boolean;
  relist: boolean;
  isSample: boolean;
  piiPurged: boolean;
  hasPhone: boolean;
};

const startOfDay = (ms: number) => Math.floor(ms / DAY_MS);

/** Gün farkı (takvim günü; saat dilimi ofsetini göz ardı eden yaklaşık ama tutarlı sayım). */
function dayDiff(fromMs: number, toMs: number): number {
  return startOfDay(toMs) - startOfDay(fromMs);
}

export function relativePast(iso: string | null, nowMs: number, empty = "Henüz yok"): string {
  if (!iso) return empty;
  const d = dayDiff(Date.parse(iso), nowMs);
  if (d <= 0) return "Bugün";
  if (d === 1) return "Dün";
  return `${d} gün önce`;
}

export function nextActionText(iso: string | null, status: FsboStatus, nowMs: number): { text: string; overdue: boolean } {
  if (!(OPEN_STATUSES as readonly string[]).includes(status)) return { text: "Takip yok", overdue: false };
  if (!iso) return { text: status === "randevu" || status === "yetki_alindi" ? "Randevu / yetki sürecinde" : "Planlanmadı", overdue: false };
  const d = dayDiff(nowMs, Date.parse(iso));
  if (d < 0) return { text: `${-d} gün gecikti`, overdue: true };
  if (d === 0) return { text: "Bugün", overdue: false };
  if (d === 1) return { text: "Yarın", overdue: false };
  return { text: `${d} gün sonra`, overdue: false };
}

export function toCardData(r: FsboRow, nowMs: number): FsboCardData {
  const age = r.listed_at ? dayDiff(Date.parse(r.listed_at), nowMs) : dayDiff(Date.parse(r.first_seen_at), nowMs);
  const next = nextActionText(r.next_action_at, r.status, nowMs);
  const tx = TRANSACTION_LABELS[(r.transaction_type as FsboTransaction) ?? "sale"] ?? "";
  const place = [r.districtName, r.location_text].filter(Boolean).join(" · ");
  const specs = [r.rooms, r.gross_m2 ? `${Math.round(r.gross_m2)} m²` : null].filter(Boolean).join(" · ");
  const title = r.title?.trim() || [r.districtName, r.rooms, tx].filter(Boolean).join(" ") || "Sahibinden ilan";
  return {
    id: r.id,
    title,
    url: r.url,
    portal: (r.portal as FsboPortal) ?? "other",
    status: r.status,
    lostReason: r.lost_reason,
    priceText: r.price != null ? formatTry(r.price) : "Fiyat yok",
    dropText: r.price_drop_count > 0 && r.last_price_drop_pct ? `↓ %${Math.round(r.last_price_drop_pct)}` : null,
    place: place || tx,
    specs,
    ageText: age <= 0 ? "Bugün" : r.listed_at ? `${age} gün` : `en az ${age} gün`,
    lastContactText: r.contact_attempts > 0 ? `${relativePast(r.last_contact_at, nowMs)} · ${r.contact_attempts} deneme` : "Aranmadı",
    nextText: next.text,
    overdue: next.overdue,
    assigneeName: r.assigneeName,
    assignedTo: r.assigned_to,
    ownerName: r.owner_name,
    phoneDisplay: r.phone ? formatPhoneDisplay(r.phone) : null,
    phoneTel: r.phone,
    attempts: r.contact_attempts,
    doNotCall: r.doNotCall,
    relist: !!r.relist_of,
    isSample: r.is_sample,
    piiPurged: !!r.pii_purged_at,
    hasPhone: !!r.phone,
  };
}
