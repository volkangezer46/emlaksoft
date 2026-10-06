/**
 * Ofis sahipliği devri — SAF sözleşme (istemci/sunucu güvenli, DB yok).
 * SQL: supabase/migrations/20261006000720_ownership_transfer_rpc.sql (JWT kimlikli 3 RPC; kod/mesaj eşlemesi burada).
 * Tasarım: docs/design/OFIS_SAHIPLIGI_DEVRI.md. Akış: sahip başlatır -> hedef kullanıcı parolasıyla onaylar ->
 * tek işlemde rol takası (eski sahip seçilen role düşer) + JWT rol claim'i + denetim kaydı.
 */
import { ROLE_LABELS } from "@/lib/role-labels";

export const OWNERSHIP_TRANSFER_HREF = "/app/ayarlar/sahiplik-devri";

/** Talebin geçerlilik süresi (SQL tablo varsayılanı `now() + interval '72 hours'` ile aynı). */
export const OWNERSHIP_TRANSFER_TTL_HOURS = 72;

/** Eski sahibin devir sonrası alabileceği roller (SQL CHECK + RPC listesiyle aynı sıra). */
export const DEMOTE_ROLES = ["gm", "branch_manager", "team_lead", "advisor", "accounting", "call_center", "readonly"] as const;
export type DemoteRole = (typeof DEMOTE_ROLES)[number];

export function isDemoteRole(v: unknown): v is DemoteRole {
  return typeof v === "string" && (DEMOTE_ROLES as readonly string[]).includes(v);
}

export const DEMOTE_ROLE_OPTIONS: readonly { value: DemoteRole; label: string }[] = DEMOTE_ROLES.map((value) => ({
  value,
  label: ROLE_LABELS[value] ?? value,
}));

export const RPC = {
  request: "ownership_transfer_request",
  accept: "ownership_transfer_accept",
  resolve: "ownership_transfer_resolve",
} as const;

/** RPC `{ok:false, code}` -> kullanıcıya gösterilen Türkçe mesaj. */
const CODE_MESSAGES: Record<string, string> = {
  invalid_role: "Devir sonrası rolünüz geçersiz.",
  invalid_target: "Devralacak kişi bu ofiste aktif bir üye olmalı (ofis sahibi olmayan).",
  not_owner: "Sahiplik devrini yalnız aktif ofis sahibi başlatabilir.",
  pending_exists: "Bu ofiste zaten bekleyen bir sahiplik devri var. Önce onu iptal edin.",
  not_found: "Devir talebi bulunamadı ya da artık geçerli değil.",
  not_target: "Bu devri yalnız devralacak kişi onaylayabilir.",
  expired: `Devir talebinin süresi doldu (${OWNERSHIP_TRANSFER_TTL_HOURS} saat). Ofis sahibi yeniden başlatabilir.`,
  owner_changed: "Devri başlatan kişi artık ofis sahibi değil; talep geçersiz.",
  target_inactive: "Devralacak kullanıcı artık aktif değil.",
  invalid_decision: "Geçersiz işlem.",
  not_party: "Bu işlemi yalnız devrin tarafı yapabilir.",
};

export function ownershipTransferMessage(code: unknown): string {
  return (typeof code === "string" && CODE_MESSAGES[code]) || "Sahiplik devri işlemi tamamlanamadı.";
}

export type OwnershipRpcResult = { ok: boolean; code?: string; id?: string; from_user_id?: string; to_user_id?: string; demote_role?: string };

/** RPC dönüşünü güvenle okur (beklenmeyen biçim = başarısız). */
export function parseOwnershipRpc(data: unknown): OwnershipRpcResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false };
  const d = data as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    ok: d.ok === true,
    code: str(d.code),
    id: str(d.id),
    from_user_id: str(d.from_user_id),
    to_user_id: str(d.to_user_id),
    demote_role: str(d.demote_role),
  };
}

/** Bekleyen talep hâlâ geçerli mi (süresi dolan talep "bekleyen" gösterilmez; kesin karar RPC'dedir). */
export function isTransferOpen(row: { status: string; expires_at: string }, nowMs: number): boolean {
  return row.status === "pending" && Date.parse(row.expires_at) > nowMs;
}
