"use client";

import { useEffect, useState } from "react";
import { MANAGEMENT_ROLES } from "@/lib/nav-roles";
import { parseScope, type ScopeValue } from "@/lib/ui/scope";

/** Kapsam değişince (ScopeSwitch / "Ofis görünümüne dön") menüyü anında günceller; layout yeniden çizilmeden. */
export const SCOPE_CHANGE_EVENT = "es-scope-change";

export function announceScope(value: ScopeValue) {
  window.dispatchEvent(new CustomEvent(SCOPE_CHANGE_EVENT, { detail: value }));
}

/** Kapsam çerezi yoksa ana ekranla AYNI varsayılan: sahip/genel müdür "ofis", diğer yönetim rolleri "ben". */
function initialScope(role: string | null | undefined, cookie: string | null | undefined): ScopeValue {
  return parseScope(cookie) ?? (role === "owner" || role === "gm" ? "ofis" : "ben");
}

/**
 * Menü düzeni için etkin rol: yönetim rolü "Benim işlerim" seçtiyse kişisel (danışman) düzen, "Ofis geneli"nde kendi
 * düzeni. YALNIZ görünümdür; yetki ve erişilebilir modüller değişmez.
 */
export function useNavRole(role: string | null | undefined, scopeCookie: string | null | undefined): { navRole: string | null; personal: boolean } {
  const [scope, setScope] = useState<ScopeValue>(() => initialScope(role, scopeCookie));
  useEffect(() => {
    const on = (e: Event) => {
      const v = parseScope((e as CustomEvent).detail);
      if (v) setScope(v);
    };
    window.addEventListener(SCOPE_CHANGE_EVENT, on);
    return () => window.removeEventListener(SCOPE_CHANGE_EVENT, on);
  }, []);
  const management = typeof role === "string" && MANAGEMENT_ROLES.includes(role);
  const personal = management && scope === "ben";
  return { navRole: personal ? "advisor" : (role ?? null), personal };
}
