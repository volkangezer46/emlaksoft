/**
 * Ofis raporları — Sahibinden ilanlar (portföy avı): "Sahibinden ilan hunisi".
 * Kişisel veri kolonu YOK (ad/telefon girmez); kiracı sınırı + aktör kapsamı (`applyActorScope`) sorgudadır.
 */
import { buildFunnel, type FunnelRow } from "@/lib/prospecting/funnel";
import { FSBO_LOST_REASONS, LOST_REASON_LABELS, STATUS_LABELS } from "@/lib/prospecting/types";
import { DATE_RANGE_FIELDS } from "../filters";
import { applyActorScope, applyTimestampRange, enrichProfiles, nameOf } from "../query-helpers";
import type { Row } from "../types";
import { ADVISOR_FILTER, defineReport, tid } from "./define";

/** Hesaplamada okunacak en çok satır (kapsamlı ofis için yeterli; aşılırsa rapor tavanı çağıran tarafta uygulanır). */
const FUNNEL_ROW_CAP = 20_000;

export const sahibindenIlanHunisi = defineReport({
  id: "sahibinden-ilan-hunisi",
  title: "Sahibinden ilan hunisi",
  description: "Kaydedilen sahibinden ilanların danışman bazında durum adetleri, yetki ve portföye dönüşüm oranı ile kayıp nedenleri. Ad ve telefon içermez.",
  category: "portfoy",
  scope: "tenant",
  module: "prospecting",
  keywords: ["sahibinden", "ilan sahibi", "portföy avı", "dönüşüm", "huni", "kayıp nedeni"],
  filters: [ADVISOR_FILTER, ...DATE_RANGE_FIELDS("Kayıt başlangıcı", "Kayıt bitişi")],
  columns: [
    { key: "danisman", label: "Danışman", type: "text", width: 24, get: (r, c) => (r.advisorId === "sahipsiz" ? "Sahipsiz" : nameOf(c, r.advisorId)) },
    { key: "toplam", label: "Toplam kayıt", type: "number", total: true, get: (r) => r.total },
    ...(["yeni", "arandi", "randevu", "yetki_alindi", "portfoye_donustu", "kayip"] as const).map((s) => ({
      key: s,
      label: STATUS_LABELS[s],
      type: "number" as const,
      total: true,
      get: (r: Row) => r.byStatus[s],
    })),
    { key: "yetkiOrani", label: "Yetki oranı", type: "percent", decimals: 1, get: (r) => r.authorityPct },
    { key: "donusum", label: "Portföye dönüşüm", type: "percent", decimals: 1, get: (r) => r.conversionPct },
    ...FSBO_LOST_REASONS.map((reason) => ({
      key: `kayip_${reason}`,
      label: `Kayıp: ${LOST_REASON_LABELS[reason]}`,
      type: "number" as const,
      total: true,
      get: (r: Row) => r.byReason[reason],
    })),
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      let q = ctx.supabase.from("fsbo_leads").select("assigned_to, status, lost_reason").eq("tenant_id", tid(ctx)).is("deleted_at", null);
      q = applyActorScope(ctx, q, { actorColumn: "assigned_to", sample: true });
      if (f.advisor) q = q.eq("assigned_to", f.advisor);
      q = applyTimestampRange(q, "first_seen_at", f);
      const { data, error } = await q.limit(FUNNEL_ROW_CAP);
      if (error) throw error;
      const rows = buildFunnel((data ?? []) as { assigned_to: string | null; status: string; lost_reason: string | null }[]) as FunnelRow[];
      await enrichProfiles((r) => [r.advisorId === "sahipsiz" ? null : r.advisorId])(rows as unknown as Row[], ctx);
      return rows as unknown as Row[];
    },
  },
});

export const PROSPECTING_REPORTS = [sahibindenIlanHunisi];
