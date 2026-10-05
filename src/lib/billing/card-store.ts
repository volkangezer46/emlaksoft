import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteStoredCard, isStoredCardAlreadyGone, type CheckoutRetrieveResult } from "@/lib/billing/iyzico";
import { CARD_CONSENT_VERSION, extractStoredCard, type StoredCardRef } from "@/lib/billing/cards";

/**
 * Kayıtlı kart SUNUCU deposu. Kart iyzico'dadır; burada yalnız sağlayıcı anahtarları + maskeli gösterim tutulur.
 *
 * Bu dosya KENDİ service_role istemcisini YARATMAZ (admin-client kabul listesine satır eklenmez):
 *  - callback/webhook/dunning yolları allowlist'li mevcut admin istemcisini PARAMETRE olarak geçer (wallet.ts deseni);
 *    her sorgu `tenant_id` süzgeci taşır (bkz. card-store-tenant-contract.test.ts).
 *  - kullanıcı eylemleri (anahtar okuma, varsayılan kart, oto-yenileme rızası, silme) oturumlu istemciyle yalnız
 *    owner/gm'e açık SECURITY DEFINER RPC'lerle yapılır (migration 20260826000700); tenant her zaman `current_tenant_id()`.
 * Tablolar/RPC'ler henüz yoksa her fonksiyon zarifçe "desteklenmiyor" döner (migration uygulanana dek kod etkisizdir).
 */

type Client = Pick<SupabaseClient, "from" | "rpc">;

function missingTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

function missingRpc(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
}

/**
 * Ofisin iyzico cardUserKey'i (yoksa/şema yoksa/yetki yoksa null). YALNIZ owner/gm oturumu için RPC döner; başka rol
 * veya hata → null (kayıtlı kartlar ödeme sayfasında listelenmez). Oturumlu istemci verilir.
 */
