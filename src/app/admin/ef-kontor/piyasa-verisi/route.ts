import { NextRequest, NextResponse } from "next/server";
import { getPlatformStaff } from "@/lib/platform";
import { platformCanAccess } from "@/lib/platform-access";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { now as clockNow, trDayKey } from "@/lib/clock";
import { getAllDistricts, getProvinceNameMap } from "@/lib/geo";
import { buildMarketExport } from "@/lib/listing-control/market-export";
import { marketCellsToCsv, type MarketCellPlace } from "@/lib/listing-control/market-signals";

/** Her istekte taze (oturum + canlı veri). */
export const dynamic = "force-dynamic";

/**
 * Emlakfiyati ANONİM/AGREGAT piyasa verisi dışa aktarımı (CSV/JSON). Yetki: süper admin (faturalama modülü + rol).
 * Kaynak `control_market_signals_v` yalnız service_role'e açık → kabul listesindeki istemci (gerekçe: platform geneli,
 * opt-in ofislerin toplulaştırılmış verisi; çıktıda ofis/ilan/kişi YOK). Yalnız `office.market_data.share_enabled`
 * açık ofisler; hücre başına en az k=5 ilan ve en az `ofis` (varsayılan 2) farklı ofis. Denetim kaydı yalnız sayıları taşır.
 */
export async function GET(req: NextRequest) {
  const staff = await getPlatformStaff();
  if (!staff) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  if (!platformCanAccess(staff.role, "billing") || staff.role !== "super_admin") {
    return NextResponse.json({ error: "Bu dışa aktarım yalnız süper admin içindir." }, { status: 403 });
  }
  const rl = await checkRateLimit(`market-export:${staff.id}`, { limit: 6, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return NextResponse.json({ error: "Çok sık dışa aktarım yapıldı; birkaç dakika sonra tekrar deneyin." }, { status: 429 });

  const sp = req.nextUrl.searchParams;
  const format = sp.get("bicim") === "json" ? "json" : "csv";
  const k = Math.min(Math.max(Math.trunc(Number(sp.get("k"))) || 5, 5), 50);
  const minTenants = Math.min(Math.max(Math.trunc(Number(sp.get("ofis"))) || 2, 1), 10);

  const admin = createAdminClient();
  const result = await buildMarketExport(admin, { k, minTenants });
  if (!result.available) {
    return NextResponse.json({ error: "Piyasa verisi görünümü okunamadı (İlan Kontrol migration'ları uygulanmamış olabilir)." }, { status: 503 });
  }

  const [districts, provinceNames] = await Promise.all([getAllDistricts(), getProvinceNameMap()]);
  const districtById = new Map(districts.map((d) => [d.id, d]));
  const placeOf = (districtId: string | null): MarketCellPlace => {
    const d = districtId ? districtById.get(districtId) : undefined;
    return { province: d ? provinceNames.get(d.provinceId) ?? null : null, district: d?.name ?? null };
  };

  await logPlatformActivity({
    actorId: staff.id,
    action: `market_data.export.${format}`,
    entityType: "export",
    entityId: null,
    meta: { k, min_offices: minTenants, cells: result.cells.length, opted_in_offices: result.optedInOffices, truncated: result.truncated },
  });

  const day = trDayKey(clockNow());
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (format === "json") {
    const body = {
      kaynak: "EmlakSoft anonim piyasa sinyalleri",
      olusturma_gunu: day,
      k_anonimlik: k,
      hucre_basina_en_az_ofis: minTenants,
      katilan_ofis_sayisi: result.optedInOffices,
      eksik: result.truncated,
      hucreler: result.cells.map((c) => ({ ...placeOf(c.districtId), ...c, districtId: undefined })),
    };
    return new NextResponse(JSON.stringify(body, null, 2), {
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="piyasa-sinyalleri-${day}.json"` },
    });
  }
  return new NextResponse(`﻿${marketCellsToCsv(result.cells, placeOf)}`, {
    headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="piyasa-sinyalleri-${day}.csv"` },
  });
}
