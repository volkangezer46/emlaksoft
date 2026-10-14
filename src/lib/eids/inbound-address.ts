import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import {
  addressForToken,
  generateInboundToken,
  getMailKey,
  hashInboundToken,
  seal,
  tokenAad,
  tokenFromAddress,
  unseal,
} from "./inbound-crypto";

/**
 * Ofise özel EİDS alma adresi (yetki-<anahtar>@eids.emlaksoft.com.tr). Anahtar yalnız özet (arama) + mühürlü
 * (gösterim) saklanır. Ofis başına tek aktif adres (DB kısmi tekil dizin). Yenileme eskisini HEMEN kapatır.
 * Tüm fonksiyonlar çağıranın verdiği istemciyi kullanır (service_role; HER sorgu tenant_id ile süzülür).
 */

export type ActiveAddress = { id: string; tenantId: string };

/** SMTP alıcısı / köprü: alıcı adresinden aktif adres satırı (bilinmeyen ya da yenilenmiş anahtar = null). */
export async function resolveInboundAddress(db: SupabaseClient, rcpt: string): Promise<ActiveAddress | null> {
  const token = tokenFromAddress(rcpt);
  if (!token) return null;
  const { data, error } = await db
    .from("eids_inbound_addresses")
    .select("id, tenant_id")
    .eq("token_hash", hashInboundToken(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; tenant_id: string };
  return { id: row.id, tenantId: row.tenant_id };
}

export type AddressView =
  | { state: "schema_pending" }
  | { state: "key_missing" }
  | { state: "none" }
  | { state: "active"; id: string; address: string; createdAt: string; lastReceivedAt: string | null };

/** Kart görünümü: aktif adres (mühür çözülür) ya da neden yok. */
export async function loadAddressView(db: SupabaseClient, tenantId: string): Promise<AddressView> {
  const { data, error } = await db
    .from("eids_inbound_addresses")
    .select("id, token_sealed, created_at, last_received_at")
    .eq("tenant_id", tenantId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) return { state: "schema_pending" };
  if (!data) return getMailKey() ? { state: "none" } : { state: "key_missing" };
  const key = getMailKey();
  if (!key) return { state: "key_missing" };
  const row = data as { id: string; token_sealed: string; created_at: string; last_received_at: string | null };
  const token = unseal(row.token_sealed, key, tokenAad(tenantId))?.toString("utf8");
  if (!token) return { state: "key_missing" };
  return { state: "active", id: row.id, address: addressForToken(token), createdAt: row.created_at, lastReceivedAt: row.last_received_at };
}

export type IssueResult = { ok: true; address: string } | { ok: false; error: string };

/**
 * Yeni adres üretir. `renew` true ise önce aktif adres kapatılır (eski adres hemen reddedilir). Aynı anda iki istek
 * gelirse kısmi tekil dizin ikincisini reddeder (23505) ve kullanıcıya "yeniden deneyin" denir.
 */
export async function issueInboundAddress(db: SupabaseClient, tenantId: string, userId: string, renew: boolean): Promise<IssueResult> {
  const key = getMailKey();
  if (!key) {
    return { ok: false, error: "Ne oldu: sunucuda e-posta şifreleme anahtarı tanımlı değil. Ne yapmalı: EmlakSoft destek ekibine bildirin; o zamana kadar e-postayı .eml yükleyerek ya da metni yapıştırarak ekleyebilirsiniz." };
  }
  const nowIso = new Date(now()).toISOString();
  if (renew) {
    const { error } = await db
      .from("eids_inbound_addresses")
      .update({ revoked_at: nowIso, revoked_by: userId })
      .eq("tenant_id", tenantId)
      .is("revoked_at", null);
    if (error) return { ok: false, error: "Ne oldu: eski adres kapatılamadı. Ne yapmalı: birkaç saniye sonra tekrar deneyin." };
  }
  const token = generateInboundToken();
  const { error } = await db.from("eids_inbound_addresses").insert({
    tenant_id: tenantId,
    token_hash: hashInboundToken(token),
    token_sealed: seal(Buffer.from(token, "utf8"), key, tokenAad(tenantId)),
    created_by: userId,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Ne oldu: ofisinizin zaten aktif bir adresi var. Ne yapmalı: sayfayı yenileyin; adresi değiştirmek için \"Adresi yenile\"yi kullanın." };
    return { ok: false, error: "Ne oldu: adres oluşturulamadı. Ne yapmalı: birkaç saniye sonra tekrar deneyin; sürerse destek ekibine bildirin." };
  }
  return { ok: true, address: addressForToken(token) };
}
