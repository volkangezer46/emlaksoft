import { DAY_MS } from "@/lib/clock";
import { formatNumberTr } from "@/lib/format";
import { relativeTimeTR } from "@/lib/admin-format";
import { attentionLevel } from "@/lib/admin/dashboard-layout";
import { platformCanAccess, type PlatformAccessSubject, type PlatformModule } from "@/lib/platform-access";
import type { AttentionRow, StatusTile } from "@/app/app/_home/kurumsal/views";
import type { loadPlatformHome } from "./platform-sections";
import type { getAdminBadges } from "@/lib/admin-badges";

/**
 * Kontrol paneli (platform-home.tsx) SAF kuralları — testli (home-rules.test.ts), DB yok.
 */

/** Cron karosu yalnız KENDİ ölçüsünden türer (F13): 40/40 → "Tümü çalışıyor"; hata varsa "N hatalı"; okunamazsa "—". */
export function cronTileStatus(total: number | null, errors: number | null): Pick<StatusTile, "tone" | "value" | "chip" | "href"> {
  if (total == null) return { tone: "slate", value: "—", chip: null, href: "/admin/sistem" };
  const err = Math.max(0, errors ?? 0);
  const value = `${formatNumberTr(Math.max(0, total - err))}/${formatNumberTr(total)}`;
  if (err === 0) return { tone: "mint", value, chip: { text: "Tümü çalışıyor", tone: "success" }, href: "/admin/sistem?sekme=entegrasyonlar" };
  return { tone: "rose", value, chip: { text: `${formatNumberTr(err)} hatalı`, tone: "danger" }, href: "/admin/sistem" };
}

/**
 * Aynı olay tekrarları tek satır (F13): "Demo girişi yapıldı ×8" — etiket + açıklama + hedef aynıysa en yeni saatte
 * birleşir. Sıra (yeni → eski) korunur.
 */
export function collapseFeed<T extends { id: string; at: string; label: string; hint: string; href: string }>(rows: readonly T[]): (T & { times: number })[] {
  const out: (T & { times: number })[] = [];
  const byKey = new Map<string, T & { times: number }>();
  for (const r of rows) {
    const key = `${r.label}\u0000${r.hint}\u0000${r.href}`;
    const hit = byKey.get(key);
    if (hit) {
      hit.times += 1;
      continue;
    }
    const row = { ...r, times: 1 };
    byKey.set(key, row);
    out.push(row);
  }
  return out;
}

export type ScoredRow = AttentionRow & { severity: number };

const relName = (rel: { name: string | null } | { name: string | null }[] | null | undefined): string | null => (Array.isArray(rel) ? (rel[0]?.name ?? null) : (rel?.name ?? null));

/**
 * Dikkat satırları TEK kural (kart + kahraman "N acil konu" + özet cümlesi; F13). Önem `attentionLevel(severity)` ile bir
 * kez; kuyruk kaleminin adedi rozet sütununa değil etiketin yanına (`more: "×3"`) yazılır, rozetler hizalı kalır.
 */
export function buildAttentionRows(
  h: Awaited<ReturnType<typeof loadPlatformHome>>,
  badges: Awaited<ReturnType<typeof getAdminBadges>> | null,
  role: PlatformAccessSubject,
  nowMs: number,
): ScoredRow[] {
  const can = (m: PlatformModule) => platformCanAccess(role, m);
  const rows: ScoredRow[] = [];
  const push = (r: Omit<AttentionRow, "level"> & { severity: number }) => rows.push({ ...r, level: attentionLevel(r.severity) });
  const countMore = (n: number) => (n > 1 ? `×${formatNumberTr(n)}` : null);
  // 1) SOMUT KAYITLAR: her satır kendi kaydına gider ("Ödeme gecikti · Ofis adı · 3 gün geçti").
  if (h.ok) {
    if (can("billing")) {
      for (const inv of h.records.overdue) {
        const days = Math.max(1, Math.floor((nowMs - Date.parse(inv.due_at)) / DAY_MS));
        push({ id: `fatura-${inv.id}`, label: `Ödeme gecikti · ${relName(inv.tenant) ?? "Ofis"}`, hint: `${inv.invoice_no ?? "Fatura"} · ${days} gün geçti`, href: `/admin/billing/faturalar/${inv.id}`, meta: null, severity: 84 + Math.min(days, 10) / 10 });
      }
    }
    if (can("tickets")) {
      for (const t of h.records.sla) {
        push({ id: `sla-${t.id}`, label: `İlk yanıt gecikti · ${t.subject || "Destek talebi"}`, hint: `${relName(t.tenant) ?? "Ofis"} · ilk yanıt ${relativeTimeTR(t.first_response_due_at)} dolmuştu`, href: `/admin/tickets/${t.id}`, meta: null, severity: 88 });
      }
    }
    if (can("billing") || can("tenants") || can("personel")) {
      for (const a of h.records.approvals) {
        push({ id: `onay-${a.id}`, label: `Onay bekliyor · ${a.summary || "Kritik işlem"}`, hint: `Dört göz kuyruğu · ${relativeTimeTR(a.requested_at)} istendi`, href: "/admin/onaylar?durum=bekleyen", meta: null, severity: 72 });
      }
    }
    if (can("tenants")) {
      const soon = h.churnTenants
        .filter((t) => t.status === "trial" && t.trial_ends_at && Date.parse(t.trial_ends_at) >= nowMs && Date.parse(t.trial_ends_at) - nowMs <= 7 * DAY_MS)
        .sort((x, y) => Date.parse(x.trial_ends_at!) - Date.parse(y.trial_ends_at!))
        .slice(0, 3);
      for (const t of soon) {
        const left = Math.max(0, Math.ceil((Date.parse(t.trial_ends_at!) - nowMs) / DAY_MS));
        push({ id: `deneme-${t.id}`, label: `Deneme bitiyor · ${t.name || "Ofis"}`, hint: left === 0 ? "Bugün bitiyor · dönüşüm fırsatı" : `${left} gün kaldı · dönüşüm fırsatı`, href: `/admin/tenants/${t.id}`, meta: null, severity: 55 });
      }
    }
  }
  if (can("sistem")) {
    for (const job of h.health?.failedJobs ?? []) push({ id: `cron-${job}`, label: `Zamanlanmış iş hatalı · ${job}`, hint: "Son çalışması hata verdi", href: "/admin/sistem", meta: null, severity: 86 });
  }
  // 2) Kayıt bazına inmeyen kuyruk kalemleri (iade, manuel inceleme, riskli ofis, EF mutabakatı, operasyon hazırlığı…).
  const covered = new Set(["trial-ending", "new-trial", ...(h.health?.failedJobs?.length ? ["cron"] : []), ...(h.ok && h.records.sla.length ? ["urgent-ticket"] : [])]);
  for (const q of h.queue) if (!covered.has(q.id)) push({ id: q.id, label: q.label, hint: q.hint, href: q.href, meta: null, more: countMore(q.count), severity: q.severity });
  if (badges?.kvkk) push({ id: "kvkk", label: "Açık KVKK başvurusu", hint: "30 günlük yasal süre işliyor", href: "/admin/tickets/kvkk", meta: null, more: countMore(badges.kvkk), severity: 60 });
  return rows.sort((a, b) => b.severity - a.severity);
}
