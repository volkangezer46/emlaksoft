import { EIDS_SENDER_ADDRESS } from "./legal-text";

/**
 * Bakanlık (EİDS) e-postalarını EmlakSoft'a İLETME KILAVUZU — sağlayıcı adımları (SAF veri; testli).
 *
 * Kaynak: docs/eids/KILAVUZ.md bölüm 2 (Yardım rehberi `eids-bakanlik-epostalari` ile aynı içerik). `src/components/eids/forwarding-guide.tsx` sekmeler halinde
 * çizer; Ayarlar > Entegrasyonlar "Bakanlık (EİDS) e-postaları" kartı (EP3) ve İlan Kontrol > Yetki sayfası aynı bileşeni
 * kullanır. Adım metnindeki `{adres}` ofisin alma adresiyle, `{gonderen}` Bakanlık göndericisiyle doldurulur.
 *
 * KURAL: Ekranda doğrulanmamış menü adları `unverified` ile işaretlenir ve kullanıcıya "Doğrulanmadı" etiketiyle gösterilir.
 * Kural tüm gelen kutusunu değil YALNIZ Bakanlık göndericisini iletir.
 */

export const EIDS_ADDRESS_TOKEN = "{adres}";
export const EIDS_SENDER_TOKEN = "{gonderen}";

/** Alma adresi biçimi (EP3): yetki-<anahtar>@eids.emlaksoft.com.tr. Yalnız gösterim/örnek içindir. */
export const EIDS_INBOUND_DOMAIN = "eids.emlaksoft.com.tr";
export const EIDS_ADDRESS_EXAMPLE = `yetki-xxxxxxxxxxxxxxxx@${EIDS_INBOUND_DOMAIN}`;

export type ForwardingProviderId = "gmail" | "workspace" | "outlook" | "m365" | "yandex" | "cpanel";

export type ForwardingStep = { text: string; unverified?: boolean };

export type ForwardingProvider = {
  id: ForwardingProviderId;
  label: string;
  /** Sekme altındaki tek cümle: kime uygun. */
  fits: string;
  steps: readonly ForwardingStep[];
  /** Kurumsal kısıt / dikkat notu (yönetici izni, onay kodu vb.). */
  warning?: { title: string; text: string; unverified?: boolean };
};

