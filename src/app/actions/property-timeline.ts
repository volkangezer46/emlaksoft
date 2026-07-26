"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";

/**
 * Portföyün zaman tüneli (X9).
 *
 * NEDEN GEREKLİ: Portföy detayında fiyat geçmişi ve durum geçmişi AYRI iki
 * bölümdü. İkisi de doğruydu ama hikâyeyi anlatmıyorlardı — "bu portföy neden
 * satmıyor?" sorusunun cevabı olayların SIRASINDA:
 *
 *   ilan açıldı → 40 gün hiç ziyaret yok → fiyat %5 düştü → 2 ziyaret →
 *   liste altı teklif → reddedildi → portal yayından kalktı
 *
 * Bu diziyi görmek için kullanıcının üç ayrı bölümü zihninde birleştirmesi
 * gerekiyordu. Ayrıca portal yayını, teklif, randevu ve açık ev hiçbir
 * kronolojide görünmüyordu.
 *
 * NEDEN TEK SQL DEĞİL: Yedi farklı tablodan farklı şekilli satırlar geliyor.
 * `union all` ile birleştirmek her tabloyu aynı kolon setine zorlamak demek;
 * okunması ve genişletilmesi zor bir sorgu çıkar. Paralel yedi küçük sorgu +
 * bellekte birleştirme daha anlaşılır ve tek portföy için ölçek sorunu yok.
 */

export type TimelineKind =
  | "price"
  | "status"
  | "portal"
  | "appointment"
  | "offer"
  | "openhouse"
  | "media";

export type TimelineEvent = {
  id: string;
  kind: TimelineKind;
  at: string;
  title: string;
  detail?: string | null;
  /** Olumlu / olumsuz / nötr — arayüzde renk için. */
  tone?: "ok" | "warn" | "danger" | "neutral";
};

function tl(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(Number(n)) + " ₺";
}

const APPT_LABEL: Record<string, string> = {
  showing: "Yer gösterme",
  office: "Ofis görüşmesi",
  valuation: "Değerleme",
  contract: "Sözleşme",
};

/*
 * `offers.status` bir ENUM: offer_status = draft | submitted | countered |
 * accepted | rejected | withdrawn.
 *
 * Ilk yazimda bu haritada `pending` ve `expired` vardi — IKISI DE ENUM'DA YOK,
 * yani hic gorunmezdi. Buna karsilik `draft`, `submitted` ve `withdrawn`
 * EKSIKTI ve ham enum degeri olarak ekrana dusuyordu. Enum'u canli semadan
 * okuyup hizalandi.
 */
const OFFER_LABEL: Record<string, string> = {
  draft: "taslak",
  submitted: "iletildi",
  countered: "karşı teklif verildi",
  accepted: "kabul edildi",
  rejected: "reddedildi",
  withdrawn: "geri çekildi",
};

