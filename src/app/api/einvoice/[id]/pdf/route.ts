import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { EINVOICE_ROW_COLUMNS, loadAdapterForUser, rowToRef, type EInvoiceRow } from "@/lib/integrations/einvoice/service";

/**
 * Fatura PDF GÖRÜNTÜLEME (indirme/dışa aktarma değil: satır içi belge). Satır oturumlu istemciyle (RLS + commissions.create)
 * okunur; PDF sağlayıcıdan anlık alınır, DB'ye/dosyaya yazılmaz. Paraşüt imzalı süreli adresini döndürür -> yönlendirilir.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(message = "Fatura bulunamadı") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission("commissions", "create");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 403 });

  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("einvoices").select(EINVOICE_ROW_COLUMNS).eq("id", id).eq("tenant_id", gate.tenantId).maybeSingle();
  const row = data as unknown as EInvoiceRow | null;
  if (!row) return notFound();
  const ref = rowToRef(row);
  if (!ref || row.status === "draft") return notFound("Fatura henüz resmileştirilmedi; PDF yok.");

  const loaded = await loadAdapterForUser(supabase, gate.tenantId);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error.message }, { status: 409 });
  if (loaded.value.connection.provider !== row.provider) {
    return NextResponse.json({ error: "Bu fatura başka bir sağlayıcıyla kesilmiş." }, { status: 409 });
  }
  const pdf = await loaded.value.adapter.getPdf(ref);
  if (!pdf.ok) return NextResponse.json({ error: pdf.error.message }, { status: pdf.error.code === "not_found" ? 404 : 502 });

  if (pdf.value.url) {
    const target = new URL(pdf.value.url);
    if (target.protocol !== "https:") return NextResponse.json({ error: "PDF adresi güvenli değil." }, { status: 502 });
    return NextResponse.redirect(target, 302);
  }
  if (!pdf.value.bytes) return notFound("PDF alınamadı.");
  return new Response(pdf.value.bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.value.bytes.byteLength),
      "Content-Disposition": 'inline; filename="fatura.pdf"',
      "Cache-Control": "private, no-store, max-age=0",
      "CDN-Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
    },
  });
}
