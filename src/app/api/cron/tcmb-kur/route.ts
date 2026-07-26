import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchTcmbRate, fetchLatestTcmbRate } from "@/lib/tcmb";
import { recordHeartbeat } from "@/lib/cron-heartbeat";

/**
 * TCMB günlük kur çekme cron'u.
 *
 * Zamanlama: TCMB ~15:30 (Europe/Istanbul) yayınlıyor. Cron 16:30 TR / 13:30 UTC
 * çalışır — yayının kesin oturması için bir saat pay.
 *
 * Davranış:
 *  * Normalde bugünün kurunu çeker.
 *  * Hafta sonu/tatilde yayın yoktur; bu HATA DEĞİL, 200 ile "atlandı" döner.
 *  * `?backfill=N` ile son N günü geriye doldurur (ilk kurulumda kullanılır).
 *    Zaten kayıtlı günler tekrar çekilmez — kotayı boşa harcamaz.
 */

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const backfillParam = req.nextUrl.searchParams.get("backfill");
  const backfillDays = backfillParam ? Math.min(Math.max(Number(backfillParam), 1), 400) : 0;

  // ---- Geriye doldurma modu ------------------------------------------------
  if (backfillDays > 0) {
    // Zaten kayıtlı tarihleri çıkar: TCMB'ye gereksiz istek atmayalım
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - backfillDays);
    const { data: existing } = await admin
      .from("tcmb_rates")
      .select("rate_date")
      .gte("rate_date", since.toISOString().slice(0, 10));
    const have = new Set((existing ?? []).map((r) => String(r.rate_date)));

    let inserted = 0;
    let skippedNoPublication = 0;
    let failed = 0;

    for (let i = 0; i < backfillDays; i += 1) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const iso = d.toISOString().slice(0, 10);
      if (have.has(iso)) continue;

      const result = await fetchTcmbRate(d);
      if (!result.ok) {
        if (result.reason === "no-publication") skippedNoPublication += 1;
        else failed += 1;
        continue;
      }

      const { error } = await admin.from("tcmb_rates").upsert(
        {
          rate_date: result.rate.rateDate,
          usd_buying: result.rate.usdBuying,
          usd_selling: result.rate.usdSelling,
          eur_buying: result.rate.eurBuying,
          eur_selling: result.rate.eurSelling,
        },
        { onConflict: "rate_date" },
      );
      if (error) failed += 1;
      else inserted += 1;
    }

    await recordHeartbeat("tcmb-kur", "ok", `backfill: ${inserted} gün eklendi`);

    return NextResponse.json({
      mode: "backfill",
      days: backfillDays,
      inserted,
      skippedNoPublication,
      failed,
    });
  }

  // ---- Günlük mod ---------------------------------------------------------
  // Son 7 günü tarar: cron bir gün kaçırsa boşluk kalmaz.
  const result = await fetchLatestTcmbRate(7);

  if (!result.ok) {
    // Yayın yokluğu normal durum → 200. Ağ/parse hatası → 502.
    if (result.reason === "no-publication") {
      await recordHeartbeat("tcmb-kur", "ok", "TCMB yayını yok (hafta sonu/tatil)");
      return NextResponse.json({ skipped: true, reason: "TCMB yayını yok (hafta sonu/tatil)" });
    }
    return NextResponse.json(
      { error: result.reason, detail: result.detail },
      { status: 502 },
    );
  }

  const { error } = await admin.from("tcmb_rates").upsert(
    {
      rate_date: result.rate.rateDate,
      usd_buying: result.rate.usdBuying,
      usd_selling: result.rate.usdSelling,
      eur_buying: result.rate.eurBuying,
      eur_selling: result.rate.eurSelling,
    },
    { onConflict: "rate_date" },
  );

  if (error) {
    return NextResponse.json({ error: "db", detail: error.message }, { status: 500 });
  }

  await recordHeartbeat("tcmb-kur", "ok", `kur alındı: ${result.rate.rateDate}`);

  return NextResponse.json({
    ok: true,
    rateDate: result.rate.rateDate,
    usdSelling: result.rate.usdSelling,
    eurSelling: result.rate.eurSelling,
  });
}
