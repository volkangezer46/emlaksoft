import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { notifyPlatformStaff } from "@/lib/platform-notify";

/**
 * Çeyreklik geo tutarlılık denetimi (vercel.json: her 3 ayın 1'i, 04:00 UTC).
 *
 * NEDEN dış API yok: il/ilçe/mahale verisi zaten `npm run geo:sync`
 * (scripts/geo-sync.ts, TurkiyeAPI statik seti) ile elle senkronlanıyor.
 * Cron'un işi senkron DEĞİL, senkronun ve gündelik yazımların bozulmadığını
 * DOĞRULAMAK: dış bağımlılık olmadan, tek RPC ile tutarlılık sayımları alınır
 * (migration 20260726000102 → public.geo_consistency_check()).
 *
 * Denetlenenler:
 *  * ilçesi olmayan aktif il / mahallesi olmayan aktif ilçe (eksik senkron)
 *  * geo tablolarında öksüz FK (province/district referansı boşta kalan satır)
 *  * properties / customer_demands içinde geo karşılığı olmayan province_id /
 *    district_id (öksüz referans — restore/elle müdahale sonrası sessiz bozulma)
 *
 * Sorun bulunursa platform personeline bildirim düşer (dunning cron'undaki
 * notifyPlatformStaff deseni); temizse yalnız heartbeat yazılır.
 */

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** RPC çıktısındaki anahtarlar — hepsi sayı; eksikse 0 kabul edilir. */
const CHECKS: ReadonlyArray<{ key: string; label: string; severity: "danger" | "warning" }> = [
  { key: "provinces_without_district", label: "ilçesi olmayan aktif il", severity: "warning" },
  { key: "districts_without_neighborhood", label: "mahallesi olmayan aktif ilçe", severity: "warning" },
  { key: "orphan_districts", label: "ile bağlı olmayan ilçe", severity: "danger" },
  { key: "orphan_neighborhoods", label: "ilçeye bağlı olmayan mahalle", severity: "danger" },
  { key: "properties_orphan_province", label: "geo karşılığı olmayan il referanslı portföy", severity: "danger" },
  { key: "properties_orphan_district", label: "geo karşılığı olmayan ilçe referanslı portföy", severity: "danger" },
  { key: "demands_orphan_province", label: "geo karşılığı olmayan il referanslı talep", severity: "danger" },
  { key: "demands_orphan_district", label: "geo karşılığı olmayan ilçe referanslı talep", severity: "danger" },
];

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("geo_consistency_check");

  if (error) {
    await recordHeartbeat("geo-sync", "error", `denetim RPC hatası: ${error.message}`);
    return NextResponse.json({ error: "rpc", detail: error.message }, { status: 500 });
  }

  const counts = (data ?? {}) as Record<string, number>;
  const issues = CHECKS
    .map((c) => ({ ...c, count: Number(counts[c.key] ?? 0) }))
    .filter((c) => c.count > 0);

  if (issues.length > 0) {
    const hasDanger = issues.some((i) => i.severity === "danger");
    const body = issues.map((i) => `${i.label}: ${i.count}`).join(" · ");
    await notifyPlatformStaff({
      title: "Geo tutarlılık denetimi sorun buldu",
      body: `${body}. Eksik kapsam için \`npm run geo:sync\`, öksüz referanslar için veri onarımı gerekir.`,
      href: "/admin/sistem",
      kind: hasDanger ? "danger" : "warning",
      meta: { job: "geo-sync", counts },
    });
    await recordHeartbeat("geo-sync", "ok", `${issues.length} bulgu: ${body}`.slice(0, 500));
    return NextResponse.json({ ok: true, clean: false, issues, counts });
  }

  await recordHeartbeat("geo-sync", "ok", "geo tutarlılık temiz");
  return NextResponse.json({ ok: true, clean: true, counts });
}
