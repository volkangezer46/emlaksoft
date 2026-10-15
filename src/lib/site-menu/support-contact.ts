import { SUPPORT_EMAIL } from "@/lib/contact-info";
import type { SiteMenuConfig } from "./schema";

/**
 * Site menüsü / alt bilgi yapılandırmasındaki derleme anı destek adresini (`SUPPORT_EMAIL`; varsayılan menüde "Destek"
 * öğesi ve "İletişim" sütunu, `mailto:` dahil) sunucuda çözülen adresle değiştirir (SAF). Yalnız derleme anı adresiyle
 * BİREBİR geçen dizeler değişir; yönetimden elle yazılmış başka adresler olduğu gibi kalır. Adres aynıysa nesne aynen döner.
 */
export function applySupportEmail(cfg: SiteMenuConfig, email: string, buildEmail: string = SUPPORT_EMAIL): SiteMenuConfig {
  const next = email.trim();
  if (!next || next === buildEmail) return cfg;
  const swap = (v: unknown): unknown => {
    if (typeof v === "string") return v.includes(buildEmail) ? v.split(buildEmail).join(next) : v;
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = swap(x);
      return out;
    }
    return v;
  };
  return swap(cfg) as SiteMenuConfig;
}
