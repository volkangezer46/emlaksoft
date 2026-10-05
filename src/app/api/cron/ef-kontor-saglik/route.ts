import { NextRequest, NextResponse } from "next/server";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { EF_ORTAK_FLAG_SETTING_KEY } from "@/lib/ef-credits/config";
import { resolveEmlakFiyatiKeys } from "@/lib/integrations/emlakfiyati/keys";
import { runOrtakProbe } from "@/lib/integrations/emlakfiyati/ortak-client";
import { parseSettingBool } from "@/lib/platform-setting-keys";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { authorizeCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * EmlakFiyati günlük bağlantı sağlık yoklaması: ortak istemcinin probe'u (GET /kullanim, tek deneme) çalışır; başarıda
 * `emlakfiyati_ortak_probe_ok_at` damgası yenilenir, başarısızlıkta silinir (public durum "live" olmaktan çıkar, kontör
 * satışı kapanır). EmlakFiyati anahtarı veya ortak bayrağı yoksa HİÇBİR ŞEY yapılmaz (hata değil). service_role istemcisi
 * yok: damga yazımı mevcut platform-settings yolundan gider (yeni service_role istemcisi kullanımı eklenmez).
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  try {
    const [settings, keys] = await Promise.all([getPlatformSettingsMany([EF_ORTAK_FLAG_SETTING_KEY]), resolveEmlakFiyatiKeys()]);
    if (!keys.current || !parseSettingBool(settings[EF_ORTAK_FLAG_SETTING_KEY], false)) {
      await recordHeartbeat("ef-kontor-saglik", "ok", "atlandı: EmlakFiyati anahtarı veya ortak bayrağı yok");
      return NextResponse.json({ ok: true, skipped: true });
    }
    const probe = await runOrtakProbe();
    const connected = probe.state === "connected";
    await recordHeartbeat(
      "ef-kontor-saglik",
      connected ? "ok" : "error",
      connected ? "yoklama başarılı, damga yenilendi" : `yoklama başarısız (${probe.state}${probe.code ? `/${probe.code}` : ""}), damga silindi`,
    );
    return NextResponse.json({ ok: true, state: probe.state });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    await recordHeartbeat("ef-kontor-saglik", "error", detail);
    return NextResponse.json({ ok: false, error: "ef_saglik_failed" }, { status: 500 });
  }
}
