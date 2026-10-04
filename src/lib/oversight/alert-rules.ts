import { trDayKey, trParts } from "@/lib/clock";
import type { AlertRuleId, OversightThresholds } from "@/lib/oversight/settings";

/**
 * Akilli uyarilar — KURAL TABANLI, ACIKLANABILIR (sahte skor yok). SAF: DB/React yok.
 *
 * Her uyari: deterministik `key` (ayni olay tekrar uyari uretmez; "incelendi" bu anahtara baglanir),
 * hangi kuralin neden tetiklendigini anlatan `explanation` ve filtreli bir `href`.
 * Metin dili saygilidir: bir kisiyi suclamaz, "dikkatinize" sunar.
 */

export type AlertSeverity = "yuksek" | "orta" | "bilgi";

export type OversightAlert = {
  key: string;
  rule: AlertRuleId;
  severity: AlertSeverity;
  title: string;
  explanation: string;
  /** Ilgili danisman (profil id) — danisman karnesi ve filtre icin. */
  advisorId: string | null;
  /** Olay zamani (ISO). */
  at: string;
  href: string;
  /** Aggregat uyarilarda olay sayisi. */
  count?: number;
};

export type AuditFact = {
  id: string;
  action: string;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
};

export type PriceChangeFact = {
  id: string;
  propertyId: string;
  oldPrice: number | null;
  newPrice: number;
  changedBy: string | null;
  createdAt: string;
};

export type CommissionCutFact = {
  id: string;
  requestedBy: string | null;
  standardRate: number | null;
  requestedRate: number | null;
  status: string;
  createdAt: string;
};

export type CertFact = {
  profileId: string;
  name: string;
  /** YYYY-MM-DD */
  expiresOn: string | null;
  liveListingCount: number;
};

export type StaleFact = {
  advisorId: string;
  name: string;
  staleListings: number;
  staleCustomers: number;
};

export type AlertFacts = {
  audit: readonly AuditFact[];
  priceChanges: readonly PriceChangeFact[];
  commissionCuts: readonly CommissionCutFact[];
  certs: readonly CertFact[];
  stale: readonly StaleFact[];
  /** profil id -> ad (mesaj metni icin) */
  names: ReadonlyMap<string, string>;
};

