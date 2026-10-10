/**
 * EKLENTİ ↔ EMLAKSOFT EŞLEŞTİRME KURALLARI (SAF, testli).
 *
 * Tasarım: eklentide SAKLANAN TOKEN YOK. Eklenti, kullanıcının EmlakSoft sekmesindeki AÇIK OTURUMUYLA konuşur (içerik betiği
 * yalnız EmlakSoft kökenlerinde çalışır, istekler aynı kökenli + özel başlıklı). Dolayısıyla sızabilecek bir oturum anahtarı
 * yoktur; "eşleştirme" kullanıcının açık onayıdır: "Bağlan" tıklanana kadar eklenti HİÇBİR kontrol yapmaz. Bağlantı
 * kullanıcı eylemiyle (popup düğmesi ya da uygulama içi sayfadaki "Eklentiyi bağla" düğmesi) kurulur ve kısa ömürlüdür:
 * EmlakSoft oturumu `PAIRING_TTL_MS` boyunca hiç görülmezse bağlantı düşer, yeniden onay istenir.
 * `externally_connectable` (0.3.0) YALNIZ EmlakSoft kökenleri için ve YALNIZ salt-okunur `ping` (kurulu mu, sürüm, bağlı mı) içindir;
 * bağlama/ayar/veri bu kanaldan yapılmaz. Bağlama kanalı içerik betiğinin `window.postMessage` köprüsüdür ve her iletide
 * köken + pencere + kullanıcı etkinliği doğrulanır.
 */

export const PAIRING_TTL_MS = 30 * 24 * 3_600_000;

/** İzinli EmlakSoft kökeni mi (tam eşleşme; https ya da localhost). `allowed` derleme zamanında manifest'e yazılan kökenlerdir. */
export function isAllowedAppOrigin(origin: string | null | undefined, allowed: readonly string[]): boolean {
  if (!origin) return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.origin !== origin.replace(/\/$/, "")) return false;
  if (u.protocol !== "https:" && !(u.protocol === "http:" && u.hostname === "localhost")) return false;
  const norm = (s: string) => s.replace(/\/\*?$/, "").replace(/\/$/, "");
  return allowed.some((a) => {
    try {
      const au = new URL(norm(a));
      // localhost: eşleşme deseni portu yok sayar (geliştirme); diğer kökenlerde tam eşleşme (protokol + ana makine + port).
      return au.protocol === u.protocol && au.hostname === u.hostname && (au.hostname === "localhost" || au.port === u.port);
    } catch {
      return false;
    }
  });
}

export type ConnectRequestInput = {
  /** İletinin geldiği pencere sayfanın kendisi mi (`event.source === window`). */
  fromSameWindow: boolean;
  eventOrigin: string;
  locationOrigin: string;
  allowedOrigins: readonly string[];
  /** Tıklama gibi gerçek kullanıcı etkinliği var mı (`navigator.userActivation.isActive`). */
  userActive: boolean;
  data: unknown;
};

export const CONNECT_REQUEST_TYPE = "connect-request";

/** Sayfanın "bağlan" isteği güvenilir mi: aynı pencere + aynı köken + izinli EmlakSoft kökeni + kullanıcı etkinliği + biçim. */
export function isTrustedConnectRequest(i: ConnectRequestInput): boolean {
  if (!i.fromSameWindow || i.eventOrigin !== i.locationOrigin) return false;
  if (!isAllowedAppOrigin(i.locationOrigin, i.allowedOrigins)) return false;
  if (!i.userActive) return false;
  const d = i.data as { type?: unknown; nonce?: unknown } | null;
  return !!d && d.type === CONNECT_REQUEST_TYPE && typeof d.nonce === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(d.nonce);
}

export type Pairing = { at: number; origin: string } | null;

/** Bağlantı hâlâ geçerli mi: bağlanılmış ve (son oturum görülme ya da bağlanma anı) TTL içinde. */
export function isPairingActive(pairing: Pairing, lastSessionOkAt: number | null, nowMs: number): boolean {
  if (!pairing) return false;
  const ref = Math.max(pairing.at, lastSessionOkAt ?? 0);
  return nowMs - ref < PAIRING_TTL_MS;
}

/** Bağlantıyı kabul edebilecek gönderici: eklentinin kendi açılır penceresi (sekmesiz) ya da izinli EmlakSoft sekmesi. */
export function isTrustedSender(sender: { id?: string; tab?: { url?: string }; url?: string }, extensionId: string, allowedOrigins: readonly string[]): boolean {
  if (sender.id !== extensionId) return false;
  if (!sender.tab) return true; // açılır pencere / eklenti sayfası
  try {
    return isAllowedAppOrigin(new URL(sender.tab.url ?? sender.url ?? "").origin, allowedOrigins);
  } catch {
    return false;
  }
}
