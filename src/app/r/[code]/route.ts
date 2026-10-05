import type { NextRequest } from "next/server";
import { parseShortCode } from "@/lib/growth/attribution";
import { captureAndRedirect } from "@/lib/growth/capture";

export const dynamic = "force-dynamic";

/** Kısa davet/vitrin imzası bağlantısı: /r/<davet kodu> veya /r/v-<vitrin>. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return captureAndRedirect(req, parseShortCode(code));
}
