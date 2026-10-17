import "server-only";
import { checkRateLimit } from "@/lib/rate-limit";
import type { ZekaConfig } from "./settings";
import type { ZekaSurface } from "./types";

/**
 * Günlük (24 saatlik kayan pencere) soru sınırları — yalnız YANIT kipinde sayılır (öneri kipi hafif ve yereldir).
 * Anahtarlar: kişi (oturumlu yüzeyde kullanıcı/personel kimliği, public/vitrinde opak IP) ve ofis (app: kiracı, vitrin:
 * vitrin ofisi). Ayar 0 ise o sınır uygulanmaz. Hız sınırı altyapısı yoksa istek REDDEDİLİR (dakikalık sınırlarla aynı).
 */

const DAY_SEC = 86_400;

export async function zekaDailyAllowed(surface: ZekaSurface, cfg: Pick<ZekaConfig, "dailyUser" | "dailyOffice">, keys: { user?: string | null; office?: string | null }): Promise<boolean> {
  const checks: Promise<{ allowed: boolean }>[] = [];
  if (cfg.dailyUser > 0 && keys.user) checks.push(checkRateLimit(`zeka-day:${surface}:u:${keys.user}`, { limit: cfg.dailyUser, windowSec: DAY_SEC, failurePolicy: "deny" }));
  if (cfg.dailyOffice > 0 && keys.office) checks.push(checkRateLimit(`zeka-day:${surface}:o:${keys.office}`, { limit: cfg.dailyOffice, windowSec: DAY_SEC, failurePolicy: "deny" }));
  if (checks.length === 0) return true;
  const out = await Promise.all(checks);
  return out.every((r) => r.allowed);
}
