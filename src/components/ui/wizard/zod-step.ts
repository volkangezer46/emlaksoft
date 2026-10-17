/**
 * Adım doğrulaması zod şemasıyla: `validate: zodStep(schema, { fieldIds })`. İstemci paketi hafif kalsın diye
 * `zod/mini` kullanılır (tam zod sunucuda). Sorun yolu (path[0]) alan adıdır; `fieldIds` alan adını DOM kimliğine
 * eşler (verilmezse ad = kimlik).
 */
import { safeParse, type ZodMiniType } from "zod/mini";
import type { WizardIssue, WizardValues } from "./engine";

export function zodStep(schema: ZodMiniType, opts?: { fieldIds?: Record<string, string> }) {
  return (v: WizardValues): WizardIssue[] => {
    const res = safeParse(schema, v);
    if (res.success) return [];
    const out: WizardIssue[] = [];
    const seen = new Set<string>();
    for (const issue of res.error.issues) {
      const name = String(issue.path[0] ?? "");
      const field = opts?.fieldIds?.[name] ?? name;
      if (seen.has(field)) continue;
      seen.add(field);
      out.push({ field, message: issue.message });
    }
    return out;
  };
}
