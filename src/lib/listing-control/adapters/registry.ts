import type { PortalAdapter } from "./types";

/**
 * Adaptör kayıt defteri (SAF). Yeni portal bağımsız eklenir: kendi dosyası + `adapters/index.ts`'e tek satır.
 * "Bağlantı yoksa kapalı" ilkesi: kayıtlı olmak yetenek vermez; `capabilities` bayrakları açık olmayan yol çağrılmaz.
 */

const registry = new Map<string, PortalAdapter>();

export function registerAdapter(adapter: PortalAdapter): void {
  if (!/^[a-z0-9-]{2,40}$/.test(adapter.id)) throw new Error(`Geçersiz adaptör kimliği: ${adapter.id}`);
  if (registry.has(adapter.id)) throw new Error(`Adaptör zaten kayıtlı: ${adapter.id}`);
  registry.set(adapter.id, adapter);
}

export function getAdapter(portalName: string | null | undefined): PortalAdapter | null {
  const id = (portalName ?? "").trim().toLowerCase();
  return registry.get(id) ?? null;
}

export function listAdapters(): PortalAdapter[] {
  return [...registry.values()];
}

/** Test yardımcısı (üretimde çağrılmaz). */
export function clearAdaptersForTest(): void {
  registry.clear();
}

/** Kullanıcı-destekli tarif host'larının birleşimi (istemci/eklenti manifest sözleşmesi için tek kaynak). */
export function assistedAllowedHosts(): string[] {
  const hosts = new Set<string>();
  for (const a of registry.values()) {
    if (a.capabilities.userAssisted && a.assistedRecipe) for (const h of a.assistedRecipe.allowedHosts) hosts.add(h);
  }
  return [...hosts].sort();
}
