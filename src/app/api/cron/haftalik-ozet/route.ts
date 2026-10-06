import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { getDisabledModulesByTenant, isDisabledFor, skippedTenantsNote } from "@/lib/modules/state";
import { authorizeCron } from "@/lib/cron-auth";
import { officeDigestDefault, wantsDigest } from "@/lib/digest-prefs";
import { runControlReportDelivery } from "@/lib/listing-control/server/report-delivery";
import { tenantsDisabledFor } from "@/lib/modules/state";
import { cronDeadline, fetchAllPaged, heartbeatFor, isPastDeadline, remainingOf } from "@/lib/cron-run";

/**
 * Haftalık yönetici özeti — her aktif tenant için GEÇEN haftanın (Pzt–Paz)
 * özeti tek bildirim olarak yönetici rollerine (owner/gm/branch_manager) gider.
 *
 * NOTLAR (deploy):
 *  - vercel.json'a eklenecek cron path: "/api/cron/haftalik-ozet"
 *    önerilen zamanlama: "30 7 * * 1" (pazartesi 07:30) — vercel.json bu
 *    turda bilinçli olarak DEĞİŞTİRİLMEDİ.
 *  - href'teki ?hafta=YYYY-WW işlevsel filtre değil, tenant başına haftada
 *    tek bildirim marker'ı (kira-tahakkuk'taki ?yenileme={yıl} deseni).
 *    scripts/check-link-contracts.ts ALLOWLIST'ine şu girişin eklenmesi
 *    gerekir: "/app/raporlar::hafta": "dedupe marker — haftalik-ozet cron".
 */


/** ISO-8601 hafta numarası — marker "YYYY-WW" için (yıl, ISO hafta yılıdır). */
function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; // Pzt=1 … Paz=7
  t.setUTCDate(t.getUTCDate() + 4 - day); // haftanın perşembesi
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: t.getUTCFullYear(), week };
}

