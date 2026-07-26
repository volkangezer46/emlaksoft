import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";

/**
 * Müşteri kartını vCard 3.0 (.vcf) olarak indirir — "Rehbere ekle".
 * UTF-8 gövde + RFC 5987 filename* ile Türkçe karakter güvenli.
 * Desen: src/app/api/customer-files/[id]/download/route.ts
 */

/** vCard değer kaçışı (RFC 2426): \ , ; ve satır sonları */
function escapeVCard(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

/** ASCII dosya adı yedeği — Türkçe karakterleri sadeleştirir */
function asciiSlug(s: string): string {
  const map: Record<string, string> = { ç: "c", Ç: "C", ğ: "g", Ğ: "G", ı: "i", İ: "I", ö: "o", Ö: "O", ş: "s", Ş: "S", ü: "u", Ü: "U" };
  return s
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (ch) => map[ch] ?? ch)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "musteri";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 403 });

  const { id } = await params;
  const supabase = await createClient();

  const [{ data: customer }, { data: tenant }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name, phone, email")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("tenants").select("name").eq("id", gate.tenantId).maybeSingle(),
  ]);

  if (!customer) {
    return NextResponse.json({ error: "Müşteri bulunamadı" }, { status: 404 });
  }

  const fullName = customer.full_name?.trim() || "İsimsiz müşteri";
  const parts = fullName.split(/\s+/);
  const lastName = parts.length > 1 ? (parts.at(-1) ?? "") : "";
  const firstName = parts.length > 1 ? parts.slice(0, -1).join(" ") : fullName;

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeVCard(fullName)}`,
    `N:${escapeVCard(lastName)};${escapeVCard(firstName)};;;`,
  ];
  if (customer.phone) lines.push(`TEL;TYPE=CELL:${customer.phone}`);
  if (customer.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCard(customer.email)}`);
  if (tenant?.name) lines.push(`ORG:${escapeVCard(tenant.name)}`);
  lines.push("NOTE:EmlakSoft", `REV:${new Date().toISOString()}`, "END:VCARD");

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
