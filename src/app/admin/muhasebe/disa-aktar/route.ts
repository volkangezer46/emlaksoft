import { NextRequest, NextResponse } from "next/server";
import { getPlatformStaff } from "@/lib/platform";
import { platformCanAccess } from "@/lib/platform-access";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { now as clockNow, trDayKey } from "@/lib/clock";
import { resolvePeriod, periodSearchParams } from "@/lib/accounting/period";
import { ledgerFilterParams, matchesLedger, parseLedgerFilter, type LedgerParams } from "@/lib/accounting/ledger";
import { CSV_EOL, csvHeaderLine, csvInvoiceLine, csvText } from "@/lib/accounting/csv";
import { enrichPage, iterateInvoicePages, LEDGER_MAX_ROWS } from "@/lib/accounting/loaders";

/** Her istekte taze: oturum + dönem + canlı veri. */
export const dynamic = "force-dynamic";

/**
 * Muhasebeci dışa aktarımı (CSV). Yetki: süper admin + muhasebe (billing modülü). Hız sınırı: 6 dışa aktarım / 10 dk.
 * Veri sayfa sayfa okunur ve akıtılır (bellekte tüm dönem tutulmaz). Satır içeriği ASLA loglanmaz:
 * denetim kaydı yalnız süzgeç + satır sayısı taşır.
 */
export async function GET(req: NextRequest) {
  const staff = await getPlatformStaff();
  if (!staff) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  if (!platformCanAccess(staff.role, "billing")) return NextResponse.json({ error: "Bu dışa aktarım için yetkiniz yok." }, { status: 403 });

  const rl = await checkRateLimit(`acct-export:${staff.id}`, { limit: 6, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return NextResponse.json({ error: "Çok sık dışa aktarım yapıldı; birkaç dakika sonra tekrar deneyin." }, { status: 429 });

  const sp = req.nextUrl.searchParams;
  const params: LedgerParams = {};
  for (const key of ["donem", "from", "to", "durum", "tur", "yontem", "ofis", "kupon", "q", "min", "max"] as const) {
    const v = sp.get(key);
    if (v) params[key] = v;
  }
  const nowMs = clockNow();
  const period = resolvePeriod(params, nowMs);
  const filter = parseLedgerFilter(params);
  const admin = createAdminClient();
  const encoder = new TextEncoder();
  const mode = filter.durum === "iade" ? "refund" : "accounting";

  let rowCount = 0;
  let truncated = false;
  let failed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(csvHeaderLine()));
        const seen = new Set<string>();
        outer: for await (const page of iterateInvoicePages(admin, period, mode)) {
          const fresh = page.filter((r) => !seen.has(r.id));
          for (const r of fresh) seen.add(r.id);
          const rows = await enrichPage(admin, fresh);
          let chunk = "";
          for (const inv of rows) {
            if (!matchesLedger(inv, filter, period, nowMs)) continue;
            chunk += csvInvoiceLine(inv);
            rowCount += 1;
          }
          if (chunk) controller.enqueue(encoder.encode(chunk));
          if (seen.size >= LEDGER_MAX_ROWS) {
            truncated = true;
            break outer;
          }
        }
        if (truncated) {
          controller.enqueue(encoder.encode(csvText(`UYARI: ${LEDGER_MAX_ROWS} satır sınırına ulaşıldı; liste eksik. Dönemi daraltın.`) + CSV_EOL));
        }
      } catch (e) {
        failed = true;
        console.error("accounting export", e instanceof Error ? e.message : "bilinmeyen");
        controller.enqueue(encoder.encode(csvText("HATA: dışa aktarım yarıda kesildi; dosya eksik.") + CSV_EOL));
      } finally {
        controller.close();
        await logPlatformActivity({
          actorId: staff.id,
          action: failed ? "accounting.export.failed" : "accounting.export.csv",
          entityType: "export",
          entityId: null,
          // Yalnız süzgeç ve sayı: satır içeriği (ofis, tutar, vergi no) loga yazılmaz.
          meta: { rowCount, truncated, ...periodSearchParams(period), ...ledgerFilterParams(filter) },
        });
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="muhasebe-faturalar-${trDayKey(nowMs)}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
