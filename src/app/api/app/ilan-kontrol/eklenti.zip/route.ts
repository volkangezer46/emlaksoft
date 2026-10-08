import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/require-permission";
import { readExtensionPackage } from "@/lib/listing-control/server/extension-package";

export const dynamic = "force-dynamic";

/**
 * GET /api/app/ilan-kontrol/eklenti.zip — sürüm numaralı eklenti paketi (ZIP). Paket derleme sırasında üretilir
 * (`npm run build:extension` / `prebuild`); yoksa 404 (uygulama içi sayfa bunu "henüz hazır değil" olarak gösterir).
 * Kimlik: oturum; yetki: portals/view. Paket gizli veri içermez (açık kaynak kodlu istemci), yine de yalnız ofis kullanıcılarına verilir.
 */
export async function GET() {
  const gate = await requirePermission("portals", "view");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.error === "Oturum bulunamadı." ? 401 : 403, headers: { "Cache-Control": "no-store" } });

  const pkg = await readExtensionPackage();
  if (!pkg) return NextResponse.json({ error: "Eklenti paketi bu sürümde henüz hazır değil." }, { status: 404, headers: { "Cache-Control": "no-store" } });

  return new Response(new Uint8Array(pkg.data), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${pkg.fileName}"`,
      "Content-Length": String(pkg.data.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
