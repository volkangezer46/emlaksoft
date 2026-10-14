import Link from "@/components/ui/smart-link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { now, trDayKey } from "@/lib/clock";
import { loadAuthorityQueue } from "@/lib/eids/authority-queue";
import { EIDS_MATCH_QUEUE_STATUSES, FORWARDING_LABELS, forwardingState, type ForwardingState } from "@/lib/eids/actions-core";
import { Widget } from "../dashboard-widgets";
import { afterFirstScreen, type HomeCtx } from "./data";

/**
 * EİDS YETKİ SAĞLIĞI (ofis panosu, yönetim). Sayılar kendi kuyruk sayfalarının AYNI okuyucusundan gelir (birebir tutar):
 *  - 15 günde bitecek / bilinmiyor → `loadAuthorityQueue` özeti = /app/ilan-kontrol/yetki?kova=… sayacı,
 *  - iptal/dolmuş ama yayında → açık `eids_takedown` görevleri = /app/gorevler?tur=eids_takedown listesi,
 *  - eşleştir kuyruğu → eşleşmemiş Bakanlık e-postaları (EP3) = Yetki > Eşleştir sekmesi,
 *  - yetkili → onaylı ve süresi geçerli portföy (Yetki sayfası),
 *  - iletme durumu → alma adresi (bağlı / sessiz / kurulmadı) = Ayarlar > Entegrasyonlar.
 * Kırmızı göstergeler doğrudan ilgili kuyruğa gider. Tablo/sütun yoksa o satır çizilmez (uydurma sayı yok).
 */
type Row = { key: string; label: string; value: number | string; href: string; tone: "danger" | "warn" | "ok" | "muted" };

const TONE: Record<Row["tone"], string> = {
  danger: "bg-danger-500/10 text-danger-600",
  warn: "bg-amber-400/15 text-amber-700",
  ok: "bg-mint-500/12 text-mint-700",
  muted: "bg-ink-950/[0.06] text-text-muted",
};

async function loadRows(tenantId: string): Promise<Row[] | null> {
  const supabase = await createClient();
  const nowMs = now();
  const today = trDayKey(nowMs);
  const [queue, approved, takedown, unmatched, address] = await Promise.all([
    loadAuthorityQueue(supabase, tenantId),
    supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .eq("is_sample", false)
      .not("status", "in", "(sold,rented,archived,withdrawn,passive)")
      .eq("authority_eids_status", "approved")
      .gte("authorization_end", today),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("kind", "eids_takedown").eq("status", "open"),
    supabase
      .from("eids_inbound_messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("match_status", [...EIDS_MATCH_QUEUE_STATUSES]),
    supabase.from("eids_inbound_addresses").select("created_at, last_received_at").eq("tenant_id", tenantId).is("revoked_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!queue.available) return null;
  const counts = queue.summary.counts as Record<string, number>;
  const rows: Row[] = [];
  if (!approved.error) rows.push({ key: "yetkili", label: "Yetkili (süresi geçerli)", value: approved.count ?? 0, href: "/app/ilan-kontrol/yetki", tone: "ok" });
  rows.push({ key: "bitiyor", label: "15 gün içinde bitecek", value: counts.bitiyor ?? 0, href: "/app/ilan-kontrol/yetki?kova=bitiyor", tone: (counts.bitiyor ?? 0) > 0 ? "warn" : "muted" });
  if (!takedown.error) {
    const n = takedown.count ?? 0;
    rows.push({ key: "kaldir", label: "İptal ya da dolmuş ama yayında", value: n, href: "/app/gorevler?tur=eids_takedown", tone: n > 0 ? "danger" : "muted" });
  }
  // EP2 kovası ("bilinmiyor") kuyruğa eklendiyse aynı özetten gelir; yoksa satır çizilmez.
  if (typeof counts.bilinmiyor === "number") {
    rows.push({ key: "bilinmiyor", label: "Yetkisi bilinmiyor", value: counts.bilinmiyor, href: "/app/ilan-kontrol/yetki?kova=bilinmiyor", tone: counts.bilinmiyor > 0 ? "warn" : "muted" });
  }
  if (!unmatched.error) {
    const n = unmatched.count ?? 0;
    rows.push({ key: "eslestir", label: "Eşleştir kuyruğu", value: n, href: "/app/ilan-kontrol/yetki?sekme=eslestir", tone: n > 0 ? "danger" : "muted" });
  }
  if (!address.error) {
    const st: ForwardingState = forwardingState((address.data as { created_at: string; last_received_at: string | null } | null) ?? null, nowMs);
    rows.push({ key: "iletme", label: "Bakanlık e-postası iletimi", value: FORWARDING_LABELS[st], href: "/app/ayarlar?sekme=entegrasyon", tone: st === "bagli" ? "ok" : st === "sessiz" ? "danger" : "warn" });
  }
  return rows;
}

export async function EidsYetkiSagligi({ ctx }: { ctx: HomeCtx }) {
  if (!ctx.tenantId || !ctx.isManagement || !(ctx.perms.portals ?? []).includes("view")) return null;
  await afterFirstScreen(ctx);
  const rows = await loadRows(ctx.tenantId);
  if (!rows) return null;

  return (
    <Widget id="eids-yetki" className="h-full">
      <section className="pm-bx flex h-full flex-col p-5" aria-labelledby="eids-yetki-baslik">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" />
          <h2 id="eids-yetki-baslik" className="pm-bx-title">
            EİDS Yetki Sağlığı
          </h2>
        </div>
        <ul className="mt-3 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.key}>
              <Link href={r.href} className="focus-ring group flex items-center justify-between gap-3 py-2.5 touch:min-h-11">
                <span className="min-w-0 truncate text-sm text-text group-hover:text-[var(--accent-text)]">{r.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className={`pm-num rounded-full px-2 py-0.5 text-xs font-bold ${TONE[r.tone]}`}>{r.value}</span>
                  <ChevronRight className="h-4 w-4 text-text-faint" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Widget>
  );
}
