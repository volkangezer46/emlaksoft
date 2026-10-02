/**
 * Tenants that can still use the canonical app may expose public surfaces.
 * `past_due` keeps a temporary payment delay from instantly taking a business
 * offline; suspension/cancellation remains the explicit publication cutoff.
 * Keep this check fail-closed: unknown, null and future lifecycle values are
 * intentionally rejected until they are explicitly reviewed here.
 */
export function isPublicTenantActive(status: string | null | undefined): boolean {
  return status === "active" || status === "trial" || status === "past_due";
}
