import {
  decideIdle,
  sessionExpired,
  sessionStartSec,
  signIdleCookie,
  verifyIdleCookie,
} from "@/lib/platform-security/admin-access";
import {
  mfaSetupRequired,
  officeIpAllowed,
  type OfficeSecurityPolicy,
  type OfficeSessionEndReason,
} from "./policy";

/**
 * DG7 proxy kapısı kararı (ağsız; yalnız imzalı çerez doğrulaması). Sıra: IP → oturum ömrü → boşta kalma → 2FA kurulumu.
 * Yalnız kanonik ofis kullanıcısında ve politika varken çağrılır (destek oturumu / platform personeli muaf).
 */
export type OfficeGateDecision =
  | { kind: "pass"; idleCookie: string | null }
  | { kind: "end"; reason: OfficeSessionEndReason }
  | { kind: "mfa_setup" };

export async function decideOfficeGate(input: {
  policy: OfficeSecurityPolicy;
  userId: string;
  role: string | null | undefined;
  twoFactorOn: boolean;
  ip: string | null;
  claims: Record<string, unknown> | null | undefined;
  idleCookieValue: string | undefined;
  /** Önceden yükleme isteği: etkinlik sayılmaz (çerez yenilenmez). */
  passive: boolean;
  nowSec: number;
  secret: string | undefined;
  envIpOverride?: string;
}): Promise<OfficeGateDecision> {
  const { policy } = input;
  if (!officeIpAllowed(policy, input.role, input.ip, input.envIpOverride)) return { kind: "end", reason: "office_ip" };
  if (policy.maxHours > 0 && sessionExpired(sessionStartSec(input.claims), input.nowSec, policy.maxHours)) {
    return { kind: "end", reason: "office_session" };
  }
  let idleCookie: string | null = null;
  // İmza anahtarı yoksa boşta kalma uygulanamaz (yönetim politikasıyla aynı: sessizce atlanır).
  if (policy.idleMinutes > 0 && input.secret) {
    const last = await verifyIdleCookie(input.idleCookieValue, input.userId, input.secret);
    const decision = decideIdle(last, input.nowSec, policy.idleMinutes, input.passive);
    if (decision.kind === "expired") return { kind: "end", reason: "office_idle" };
    if (decision.kind === "refresh") idleCookie = await signIdleCookie(input.userId, input.nowSec, input.secret);
  }
  if (mfaSetupRequired(policy, input.role, input.twoFactorOn)) return { kind: "mfa_setup" };
  return { kind: "pass", idleCookie };
}