export async function getPropertyTimeline(propertyId: string): Promise<TimelineEvent[]> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok || !propertyId) return [];

  const supabase = await createClient();

  // RLS kiracı ayrımını yapıyor; `tenant_id` filtresi elle eklenmiyor.
  const [fiyat, durum, portal, randevu, teklif, acikEv, medya] = await Promise.all([
    supabase
      .from("property_price_history")
      .select("id, price_field, old_price, new_price, change_pct, reason, created_at")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("property_status_history")
      .select("id, old_status, new_status, reason, created_at")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("portal_listings")
      .select("id, portal_name, status, published_at, removed_at, removal_reason, created_at")
      .eq("property_id", propertyId)
      .limit(40),
    supabase
      .from("appointments")
      .select("id, appointment_type, scheduled_at, status")
      .eq("property_id", propertyId)
      .order("scheduled_at", { ascending: false })
      .limit(60),
    supabase
      .from("offers")
      .select("id, amount, status, created_at")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("open_houses")
      .select("id, scheduled_at, visitor_count, status")
      .eq("property_id", propertyId)
      .order("scheduled_at", { ascending: false })
      .limit(20),
    supabase
      .from("property_media")
      .select("id, created_at")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const olaylar: TimelineEvent[] = [];

  for (const r of fiyat.data ?? []) {
    const pct = r.change_pct != null ? Number(r.change_pct) : null;
    const artti = pct != null && pct > 0;
    olaylar.push({
      id: `p-${r.id}`,
      kind: "price",
      at: r.created_at,
      title: `Fiyat ${tl(r.old_price)} → ${tl(r.new_price)}`,
      detail: [pct != null ? `%${Math.abs(pct)} ${artti ? "artış" : "indirim"}` : null, r.reason]
        .filter(Boolean)
        .join(" · "),
      // İndirim satış şansını artırır ama marjı düşürür; nötr bırakmak yerine
      // yönü göstermek daha bilgilendirici.
      tone: artti ? "warn" : "ok",
    });
  }

  for (const r of durum.data ?? []) {
    const yeni = String(r.new_status ?? "");
    olaylar.push({
      id: `s-${r.id}`,
      kind: "status",
      at: r.created_at,
      title: `Durum: ${r.old_status ?? "—"} → ${yeni}`,
      detail: r.reason,
      tone: yeni === "sold" || yeni === "rented" ? "ok" : yeni === "archived" ? "danger" : "neutral",
    });
  }

  /*
   * Portal satırı TEK kayıt ama İKİ olay taşıyor: yayına alınma ve kaldırılma.
   * Ayrı ayrı eklenmezse kronoloji "ne zaman yayından kalktı" sorusunu
   * cevaplayamaz.
   */
  for (const r of portal.data ?? []) {
    const yayin = r.published_at ?? r.created_at;
    if (yayin) {
      olaylar.push({
        id: `pl-${r.id}-in`,
        kind: "portal",
        at: yayin,
        title: `${r.portal_name} yayına alındı`,
        tone: "ok",
      });
    }
    if (r.removed_at) {
      olaylar.push({
        id: `pl-${r.id}-out`,
        kind: "portal",
        at: r.removed_at,
        title: `${r.portal_name} yayından kaldırıldı`,
        detail: r.removal_reason,
        tone: "danger",
      });
    }
  }

  for (const r of randevu.data ?? []) {
    const iptal = r.status === "cancelled";
    olaylar.push({
      id: `a-${r.id}`,
      kind: "appointment",
      at: r.scheduled_at,
      title: APPT_LABEL[r.appointment_type] ?? r.appointment_type,
      detail: iptal ? "iptal edildi" : (r.status ?? null),
      tone: iptal ? "danger" : "neutral",
    });
  }

  for (const r of teklif.data ?? []) {
    olaylar.push({
      id: `o-${r.id}`,
      kind: "offer",
      at: r.created_at,
      title: `Teklif ${tl(r.amount)}`,
      detail: OFFER_LABEL[r.status] ?? r.status,
      tone:
        r.status === "accepted"
          ? "ok"
          : r.status === "rejected" || r.status === "withdrawn"
            ? "danger"
            : "warn",
    });
  }

  for (const r of acikEv.data ?? []) {
    olaylar.push({
      id: `oh-${r.id}`,
      kind: "openhouse",
      at: r.scheduled_at,
      title: "Açık ev",
      detail: `${r.visitor_count ?? 0} ziyaretçi`,
      tone: (r.visitor_count ?? 0) > 0 ? "ok" : "neutral",
    });
  }

  /*
   * Medya tek tek listelenmiyor: 40 fotoğraf yüklenmişse kronolojiyi tek
   * başına doldurur ve asıl olayları görünmez kılar. Aynı GÜNE düşenler
   * tek satırda toplanıyor.
   */
  const medyaGun = new Map<string, number>();
  for (const r of medya.data ?? []) {
    const gun = String(r.created_at).slice(0, 10);
    medyaGun.set(gun, (medyaGun.get(gun) ?? 0) + 1);
  }
  for (const [gun, adet] of medyaGun) {
    olaylar.push({
      id: `m-${gun}`,
      kind: "media",
      at: `${gun}T12:00:00.000Z`,
      title: `${adet} görsel/belge eklendi`,
      tone: "neutral",
    });
  }

  // Yeniden eskiye. Geçersiz tarihli satır varsa sona düşsün.
  return olaylar
    .filter((e) => e.at && !Number.isNaN(new Date(e.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
