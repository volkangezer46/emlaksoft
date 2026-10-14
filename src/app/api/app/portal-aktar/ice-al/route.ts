import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { now as clockNow } from "@/lib/clock";
import { logActivity } from "@/lib/activity";
import { resolveDistrict } from "@/lib/prospecting/district";
import { sanitizeImportItems } from "@/lib/portal-transfer/import-plan";
import { runPortalImport } from "@/lib/portal-transfer/import-run";
import { isTransferPortal } from "@/lib/portal-transfer/rules";
import { guardBridgeRequest, NO_STORE } from "@/lib/portal-transfer/bridge-guard";

export const dynamic = "force-dynamic";

const MAX_BODY = 120_000;

/**
 * POST /api/app/portal-aktar/ice-al — "İlanlarımı EmlakSoft'a al". Eklenti, kullanıcının açık "İlanlarım" sayfasından okuduğu
 * ve KULLANICININ SEÇTİĞİ ilanları kendi EmlakSoft oturumuyla gönderir. Sunucu portala istek ATMAZ. Mükerrer kontrolü: önce portal
 * ilan numarası (canlı bağ), sonra eşleştirme motoru; kalanlar taslak portföy olur (kaynak 'assisted', created_via 'import').
 * Telefon/kişi adı alınmaz. Kapı: `portals:edit` + `properties:create`.
 */
export async function POST(request: Request) {
  const guard = await guardBridgeRequest(request, {
    rateKey: "pt-ice-al",
    limit: 10,
    permissions: [
      ["portals", "edit"],
      ["properties", "create"],
    ],
  });
  if (!guard.ok) return guard.response;
  const { gate, userId } = guard;

  let portal: string | undefined;
  let rawItems: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ ok: false, error: "too_large" }, { status: 413, headers: NO_STORE });
    const body = JSON.parse(raw) as { portal?: string; items?: unknown };
    portal = body.portal;
    rawItems = body.items;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: NO_STORE });
  }
  if (!isTransferPortal(portal)) return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400, headers: NO_STORE });
  const items = sanitizeImportItems(portal, rawItems);
  if (items.length === 0) return NextResponse.json({ ok: false, error: "no_items", message: "Eklenecek geçerli ilan yok." }, { status: 400, headers: NO_STORE });

  const db = await createClient();
  const stamp = new Date(clockNow()).toISOString().slice(2, 7).replace("-", "");
  const run = await runPortalImport(
    {
      db,
      tenantId: gate.tenantId,
      userId,
      role: gate.role,
      portal,
      resolvePlace: (text) => resolveDistrict(text).then((p) => (p ? { provinceId: p.provinceId, districtId: p.districtId } : null)),
      newPropertyCode: () => `ES-${stamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
    },
    items,
  );
  if ("error" in run) return NextResponse.json({ ok: false, error: "schema_pending", message: run.error }, { status: 502, headers: NO_STORE });

  if (run.counts.created > 0 || run.counts.possibleMatch > 0) {
    await logActivity({
      tenantId: gate.tenantId,
      actorId: userId,
      action: "portal.import",
      entityType: "portal_transfer",
      newValue: { portal, ...run.counts },
    });
    revalidatePath("/app/portfoyler");
    revalidatePath("/app/ilan-kontrol/portallar");
    revalidatePath("/app/ilan-kontrol");
    revalidatePath("/app/ilan-kontrol/eslesme");
  }
  return NextResponse.json({ ok: true, summary: run.summary, counts: run.counts, results: run.results }, { headers: NO_STORE });
}
