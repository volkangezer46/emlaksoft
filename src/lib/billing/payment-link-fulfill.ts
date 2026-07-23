import { createAdminClient } from "@/lib/supabase/admin";

export async function fulfillPaymentLinkByToken(
  token: string,
  source: "demo" | "callback" | "webhook",
): Promise<{ ok?: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("payment_links")
    .select("id, tenant_id, commission_id, status")
    .eq("token", token)
    .maybeSingle();
  if (!link) return { error: "Link bulunamadı." };
  if (link.status === "paid") return { ok: true };

  await admin
    .from("payment_links")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", link.id);

  if (link.commission_id) {
    await admin.from("commissions").update({ status: "paid" }).eq("id", link.commission_id);
  }

  await admin.from("notifications").insert({
    tenant_id: link.tenant_id,
    title: "Ödeme linki tahsil edildi",
    body: source === "demo" ? "Demo tahsilat tamamlandı." : "Kaparo / komisyon ödemesi alındı.",
    href: "/app/komisyon",
    kind: "success",
  });

  return { ok: true };
}

export async function fulfillPaymentLinkByConversation(
  conversationId: string,
  source: "callback" | "webhook",
): Promise<boolean> {
  if (!conversationId.startsWith("plink-")) return false;
  const token = conversationId.slice("plink-".length);
  if (!token) return false;
  const res = await fulfillPaymentLinkByToken(token, source);
  return Boolean(res.ok);
}
