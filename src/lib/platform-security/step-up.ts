import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/settings/read";
import { logPlatformActivity } from "@/lib/platform-activity";
import { STEP_UP_ACTIONS, STEP_UP_FIELD, STEP_UP_REQUIRED_KEY, normalizeStepUpCode, type StepUpAction } from "./step-up-policy";

export { STEP_UP_FIELD, STEP_UP_ACTIONS, type StepUpAction } from "./step-up-policy";

export type StepUpResult = { ok: true } | { ok: false; error: string; code: "step_up_required" | "step_up_invalid" | "step_up_no_factor" };

async function stepUpRequired(): Promise<boolean> {
  try {
    return (await getSetting<boolean>(STEP_UP_REQUIRED_KEY)) !== false;
  } catch {
    return true; // okunamazsa güvenli taraf: kod iste
  }
}

/**
 * AD11 kritik işlemde yeniden doğrulama (TOTP). Server action'ın İLK yazımından ÖNCE çağrılır:
 *   const su = await requireStepUp(formData, "refund", staff.id); if (!su.ok) return { error: su.error };
 * Personelin doğrulanmış TOTP faktörü yoksa işlem yapılamaz (önce Hesabım > Güvenlik'ten kurulur). Kod Supabase MFA
 * ile doğrulanır (challenge + verify; oturum AAL2'ye yükselir). Başarısız deneme denetim izine yazılır.
 * `platform.step_up_required` kapalıysa (önerilmez) kod istenmez.
 */
export async function requireStepUp(
  input: FormData | { code?: unknown },
  action: StepUpAction,
  staffId: string,
): Promise<StepUpResult> {
  if (!(await stepUpRequired())) return { ok: true };
  const raw = input instanceof FormData ? input.get(STEP_UP_FIELD) : input.code;
  const code = normalizeStepUpCode(raw);
  const label = STEP_UP_ACTIONS[action];
  if (!code) {
    return { ok: false, code: "step_up_required", error: `${label} için doğrulayıcı uygulamanızdaki 6 haneli kodu girin.` };
  }

  const supabase = await createClient();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  const factor = listError ? null : (factors?.totp ?? []).find((f) => f.status === "verified");
  if (!factor) {
    return {
      ok: false,
      code: "step_up_no_factor",
      error: `${label} doğrulayıcı kodu ister. Önce Hesabım > Güvenlik'ten doğrulayıcı (TOTP) kurun.`,
    };
  }
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) {
    await logPlatformActivity({
      actorId: staffId,
      action: "platform.step_up.failed",
      entityType: "step_up",
      meta: { step_up_action: action },
    });
    return { ok: false, code: "step_up_invalid", error: "Doğrulayıcı kodu hatalı ya da süresi geçmiş. Yeni kodla tekrar deneyin." };
  }
  await logPlatformActivity({
    actorId: staffId,
    action: "platform.step_up.ok",
    entityType: "step_up",
    meta: { step_up_action: action },
  });
  return { ok: true };
}
