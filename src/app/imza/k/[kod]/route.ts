import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

/**
 * Kısa imza bağlantısı `/imza/k/<kod>` (SMS hatırlatması, 20261007000720). Kod → token eşlemesi anon DEFINER RPC
 * `contract_signer_resolve_short` ile yapılır (yalnız bekleyen imzacı + gönderilmiş, süresi geçmemiş sözleşme +
 * public-aktif ofis); service_role YOK. IP başına hız sınırı kaba kuvvet denemesini keser. Token'lı yüzey: sitemap'e
 * girmez (`/imza/` öneki seo registry'de kapalı), yanıt önbelleğe alınmaz.
 */
export const dynamic = "force-dynamic";

const CODE_RE = /^[0-9a-f]{16}$/;

function invalid() {
  return new NextResponse("İmza bağlantısı geçersiz veya süresi dolmuş. Lütfen ofisinizle iletişime geçin.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ kod: string }> }) {
  const { kod } = await params;
  const ip = await clientIp();
  const rate = await checkRateLimit(`imza-kisa:${ip}`, { limit: 30, windowSec: 10 * 60, failurePolicy: "deny" });
  if (!rate.allowed) {
    return new NextResponse("Çok fazla deneme. Lütfen birkaç dakika sonra tekrar deneyin.", {
      status: 429,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  if (!CODE_RE.test(kod ?? "")) return invalid();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contract_signer_resolve_short", { p_code: kod });
  if (error || typeof data !== "string" || !/^[0-9a-f]{32,128}$/i.test(data)) return invalid();
  const res = NextResponse.redirect(new URL(`/imza/${data}`, _req.url), 303);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
