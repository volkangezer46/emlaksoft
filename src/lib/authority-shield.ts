/**
 * EİDS / yazılı yetki kalkanı — pazarlık ve kaparo öncesi kontrol.
 * Harici EİDS API gelene kadar ofis onayı (checkbox / meta) ile çalışır.
 */
export function checkAuthorityShield(input: {
  hasWrittenAuthority: boolean;
  force?: boolean;
}): { ok: boolean; warning?: string } {
  if (input.force) return { ok: true };
  if (!input.hasWrittenAuthority) {
    return {
      ok: false,
      warning:
        "Yetki belgesi / EİDS kaydı onaylanmadan deal veya kaparo riskli. Yazılı yetkiyi işaretleyin veya uyum merkezinden kaydedin.",
    };
  }
  return { ok: true };
}
