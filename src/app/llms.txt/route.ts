import { getBaseUrl } from "@/lib/base-url";
import { buildLlmsTxt } from "@/lib/seo/robots-rules";
import { getSeoSettings } from "@/lib/seo/store";

/** llms.txt: isteğe bağlı site özeti. Varsayılan KAPALI (404); /admin/seo'dan açılır. */
export async function GET() {
  const s = await getSeoSettings();
  const body = buildLlmsTxt(s.global, s.robots, getBaseUrl());
  if (body === null) return new Response("Not found", { status: 404 });
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=3600" },
  });
}
