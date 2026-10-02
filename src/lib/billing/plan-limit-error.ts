const LABELS: Record<string, string> = {
  seats: "aktif kullanıcı",
  customers: "müşteri",
  active_properties: "aktif portföy",
  branches: "aktif şube",
};

/** Database entitlement trigger errors are safe to present as upgrade guidance. */
export function planLimitErrorMessage(error: { message?: string } | null | undefined): string | null {
  const match = error?.message?.match(/PLAN_LIMIT_EXCEEDED:([a-z_]+):(\d+)/);
  if (!match) return null;
  const metric = LABELS[match[1]!] ?? "kayıt";
  return `Paketiniz en fazla ${match[2]} ${metric} destekliyor. Devam etmek için paketinizi yükseltin.`;
}
