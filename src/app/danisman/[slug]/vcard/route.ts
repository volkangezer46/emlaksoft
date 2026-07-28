import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { toE164TurkishPhone } from "@/lib/phone";

/**
 * "Rehbere ekle" — danışman kartvizitini vCard 3.0 (.vcf) olarak indirir.
 * Desen: src/app/app/musteriler/[id]/vcard/route.ts (UTF-8 gövde + RFC 5987
 * filename*), ancak burası PUBLIC: yetki kapısı yerine slug + `is_public`
 * kontrolü var ve sorgu service role ile yapılır (RLS anon'a açık değil).
 *
 * HIZ SINIRI: sayfanın kendisi ISR ile CDN'den gelir, bu uç ise her istekte
 * DB'ye gider → IP başına sabit pencere sınırı (lead/demo formu deseni).
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

/** vCard değer kaçışı (RFC 2426): \ , ; ve satır sonları */
function escapeVCard(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

/** ASCII dosya adı yedeği — Türkçe karakterleri sadeleştirir */
function asciiSlug(s: string): string {
  const map: Record<string, string> = {
    ç: "c", Ç: "C", ğ: "g", Ğ: "G", ı: "i", İ: "I", ö: "o", Ö: "O", ş: "s", Ş: "S", ü: "u", Ü: "U",
  };
  return (
    s
      .replace(/[çÇğĞıİöÖşŞüÜ]/g, (ch) => map[ch] ?? ch)
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "danisman"
  );
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json({ error: "Kartvizit bulunamadı" }, { status: 404 });
  }

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`vcard:${ip}`, { limit: 30, windowSec: 60 });
  if (!allowed) {
    return NextResponse.json({ error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." }, { status: 429 });
  }

  const admin = createAdminClient();
  const { data: agent } = await admin
    .from("profiles")
    .select("id, tenant_id, full_name, phone, title, is_active, is_public")
    .eq("public_slug", slug)
    .maybeSingle();

  if (!agent || agent.is_public !== true || agent.is_active !== true) {
    return NextResponse.json({ error: "Kartvizit bulunamadı" }, { status: 404 });
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("name, slug")
    .eq("id", agent.tenant_id)
    .maybeSingle();

  const fullName = String(agent.full_name ?? "").trim() || "Emlak danışmanı";
  const parts = fullName.split(/\s+/);
  const lastName = parts.length > 1 ? (parts.at(-1) ?? "") : "";
  const firstName = parts.length > 1 ? parts.slice(0, -1).join(" ") : fullName;

  const origin = req.nextUrl.origin;
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeVCard(fullName)}`,
    `N:${escapeVCard(lastName)};${escapeVCard(firstName)};;;`,
  ];
  // Telefon uluslararası biçimde yazılır — kart yurt dışından da aranabilsin.
  if (agent.phone) lines.push(`TEL;TYPE=CELL:${toE164TurkishPhone(agent.phone as string)}`);
  if (agent.title) lines.push(`TITLE:${escapeVCard(String(agent.title))}`);
  if (tenant?.name) lines.push(`ORG:${escapeVCard(String(tenant.name))}`);
  lines.push(`URL:${origin}/danisman/${slug}`);
  lines.push("END:VCARD");

  const vcf = lines.join("\r\n") + "\r\n";
  const filename = `${asciiSlug(fullName)}.vcf`;

  return new NextResponse(vcf, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(fullName)}.vcf`,
      "Cache-Control": "no-store",
    },
  });
}
