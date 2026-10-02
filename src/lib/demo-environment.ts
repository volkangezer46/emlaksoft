import {
  environmentFlagState,
  getDeploymentStage,
  type Environment,
} from "@/lib/deployment-env";

/** Local development defaults to demo-on; previews require an explicit flag. */
export function isDemoLoginEnabled(env: Environment = process.env): boolean {
  const stage = getDeploymentStage(env);
  if (stage === "production") return false;

  const state = environmentFlagState(env.ENABLE_DEMO_LOGIN);
  if (state === "enabled") return true;
  if (state === "disabled" || state === "invalid") return false;
  return stage === "local";
}

/** Platform/super-admin demo identities never run on shared preview/prod DBs. */
export function isPlatformDemoPersonaAllowed(env: Environment = process.env): boolean {
  const stage = getDeploymentStage(env);
  return (stage === "local" || stage === "test") && isDemoLoginEnabled(env);
}
