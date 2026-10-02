export type DeploymentStage = "local" | "test" | "preview" | "production";
export type EnvironmentFlagState = "enabled" | "disabled" | "unset" | "invalid";

export type Environment = Readonly<Record<string, string | undefined>>;

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);
const DEMO_FLAG_PATTERN = /^ALLOW_.*_DEMO$/;
const RELEASE_MIGRATION_PATTERN = /^\d{14}[a-z]?_[a-z0-9_]+\.sql$/;
const RELEASE_CHECKSUM_PATTERN = /^[a-f0-9]{16}$/i;
const MIN_HEALTHCHECK_SECRET_LENGTH = 32;
const MIN_OTP_HMAC_SECRET_BYTES = 32;
const MIN_RUNTIME_SIGNING_SECRET_LENGTH = 32;

function normalized(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase();
}

export function environmentFlagState(value: string | undefined): EnvironmentFlagState {
  if (value === undefined) return "unset";
  const candidate = normalized(value);
  if (candidate && ENABLED_VALUES.has(candidate)) return "enabled";
  if (candidate && DISABLED_VALUES.has(candidate)) return "disabled";
  return "invalid";
}

/**
 * Resolve the deployment boundary without treating generic CI as a safe stage.
 * A Vercel production deployment cannot be downgraded by another environment
 * variable; non-Vercel preview/test builds must opt in explicitly.
 */
export function getDeploymentStage(env: Environment = process.env): DeploymentStage {
  const vercelStage = normalized(env.VERCEL_ENV);
  const explicitStage = normalized(env.EMLAKSOFT_ENV);

  if (vercelStage === "production" || explicitStage === "production") return "production";
  if (vercelStage === "preview") return "preview";
  if (vercelStage === "development") return "local";

  if (explicitStage === "preview") return "preview";
  // A production-mode build may be an explicitly identified preview, but it
  // must never be downgraded to local merely by copying a developer .env file.
  if (env.NODE_ENV === "production") return "production";

  if (explicitStage === "test") return "test";
  if (env.NODE_ENV === "test") return "test";
  if (env.NODE_ENV === "development") return "local";
  if (explicitStage === "local" || explicitStage === "development") return "local";
  return "production";
}

export function productionDemoFlagViolations(env: Environment = process.env): string[] {
  if (getDeploymentStage(env) !== "production") return [];

  return Object.keys(env)
    .filter((name) => name === "ENABLE_DEMO_LOGIN" || DEMO_FLAG_PATTERN.test(name))
    .filter((name) => {
      const state = environmentFlagState(env[name]);
      return state === "enabled" || state === "invalid";
    })
    .sort();
}

function value(env: Environment, name: string): string {
  return env[name]?.trim() ?? "";
}

function isHttpsOrigin(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      (url.pathname === "/" || url.pathname === "") &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function productionAppUrl(env: Environment): string {
  const explicit = value(env, "NEXT_PUBLIC_APP_URL");
  if (explicit) return explicit;

  const vercelProductionUrl = value(env, "VERCEL_PROJECT_PRODUCTION_URL");
  if (!vercelProductionUrl) return "";
  return /^https?:\/\//i.test(vercelProductionUrl)
    ? vercelProductionUrl
    : `https://${vercelProductionUrl}`;
}

/**
 * Truly universal production configuration. Provider-specific integrations
 * (billing, webhooks, AI, messaging, portals) intentionally do not belong in
 * this boot gate; their own modules fail closed only when those features run.
 */
export function productionEnvironmentViolations(env: Environment = process.env): string[] {
  if (getDeploymentStage(env) !== "production") return [];

  const violations: string[] = [];
  if (!isHttpsOrigin(value(env, "NEXT_PUBLIC_SUPABASE_URL"))) {
    violations.push("NEXT_PUBLIC_SUPABASE_URL");
  }
  if (
    !value(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") &&
    !value(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY")
  ) {
    violations.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  if (!value(env, "SUPABASE_SECRET_KEY") && !value(env, "SUPABASE_SERVICE_ROLE_KEY")) {
    violations.push("SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY");
  }
  if (new TextEncoder().encode(value(env, "OTP_HMAC_SECRET")).byteLength < MIN_OTP_HMAC_SECRET_BYTES) {
    violations.push("OTP_HMAC_SECRET");
  }
  if (value(env, "TWO_FACTOR_COOKIE_SECRET").length < MIN_RUNTIME_SIGNING_SECRET_LENGTH) {
    violations.push("TWO_FACTOR_COOKIE_SECRET");
  }
  if (value(env, "PROPERTY_MEDIA_SIGNING_SECRET").length < MIN_RUNTIME_SIGNING_SECRET_LENGTH) {
    violations.push("PROPERTY_MEDIA_SIGNING_SECRET");
  }
  const signingSecrets = [
    value(env, "OTP_HMAC_SECRET"),
    value(env, "TWO_FACTOR_COOKIE_SECRET"),
    value(env, "PROPERTY_MEDIA_SIGNING_SECRET"),
  ];
  if (signingSecrets.every(Boolean) && new Set(signingSecrets).size !== signingSecrets.length) {
    violations.push("OTP_HMAC_SECRET|TWO_FACTOR_COOKIE_SECRET|PROPERTY_MEDIA_SIGNING_SECRET must be independent");
  }
  if (!isHttpsOrigin(productionAppUrl(env))) {
    violations.push("NEXT_PUBLIC_APP_URL|VERCEL_PROJECT_PRODUCTION_URL");
  }
  if (value(env, "HEALTHCHECK_SECRET").length < MIN_HEALTHCHECK_SECRET_LENGTH) {
    violations.push("HEALTHCHECK_SECRET");
  }
  if (!RELEASE_MIGRATION_PATTERN.test(value(env, "RELEASE_MIGRATION"))) {
    violations.push("RELEASE_MIGRATION");
  }
  if (!RELEASE_CHECKSUM_PATTERN.test(value(env, "RELEASE_MIGRATION_CHECKSUM"))) {
    violations.push("RELEASE_MIGRATION_CHECKSUM");
  }
  return violations;
}

/** Fail the config load used by both `next build` and `next start`. */
export function assertProductionDemoSafety(env: Environment = process.env): void {
  const violations = productionDemoFlagViolations(env);
  if (violations.length === 0) return;

  throw new Error(
    `[deployment-env] Production refused: ${violations.join(", ")} must be unset or explicitly disabled.`,
  );
}

/** Fail `next build`/`next start` before a misconfigured release can serve. */
export function assertProductionEnvironment(env: Environment = process.env): void {
  assertProductionDemoSafety(env);
  const violations = productionEnvironmentViolations(env);
  if (violations.length === 0) return;

  throw new Error(
    `[deployment-env] Production refused: missing or invalid required environment: ${violations.join(", ")}.`,
  );
}
