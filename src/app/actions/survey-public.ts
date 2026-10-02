"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { notifyTenant } from "@/lib/notify";
import { isPublicTenantActive } from "@/lib/public-tenant";

export type PublicSurveyResult = {
  ok?: boolean;
  error?: string;
  /** Anket daha önce cevaplandıysa true — "Yanıtınız alınmış" ekranı gösterilir. */
  alreadyAnswered?: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Memnuniyet anketi cevabı (/anket/[token] public sayfası).
 *
 * Auth YOK — public_token yeterli (registerOpenHouseVisitorByToken deseni).
 * RLS anon'a açılmadığı için service role ile yazılır. Tek cevap kuralı:
 * status='answered' olan anket bir daha güncellenmez (update'e eq filtresi).
 *
 * DÜŞÜK PUAN (0-6): danışmana ve (varsa, danışmandan farklıysa) ofis
 * sahibine ANINDA bildirim — telafi araması fırsat penceresi dardır.
 */
export async function submitSurveyByToken(fd: FormData): Promise<PublicSurveyResult> {
  const token = String(fd.get("token") ?? "").trim();
  const scoreRaw = String(fd.get("score") ?? "").trim();
  const comment = String(fd.get("comment") ?? "").trim().slice(0, 2000);
  // Honeypot — botlar gizli alanı doldurur; sessizce "başarılı" davran (lead formu deseni).
  if (String(fd.get("website") ?? "").trim()) return { ok: true };

  if (!UUID_RE.test(token)) return { error: "Geçersiz bağlantı." };
  const score = Number(scoreRaw);
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    return { error: "Lütfen 0-10 arası bir puan seçin." };
  }

  // Token tahmini / spam koruması — IP başına dakikada 10 deneme.
  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`anket:${ip}`, {
    limit: 10,
    windowSec: 60,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: survey } = await admin
    .from("surveys")
    .select("id, tenant_id, customer_id, agent_id, status")
    .eq("public_token", token)
    .maybeSingle();

  if (!survey) return { error: "Bağlantı geçersiz veya anket bulunamadı." };
  const { data: tenant } = await admin
    .from("tenants")
    .select("status")
    .eq("id", survey.tenant_id)
    .maybeSingle();
  if (!tenant || !isPublicTenantActive(tenant.status)) {
    return { error: "Bağlantı geçersiz veya anket bulunamadı." };
  }

  const [{ data: customer }, { data: agent }] = await Promise.all([
    admin
      .from("customers")
      .select("full_name")
      .eq("id", survey.customer_id)
      .eq("tenant_id", survey.tenant_id)
      .is("deleted_at", null)
      .maybeSingle(),
    survey.agent_id
      ? admin
          .from("profiles")
          .select("id")
          .eq("id", survey.agent_id)
          .eq("tenant_id", survey.tenant_id)
          .eq("is_active", true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!customer || (survey.agent_id && !agent)) {
    return { error: "Bağlantı geçersiz veya anket bulunamadı." };
  }
  if (survey.status === "answered") return { ok: true, alreadyAnswered: true };

  // Yarışta ikinci yazımı da engelle: yalnız hâlâ 'pending' olan satır güncellenir.
  const { data: updated, error } = await admin
    .from("surveys")
    .update({
      score,
      comment: comment || null,
      status: "answered",
      answered_at: new Date().toISOString(),
    })
    .eq("id", survey.id)
    .eq("tenant_id", survey.tenant_id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("submitSurveyByToken", error);
    return { error: "Yanıt kaydedilemedi. Lütfen tekrar deneyin." };
  }
  if (!updated) return { ok: true, alreadyAnswered: true };

  // Düşük puan alarmı — bildirim hatası teşekkür ekranını düşürmesin.
  if (score <= 6) {
    try {
      const customerName = customer.full_name ?? "Müşteri";
      const agentId = agent?.id ?? null;
      const targets = new Set<string>();
      if (agentId) targets.add(agentId);
      // Ofis sahibi de görsün (danışmanın kendisi değilse) — telafi süreci yönetim işi.
      const { data: owner } = await admin
        .from("profiles")
        .select("id")
        .eq("tenant_id", String(survey.tenant_id))
        .eq("role", "owner")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (owner?.id) targets.add(String(owner.id));

      await Promise.all(
        [...targets].map((userId) =>
          notifyTenant({
            tenantId: String(survey.tenant_id),
            userId,
            title: `⚠ Düşük memnuniyet: ${customerName} ${score} verdi`,
            body: "Deneyimi telafi etmek için müşteriyi en kısa sürede arayın.",
            href: "/app/raporlar/memnuniyet",
            kind: "warning",
          }),
        ),
      );
    } catch (e) {
      console.error("survey low score notify", e);
    }
  }

  return { ok: true };
}