const compactTry = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Uzun süren toplu işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const admin = createAdminClient();

  // Geçen haftanın kapalı aralığı [weekStart, weekEnd): bu haftanın pazartesi
  // 00:00'ı biter, 7 gün öncesi başlar (gunluk-ozet'teki yerel saat deseni).
  const weekEnd = new Date();
  weekEnd.setHours(0, 0, 0, 0);
  const dow = weekEnd.getDay() || 7; // Pzt=1 … Paz=7
  weekEnd.setDate(weekEnd.getDate() - (dow - 1));
  const weekStart = new Date(weekEnd.getTime() - 7 * 86_400_000);
  const startIso = weekStart.toISOString();
  const endIso = weekEnd.toISOString();

  // Özetlenen haftanın marker'ı — tenant başına haftada tek bildirim.
  const { year, week } = isoWeek(weekStart);
  const markerHref = `/app/raporlar?hafta=${year}-${String(week).padStart(2, "0")}`;

  const deadline = cronDeadline(Date.now());
  // order(id) + range sayfalama (sırasız .limit(500) yok): 500+ ofis sessizce atlanmaz.
  const { rows: tenants, error: tenantsError } = await fetchAllPaged<{ id: string; name: string }>((from, to) =>
    admin
      .from("tenants")
      .select("id, name")
      .in("status", ["active", "trial", "past_due"])
      .order("id", { ascending: true })
      .range(from, to),
  );

  const disabledModules = await getDisabledModulesByTenant(admin);
  let sent = 0;
  let skippedEmpty = 0;
  let skippedDone = 0;
  let skippedPrefs = 0;
  let processed = 0;
  let failed = 0;
  let timedOut = false;

  for (const t of tenants) {
    if (isPastDeadline(Date.now(), deadline)) {
      timedOut = true;
      break;
    }
    processed += 1;
    if (isDisabledFor(disabledModules, String(t.id), "reports")) continue;
    // Bu hafta için zaten gönderilmiş mi? (marker'lı href varlık kontrolü)
    const { count: already } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", t.id)
      .eq("href", markerHref);
    if ((already ?? 0) > 0) {
      skippedDone++;
      continue;
    }

    const [
      { count: newCustomers },
      { count: newProperties },
      { data: wonDeals },
      { data: collected },
      { count: lostDeals },
      { data: profiles },
    ] = await Promise.all([
      admin
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", t.id)
        .is("deleted_at", null)
        .gte("created_at", startIso)
        .lt("created_at", endIso),
      admin
        .from("properties")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", t.id)
        .is("deleted_at", null)
        .gte("created_at", startIso)
        .lt("created_at", endIso),
      // Kazanılan/kaybedilen için ayrı zaman damgası yok — stage geçişi
      // updated_at'i yazar (gunluk-ozet'teki "anlaşma hareketi" vekiliyle aynı).
      admin
        .from("deals")
        .select("deal_value, advisor:profiles!deals_assigned_to_fkey(full_name)")
        .eq("tenant_id", t.id)
        .eq("stage", "won")
        .gte("updated_at", startIso)
        .lt("updated_at", endIso)
        .limit(500),
      admin
        .from("commissions")
        .select("gross_amount")
        .eq("tenant_id", t.id)
        .in("status", ["paid", "collected"])
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .limit(500),
      admin
        .from("deals")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", t.id)
        .eq("stage", "lost")
        .gte("updated_at", startIso)
        .lt("updated_at", endIso),
      admin
        .from("profiles")
        .select("id, role, notification_prefs")
        .eq("tenant_id", t.id)
        .eq("is_active", true)
        .in("role", ["owner", "gm", "branch_manager"]),
    ]);

    // Ofis tanımı: kendi tercihini kaydetmemiş yöneticiler için özet varsayılanı (okunamazsa açık).
    const officeDigest = await officeDigestDefault(admin, String(t.id));
    const wonCount = wonDeals?.length ?? 0;
    const wonValue = (wonDeals ?? []).reduce((s, d) => s + Number(d.deal_value || 0), 0);
    const collectedTotal = (collected ?? []).reduce((s, c) => s + Number(c.gross_amount || 0), 0);

    // Haftanın danışmanı: kazanılan anlaşma değeri toplamı en yüksek danışman
    // (wonDeals'tan türetilir, ek sorgu yok; veri yoksa satır eklenmez).
    const advisorWon = new Map<string, number>();
    for (const d of wonDeals ?? []) {
      const rel = d.advisor as { full_name?: string | null } | { full_name?: string | null }[] | null;
      const adv = Array.isArray(rel) ? rel[0] : rel;
      const v = Number(d.deal_value || 0);
      if (adv?.full_name && v > 0) advisorWon.set(adv.full_name, (advisorWon.get(adv.full_name) ?? 0) + v);
    }
    const haftaninDanismani = [...advisorWon.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;

    // Veri sıfırsa bildirim atma — boş özet gürültüdür.
    const hasData =
      (newCustomers ?? 0) > 0 ||
      (newProperties ?? 0) > 0 ||
      wonCount > 0 ||
      collectedTotal > 0 ||
      (lostDeals ?? 0) > 0;
    if (!hasData) {
      skippedEmpty++;
      continue;
    }

    const parts = [
      `${newCustomers ?? 0} yeni müşteri`,
      `${newProperties ?? 0} yeni portföy`,
      wonCount > 0 ? `${wonCount} kazanılan anlaşma (${compactTry.format(wonValue)})` : `${wonCount} kazanılan anlaşma`,
      ...(haftaninDanismani ? [`Haftanın danışmanı: ${haftaninDanismani}`] : []),
      `${compactTry.format(collectedTotal)} tahsilat`,
      `${lostDeals ?? 0} kayıp`,
    ];
    const body = `Haftalık özet: ${parts.join(" · ")}`;

    const recipients = (profiles ?? []).filter((p) => wantsDigest(p.notification_prefs, officeDigest));
    skippedPrefs += (profiles?.length ?? 0) - recipients.length;
    if (recipients.length === 0) continue;

    const rows = recipients.map((p) => ({
      tenant_id: t.id,
      user_id: p.id,
      title: "Haftalık yönetici özeti",
      body,
      href: markerHref,
      kind: "info",
    }));

    const { error } = await admin.from("notifications").insert(rows);
    if (error) failed += 1;
    else sent += rows.length;
  }

  // İlan Kontrol raporu teslimi (ofis ayarı açık ofisler; en iyi çaba, özet işini bozmaz; dedupe dönem başına tek).
  let controlReports = 0;
  try {
    const lc = await runControlReportDelivery(admin, "weekly", Date.now(), {
      disabledTenantIds: new Set(tenantsDisabledFor(disabledModules, "portals")),
    });
    controlReports = lc.sent;
    failed += lc.failed;
  } catch (e) {
    console.error("haftalik-ozet ilan kontrol raporu", e);
  }

  const hb = heartbeatFor({
    total: tenants.length,
    processed,
    failed,
    timedOut,
    listError: tenantsError,
    summary: `${sent} özet gönderildi, ${controlReports} ilan kontrol raporu, ${skippedEmpty} boş, ${skippedDone} zaten gönderilmiş, ${skippedPrefs} tercih kapalı${skippedTenantsNote(disabledModules, "reports")}`,
  });
  await recordHeartbeat("haftalik-ozet", hb.status, hb.detail);

  return NextResponse.json({
    ok: hb.status === "ok",
    sent,
    skippedEmpty,
    skippedDone,
    skippedPrefs,
    failed,
    remaining: remainingOf({ total: tenants.length, processed }),
  });
}
