import type { NextRequest } from "next/server";
import { isPartnerCode } from "@/lib/growth/attribution";
import { captureAndRedirect } from "@/lib/growth/capture";
import { isActivePartnerCode } from "@/lib/growth/store";

export const dynamic = "force-dynamic";

/** Ortak bağlantısı: /p/<kod>. Kod bilinmiyor/pasifse (ya da program kapalıysa) sessizce /kayit'a düşer. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.trim().toLowerCase();
  const ok = isPartnerCode(code) && (await isActivePartnerCode(code));
  return captureAndRedirect(req, ok ? { kind: "partner", code } : null);
}
