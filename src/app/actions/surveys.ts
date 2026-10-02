"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { getBaseUrl } from "@/lib/base-url";

export type SurveyResult = { error?: string; ok?: boolean; id?: string; url?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function appUrl() {
  return getBaseUrl();
}

/**
 * Kapanan (stage='won') anlaşma için memnuniyet anketi üretir.
 *
 * Çift yetki kapısı: rapor sayfasından tetiklenir (reports.view) ama
 * anlaşma verisine dokunur — anlaşmaları göremeyen biri anket de üretemesin
 * (deals action'ları commissions modülüyle kapılı, aynı çizgi).
 *
 * SMS GÖNDERİLMEZ (İYS kapsam dışı): link panelde kopyalanır; müşterinin
 * danışmanına "linki iletin" bildirimi düşer. unique(deal_id) mükerrer
 * üretimi DB seviyesinde engeller (23505 → dostane mesaj).
 */
export async function createSurveyForDeal(formData: FormData): Promise<SurveyResult> {
  const gate = await requirePermission("reports", "view");
  if (!gate.ok) return { error: gate.error };
  const dealsGate = await requirePermission("commissions", "view");
  if (!dealsGate.ok) return { error: dealsGate.error };

  const dealId = String(formData.get("deal_id") ?? "").trim();
  if (!UUID_RE.test(dealId)) return { error: "Geçersiz anlaşma." };

  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id, stage, customer_id, assigned_to")
    .eq("id", dealId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!deal) return { error: "Anlaşma bulunamadı." };
  if (deal.stage !== "won") return { error: "Anket yalnızca kazanılan anlaşmalar için oluşturulabilir." };
  if (!deal.customer_id) return { error: "Anlaşmaya bağlı müşteri yok — anket gönderilecek kişi belirsiz." };

  const [{ data: customer }, { data: agent }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name")
      .eq("id", deal.customer_id)
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .maybeSingle(),
    deal.assigned_to
      ? supabase
          .from("profiles")
          .select("id")
          .eq("id", deal.assigned_to)
          .eq("tenant_id", gate.tenantId)
          .eq("is_active", true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!customer) return { error: "Anlaşmanın müşterisi bulunamadı veya bu ofise ait değil." };
  if (deal.assigned_to && !agent) return { error: "Anlaşmanın danışmanı bu ofise ait değil." };

  const { data, error } = await supabase
    .from("surveys")
    .insert({
      tenant_id: gate.tenantId,
      deal_id: deal.id,
      customer_id: customer.id,
      agent_id: agent?.id ?? null,
    })
    .select("id, public_token")
    .single();

  if (error || !data) {
    // unique(deal_id) ihlali — bir anlaşmaya bir anket.
    if (error?.code === "23505") return { error: "Bu anlaşma için zaten bir anket oluşturulmuş." };
    console.error("createSurveyForDeal", error);
    return { error: "Anket oluşturulamadı." };
  }

  const url = `${appUrl()}/anket/${data.public_token}`;

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "survey.create",
    entityType: "survey",
    entityId: data.id,
    newValue: { deal_id: deal.id, customer_id: deal.customer_id },
  });

  // Müşterinin danışmanına haber ver — linki müşteriye o iletecek.
  const customerName = customer.full_name ?? "müşteri";
  const agentId = agent?.id ?? null;
  if (agentId) {
    try {
      await notifyTenant({
        tenantId: gate.tenantId,
        userId: agentId,
        title: "Anket linki hazır — müşteriye iletin",
        body: `${customerName} için memnuniyet anketi oluşturuldu. Linki raporlar sayfasından kopyalayabilirsiniz.`,
        href: "/app/raporlar/memnuniyet",
        kind: "info",
      });
    } catch (e) {
      console.error("createSurveyForDeal notify", e);
    }
  }

  revalidatePath("/app/raporlar/memnuniyet");
  return { ok: true, id: data.id, url };
}
