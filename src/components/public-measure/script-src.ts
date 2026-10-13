import { readFileSync } from "node:fs";
import { join } from "node:path";
import { now } from "@/lib/clock";
import { canMeasure } from "@/lib/measure/scope";
import type { MeasureSettings } from "@/lib/measure/settings";

/**
 * Ölçüm istemcisinin içerik özetli dosya adı (`public/statik/measure.json`, prebuild üretir). Süreç içinde
 * önbelleklenir; dosya yoksa (geliştirmede derleme yapılmadı) null döner ve etiket basılmaz — 60 sn sonra yeniden bakılır.
 */
let cached: { src: string | null; at: number } | null = null;

export function measureScriptSrc(nowMs: number = now()): string | null {
  if (cached && (cached.src || nowMs - cached.at < 60_000)) return cached.src;
  let src: string | null = null;
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), "public", "statik", "measure.json"), "utf8")) as { file?: unknown };
    src = typeof raw.file === "string" && /^\/statik\/m-[0-9a-f]+\.js$/.test(raw.file) ? raw.file : null;
  } catch {
    src = null;
  }
  cached = { src, at: nowMs };
  return src;
}

export type MeasureScriptProps = { src: string; "data-a": "0" | "1" };

/**
 * SAF karar: etiket basılacak mı, hangi özniteliklerle? Kapsam dışı yol (/app, /admin, giriş, portallar) → null;
 * sayaç ve hız ölçümü ikisi de kapalı → null; dosya yok → null.
 */
export function measureScriptProps(path: string | undefined, settings: MeasureSettings, src: string | null): MeasureScriptProps | null {
  if (path !== undefined && !canMeasure(path)) return null;
  if (!src || (!settings.pageviews && !settings.vitals)) return null;
  return { src, "data-a": settings.attribution ? "1" : "0" };
}