const fmt = (n: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(n);
const tl = (n: number) => `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n)} ₺`;

const REMOVAL_STATUSES = ["archived", "removed", "passive", "pasif", "kaldirildi", "arsiv", "withdrawn"];

/** Sistem/ofis-kontrol kayitlari "danisman islemi" sayilmaz (mesai disi sayimi vb.). */
function isAdvisorWork(a: AuditFact): boolean {
  return Boolean(a.actorId) && !a.action.startsWith("oversight.") && !a.action.startsWith("ops.") && !a.action.startsWith("platform");
}

function feedHref(p: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `/app/ofis-kontrol?${qs}` : "/app/ofis-kontrol";
}

function dayRange(createdAt: string): { from: string; to: string } {
  const d = trDayKey(createdAt);
  return { from: d, to: d };
}

function groupBy<T>(rows: readonly T[], keyOf: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

function nameOf(names: ReadonlyMap<string, string>, id: string | null): string {
  return (id && names.get(id)) || "Bir danışman";
}

/**
 * Tum kurallari degerlendirir. `nowMs` disaridan verilir (saflik). Sonuc yeni -> eski.
 * Kapali kurallar atlanir; "veri kaynagi yok" kurallari (sensitive_download) uyari uretmez.
 */
export function evaluateAlerts(facts: AlertFacts, t: OversightThresholds, nowMs: number): OversightAlert[] {
  const out: OversightAlert[] = [];
  const on = (r: AlertRuleId) => t.enabled[r] !== false;

  // 1) Buyuk fiyat dusurme -------------------------------------------------
  if (on("price_drop")) {
    for (const p of facts.priceChanges) {
      if (p.oldPrice == null || p.oldPrice <= 0 || p.newPrice >= p.oldPrice) continue;
      const dropPct = ((p.oldPrice - p.newPrice) / p.oldPrice) * 100;
      if (dropPct < t.priceDropPct) continue;
      out.push({
        key: `price_drop:${p.id}`,
        rule: "price_drop",
        severity: dropPct >= t.priceDropPct * 2 ? "yuksek" : "orta",
        title: `İlan fiyatı %${fmt(dropPct)} düşürüldü`,
        explanation: `${nameOf(facts.names, p.changedBy)} bir ilanın fiyatını ${tl(p.oldPrice)} değerinden ${tl(p.newPrice)} değerine çekti (eşik %${fmt(t.priceDropPct)}).`,
        advisorId: p.changedBy,
        at: p.createdAt,
        href: `/app/portfoyler/${p.propertyId}`,
      });
    }
  }

  // 2) Ilan yayindan kaldirma / silme -----------------------------------------
  if (on("listing_removed")) {
    for (const a of facts.audit) {
      const status = typeof a.newValue?.status === "string" ? a.newValue.status.toLocaleLowerCase("tr-TR") : "";
      const isDelete = a.action === "property.delete";
      const isPortalClose = a.action === "portal.close";
      const isStatusRemoval =
        (a.action === "property.status" || a.action === "property.bulk_status") && REMOVAL_STATUSES.includes(status);
      if (!isDelete && !isPortalClose && !isStatusRemoval) continue;
      const what = isDelete ? "bir ilanı sildi" : isPortalClose ? "bir ilanın portal yayınını kapattı" : "ilanı yayından kaldırdı";
      out.push({
        key: `listing_removed:${a.id}`,
        rule: "listing_removed",
        severity: isDelete ? "yuksek" : "orta",
        title: isDelete ? "İlan silindi" : "İlan yayından kaldırıldı",
        explanation: `${nameOf(facts.names, a.actorId)} ${what}.`,
        advisorId: a.actorId,
        at: a.createdAt,
        href: feedHref({ aktor: a.actorId ?? undefined, tur: a.action, ...dayRange(a.createdAt) }),
      });
    }
  }

  // 3) Toplu musteri silme (kisi + gun) ------------------------------------
  if (on("bulk_delete")) {
    const del = facts.audit.filter((a) => a.action === "customer.delete" && a.actorId);
    for (const [k, rows] of groupBy(del, (a) => `${a.actorId}|${trDayKey(a.createdAt)}`)) {
      if (rows.length < t.bulkDeleteCount) continue;
      const [actor, day] = k.split("|");
      out.push({
        key: `bulk_delete:${actor}:${day}`,
        rule: "bulk_delete",
        severity: "yuksek",
        title: `Bir günde ${rows.length} müşteri silindi`,
        explanation: `${nameOf(facts.names, actor)} ${day} tarihinde ${rows.length} müşteri sildi (eşik ${t.bulkDeleteCount}).`,
        advisorId: actor,
        at: rows[0].createdAt,
        count: rows.length,
        href: feedHref({ aktor: actor, tur: "customer.delete", from: day, to: day }),
      });
    }
  }

  // 4) Toplu export -----------------------------------------------------------
  if (on("bulk_export")) {
    const ex = facts.audit.filter((a) => a.action.startsWith("export.") && a.actorId);
    for (const a of ex) {
      const rows = Number(a.newValue?.rows);
      if (!Number.isFinite(rows) || rows < t.bulkExportRows) continue;
      out.push({
        key: `bulk_export:${a.id}`,
        rule: "bulk_export",
        severity: rows >= t.bulkExportRows * 5 ? "yuksek" : "orta",
        title: `${fmt(rows)} satırlık veri indirildi`,
        explanation: `${nameOf(facts.names, a.actorId)} tek seferde ${fmt(rows)} satır dışa aktardı (eşik ${fmt(t.bulkExportRows)}).`,
        advisorId: a.actorId,
        at: a.createdAt,
        count: rows,
        href: feedHref({ aktor: a.actorId ?? undefined, kategori: "export", ...dayRange(a.createdAt) }),
      });
    }
    for (const [k, rows] of groupBy(ex, (a) => `${a.actorId}|${trDayKey(a.createdAt)}`)) {
      if (rows.length < t.exportPerDay) continue;
      const [actor, day] = k.split("|");
      out.push({
        key: `export_burst:${actor}:${day}`,
        rule: "bulk_export",
        severity: "orta",
        title: `Bir günde ${rows.length} kez veri indirildi`,
        explanation: `${nameOf(facts.names, actor)} ${day} tarihinde ${rows.length} kez dışa aktarma yaptı (eşik ${t.exportPerDay}).`,
        advisorId: actor,
        at: rows[0].createdAt,
        count: rows.length,
        href: feedHref({ aktor: actor, kategori: "export", from: day, to: day }),
      });
    }
  }

  // 5) Musteri / ilan devri (kisi + gun) -------------------------------------
  if (on("reassign")) {
    const re = facts.audit.filter(
      (a) => (a.action === "customer.reassign" || a.action === "property.reassign" || a.action === "customer.bulk_assign") && a.actorId,
    );
    for (const [k, rows] of groupBy(re, (a) => `${a.actorId}|${trDayKey(a.createdAt)}`)) {
      if (rows.length < t.reassignPerDay) continue;
      const [actor, day] = k.split("|");
      out.push({
        key: `reassign:${actor}:${day}`,
        rule: "reassign",
        severity: "orta",
        title: `Bir günde ${rows.length} devir işlemi`,
        explanation: `${nameOf(facts.names, actor)} ${day} tarihinde ${rows.length} müşteri/ilan devri yaptı (eşik ${t.reassignPerDay}).`,
        advisorId: actor,
        at: rows[0].createdAt,
        count: rows.length,
        href: feedHref({ aktor: actor, kategori: "devir", from: day, to: day }),
      });
    }
  }

  // 6) Mesai disi yogun islem (kisi + gun) ---------------------------------
  if (on("after_hours")) {
    const off = facts.audit.filter((a) => {
      if (!isAdvisorWork(a)) return false;
      const h = trParts(a.createdAt).hour;
      return h < t.workStartHour || h >= t.workEndHour;
    });
    for (const [k, rows] of groupBy(off, (a) => `${a.actorId}|${trDayKey(a.createdAt)}`)) {
      if (rows.length < t.afterHoursEvents) continue;
      const [actor, day] = k.split("|");
      out.push({
        key: `after_hours:${actor}:${day}`,
        rule: "after_hours",
        severity: "orta",
        title: `Mesai dışında ${rows.length} işlem`,
        explanation: `${nameOf(facts.names, actor)} ${day} tarihinde ${String(t.workStartHour).padStart(2, "0")}:00–${String(t.workEndHour).padStart(2, "0")}:00 dışında ${rows.length} işlem yaptı (eşik ${t.afterHoursEvents}). Nöbet ya da yoğun gün olabilir.`,
        advisorId: actor,
        at: rows[0].createdAt,
        count: rows.length,
        href: feedHref({ aktor: actor, from: day, to: day }),
      });
    }
  }

  // 7) Yetki belgesi suresi dolmus + yayinda ilan --------------------------
  if (on("cert_expired")) {
    const today = trDayKey(nowMs);
    for (const c of facts.certs) {
      if (!c.expiresOn || c.expiresOn >= today || c.liveListingCount <= 0) continue;
      out.push({
        key: `cert_expired:${c.profileId}:${c.expiresOn}`,
        rule: "cert_expired",
        severity: "yuksek",
        title: "Yetki belgesi süresi dolmuş",
        explanation: `${c.name} adlı danışmanın yetki belgesi ${c.expiresOn} tarihinde sona erdi; yayında ${c.liveListingCount} ilanı var.`,
        advisorId: c.profileId,
        at: `${c.expiresOn}T00:00:00.000Z`,
        count: c.liveListingCount,
        href: `/app/ekip/${c.profileId}`,
      });
    }
  }

  // 8-9) Uzun suredir islem gormeyen ilan / musteri (danisman + ay) ----------
  const monthKey = trDayKey(nowMs).slice(0, 7);
  const nowIso = new Date(nowMs).toISOString();
  for (const s of facts.stale) {
    if (on("stale_listing") && s.staleListings > 0) {
      out.push({
        key: `stale_listing:${s.advisorId}:${monthKey}`,
        rule: "stale_listing",
        severity: "bilgi",
        title: `${s.staleListings} ilan ${t.staleListingDays}+ gündür güncellenmedi`,
        explanation: `${s.name} adlı danışmanın ${s.staleListings} yayındaki ilanı ${t.staleListingDays} günden uzun süredir işlem görmedi; sahipsiz kalma riski var.`,
        advisorId: s.advisorId,
        at: nowIso,
        count: s.staleListings,
        href: `/app/portfoyler?danisman=${s.advisorId}`,
      });
    }
    if (on("stale_customer") && s.staleCustomers > 0) {
      out.push({
        key: `stale_customer:${s.advisorId}:${monthKey}`,
        rule: "stale_customer",
        severity: "bilgi",
        title: `${s.staleCustomers} müşteri ${t.staleCustomerDays}+ gündür işlem görmedi`,
        explanation: `${s.name} adlı danışmana atanmış ${s.staleCustomers} müşteri ${t.staleCustomerDays} günden uzun süredir güncellenmedi.`,
        advisorId: s.advisorId,
        at: nowIso,
        count: s.staleCustomers,
        href: `/app/musteriler?assigned=${s.advisorId}`,
      });
    }
  }

  // 10) Komisyon orani manuel dusurme (onay talebi uzerinden) -----------------
  if (on("commission_cut")) {
    for (const c of facts.commissionCuts) {
      if (c.standardRate == null || c.requestedRate == null) continue;
      const cut = c.standardRate - c.requestedRate;
      if (cut < t.commissionCutPoints) continue;
      out.push({
        key: `commission_cut:${c.id}`,
        rule: "commission_cut",
        severity: "orta",
        title: `Komisyon oranı ${fmt(cut)} puan düşürülmek istendi`,
        explanation: `${nameOf(facts.names, c.requestedBy)} standart %${fmt(c.standardRate)} oranını %${fmt(c.requestedRate)} olarak talep etti (eşik ${fmt(t.commissionCutPoints)} puan).`,
        advisorId: c.requestedBy,
        at: c.createdAt,
        href: `/app/onaylar?tur=komisyon_indirimi&durum=${c.status}`,
      });
    }
  }

  const rank: Record<AlertSeverity, number> = { yuksek: 0, orta: 1, bilgi: 2 };
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : rank[a.severity] - rank[b.severity] || (a.key < b.key ? -1 : 1)));
}

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  yuksek: "Yüksek",
  orta: "Orta",
  bilgi: "Bilgi",
};

/** Uyarilari dagitir: acik (incelenmemis) / incelenmis. */
export function splitByReview<T extends { key: string }>(
  alerts: readonly T[],
  reviewed: ReadonlySet<string>,
): { open: T[]; done: T[] } {
  const open: T[] = [];
  const done: T[] = [];
  for (const a of alerts) (reviewed.has(a.key) ? done : open).push(a);
  return { open, done };
}
