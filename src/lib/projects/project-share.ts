import "server-only";
import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchemaError } from "./project-media";

/**
 * PF-04 — Proje paylaşım sayfası durumu (/proje/[token]). Token 256 bit (43 karakter base64url); sayfa varsayılan
 * KAPALI, noindex. Sütunlar yoksa (migration bekliyor) `available:false`.
 */
export const PROJECT_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

export function newProjectShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export type ProjectShareState = {
  available: boolean;
  enabled: boolean;
  showPrices: boolean;
  token: string | null;
  sharedAt: string | null;
};

export async function loadProjectShare(
  client: SupabaseClient,
  input: { tenantId: string; projectId: string },
): Promise<ProjectShareState> {
  const { data, error } = await client
    .from("projects")
    .select("share_token, share_enabled, share_show_prices, shared_at")
    .eq("id", input.projectId)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  if (error || !data) {
    if (error && !isMissingSchemaError(error)) console.error("loadProjectShare", { code: error.code });
    return { available: !isMissingSchemaError(error), enabled: false, showPrices: true, token: null, sharedAt: null };
  }
  const row = data as { share_token: string | null; share_enabled: boolean; share_show_prices: boolean; shared_at: string | null };
  return {
    available: true,
    enabled: Boolean(row.share_enabled && row.share_token),
    showPrices: row.share_show_prices !== false,
    token: row.share_token,
    sharedAt: row.shared_at,
  };
}
