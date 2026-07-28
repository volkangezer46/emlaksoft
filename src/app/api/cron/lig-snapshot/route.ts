import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { notifyTenant } from "@/lib/notify";
import { evaluateBadges, BADGE_BY_CODE } from "@/lib/gamification";
import { loadLeagueData, periodOf, periodRange, previousPeriod } from "@/lib/gamification-query";

/**
 * Aylık lig mühürleme cron'u.
 *
 * Zamanlama: her ayın 1'i 02:00 UTC ("0 2 1 * *") — BİTEN ayı işler.
 * Saat 02:00 bilinçli: bölge snapshot'ı (03:00) ve günlük özet (07:00)
 * ile çakışmaz, ay değişiminden sonra geç kalan yazmalar oturmuştur.
 *
 * NE YAPAR (her aktif tenant için):
 *  1. Biten ayın lig verisini `loadLeagueData` ile hesaplar — SAYFANIN
 *     KULLANDIĞI AYNI FONKSİYON. Arşivlenen skor ile ekranda görülen skorun
 *     ayrışmaması bunun tek garantisi.
 *  2. `agent_score_snapshots`'a upsert eder (unique tenant+staff+period →
 *     elle yeniden tetiklemek GÜVENLİ, mükerrer satır oluşmaz).
 *  3. Dönemsel rozetleri (Ayın Şampiyonu, Kapanış Makinesi, ...) ve o an
 *     hak edilmiş ömür boyu rozetleri `agent_badges`'e yazar. Mükerrer
 *     yazım `idx_agent_badges_unique` ile DB seviyesinde engellenir; bu
 *     yüzden `ignoreDuplicates` ile sessiz geçilir — kazanılmış rozetin
 *     `earned_at` tarihi ASLA güncellenmez.
 *  4. Şampiyona ve podyuma bildirim gönderir.
 *
 * ?donem=YYYY-MM ile belirli bir ay elle mühürlenebilir (geriye dönük
 * doldurma). Verilmezse bir önceki ay işlenir.
 */

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // İşlenecek dönem: ?donem=YYYY-MM veya (varsayılan) BİTEN ay.
  const asked = req.nextUrl.searchParams.get("donem") ?? "";
  const period = /^\d{4}-\d{2}$/.test(asked) ? asked : previousPeriod(periodOf(new Date()));
  const range = periodRange(period);

  // Seri hesabı dönem sonuna göre yapılır: "ay kapanırken serisi kaç gündü".
  // Bugüne göre hesaplamak, geriye dönük doldurmada herkesin serisini 0 yapardı.
  const lastDayOfPeriod = new Date(Date.parse(range.endIso) - 86_400_000).toISOString().slice(0, 10);

  const { data: tenants, error: tenantsError } = await admin
    .from("tenants")
    .select("id")
    .in("status", ["active", "trial", "past_due"])
    .limit(500);

  if (tenantsError) {
    await recordHeartbeat("lig-snapshot", "error", `tenant listesi okunamadı: ${tenantsError.message}`);
    return NextResponse.json({ error: "db", detail: tenantsError.message }, { status: 500 });
  }

  let snapshots = 0;
  let badges = 0;
  let notified = 0;
  let failed = 0;
  let tenantsWithData = 0;

  for (const t of tenants ?? []) {
    const tenantId = String(t.id);
    try {
      const league = await loadLeagueData(admin, { period, tenantId, todayIso: lastDayOfPeriod });

      // Puanı olan kimse yoksa ofis o ay hiç çalışmamış demektir — boş
      // snapshot yazmak tabloyu şişirir, atlanır.
      const scored = league.ranked.filter((r) => r.total > 0);
      if (scored.length === 0) continue;
      tenantsWithData += 1;

      // ── 1) Skor fotoğrafı ────────────────────────────────────────────
      const snapRows = scored.map((r) => ({
        tenant_id: tenantId,
        staff_id: r.staffId,
        period,
        score: r.total,
        breakdown: r.breakdown,
        rank: r.rank,
      }));
      const { error: snapErr } = await admin
        .from("agent_score_snapshots")
        .upsert(snapRows, { onConflict: "tenant_id,staff_id,period" });
      if (snapErr) {
        failed += 1;
        continue;
      }
      snapshots += snapRows.length;

      // ── 2) Rozetler ──────────────────────────────────────────────────
      // Dönemsel rozet → period dolu; ömür boyu rozet → period null.
      //
      // NEDEN upsert DEĞİL: tekillik `coalesce(period,'')` üzerine kurulu bir
      // İFADE indeksi (NULL period'lar da tekil sayılsın diye — bkz. migration
      // 120). PostgreSQL'de ON CONFLICT hedefi ancak birebir eşleşen bir
      // indeks olabilir; "tenant_id,staff_id,badge_code,period" listesi bu
      // ifade indeksiyle EŞLEŞMEZ ve upsert hata verirdi. Bu yüzden önce
      // mevcut rozetler okunuyor, yalnız YENİLER ekleniyor. Yan faydası:
      // kazanılmış rozetin `earned_at` tarihi hiçbir koşulda güncellenmiyor.
      const badgeRows: Array<Record<string, unknown>> = [];
      for (const r of scored) {
        const stats = league.statsById.get(r.staffId);
        if (!stats) continue;
        const meta = { score: r.total, rank: r.rank, period };
        for (const code of evaluateBadges(stats, { scope: "monthly" })) {
          badgeRows.push({ tenant_id: tenantId, staff_id: r.staffId, badge_code: code, period, meta });
        }
        for (const code of evaluateBadges(stats, { scope: "lifetime" })) {
          badgeRows.push({ tenant_id: tenantId, staff_id: r.staffId, badge_code: code, period: null, meta });
        }
      }
      if (badgeRows.length > 0) {
        const { data: mevcut } = await admin
          .from("agent_badges")
          .select("staff_id, badge_code, period")
          .eq("tenant_id", tenantId)
          .or(`period.eq.${period},period.is.null`)
          .limit(5000);
        const key = (staff: unknown, code: unknown, per: unknown) => `${staff}|${code}|${per ?? ""}`;
        const varOlan = new Set((mevcut ?? []).map((m) => key(m.staff_id, m.badge_code, m.period)));
        const yeni = badgeRows.filter((b) => !varOlan.has(key(b.staff_id, b.badge_code, b.period)));
        if (yeni.length > 0) {
          const { error: badgeErr } = await admin.from("agent_badges").insert(yeni);
          if (badgeErr) failed += 1;
          else badges += yeni.length;
        }
      }

      // ── 3) Bildirimler ───────────────────────────────────────────────
      const nameOf = (id: string) => league.agents.find((a) => a.id === id)?.fullName ?? "Danışman";
      const champion = scored.find((r) => r.rank === 1);
      if (champion) {
        const championName = nameOf(champion.staffId);
        // Ofis geneli duyuru: şampiyonluk paylaşılmadığında motivasyon üretmez.
        await notifyTenant({
          tenantId,
          title: `🏆 ${range.label} şampiyonu: ${championName}`,
          body: `${champion.total} puan · ${champion.breakdown.deal_won.count} anlaşma · ${champion.breakdown.property_new.count} portföy`,
          href: `/app/lig?donem=${period}`,
          kind: "success",
        });
        notified += 1;

        // Podyumdaki herkese kişisel tebrik (şampiyon dahil).
        for (const r of scored.filter((x) => x.rank <= 3)) {
          const rozetler = league.statsById.get(r.staffId)
            ? evaluateBadges(league.statsById.get(r.staffId)!, { scope: "monthly" })
                .map((c) => BADGE_BY_CODE.get(c)?.name)
                .filter(Boolean)
            : [];
          await notifyTenant({
            tenantId,
            userId: r.staffId,
            title: `${r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : "🥉"} ${range.label} ligini ${r.rank}. bitirdin`,
            body: rozetler.length > 0
              ? `${r.total} puan · Kazandığın rozetler: ${rozetler.join(", ")}`
              : `${r.total} puan topladın.`,
            href: `/app/lig?donem=${period}`,
            kind: "success",
          });
          notified += 1;
        }
      }
    } catch (err) {
      failed += 1;
      console.error("lig-snapshot", tenantId, err);
    }
  }

  const detail = `${period}: ${tenantsWithData} ofis, ${snapshots} skor, ${badges} rozet, ${notified} bildirim${failed ? `, ${failed} hata` : ""}`;
  await recordHeartbeat("lig-snapshot", failed > 0 ? "error" : "ok", detail);

  return NextResponse.json({
    ok: failed === 0,
    period,
    tenants: tenants?.length ?? 0,
    tenantsWithData,
    snapshots,
    badges,
    notified,
    failed,
  });
}
