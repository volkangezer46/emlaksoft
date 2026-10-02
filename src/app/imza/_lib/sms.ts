/**
 * İmza akışı SMS yardımcıları.
 *
 * Raw credentials are resolved from the service-role-only
 * tenant_integration_secrets table through the shared tenant provider helper.
 * A platform sender is used only when ALLOW_PLATFORM_MESSAGING_FALLBACK=true.
 */

import {
  getTenantNetgsmConfig as resolveTenantNetgsmConfig,
  isTenantSmsAvailable,
  sendTenantSms,
} from "@/lib/messaging/tenant-providers";
import type { NetgsmConfig, SmsSendResult } from "@/lib/messaging/netgsm";

export async function getTenantNetgsmConfig(tenantId: string): Promise<NetgsmConfig | null> {
  return resolveTenantNetgsmConfig(tenantId);
}

export async function isSignerSmsAvailable(
  tenantId: string,
  phone: string | null | undefined,
): Promise<boolean> {
  if (!phone || !normalizeTrMobile(phone)) return false;
  return isTenantSmsAvailable(tenantId);
}

export async function sendSignerSms(
  tenantId: string,
  to: string,
  text: string,
): Promise<SmsSendResult> {
  return sendTenantSms(tenantId, to, text);
}

/** Telefonun yalnızca son iki hanesini gösterir (ör. "05** *** ** 42"). */
export function maskPhone(raw: string): string {
  const phone = normalizeTrMobile(raw);
  if (!phone) return "***";
  return `0${phone.slice(0, 1)}** *** ** ${phone.slice(-2)}`;
}

/** TR cep numarasını 10 haneli formata normalize eder. */
function normalizeTrMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("90") && digits.length === 12) return digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) return digits.slice(1);
  if (digits.startsWith("5") && digits.length === 10) return digits;
  return null;
}
