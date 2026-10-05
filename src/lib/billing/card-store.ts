import { createAdminClient } from "@/lib/supabase/admin";
import { deleteStoredCard, isStoredCardAlreadyGone } from "@/lib/billing/iyzico";
import { CARD_CONSENT_VERSION, type StoredCardRef } from "@/lib/billing/cards";

/**
 * Kayıtlı kart SUNUCU deposu (service_role, HER sorguda tenant filtresi). Kart iyzico'dadır; burada yalnız
 * sağlayıcı anahtarları + maskeli gösterim tutulur. İstemci tablolardan yalnız güvenli sütunları okur
 * (migration 20260826000100); yazma yalnız bu modüldedir. Tablolar henüz yoksa her fonksiyon zarifçe
 * "desteklenmiyor" döner (migration uygulanana dek kod etkisizdir).
 */

/** Tek service_role giriş noktası (kabul listesinde TEK birim). Her çağıran tenant filtresini kendisi uygular. */
function adminStore() {
  return createAdminClient();
}

function missingTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

/** Ofisin iyzico cardUserKey'i (yoksa/şema yoksa null). Ödeme formuna verilir: kayıtlı kartlar listelenir. */
export async function getTenantCardUserKey(tenantId: string): Promise<string | null> {
  try {
    const { data, error } = await adminStore()
      .from("tenant_payment_profiles")
      .select("provider_card_user_key")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) {
      if (!missingTable(error)) console.error("getTenantCardUserKey", error.code);
      return null;
    }
    return (data?.provider_card_user_key as string | null) ?? null;
  } catch (e) {
    console.error("getTenantCardUserKey", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Ödeme doğrulandıktan SONRA (callback) kartı kaydeder. Yalnız faturada açık rıza işareti varsa çağrılır.
 * İlk kart otomatik varsayılan olur. Hata ödemeyi bozmaz (çağıran try/catch yapar); idempotent (aynı token tekrar eklenmez).
 */
export async function saveCardFromPayment(input: {
  tenantId: string;
  consentUserId: string | null;
  invoiceId: string | null;
  card: StoredCardRef;
  consentAtIso: string;
}): Promise<{ saved: boolean; reason?: string }> {
  const admin = adminStore();
  const { tenantId, card } = input;

  const { error: profileError } = await admin
    .from("tenant_payment_profiles")
    .upsert(
      { tenant_id: tenantId, provider: "iyzico", provider_card_user_key: card.providerCardUserKey, updated_at: input.consentAtIso },
      { onConflict: "tenant_id" },
    );
  if (profileError) {
    if (missingTable(profileError)) return { saved: false, reason: "unsupported" };
    throw new Error(`Kart profili yazılamadı: ${profileError.code ?? "?"}`);
  }

  const { count } = await admin
    .from("payment_cards")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  const { data: inserted, error } = await admin
    .from("payment_cards")
    .upsert(
      {
        tenant_id: tenantId,
        provider: "iyzico",
        provider_card_token: card.providerCardToken,
        brand: card.brand,
        card_family: card.cardFamily,
        bin_prefix: card.binPrefix,
        last_four: card.lastFour,
        is_default: (count ?? 0) === 0,
        consent_at: input.consentAtIso,
        consent_by: input.consentUserId,
        consent_version: CARD_CONSENT_VERSION,
        source_invoice_id: input.invoiceId,
      },
      { onConflict: "tenant_id,provider_card_token", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Kart kaydedilemedi: ${error.code ?? "?"}`);
  return { saved: Boolean(inserted) };
}

export type RemoveCardResult = { ok: true; cardId: string } | { ok: false; error: string };

/**
 * Kartı ÖNCE iyzico'dan, sonra kendi kaydımızdan siler. iyzico silmesi başarısızsa (kart zaten yok değilse)
 * yerel kayıt KALIR ve hata döner: sağlayıcıda canlı token'ı sahipsiz bırakmayız.
 */
export async function removeStoredCard(input: { tenantId: string; cardId: string }): Promise<RemoveCardResult> {
  const admin = adminStore();
  const { data: card, error } = await admin
    .from("payment_cards")
    .select("id, provider_card_token, is_default")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.cardId)
    .maybeSingle();
  if (error || !card) return { ok: false, error: "Kart bulunamadı." };

  const { data: profile } = await admin
    .from("tenant_payment_profiles")
    .select("provider_card_user_key, auto_renew_enabled, auto_renew_card_id")
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  const userKey = (profile?.provider_card_user_key as string | null) ?? null;
  if (!userKey) return { ok: false, error: "Kart sağlayıcı kaydı eksik; destekle iletişime geçin." };

  try {
    const res = await deleteStoredCard({ cardUserKey: userKey, cardToken: card.provider_card_token as string });
    if (String(res.status).toLowerCase() !== "success" && !isStoredCardAlreadyGone(res)) {
      return { ok: false, error: "Kart ödeme sağlayıcısından silinemedi. Lütfen tekrar deneyin." };
    }
  } catch (e) {
    console.error("removeStoredCard iyzico", e instanceof Error ? e.message : e);
    return { ok: false, error: "Kart ödeme sağlayıcısından silinemedi. Lütfen tekrar deneyin." };
  }

  // Bu kart otomatik yenileme kartıysa rıza düşer (rızasız tahsilat olamaz).
  if (profile?.auto_renew_card_id === input.cardId) {
    await admin
      .from("tenant_payment_profiles")
      .update({ auto_renew_enabled: false, auto_renew_card_id: null, updated_at: new Date().toISOString() })
      .eq("tenant_id", input.tenantId);
  }
  const { error: delError } = await admin
    .from("payment_cards")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("id", input.cardId);
  if (delError) return { ok: false, error: "Kart kaydı silinemedi." };

  if (card.is_default) {
    const { data: next } = await admin
      .from("payment_cards")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (next?.id) await admin.rpc("set_default_payment_card", { p_tenant_id: input.tenantId, p_card_id: next.id });
  }
  return { ok: true, cardId: input.cardId };
}

export async function setDefaultStoredCard(input: { tenantId: string; cardId: string }): Promise<boolean> {
  const { error } = await adminStore().rpc("set_default_payment_card", {
    p_tenant_id: input.tenantId,
    p_card_id: input.cardId,
  });
  if (error) console.error("setDefaultStoredCard", error.code);
  return !error;
}

/** Otomatik yenileme rızasını yazar/geri alır. Açarken kart bu ofise ait olmalı. */
export async function writeAutoRenewConsent(input: {
  tenantId: string;
  userId: string;
  enabled: boolean;
  cardId: string | null;
  ip: string;
  nowIso: string;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = adminStore();
  if (input.enabled) {
    const { data: card } = await admin
      .from("payment_cards")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .eq("id", input.cardId ?? "")
      .maybeSingle();
    if (!card) return { ok: false, error: "Kart bulunamadı." };
  }
  const { error } = await admin
    .from("tenant_payment_profiles")
    .update(
      input.enabled
        ? {
            auto_renew_enabled: true,
            auto_renew_card_id: input.cardId,
            auto_renew_consent_at: input.nowIso,
            auto_renew_consent_by: input.userId,
            auto_renew_consent_ip: input.ip.slice(0, 64),
            updated_at: input.nowIso,
          }
        : { auto_renew_enabled: false, auto_renew_card_id: null, updated_at: input.nowIso },
    )
    .eq("tenant_id", input.tenantId);
  if (error) return { ok: false, error: "Rıza kaydedilemedi." };
  return { ok: true };
}
