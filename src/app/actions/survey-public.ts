"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { notifyTenant } from "@/lib/notify";

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
  const { allowed } = await checkRateLimit(`anket:${ip}`, { limit: 10, windowSec: 60 });
  if (!allowed) return { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: survey } = await admin
    .from("surveys")
    .select("id, tenant_id, agent_id, status, customer:customers(full_name)")
    .eq("public_token", token)
    .maybeSingle();

  if (!survey) return { error: "Bağlantı geçersiz veya anket bulunamadı." };
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
      const rel = survey.customer as { full_name?: string } | { full_name?: string }[] | null;
      const customerName =
        (Array.isArray(rel) ? rel[0]?.full_name : rel?.full_name) ?? "Müşteri";
      const agentId = (survey.agent_id as string | null) ?? null;
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
