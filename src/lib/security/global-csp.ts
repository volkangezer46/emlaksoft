import { VIRTUAL_TOUR_FRAME_HOSTS } from "../virtual-tour";

/**
 * KÜRESEL CSP (tek kaynak): next.config.ts başlığı, statik sayfa yedeği (src/lib/static-home/render.ts) ve statik yol
 * proxy yanıtı (src/lib/supabase/middleware.ts) aynı metni kullanır. Göreli içe aktarma: next.config de yükler.
 * Supabase kökü YALNIZ yapılandırılmış tek origin'dir (canlı: self-hosted https://api.emlaksoft.com.tr). Joker bulut
 * desenleri (*.supabase.co / wss://*.supabase.co) yok: başka bir Supabase projesine veri sızdırma yolu açmasın.
 * Statik sunulan yollar (kayıt defteri) bu başlığı next.config'ten ALMAZ: orada katı hash politikası verilir
 * (src/lib/static-home/csp.ts); Next aynı adlı başlıkta config değerini korur, rota değerini eklemez.
 */
export function globalContentSecurityPolicy(env: { isDevelopment: boolean; supabaseUrl?: string | null }): string {
  const { isDevelopment } = env;
  const supabaseOrigin = (() => {
    try {
      const url = new URL(env.supabaseUrl ?? "");
      return url.protocol === "https:" || url.protocol === "http:" ? url : null;
    } catch {
      return null;
    }
  })();
  const supabaseHttp = supabaseOrigin ? ` ${supabaseOrigin.origin}` : "";
  const supabaseWs = supabaseOrigin ? ` ${supabaseOrigin.origin.replace(/^http/, "ws")}` : "";
  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${supabaseHttp} https://api.qrserver.com https://tile.openstreetmap.org`,
    "font-src 'self' data:",
    `connect-src 'self'${supabaseHttp}${supabaseWs} https://api.qrserver.com${isDevelopment ? " ws: wss:" : ""}`,
    `media-src 'self' data: blob:${supabaseHttp}`,
    `frame-src 'self' https://www.openstreetmap.org ${VIRTUAL_TOUR_FRAME_HOSTS.map((h) => `https://${h}`).join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  return contentSecurityPolicy;
}

/** Çalışma anı (sunucu/proxy) küresel CSP'si. */
export function runtimeGlobalCsp(): string {
  return globalContentSecurityPolicy({ isDevelopment: process.env.NODE_ENV === "development", supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL });
}
