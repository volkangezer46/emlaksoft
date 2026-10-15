import { NextResponse, type NextRequest } from "next/server";
import { getBaseUrl } from "@/lib/base-url";
import { now } from "@/lib/clock";
import { platformSettingsPort } from "@/lib/google/db";
import { exchangeCode } from "@/lib/google/oauth";
import { GOOGLE_PKCE_COOKIE, GOOGLE_CALLBACK_PATH, currentSessionBinding, googleStateSigner } from "@/lib/google/session";
import { STATE_REASON_LABELS, verifyState } from "@/lib/google/state";
import { GoogleSecretsUnavailableError, readGoogleSnapshot, saveToken } from "@/lib/google/token-store";
import { GOOGLE_SERVICE_LABELS } from "@/lib/google/keys";
import { getPlatformStaff } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { secretsWritable } from "@/lib/settings/secrets";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Google OAuth dönüşü. `/api/` altında olduğu için proxy oturumu çözmez: rota KENDİSİ denetler —
 * (1) aktif personel oturumu, (2) super_admin rolü (değilse 403), (3) oturuma bağlı HMAC `state` (10 dk),
 * (4) çerezdeki PKCE doğrulayıcısı (S256 özeti state'tekiyle eşleşmeli). Mühürleme anahtarı yoksa bağlama reddedilir.
 * Başarı/başarısızlık Bağlantılar ekranına Türkçe iletiyle döner; kod/belirteç asla log'a yazılmaz.
 */
const BACK = "/admin/site/baglantilar";

function back(params: Record<string, string>) {
  const url = new URL(BACK, getBaseUrl());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url, { status: 303 });
  res.cookies.set({ name: GOOGLE_PKCE_COOKIE, value: "", path: GOOGLE_CALLBACK_PATH, maxAge: 0, httpOnly: true, secure: true, sameSite: "lax" });
  return res;
}

export async function GET(req: NextRequest) {
  const staff = await getPlatformStaff();
  if (!staff) return NextResponse.json({ error: "Yetkisiz" }, { status: 403 });
  if (staff.role !== "super_admin") return NextResponse.json({ error: "Bu işlem yalnız süper admin içindir." }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const binding = await currentSessionBinding(staff.id);
  const verifier = req.cookies.get(GOOGLE_PKCE_COOKIE)?.value ?? null;
  const check = verifyState(sp.get("state"), binding ?? { staffId: staff.id, sessionId: "" }, verifier, now(), googleStateSigner);
  if (!check.ok) return back({ hata: STATE_REASON_LABELS[check.reason] });

  const service = check.payload.service;
  if (sp.get("error")) {
    return back({ hata: sp.get("error") === "access_denied" ? "Google izin ekranında onay verilmedi." : "Google bağlantıyı tamamlamadı." });
  }
  const code = sp.get("code");
  if (!code || code.length > 2048) return back({ hata: "Google yetki kodu gelmedi." });
  if (!secretsWritable()) return back({ hata: STATE_REASON_LABELS.anahtar });

  try {
    const snap = await readGoogleSnapshot(platformSettingsPort);
    if (!snap.client) return back({ hata: "Önce OAuth istemci kimliğini girin." });
    const tokens = await exchangeCode({ client: snap.client, code, verifier: verifier! });
    const ok = await saveToken(
      platformSettingsPort,
      service,
      { refreshToken: tokens.refreshToken, scope: tokens.scope, connectedAt: new Date(now()).toISOString(), connectedBy: staff.id, needsReconnect: false },
      staff.id,
    );
    if (!ok) return back({ hata: "Bağlantı kaydedilemedi; lütfen tekrar deneyin." });
    await logPlatformActivity({ actorId: staff.id, action: "google.connect", entityType: "google", entityId: null, meta: { service } });
    return back({ bagli: service, ileti: `${GOOGLE_SERVICE_LABELS[service]} bağlandı.` });
  } catch (e) {
    if (e instanceof GoogleSecretsUnavailableError) return back({ hata: STATE_REASON_LABELS.anahtar });
    log.error("google_callback_failed", { route: "/api/admin/google/callback", code: e instanceof Error ? e.name : "hata" });
    return back({ hata: "Google bağlantısı tamamlanamadı; lütfen yeniden deneyin." });
  }
}
