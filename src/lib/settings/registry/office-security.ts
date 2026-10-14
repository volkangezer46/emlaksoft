import type { AnySettingDef } from "../types";
import { defineBool, defineInt, defineString } from "./define";
import { validateAllowlist } from "@/lib/platform-security/admin-access";
import {
  IDLE_MAX_MINUTES,
  OFFICE_IDLE_MINUTES_KEY,
  OFFICE_IP_ALLOWLIST_KEY,
  OFFICE_IP_OWNER_EXEMPT_KEY,
  OFFICE_MAX_HOURS_KEY,
  OFFICE_MFA_ROLES_KEY,
  OFFICE_NEW_DEVICE_ALERT_KEY,
  SESSION_MAX_HOURS_LIMIT,
  validateRoleList,
} from "@/lib/office-security/policy";

/**
 * DG7 ofis güvenlik politikası (ofis kapsamı, `tenant_settings`). Varsayılanların HEPSİ bugünkü davranış: 2FA zorunlu rol
 * yok, IP kısıtı yok (sahip muaf), boşta kalma/oturum ömrü kapalı, yeni cihaz bildirimi kapalı.
 * Yazma YALNIZ Ayarlar > Güvenlik'teki korumalı yoldan (`fromBridge`): yalnız ofis sahibi, kendini kilitleme onayı ve
 * SMS hazır mı denetimi orada; Kurallar ve varsayılanlar ekranı bu ayarları bağlantı olarak gösterir.
 */
const OFFICE_SECURITY = {
  scope: "tenant",
  storage: "tenant_settings",
  permission: { appModule: "settings" },
  category: "guvenlik",
  group: "guvenlik",
  editMode: "bridge",
  editHref: "/app/ayarlar/guvenlik#ofis-politikasi",
} as const;

export const OFFICE_SECURITY_SETTING_DEFS: AnySettingDef[] = [
  defineString({
    ...OFFICE_SECURITY,
    key: OFFICE_MFA_ROLES_KEY,
    default: "",
    maxLength: 200,
    risk: "high",
    label: "İki adımlı doğrulama zorunlu roller",
    description: "Seçilen rollerdeki kullanıcılar SMS ile iki adımlı doğrulamayı kurmadan panele giremez. Boş = zorunluluk yok.",
    impact: "Kurmamış kullanıcı bir sonraki tıklamasında kurulum ekranına yönlenir; telefonunu doğrulayınca devam eder.",
    crossRule: (v: string) => validateRoleList(v),
  }),
  defineString({
    ...OFFICE_SECURITY,
    key: OFFICE_IP_ALLOWLIST_KEY,
    default: "",
    maxLength: 4000,
    multiline: true,
    risk: "high",
    label: "İzinli IP adresleri",
    description: "Satır ya da virgülle IPv4/IPv6 adres veya CIDR (ör. 203.0.113.7, 10.0.0.0/24). Boş = her ağdan giriş.",
    impact: "Doluysa listede olmayan ağdan açılan ofis oturumu kapanır (≤30 sn içinde). Sahip muafiyeti açıksa ofis sahibi etkilenmez.",
    crossRule: (v: string) => validateAllowlist(v),
  }),
  defineBool({
    ...OFFICE_SECURITY,
    key: OFFICE_IP_OWNER_EXEMPT_KEY,
    default: true,
    risk: "high",
    label: "Ofis sahibi IP kısıtından muaf",
    description: "Açıkken ofis sahibi her ağdan girebilir; IP listesi yanlış girilse bile ofis kilitlenmez (önerilir).",
    impact: "Kapatırsanız sahip de yalnız listedeki ağlardan girer; kilitlenirseniz EmlakSoft destek ekibi politikayı sıfırlar.",
  }),
  defineInt({
    ...OFFICE_SECURITY,
    key: OFFICE_IDLE_MINUTES_KEY,
    default: 0,
    min: 0,
    max: IDLE_MAX_MINUTES,
    unit: "dk",
    risk: "low",
    label: "Boşta kalma süresi",
    description: "Kullanıcı bu süre boyunca panelde işlem yapmazsa oturumu kapanır. 0 = kapalı.",
    impact: "Paylaşılan bilgisayarda açık kalan oturum riskini azaltır; çok düşük değer sık yeniden giriş ister.",
  }),
  defineInt({
    ...OFFICE_SECURITY,
    key: OFFICE_MAX_HOURS_KEY,
    default: 0,
    min: 0,
    max: SESSION_MAX_HOURS_LIMIT,
    unit: "saat",
    risk: "low",
    label: "En uzun oturum süresi",
    description: "Girişten bu kadar saat sonra oturum (etkinlikten bağımsız) kapanır. 0 = sınırsız.",
    impact: "Kullanıcılar süre dolunca yeniden giriş yapar; 2FA açıksa yeni kod ister.",
  }),
  defineBool({
    ...OFFICE_SECURITY,
    key: OFFICE_NEW_DEVICE_ALERT_KEY,
    default: false,
    risk: "low",
    label: "Yeni cihazdan giriş bildirimi",
    description: "Bir kullanıcı daha önce görülmemiş bir cihaz/tarayıcıdan girdiğinde kendisine ve ofis sahibine bildirim gider.",
    impact: "Tanımadığınız bir giriş fark edilir; Ayarlar > Güvenlik'ten o oturumu kapatabilirsiniz.",
  }),
];
