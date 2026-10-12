import { now } from "@/lib/clock";
import { closeFsboInsightAfterContact } from "@/lib/insights/close-on-contact";
import { requirePermission } from "@/lib/require-permission";
import { MANAGER_ROLES } from "@/lib/team/assignable-roles";
import type { Db } from "./store";
import { isFsboStatus } from "./types";

/**
 * Portföye dönüşüm bağı: portföy oluşturma akışı (`createProperty`) başarıyla bitince ilan sahibi adayı "Portföye döndü"
 * olur. Kişisel veri (ad, telefon) artık müşteri kaydındadır; adayda silinir (müşteri saklama kuralları işler).
 * Çağrı merkezi dönüştüremez (sahip kararı). Dönüşüm geri alınamaz; hata portföy oluşumunu ETKİLEMEZ (çağıran yalnız uyarır).
 */
export async function linkConvertedFsboLead(
  db: Db,
  input: { tenantId: string; userId: string; role: string; leadId: string; propertyId: string; customerId: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(input.leadId)) return { ok: false, error: "Sahibinden ilan kaydı tanınmadı." };
  if (input.role === "call_center") return { ok: false, error: "Çağrı merkezi sahibinden ilanı portföye dönüştüremez." };
  const gate = await requirePermission("prospecting", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };

  const { data } = await db
    .from("fsbo_leads")
    .select("id, assigned_to, status, customer_id")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.leadId)
    .is("deleted_at", null)
    .maybeSingle();
  const lead = data as { id: string; assigned_to: string | null; status: string; customer_id: string | null } | null;
  if (!lead) return { ok: false, error: "Sahibinden ilan kaydı bulunamadı." };
  if (!isFsboStatus(lead.status) || lead.status === "portfoye_donustu" || lead.status === "kayip") return { ok: false, error: "Bu kayıt portföye dönüştürülemez." };
  const privileged = (MANAGER_ROLES as readonly string[]).includes(input.role) || input.role === "team_lead";
  if (!privileged && lead.assigned_to && lead.assigned_to !== input.userId) return { ok: false, error: "Bu kayıt başka bir danışmanın." };

  const nowIso = new Date(now()).toISOString();
  const upd = await db
    .from("fsbo_leads")
    .update({
      status: "portfoye_donustu",
      status_changed_at: nowIso,
      converted_at: nowIso,
      last_activity_at: nowIso,
      next_action_at: null,
      property_id: input.propertyId,
      customer_id: input.customerId ?? lead.customer_id,
      // Kişisel veri müşteri kaydına geçti; adayda tutulmaz (telefon özeti ilan eşleştirmesi için kalır).
      owner_name: null,
      phone: null,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", lead.id);
  if (upd.error) return { ok: false, error: "Sahibinden ilan kaydı güncellenemedi." };
  await db.from("fsbo_lead_activities").insert({
    tenant_id: input.tenantId,
    lead_id: lead.id,
    actor_id: input.userId,
    kind: "status",
    note: "Portföye dönüştü.",
  });
  closeFsboInsightAfterContact(lead.id);
  return { ok: true };
}
