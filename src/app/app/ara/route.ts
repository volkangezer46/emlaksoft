import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import { callerRedirectPath, phoneSearchNeedle } from "@/lib/caller-lookup";

/**
 * Arayan müşteri kısayolu: `/app/ara?tel=<numara>` (santral/CTI ekran açma bağlantısı, telefon "paylaş" menüsü, yer imi).
 * Numara her biçimde gelebilir; `phone-rules` ile saklama biçimine çevrilip müşteri (alıcı/malik/kiracı = customers kaydı)
 * aranır. Tek eşleşme → müşteri kartı, yok → numarası dolu yeni müşteri formu, çok → arama sonuçları. Sayfa DEĞİL yönlendirme
 * (menüde öğe olmaz). Kapsam üst çubuk aramasıyla aynı: ofis geneli yetkisi yoksa yalnız kendine atanan müşteriler.
 */
export async function GET(req: NextRequest) {
  const base = req.nextUrl.clone();
  base.search = "";
  const go = (path: string) => {
    const u = new URL(path, base);
    return NextResponse.redirect(u, 303);
  };

  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return go("/app");

  const n = phoneSearchNeedle(req.nextUrl.searchParams.get("tel"));
  if (!n) return go("/app/musteriler");

  const supabase = await createClient();
  let q = supabase
    .from("customers")
    .select("id")
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .ilike("phone", `%${n.needle}%`)
    .limit(2);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("assigned_to", gate.userId);
  const { data, error } = await q;
  if (error) return go(`/app/arama-sonuclari?q=${encodeURIComponent(n.needle)}`);
  return go(callerRedirectPath((data ?? []).map((r) => ({ id: r.id as string })), n));
}
