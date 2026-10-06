import { getSettingDef, isSecretDef, storageKeyOf } from "./registry";
import { sealSecret, secretsWritable } from "./secrets";
import type { AnySettingDef } from "./types";
import { coerceInput } from "./view";

export const MIN_REASON_LENGTH = 5;

export type WriteItem = { def: AnySettingDef; storage: string; formatted: string | null; plain?: string };
/** Doğrulama + biçimleme (yetkiden sonra). Hata: Türkçe mesaj. */
export function prepareWrite(input: { key: string; value: unknown; reason?: string; fromBridge?: boolean }):
  | { ok: true; item: WriteItem }
  | { ok: false; error: string } {
  const def = getSettingDef(input.key);
  if (!def) return { ok: false, error: `Bilinmeyen ayar: ${input.key}` };
  if (def.editMode === "locked") return { ok: false, error: def.lockedReason ?? "Bu ayar değiştirilemez." };
  if (def.editMode === "bridge" && !input.fromBridge) {
    return { ok: false, error: `Bu ayar kendi ekranından düzenlenir${def.editHref ? ` (${def.editHref})` : ""}.` };
  }
  if (def.risk === "high" && (input.reason ?? "").trim().length < MIN_REASON_LENGTH) {
    return { ok: false, error: `${def.label}: yüksek riskli ayar için gerekçe zorunludur (en az ${MIN_REASON_LENGTH} karakter).` };
  }
  const storage = storageKeyOf(def);
  if (input.value === null) return { ok: true, item: { def, storage, formatted: null } };

  const coerced = coerceInput(def, input.value);
  if (!coerced.ok) return { ok: false, error: coerced.error };
  if (isSecretDef(def)) {
    if (!secretsWritable()) {
      return {
        ok: false,
        error: "Şifreli saklama etkin değil (PLATFORM_SECRETS_KEY tanımlı değil). Anahtar kaydedilmedi; düz metin asla yazılmaz.",
      };
    }
    const plain = String(coerced.value);
    const sealed = sealSecret(storage, plain);
    if (!sealed) return { ok: false, error: "Anahtar şifrelenemedi; kaydedilmedi." };
    return { ok: true, item: { def, storage, formatted: sealed, plain } };
  }
  return { ok: true, item: { def, storage, formatted: def.codec.format(coerced.value) } };
}

