import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";

/**
 * Aylık bölge istatistik fotoğrafı cron'u.
 *
 * Zamanlama: ayda 1 — her ayın 1'i (öneri: "0 3 1 * *", 03:00 UTC).
 *
 * NE YAPAR: Tüm aktif tenant'lar için mevcut `region_stats` RPC'sini üç
 * filtreyle (Tümü / Satılık / Kiralık) çalıştırır ve sonuçları bu ayın
 * `region_stats_history` satırları olarak upsert eder. Aynı ay ikinci kez
 * çalışırsa unique(tenant, ilçe, ay, tip) sayesinde satırlar GÜNCELLENİR —
 * mükerrer kayıt oluşmaz, yani cron'u elle tetiklemek güvenlidir.
 *
 * NEDEN SNAPSHOT: region_stats anlık hesaptır; geçmişe dönük "6 ay önce medyan
 * neydi?" sorusu ancak bu tarihçe biriktikçe cevaplanabilir. /app/bolge-analizi
 * trend çizgisini buradan okur.
 */

// region_stats() dönüş satırının burada kullanılan alt kümesi
type RegionStatRow = {
  district_id: string;
  median_sqm_price: number | string | null;
  active_count: number;
  avg_days_listed: number | string | null;
  closed_count: number;
};

// RPC filtresi (null = filtresiz) → history tablosundaki tx_type etiketi
const TX_VARIANTS: Array<{ filter: string | null; label: "Tümü" | "Satılık" | "Kiralık" }> = [
  { filter: null, label: "Tümü" },
  { filter: "Satılık", label: "Satılık" },
  { filter: "Kiralık", label: "Kiralık" },
];

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // Ay başı (UTC) — history.period check kısıtıyla birebir aynı yuvarlama
  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;

  const { data: tenants, error: tenantsError } = await admin
    .from("tenants")
    .select("id")
    .in("status", ["active", "trial", "past_due"])
    .limit(500);

  if (tenantsError) {
    await recordHeartbeat("bolge-snapshot", "error", `tenant listesi okunamadı: ${tenantsError.message}`);
    return NextResponse.json({ error: "db", detail: tenantsError.message }, { status: 500 });
  }

  let upserted = 0;
  let failed = 0;
  let tenantsWithData = 0;

  for (const t of tenants ?? []) {
    // Üç varyant birbirinden bağımsız — paralel çekilebilir
    const results = await Promise.all(
      TX_VARIANTS.map(async (v) => {
        const { data, error } = await admin.rpc("region_stats", {
          p_tenant_id: t.id,
          p_transaction_type: v.filter,
          p_months_back: 12,
        });
        return { label: v.label, rows: (error ? [] : (data ?? [])) as RegionStatRow[], error };
      }),
    );

    const rows = results.flatMap((r) =>
      r.rows
        .filter((row) => row.district_id)
        .map((row) => ({
          tenant_id: t.id,
          district_id: row.district_id,
          period,
          tx_type: r.label,
          median_sqm_price: row.median_sqm_price != null ? Number(row.median_sqm_price) : null,
          active_count: Number(row.active_count ?? 0),
          avg_days_listed: row.avg_days_listed != null ? Number(row.avg_days_listed) : null,
          closed_count: Number(row.closed_count ?? 0),
        })),
    );

    if (results.some((r) => r.error)) failed += 1;
    if (rows.length === 0) continue;

    const { error } = await admin
      .from("region_stats_history")
      .upsert(rows, { onConflict: "tenant_id,district_id,period,tx_type" });

    if (error) {
      failed += 1;
      continue;
    }
    upserted += rows.length;
    tenantsWithData += 1;
  }

  const detail = `${period}: ${tenantsWithData} ofis, ${upserted} satır${failed ? `, ${failed} hata` : ""}`;
  await recordHeartbeat("bolge-snapshot", failed > 0 ? "error" : "ok", detail);

  return NextResponse.json({
    ok: failed === 0,
    period,
    tenants: tenants?.length ?? 0,
    tenantsWithData,
    upserted,
    failed,
  });
}
