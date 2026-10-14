import { readOfficeSecurityPolicyCached } from "./policy-cache";
import {
  OFFICE_IP_ENV_OVERRIDE,
  mfaSetupRequired,
  officeIpAllowed,
  officePolicyIp,
  officeSecurityLoginNotice,
} from "./policy";

/**
 * DG7 politikası proxy DIŞINDA (sunucu tarafı). Proxy yalnız sayfa yollarını kapsar; şu noktalar da aynı önbellekli
 * görüntüyü (30 sn) okur:
 *  - giriş eylemleri (parola, Google dönüşü): izinsiz IP'de oturum hiç açılmaz, SMS kodu gönderilmez;
 *  - `requireActiveTenant` (requirePermission → /api/app/*, indirme rotaları, server action'lar): proxy'den geçmemiş
 *    istekte IP kısıtı ve 2FA kurulum zorunluluğu uygulanır.
 * Boşta kalma ve en uzun oturum süresi yalnız proxy'dedir (sayfa gezinmesi; API çağrısı etkinlik sayılmaz).
 * Destek oturumu ve platform personeli çağıran tarafta muaf tutulur (proxy ile aynı).
 */

/** Giriş anında: bu IP'den bu rolde oturum açılabilir mi? Politika yoksa ek iş yok (önbellekten "yok"). */
export async function officeLoginIpAllowed(input: {
  tenantId: string | null | undefined;
  role: string | null | undefined;
  headers: Pick<Headers, "get">;
}): Promise<boolean> {
  if (!input.tenantId) return true;
  const policy = await readOfficeSecurityPolicyCached(input.tenantId);
  if (!policy) return true;
  return officeIpAllowed(policy, input.role, officePolicyIp(input.headers), process.env[OFFICE_IP_ENV_OVERRIDE]);
}

/** Giriş ekranındaki IP reddi metni (proxy'nin `reason=office_ip` bildirimiyle aynı). */
export const OFFICE_IP_LOGIN_ERROR = officeSecurityLoginNotice("office_ip")!;
export const OFFICE_MFA_SETUP_ERROR =
  "Ofisinizin güvenlik politikası bu rol için iki adımlı doğrulama istiyor. Panele girip doğrulamayı kurun.";

/** Kanonik ofis kullanıcısının proxy dışı isteği: engel varsa kullanıcıya gösterilecek metin, yoksa null. */
export async function officeRequestPolicyBlock(input: {
  tenantId: string;
  role: string | null | undefined;
  twoFactorOn: boolean;
  headers: Pick<Headers, "get">;
}): Promise<string | null> {
  const policy = await readOfficeSecurityPolicyCached(input.tenantId);
  if (!policy) return null;
  if (!officeIpAllowed(policy, input.role, officePolicyIp(input.headers), process.env[OFFICE_IP_ENV_OVERRIDE])) {
    return OFFICE_IP_LOGIN_ERROR;
  }
  if (mfaSetupRequired(policy, input.role, input.twoFactorOn)) return OFFICE_MFA_SETUP_ERROR;
  return null;
}
