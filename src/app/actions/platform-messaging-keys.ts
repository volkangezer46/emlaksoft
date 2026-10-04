"use server";

import { revalidatePath } from "next/cache";
import { guardPlatformAction } from "@/lib/platform-guards";
import { setPlatformSetting } from "@/lib/platform-settings";
import { logPlatformActivity } from "@/lib/platform-activity";
import { normalizeAllowedWhatsAppApiUrl } from "@/lib/messaging/netgsm";

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

  const results = await Promise.all([
    setPlatformSetting("netgsm_usercode", usercode, gate.staff.id),
    setPlatformSetting("netgsm_password", password, gate.staff.id),
    setPlatformSetting("netgsm_msgheader", msgheader, gate.staff.id),
  ]);
  if (results.some((ok) => !ok)) return { error: "Netgsm bilgileri kaydedilemedi." };

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

  await Promise.all([
    setPlatformSetting("netgsm_usercode", null, gate.staff.id),
    setPlatformSetting("netgsm_password", null, gate.staff.id),
    setPlatformSetting("netgsm_msgheader", null, gate.staff.id),
  ]);
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

  const results = await Promise.all([
    setPlatformSetting("whatsapp_api_url", apiUrl, gate.staff.id),
    setPlatformSetting("whatsapp_api_token", token, gate.staff.id),
  ]);
  if (results.some((ok) => !ok)) return { error: "WhatsApp bilgileri kaydedilemedi." };

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

  await Promise.all([
    setPlatformSetting("whatsapp_api_url", null, gate.staff.id),
    setPlatformSetting("whatsapp_api_token", null, gate.staff.id),
  ]);
  await logPlatformActivity({ actorId: gate.staff.id, action: "integration.whatsapp.clear", entityType: "integration" });
  revalidatePath("/admin/sistem");
  return { ok: true };
}