export const FORWARDING_PROVIDERS: readonly ForwardingProvider[] = [
  {
    id: "gmail",
    label: "Gmail",
    fits: "Kişisel @gmail.com hesabı.",
    steps: [
      { text: "Bilgisayardan Gmail'i açın. Sağ üstteki dişli simgesine, ardından \"Tüm ayarları görün\"e basın." },
      { text: `"Yönlendirme ve POP/IMAP" sekmesinde "Yönlendirme adresi ekle"ye basın ve ${EIDS_ADDRESS_TOKEN} adresini yazın.` },
      { text: "Gmail bu adrese bir onay kodu gönderir. Kod birkaç dakika içinde EmlakSoft'taki Bakanlık (EİDS) e-postaları kartında görünür. Kodu Gmail'e yazıp onaylayın." },
      { text: "Bu sekmede \"Gelen postanın bir kopyasını yönlendir\" seçeneğini AÇMAYIN. Böylece yalnız filtreye uyan e-postalar iletilir." },
      { text: `"Filtreler ve engellenen adresler" sekmesinde "Yeni filtre oluştur"a basın. Kimden alanına ${EIDS_SENDER_TOKEN} yazın ve "Filtre oluştur"a basın.` },
      { text: `"Şu adrese yönlendir" kutusunu işaretleyip ${EIDS_ADDRESS_TOKEN} adresini seçin, sonra "Filtre oluştur"a basın.` },
      { text: "Eski e-postalar otomatik iletilmez. Onları .eml olarak indirip İlan Kontrol > Yetki ekranından yükleyin." },
    ],
  },
  {
    id: "workspace",
    label: "Google Workspace",
    fits: "Şirket alan adlı Gmail (ör. info@ofisiniz.com, Google altyapısı).",
    steps: [
      { text: "Adımlar Gmail sekmesindekiyle aynıdır: önce yönlendirme adresi eklenir ve onaylanır, sonra yalnız Bakanlık göndericisi için filtre kurulur." },
      { text: `Filtrede Kimden: ${EIDS_SENDER_TOKEN}, eylem: "Şu adrese yönlendir" > ${EIDS_ADDRESS_TOKEN}.` },
    ],
    warning: {
      title: "Yönetici izni gerekebilir",
      text: "Şirket yöneticisi dış adrese otomatik iletmeyi kapatmış olabilir. Bu durumda yöneticinin Yönetici Konsolu > Gmail > Son kullanıcı erişimi > \"Otomatik yönlendirme\" ayarını açması gerekir.",
      unverified: true,
    },
  },
  {
    id: "outlook",
    label: "Outlook / Hotmail",
    fits: "Kişisel outlook.com, hotmail.com ya da live.com hesabı.",
    steps: [
      { text: "outlook.com'da dişli simgesine basın: Ayarlar > Posta > Kurallar > \"+ Yeni kural ekle\"." },
      { text: "Kurala bir ad verin, örneğin \"EİDS EmlakSoft\"." },
      { text: `Koşul: "Gönderen" > ${EIDS_SENDER_TOKEN}.` },
      { text: `Eylem: "Şuraya ilet" > ${EIDS_ADDRESS_TOKEN}. Outlook onay kodu istemez.` },
      { text: "\"Kaydet\"e basın." },
    ],
  },
  {
    id: "m365",
    label: "Microsoft 365",
    fits: "Şirket alan adlı Outlook (Exchange Online).",
    steps: [
      { text: "Kural kurulumu Outlook / Hotmail sekmesindekiyle aynıdır." },
      { text: `Koşul: "Gönderen" > ${EIDS_SENDER_TOKEN}. Eylem: "Şuraya ilet" > ${EIDS_ADDRESS_TOKEN}.` },
    ],
    warning: {
      title: "Dış adrese iletme engelli olabilir",
      text: "Microsoft 365'te dış adrese otomatik iletme varsayılan olarak engelli olabilir (giden istenmeyen posta ilkesi). BT yöneticinizin Defender'daki Giden istenmeyen posta ilkesi > Otomatik iletme ayarını sizin posta kutunuz için açması gerekir.",
    },
  },
  {
    id: "yandex",
    label: "Yandex",
    fits: "Yandex Mail ya da Yandex 360 kurumsal posta.",
    steps: [
      { text: "Ayarlar > E-posta işleme kuralları > \"Kural oluştur\".", unverified: true },
      { text: `Koşul: "Kimden" içerir ${EIDS_SENDER_TOKEN}.`, unverified: true },
      { text: `Eylem: "Adrese ilet" > ${EIDS_ADDRESS_TOKEN}.`, unverified: true },
      { text: "Yandex şifrenizi isteyip alıcı adrese bir onay e-postası gönderebilir. Bu onay bağlantısı EmlakSoft'taki kartta görünür." },
    ],
    warning: {
      title: "Menü adları dile göre değişebilir",
      text: "Yandex arayüzündeki menü adları doğrulanmadı; ekranınızda benzer adlı \"kural / filtre\" menüsünü arayın.",
      unverified: true,
    },
  },
  {
    id: "cpanel",
    label: "cPanel / hosting",
    fits: "Hosting firmasının verdiği posta (ör. info@ofisiniz.com, cPanel ya da Plesk).",
    steps: [
      { text: "cPanel: E-posta > E-posta Filtreleri (hesap bazında) > yeni filtre." },
      { text: `Kural: "From" equals ${EIDS_SENDER_TOKEN}.` },
      { text: `Eylem: "Redirect to email" > ${EIDS_ADDRESS_TOKEN}.` },
      { text: "Plesk ve diğer panellerde benzer bir \"filtre / yönlendirme\" menüsü vardır. Orada da tüm postayı değil, yalnız bu göndericiyi iletin." },
    ],
    warning: {
      title: "Tüm postayı iletmeyin",
      text: "Hesap düzeyinde \"tüm postayı yönlendir\" (forwarder) kurmayın; EmlakSoft başka göndericiden gelen e-postayı okumadan siler.",
    },
  },
];

export function isForwardingProviderId(v: unknown): v is ForwardingProviderId {
  return typeof v === "string" && FORWARDING_PROVIDERS.some((p) => p.id === v);
}

/** Adım metnindeki yer tutucuları doldurur; adres yoksa okunur bir yer tutucu kalır. */
export function fillForwardingText(text: string, address: string | null | undefined): string {
  const a = address?.trim() || "EmlakSoft alma adresiniz";
  return text.split(EIDS_ADDRESS_TOKEN).join(a).split(EIDS_SENDER_TOKEN).join(EIDS_SENDER_ADDRESS);
}

/** E-posta adresinden sağlayıcı önerisi (yalnız ilk sekme seçimi; yanlışsa kullanıcı sekmeyi değiştirir). */
export function guessForwardingProvider(email: string | null | undefined): ForwardingProviderId {
  const domain = String(email ?? "").toLowerCase().split("@")[1] ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(domain)) return "outlook";
  if (/^yandex\.[a-z.]+$/.test(domain)) return "yandex";
  return "gmail";
}
