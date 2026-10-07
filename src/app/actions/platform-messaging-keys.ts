"use server";

import { revalidatePath } from "next/cache";
import { guardPlatformAction } from "@/lib/platform-guards";
import { applyPlatformWrites } from "@/lib/settings/write";
import { logPlatformActivity } from "@/lib/platform-activity";
import { normalizeAllowedWhatsAppApiUrl } from "@/lib/messaging/netgsm";
import { actionErrorMessage } from "@/lib/action-errors";

export type MessagingKeyResult = { ok?: boolean; error?: string };

function gateSuperAdmin() {
  return guardPlatformAction({
    module: "sistem",
    roles: ["super_admin"],
    rate: { key: "platform-messaging-keys", limit: 12, windowSec: 600 },
  });
}

/** Netgsm (platform yedek SMS hesabı): kullanıcı kodu, parola, onaylı başlık. Yalnız süper admin. */
export async function saveNetgsmKeys(fd: FormData): Promise<MessagingKeyResult> {
  const gate = await gateSuperAdmin();
  if ("error" in gate) return { error: gate.error };

  const usercode = String(fd.get("usercode") ?? "").trim();
  const password = String(fd.get("password") ?? "").trim();
  const msgheader = String(fd.get("msgheader") ?? "").trim();

  if (!usercode || usercode.length > 64) return { error: "Kullanıcı kodu zorunludur (en çok 64 karakter)." };
  if (!password || password.length > 256) return { error: "Parola zorunludur (en çok 256 karakter)." };
  if (!/^[A-Za-z0-9ÇĞİÖŞÜçğıöşü .&-]{1,11}$/.test(msgheader)) {
    return { error: "Mesaj başlığı 1-11 karakter olmalı (harf, rakam, boşluk)." };
  }

  const res = await applyPlatformWrites(
    gate.staff,
    [
      { key: "notify.netgsm_usercode", value: usercode },
      { key: "notify.netgsm_password", value: password },
      { key: "notify.netgsm_msgheader", value: msgheader },
    ],
    { reason: "Netgsm bilgileri kaydı", fromBridge: true },
  );
  if (!res.ok) return { error: res.error || actionErrorMessage(null, "Netgsm bilgileri kaydedilemedi.") };

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "integration.netgsm.save",
    entityType: "integration",
    meta: { msgheader },
  });
  revalidatePath("/admin/sistem");
  return { ok: true };
}

export async function clearNetgsmKeys(): Promise<MessagingKeyResult> {
  const gate = await gateSuperAdmin();
  if ("error" in gate) return { error: gate.error };

  const res = await applyPlatformWrites(
    gate.staff,
    [
      { key: "notify.netgsm_usercode", value: null },
      { key: "notify.netgsm_password", value: null },
      { key: "notify.netgsm_msgheader", value: null },
    ],
    { reason: "Netgsm bilgileri silindi", fromBridge: true },
  );
  if (!res.ok) return { error: res.error };
  await logPlatformActivity({ actorId: gate.staff.id, action: "integration.netgsm.clear", entityType: "integration" });
  revalidatePath("/admin/sistem");
  return { ok: true };
}

/** WhatsApp sağlayıcı: API adresi izinli sağlayıcı alan adlarıyla sınırlıdır (SSRF koruması). */
export async function saveWhatsappKeys(fd: FormData): Promise<MessagingKeyResult> {
  const gate = await gateSuperAdmin();
  if ("error" in gate) return { error: gate.error };

  const apiUrlRaw = String(fd.get("api_url") ?? "").trim();
  const token = String(fd.get("api_token") ?? "").trim();
  if (!apiUrlRaw) return { error: "API adresi zorunludur." };
  if (!token || token.length > 4096) return { error: "API anahtarı zorunludur (en çok 4096 karakter)." };

  const apiUrl = normalizeAllowedWhatsAppApiUrl(apiUrlRaw);
  if (!apiUrl) {
    return { error: "WhatsApp API adresi HTTPS olmalı ve izinli sağlayıcı alan adını kullanmalıdır." };
  }

  const res = await applyPlatformWrites(
    gate.staff,
    [
      { key: "notify.whatsapp_api_url", value: apiUrl },
      { key: "notify.whatsapp_api_token", value: token },
    ],
    { reason: "WhatsApp bilgileri kaydı", fromBridge: true },
  );
  if (!res.ok) return { error: res.error || actionErrorMessage(null, "WhatsApp bilgileri kaydedilemedi.") };

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "integration.whatsapp.save",
    entityType: "integration",
    meta: { host: new URL(apiUrl).hostname },
  });
  revalidatePath("/admin/sistem");
  return { ok: true };
}

export async function clearWhatsappKeys(): Promise<MessagingKeyResult> {
  const gate = await gateSuperAdmin();
  if ("error" in gate) return { error: gate.error };

  const res = await applyPlatformWrites(
    gate.staff,
    [
      { key: "notify.whatsapp_api_url", value: null },
      { key: "notify.whatsapp_api_token", value: null },
    ],
    { reason: "WhatsApp bilgileri silindi", fromBridge: true },
  );
  if (!res.ok) return { error: res.error };
  await logPlatformActivity({ actorId: gate.staff.id, action: "integration.whatsapp.clear", entityType: "integration" });
  revalidatePath("/admin/sistem");
  return { ok: true };
}
