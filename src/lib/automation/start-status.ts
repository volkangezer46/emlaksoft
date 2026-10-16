/**
 * Sihirbazdan yeni kural: "Kuralı hemen etkinleştir" kutusu → `automations.status`.
 * Alan hiç gelmezse (eski istemci) davranış değişmez: etkin.
 */
export function automationStartStatus(raw: FormDataEntryValue | null | undefined): "active" | "inactive" {
  return String(raw ?? "1").trim() === "0" ? "inactive" : "active";
}
