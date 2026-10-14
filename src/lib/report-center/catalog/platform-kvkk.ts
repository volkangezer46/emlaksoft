/**
 * KVKK veri sahibi başvuruları (DG6) — platform raporları. Dosya çıktısı YALNIZ buradan (rapor merkezi deseni; admin
 * başvuru sayfasında indirme/rapor bağlantısı yok). Veri servis istemcisiyle okunur (`buildPlatformContext`).
 *  - "KVKK veri paketi": başvuru no ile kişiye ait kayıtlar (yalnız kimliği doğrulanmış ve kayıtları taranmış başvuru;
 *    aksi halde boş). Kayıtlar dosya anında yeniden okunur. XLSX'te bölümlere göre ayrı sayfalar.
 *  - "KVKK başvuru defteri": başvuruların YALNIZ meta kaydı (başvuru no, tür, durum, kimlik, tarihler, kalan gün).
 */
import { now } from "@/lib/clock";
import {
  IDENTITY_STATUS_LABELS,
  PLATFORM_KVKK_STATUS_LABELS,
  PLATFORM_KVKK_TYPE_LABELS,
  platformKvkkDaysLeft,
} from "@/lib/compliance/platform-kvkk";
import { loadPackageRowsByRef } from "@/lib/compliance/platform-kvkk-service";
import { DATE_RANGE_FIELDS } from "../filters";
import { applyTimestampRange, label } from "../query-helpers";
import { defineReport, opts } from "./define";

const QUEUE_STATUS_LABELS = Object.fromEntries(Object.entries(PLATFORM_KVKK_STATUS_LABELS).filter(([k]) => k !== "awaiting_email"));
const DELIVERY_LABELS: Record<string, string> = { sent: "E-postayla gönderildi", failed: "Gönderilemedi", disabled: "Kanal kapalı", suppressed: "Bastırılmış adres" };

export const kvkkVeriPaketi = defineReport({
  id: "kvkk-veri-paketi",
  title: "KVKK veri paketi",
  description:
    "Başvuru numarasıyla kişiye ait kayıtların dökümü (ofis müşteri kayıtları, ilişkili kayıt sayıları, EmlakSoft kayıtları). Yalnız kimliği doğrulanmış ve kayıtları taranmış başvuruda dolar.",
  category: "destek",
  scope: "platform",
  platformModule: "tickets",
  personalData: true,
  xlsxSheetBy: "bolum",
  keywords: ["kvkk", "veri paketi", "erişim", "taşınabilirlik", "ilgili kişi", "başvuru"],
  filters: [{ kind: "text", key: "basvuru", label: "Başvuru no", placeholder: "KVKK-2026-XXXXXX" }],
  columns: [
    { key: "bolum", label: "Bölüm", type: "text", width: 20, get: (r) => r.bolum },
    { key: "ofis", label: "Kaynak", type: "text", width: 28, get: (r) => r.ofis },
    { key: "kayit", label: "Kayıt", type: "text", width: 22, get: (r) => r.kayit },
    { key: "alan", label: "Alan", type: "text", width: 22, get: (r) => r.alan },
    { key: "deger", label: "Değer", type: "text", width: 44, get: (r) => r.deger },
    { key: "tarih", label: "Kayıt tarihi", type: "date", get: (r) => r.tarih },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => (f.basvuru ? loadPackageRowsByRef(ctx.supabase, f.basvuru) : []),
  },
});

export const kvkkBasvuruDefteri = defineReport({
  id: "kvkk-basvuru-defteri",
  title: "KVKK başvuru defteri",
  description:
    "EmlakSoft'a doğrudan gelen KVKK başvuruları: başvuru no, tür, durum, kimlik doğrulaması, alınış, 30 günlük son tarih, kalan gün ve sonuç (kişi adı ve içerik yok).",
  category: "destek",
  scope: "platform",
  platformModule: "tickets",
  keywords: ["kvkk", "ilgili kişi", "başvuru", "son tarih", "sla"],
  filters: [
    { kind: "select", key: "tur", label: "Tür", options: opts(PLATFORM_KVKK_TYPE_LABELS) },
    { kind: "select", key: "durum", label: "Durum", options: opts(QUEUE_STATUS_LABELS) },
    ...DATE_RANGE_FIELDS("Başvuru başlangıcı", "Başvuru bitişi"),
  ],
  columns: [
    { key: "ref", label: "Başvuru no", type: "text", width: 18, get: (r) => r.ref },
    { key: "tur", label: "Tür", type: "text", width: 22, get: (r) => label(PLATFORM_KVKK_TYPE_LABELS, r.request_type) },
    { key: "durum", label: "Durum", type: "text", width: 14, get: (r) => label(PLATFORM_KVKK_STATUS_LABELS, r.status) },
    { key: "kimlik", label: "Kimlik", type: "text", width: 14, get: (r) => label(IDENTITY_STATUS_LABELS, r.identity_status) },
    { key: "alinis", label: "Alınış", type: "datetime", get: (r) => r.email_verified_at },
    { key: "sonTarih", label: "Son tarih (30 gün)", type: "date", get: (r) => r.due_at },
    { key: "kalan", label: "Kalan gün", type: "number", get: (r) => platformKvkkDaysLeft(r.due_at, String(r.status), now()) },
    { key: "sonuc", label: "Sonuç tarihi", type: "date", get: (r) => r.resolved_at },
    { key: "yanit", label: "Yanıt teslimi", type: "text", width: 20, get: (r) => (r.resolved_at ? label(DELIVERY_LABELS, r.response_delivery) || "Başka kanal" : "") },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("platform_kvkk_requests")
        .select("id, ref, request_type, status, identity_status, email_verified_at, due_at, resolved_at, response_delivery", { count: "exact" })
        .neq("status", "awaiting_email");
      if (f.tur) q = q.eq("request_type", f.tur);
      if (f.durum) q = q.eq("status", f.durum);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: true }).order("id", { ascending: true });
    },
  },
});

export const PLATFORM_KVKK_REPORTS = [kvkkVeriPaketi, kvkkBasvuruDefteri];
