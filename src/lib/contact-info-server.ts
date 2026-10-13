import "server-only";
import { cache } from "react";
import { buildSupportContact, SUPPORT_EMAIL, type SupportContact } from "@/lib/contact-info";
import { getSettings } from "@/lib/settings/read";
import { SUPPORT_CONTACT_KEYS } from "@/lib/settings/registry/legal";

const env = (name: string) => process.env[name]?.trim() || "";
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** SAF: ayar > sunucu env (SUPPORT_*) > eski NEXT_PUBLIC_* yedeği / koddaki varsayılan. */
export function resolveSupportContact(settings: Record<string, unknown>): SupportContact {
  return buildSupportContact({
    email: str(settings["support.email"]) || env("SUPPORT_EMAIL") || SUPPORT_EMAIL,
    phone: str(settings["support.phone"]) || env("SUPPORT_PHONE") || env("NEXT_PUBLIC_SUPPORT_PHONE"),
    whatsapp: str(settings["support.whatsapp"]) || env("SUPPORT_WHATSAPP") || env("NEXT_PUBLIC_SUPPORT_WHATSAPP"),
  });
}

/**
 * Destek iletişimi (SUNUCU; ayar defterinden, ≤30 sn önbellek). İstek başına bir kez çözülür. Ayar okunamazsa
 * (derleme, DB yok) env/varsayılana düşer; asla fırlatmaz.
 */
export const getSupportContact = cache(async (): Promise<SupportContact> => {
  try {
    return resolveSupportContact(await getSettings(SUPPORT_CONTACT_KEYS));
  } catch {
    return resolveSupportContact({});
  }
});
