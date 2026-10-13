import { NextResponse } from "next/server";
import { loadTemplateText } from "@/lib/email/send";
import { authTemplateDef, renderAuthTemplateHtml } from "@/lib/email/templates";

export const dynamic = "force-dynamic";

/**
 * GoTrue (Supabase Auth) e-posta şablonları: GOTRUE_MAILER_TEMPLATES_<TİP>=https://emlaksoft.com.tr/api/auth-templates/<tip>
 * (tip: invite | confirmation | recovery | magic_link | email_change). GoTrue şablonu bu uçtan çeker ve kısa süre
 * önbelleğe alır; admin metni (`email.template.auth_<tip>.body`, ayar önbelleği ≤30 sn) deploy gerekmeden yansır.
 * Gövde ortak marka yerleşimiyle HTML'e çevrilir; admin metni Go-güvenli kaçışlanır (`{`/`}` varlık), yalnız katalogdaki
 * değişkenler sabit Go yer tutucularına (`{{ .ConfirmationURL }}`, `{{ .Token }}` ...) bağlanır. Herkese açık uçtur:
 * yalnız şablon metni döner (kişisel veri yok). Ayar okunamazsa varsayılan metin döner (GoTrue e-postası kesilmez).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const def = authTemplateDef(type);
  if (!def) return new NextResponse("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const text = await loadTemplateText(def.key);
  const html = renderAuthTemplateHtml(def, text.body, text.footer);
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
