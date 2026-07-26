import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { isValidOptionalTurkishMobile, normalizeTurkishPhone } from "@/lib/phone";
import { notifyTenant } from "@/lib/notify";

export type LeadInput = {
  fullName: string;
  phone?: string;
  email?: string;
  message?: string;
  source?: string;
  channel?: string;
  transactionType?: string;
  propertyType?: string;
  provinceId?: string;
  budgetMin?: number | null;
  budgetMax?: number | null;
  rooms?: string;
};

export type LeadResult =
  | { ok: true; customerId: string; assignedTo: string | null; duplicate: boolean }
  | { ok: false; error: string; status: number };

const ASSIGNABLE_ROLES = ["advisor", "team_lead", "branch_manager", "gm", "owner"];

/**
 * Aktif danışmanlar arasında en az yüklü olana atar (round-robin/least-loaded).
 * Böylece gelen her lead adil biçimde dağıtılır ve speed-to-lead sağlanır.
 */
async function pickAssignee(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<string | null> {
  const { data: members } = await admin
    .from("profiles")
    .select("id, role")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("role", ASSIGNABLE_ROLES);

  if (!members || members.length === 0) return null;

  // Danışman rolü öncelikli; yoksa yönetici rollerine düş.
  const advisors = members.filter((m) => m.role === "advisor" || m.role === "team_lead");
  const pool = advisors.length > 0 ? advisors : members;

  const { data: loads } = await admin
    .from("customers")
    .select("assigned_to")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .not("assigned_to", "is", null);

  const counts = new Map<string, number>();
  for (const m of pool) counts.set(m.id, 0);
  for (const row of loads ?? []) {
    const a = (row as { assigned_to: string | null }).assigned_to;
    if (a && counts.has(a)) counts.set(a, (counts.get(a) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const m of pool) {
    const c = counts.get(m.id) ?? 0;
    if (c < bestCount) {
      bestCount = c;
      best = m.id;
    }
  }
  return best;
}

export async function intakeLead(token: string, input: LeadInput): Promise<LeadResult> {
  const fullName = input.fullName?.trim();
  if (!fullName) return { ok: false, error: "Ad soyad zorunlu.", status: 400 };
  if (input.phone && !isValidOptionalTurkishMobile(input.phone)) {
    return { ok: false, error: "Geçerli bir Türk cep telefonu girin.", status: 400 };
  }

  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, lead_capture_enabled")
    .eq("lead_capture_token", token)
    .maybeSingle();

  if (!tenant) return { ok: false, error: "Geçersiz bağlantı.", status: 404 };
  if (tenant.lead_capture_enabled === false) {
    return { ok: false, error: "Bu form şu anda kapalı.", status: 403 };
  }

  const tenantId = tenant.id as string;
  const phone = input.phone ? normalizeTurkishPhone(input.phone) : "";
  const channel = (input.channel || "web_form").slice(0, 40);
  const source = (input.source || channel).slice(0, 80);

  // Telefonla mükerrer kayıt kontrolü
  let customerId: string | null = null;
  let assignedTo: string | null = null;
  let duplicate = false;

  if (phone) {
    const { data: existing } = await admin
      .from("customers")
      .select("id, assigned_to")
      .eq("tenant_id", tenantId)
      .eq("phone", phone)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (existing) {
      customerId = existing.id as string;
      assignedTo = (existing.assigned_to as string | null) ?? null;
      duplicate = true;
    }
  }

  if (!customerId) {
    assignedTo = await pickAssignee(admin, tenantId);
    const { data: created, error } = await admin
      .from("customers")
      .insert({
        tenant_id: tenantId,
        full_name: fullName,
        phone: phone || null,
        email: input.email?.trim() || null,
        customer_types: ["alici"],
        province_id: input.provinceId || null,
        source,
        lead_channel: channel,
        auto_assigned: !!assignedTo,
        assigned_to: assignedTo,
        notes: input.message?.trim() || null,
      })
      .select("id")
      .single();

    if (error || !created) {
      console.error("intakeLead insert", error);
      return { ok: false, error: "Kayıt oluşturulamadı.", status: 500 };
    }
    customerId = created.id as string;
  }

  // Talep bilgisi verilmişse demand oluştur
  if (input.transactionType) {
    await admin.from("customer_demands").insert({
      tenant_id: tenantId,
      customer_id: customerId,
      transaction_type: input.transactionType,
      property_type: input.propertyType || null,
      province_id: input.provinceId || null,
      budget_min: input.budgetMin ?? null,
      budget_max: input.budgetMax ?? null,
      rooms: input.rooms || null,
      status: "new",
    });
  }

  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: null,
    action: duplicate ? "lead.intake.duplicate" : "lead.intake",
    entity_type: "customer",
    entity_id: customerId,
    new_value: { full_name: fullName, phone, channel, source, assigned_to: assignedTo },
  });

  // Speed-to-lead: atanan danışmana anında bildirim (yoksa ofise geneli)
  await notifyTenant({
    tenantId,
    userId: assignedTo,
    title: duplicate ? "Tekrar eden lead geldi" : "Yeni lead geldi",
    body: `${fullName}${phone ? ` · ${phone}` : ""} · ${source}`,
    href: `/app/musteriler/${customerId}`,
    kind: "success",
  });

  return { ok: true, customerId, assignedTo, duplicate };
}
