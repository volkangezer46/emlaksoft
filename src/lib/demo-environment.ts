import {
  environmentFlagState,
  getDeploymentStage,
  type Environment,
} from "@/lib/deployment-env";

/**
 * Production'da demo girişi VARSAYILAN KAPALIDIR ve iki ayrı, açık bayrakla açılır:
 *  - PRODUCTION_DEMO_LOGIN_OPT_IN      → ofis kullanıcısı kartları
 *  - PRODUCTION_PLATFORM_DEMO_OPT_IN   → ayrıca süper admin/platform kartları
 *    (önce yukarıdaki de açık olmalı).
 * Bayrak adları bilerek `ALLOW_*_DEMO` desenine uymaz: o desen production build'inde
 * yasaktır (deployment-env.ts → productionDemoFlagViolations). `ENABLE_DEMO_LOGIN`
 * production'da hâlâ yasak; yanlışlıkla kopyalanmış bir .env onu açamaz.
 *
 * UYARI: Açıkken adresi bilen HERKES tek tıkla o kimliğe girer; platform bayrağı
 * açıkken süper admin dahil. Yalnız veri taşımayan geliştirme ortamında kullanın.
 */
function productionOptIn(env: Environment, name: string): boolean {
  return environmentFlagState(env[name]) === "enabled";
}

/** Local development defaults to demo-on; previews require an explicit flag. */
export function isDemoLoginEnabled(env: Environment = process.env): boolean {
  const stage = getDeploymentStage(env);
  if (stage === "production") return productionOptIn(env, "PRODUCTION_DEMO_LOGIN_OPT_IN");

  const state = environmentFlagState(env.ENABLE_DEMO_LOGIN);
  if (state === "enabled") return true;
  if (state === "disabled" || state === "invalid") return false;
  return stage === "local";
}

/**
 * Platform/super-admin demo identities: local/test, or production only with the
 * explicit second opt-in (and the general demo opt-in).
 */
export function isPlatformDemoPersonaAllowed(env: Environment = process.env): boolean {
  const stage = getDeploymentStage(env);
  if (stage === "production") {
    return isDemoLoginEnabled(env) && productionOptIn(env, "PRODUCTION_PLATFORM_DEMO_OPT_IN");
  }
  return (stage === "local" || stage === "test") && isDemoLoginEnabled(env);
}
