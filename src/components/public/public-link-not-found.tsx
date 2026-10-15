import type { ReactNode } from "react";
import { Link2Off, type LucideIcon } from "lucide-react";

/**
 * Token'lı müşteri linkleri (paylaşım, sunum, randevu teyidi, müşteri/malik portalı, değerleme raporu, açık ev) ve
 * vitrinin bulunamayan/geçersiz bağlantı ekranı — TEK BİLEŞEN (SK8 B153).
 *
 * Kurallar: HTTP 404 ile döner (her token ağacında `not-found.tsx` bunu basar; sayfa `notFound()` çağırır ve rotada
 * `loading.tsx` OLMADIĞI için durum kodu akış başlamadan yazılır). Müşteriye giden link olduğu için EmlakSoft
 * pazarlama bağlantısı ("Fiyatlar", "Ücretsiz deneyin", "Giriş yapın") YOKTUR; ziyaretçi linki gönderen ofise
 * yönlendirilir. `children` ile ofise ait yol (vitrine dön vb.) eklenebilir.
 */
export function PublicLinkNotFound({
  icon: Icon = Link2Off,
  title = "Bu bağlantı artık geçerli değil",
  description = "Bağlantının süresi dolmuş ya da kaldırılmış olabilir. Sizi gönderen ofisle iletişime geçin; size yeni bir bağlantı iletebilirler.",
  children,
}: {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <main id="main-content" className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <div aria-hidden="true" className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-ink-950/5">
          <Icon className="h-8 w-8 text-text-muted" />
        </div>
        <h1 className="text-balance font-display text-lg font-bold text-ink-950">{title}</h1>
        <p className="mx-auto mt-2 text-pretty text-sm leading-relaxed text-text-muted">{description}</p>
        {children ? <div className="mt-6">{children}</div> : null}
      </div>
    </main>
  );
}