export async function getTenantCardUserKey(supabase: Client): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("tenant_card_user_key");
    if (error) {
      if (!missingRpc(error) && error.code !== "42501") console.error("getTenantCardUserKey", error.code);
      return null;
    }
    return typeof data === "string" && data ? data : null;
  } catch (e) {
    console.error("getTenantCardUserKey", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Ödeme doğrulandıktan SONRA (callback/webhook) kartı kaydeder. Çağıran admin istemcisini geçer.
 * - Mevcut `provider_card_user_key` ASLA ezilmez: farklıysa kart eklenmez (aynı cardUserKey altında olmayan kart
 *   başka iyzico kullanıcısına ait olurdu; kayıt yarım kalmasın diye hiç yazılmaz).
 * - İlk kart otomatik varsayılan olur. Idempotent (aynı token tekrar eklenmez).
 */
export async function saveCardFromPayment(
  admin: Client,
  input: {
    tenantId: string;
    consentUserId: string | null;
    invoiceId: string | null;
    card: StoredCardRef;
    consentAtIso: string;
  },
): Promise<{ saved: boolean; reason?: string }> {
  const { tenantId, card } = input;

  const { data: existing, error: readError } = await admin
    .from("tenant_payment_profiles")
    .select("provider_card_user_key")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (readError) {
    if (missingTable(readError)) return { saved: false, reason: "unsupported" };
    throw new Error(`Kart profili okunamadı: ${readError.code ?? "?"}`);
  }
  const currentKey = (existing?.provider_card_user_key as string | null | undefined) ?? null;
  if (currentKey && currentKey !== card.providerCardUserKey) return { saved: false, reason: "user_key_mismatch" };

  if (!existing) {
    const { error } = await admin
      .from("tenant_payment_profiles")
      .upsert(
        { tenant_id: tenantId, provider: "iyzico", provider_card_user_key: card.providerCardUserKey, updated_at: input.consentAtIso },
        { onConflict: "tenant_id", ignoreDuplicates: true },
      );
    if (error) throw new Error(`Kart profili yazılamadı: ${error.code ?? "?"}`);
  } else if (!currentKey) {
    // Satır var ama anahtar boş (ör. yalnız rıza satırı): yalnız BOŞ anahtar doldurulur, dolu anahtara dokunulmaz.
    const { error } = await admin
      .from("tenant_payment_profiles")
      .update({ provider_card_user_key: card.providerCardUserKey, updated_at: input.consentAtIso })
      .eq("tenant_id", tenantId)
      .is("provider_card_user_key", null);
    if (error) throw new Error(`Kart profili yazılamadı: ${error.code ?? "?"}`);
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

/**
 * callback VE webhook'un ortak, güvenli kart kaydı yolu. YALNIZ ödeme tam doğrulamadan (imza/tutar/retrieve)
 * ve fulfill'den sonra çağrılır. Koşullar: fatura meta'sında açık rıza işareti + rıza veren kullanıcı bu ofiste hâlâ
 * aktif owner/gm. Hata ödemeyi BOZMAZ (asla fırlatmaz).
 */
export async function saveCardAfterVerifiedPayment(
  admin: Client,
  input: {
    tenantId: string;
    meta: { saveCard?: unknown; saveCardConsentBy?: unknown } | null | undefined;
    result: CheckoutRetrieveResult;
    invoiceId?: string | null;
  },
): Promise<{ saved: boolean; reason?: string }> {
  try {
    if (input.meta?.saveCard !== true) return { saved: false, reason: "no_consent" };
    const consentBy = typeof input.meta.saveCardConsentBy === "string" ? input.meta.saveCardConsentBy : null;
    if (!consentBy) return { saved: false, reason: "no_consent_user" };

    const { data: who } = await admin
      .from("profiles")
      .select("role, is_active")
      .eq("tenant_id", input.tenantId)
      .eq("id", consentBy)
      .maybeSingle();
    if (!who || who.is_active === false || (who.role !== "owner" && who.role !== "gm")) {
      return { saved: false, reason: "consent_user_not_manager" };
    }

    const card = extractStoredCard(input.result);
    if (!card) return { saved: false, reason: "no_card_in_result" };
    return await saveCardFromPayment(admin, {
      tenantId: input.tenantId,
      consentUserId: consentBy,
      invoiceId: input.invoiceId ?? null,
      card,
      consentAtIso: new Date().toISOString(),
    });
  } catch (e) {
    console.error("saveCardAfterVerifiedPayment", e instanceof Error ? e.message : "error");
    return { saved: false, reason: "error" };
  }
}

export type RemoveCardResult = { ok: true; cardId: string } | { ok: false; error: string };

/**
 * Kartı ÖNCE iyzico'dan, sonra kendi kaydımızdan siler (oturumlu istemci + owner/gm RPC). iyzico silmesi başarısızsa
 * (kart zaten yok değilse) yerel kayıt KALIR ve hata döner: sağlayıcıda canlı token'ı sahipsiz bırakmayız.
 * Oto-yenileme rızası/varsayılan kart devri SQL'de (remove_my_payment_card) atomik yapılır.
 */
export async function removeStoredCard(supabase: Client, input: { cardId: string }): Promise<RemoveCardResult> {
  const { data: ref, error } = await supabase.rpc("payment_card_provider_ref", { p_card_id: input.cardId });
  if (error || !ref || typeof ref !== "object" || Array.isArray(ref)) return { ok: false, error: "Kart bulunamadı." };
  const userKey = typeof (ref as { userKey?: unknown }).userKey === "string" ? (ref as { userKey: string }).userKey : null;
  const token = typeof (ref as { token?: unknown }).token === "string" ? (ref as { token: string }).token : null;
  if (!userKey || !token) return { ok: false, error: "Kart sağlayıcı kaydı eksik; destekle iletişime geçin." };

  try {
    const res = await deleteStoredCard({ cardUserKey: userKey, cardToken: token });
    if (String(res.status).toLowerCase() !== "success" && !isStoredCardAlreadyGone(res)) {
      return { ok: false, error: "Kart ödeme sağlayıcısından silinemedi. Lütfen tekrar deneyin." };
    }
  } catch (e) {
    console.error("removeStoredCard iyzico", e instanceof Error ? e.message : e);
    return { ok: false, error: "Kart ödeme sağlayıcısından silinemedi. Lütfen tekrar deneyin." };
  }

  const { data: removed, error: delError } = await supabase.rpc("remove_my_payment_card", { p_card_id: input.cardId });
  if (delError || removed !== true) return { ok: false, error: "Kart kaydı silinemedi." };
  return { ok: true, cardId: input.cardId };
}

export async function setDefaultStoredCard(supabase: Client, input: { cardId: string }): Promise<boolean> {
  const { error } = await supabase.rpc("set_my_default_payment_card", { p_card_id: input.cardId });
  if (error) console.error("setDefaultStoredCard", error.code);
  return !error;
}

/** Otomatik yenileme rızasını yazar/geri alır (owner/gm RPC; açarken kart bu ofise ait olmalı). */
export async function writeAutoRenewConsent(
  supabase: Client,
  input: { enabled: boolean; cardId: string | null; ip: string },
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("set_my_auto_renew_consent", {
    p_enabled: input.enabled,
    p_card_id: input.cardId,
    p_ip: input.ip.slice(0, 64),
  });
  if (error) {
    return { ok: false, error: error.code === "P0002" ? "Kart bulunamadı." : "Rıza kaydedilemedi." };
  }
  if (data !== true) return { ok: false, error: "Rıza kaydedilemedi." };
  return { ok: true };
}
