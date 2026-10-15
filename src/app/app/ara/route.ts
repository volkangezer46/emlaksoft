import type { NextRequest } from "next/server";
import { publicRedirect } from "@/lib/public-redirect";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { getListScope } from "@/lib/access-control/list-scope";
import { applyScopeFilter } from "@/lib/access-control/query-scope";
import { callerRedirectPath, phoneSearchNeedle } from "@/lib/caller-lookup";

/**
 * Arayan müşteri kısayolu: `/app/ara?tel=<numara>` (santral/CTI ekran açma bağlantısı, telefon "paylaş" menüsü, yer imi).
 * Numara her biçimde gelebilir; `phone-rules` ile saklama biçimine çevrilip müşteri (alıcı/malik/kiracı = customers kaydı)
 * `phone_digits` üzerinden aranır. Tek eşleşme → müşteri kartı, yok → numarası dolu yeni müşteri formu (form, numara
 * kapsam dışı bir danışmanın müşterisiyse "Bu numara X danışmanının müşterisi" uyarısını gösterir), çok → arama sonuçları.
 * Sayfa DEĞİL yönlendirme (menüde öğe olmaz). Kapsam müşteri LİSTESİYLE AYNI (`getListScope`, B059).
 */
export async function GET(req: NextRequest) {
  // Kök istekten DEĞİL getBaseUrl'den (ters vekil arkasında req.nextUrl konteynerin iç adresidir: 0.0.0.0:3000).
  const go = (path: string) => publicRedirect(path, 303);

  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return go("/app");

  const n = phoneSearchNeedle(req.nextUrl.searchParams.get("tel"));
  if (!n) return go("/app/musteriler");

  const [supabase, listScope] = await Promise.all([
    createClient(),
    getListScope({ userId: gate.userId, tenantId: gate.tenantId, role: gate.role }),
  ]);
  const q = applyScopeFilter(
    supabase
      .from("customers")
      .select("id")
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .ilike("phone_digits", `%${n.needle}%`)
      .limit(2),
    listScope.filter,
    { ownerColumn: "assigned_to" },
  );
  const { data, error } = await q;
  if (error) return go(`/app/arama-sonuclari?q=${encodeURIComponent(n.needle)}`);
  return go(callerRedirectPath((data ?? []).map((r) => ({ id: r.id as string })), n));
}
