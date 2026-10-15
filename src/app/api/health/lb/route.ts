import { NextResponse } from "next/server";
import { isDraining } from "@/lib/release-drain";

export const dynamic = "force-dynamic";

/**
 * Traefik yük dengeleyici yoklaması (deploy/compose.prod.yml `loadbalancer.healthcheck.path`). DB'ye GİTMEZ: yalnız
 * boşaltma işaretine bakar. Tam hazırlık (DB + migration) `/api/health`'tedir ve deploy.sh yeni rengi trafiğe vermeden
 * önce onu bekler; Traefik'in onu yoklaması bir DB dalgalanmasında ya da yük altında 2 sn aşımında İKİ rengi birden
 * havuzdan çıkarır ve tüm site (DB'siz sayfalar dahil) "no available server" 503'üne düşerdi.
 */
export function GET() {
  const draining = isDraining();
  return NextResponse.json(
    { ok: !draining },
    { status: draining ? 503 : 200, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
