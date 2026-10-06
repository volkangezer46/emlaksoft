"use client";

import { useState, useTransition } from "react";
import { BellOff, BellRing, Check, Loader2, MessageSquareOff } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";
import { saveNotificationPrefs } from "@/app/actions/notification-prefs";
import { PushSubscribeToggle } from "@/components/app/push-subscribe";

export type NotifPrefs = {
  portal: boolean;
  appointment: boolean;
  commission: boolean;
  digest: boolean;
  marketing: boolean;
  priceDrop: boolean;
  savedSearch: boolean;
  share: boolean;
  dunning: boolean;
  rentOverdue: boolean;
  network: boolean;
  insight: boolean;
  support: boolean;
  assignment: boolean;
  authority: boolean;
  survey: boolean;
};

const KEY = "es_notif_prefs_v1";
const DEFAULTS: NotifPrefs = {
  portal: true,
  appointment: true,
  commission: true,
  digest: true,
  marketing: false,
  priceDrop: true,
  savedSearch: true,
  share: true,
  dunning: true,
  rentOverdue: true,
  network: true,
  insight: true,
  support: true,
  assignment: true,
  authority: true,
  survey: true,
};

/** Geriye dönük: bell hâlâ local cache okuyabilir; sunucu öncelikli */
export function readNotifPrefs(): NotifPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

const ROWS: { key: keyof NotifPrefs; label: string; desc: string }[] = [
  { key: "portal", label: "Portal teyit", desc: "Gecikmiş ilan teyit uyarıları" },
  { key: "appointment", label: "Randevu", desc: "Yaklaşan randevu hatırlatmaları" },
  { key: "commission", label: "Komisyon / deal", desc: "Tahsilat ve kazanılan anlaşmalar" },
  { key: "digest", label: "Günlük özet", desc: "Sabah ofis digest bildirimi (cron)" },
  { key: "marketing", label: "Ürün duyuruları", desc: "EmlakSoft yenilikleri (opsiyonel)" },
  { key: "priceDrop", label: "Fiyat düşüşü eşleşmeleri", desc: "Fiyatı düşen portföyle eşleşen talepler" },
  { key: "savedSearch", label: "Vitrin kayıtlı aramaları", desc: "Ziyaretçi aramaları ve yeni ilan eşleşmeleri" },
  { key: "share", label: "Paylaşım bildirimleri", desc: "Paylaşım linki açılış ve beğenileri" },
  { key: "dunning", label: "Ödeme hatırlatmaları", desc: "Gecikmiş fatura ve abonelik uyarıları" },
  { key: "rentOverdue", label: "Kira gecikmeleri", desc: "Geciken kira tahakkuk ve kira yenileme bildirimleri" },
  { key: "network", label: "Ağ iş birliği talepleri", desc: "Ofisler arası iş birliği bildirimleri" },
  { key: "insight", label: "Önemli öneriler", desc: "Yüksek öncelikli içgörüler (günde en çok 3 bildirim)" },
  { key: "support", label: "Destek talepleri", desc: "Destek talebinize gelen yanıt ve durum değişiklikleri" },
  { key: "assignment", label: "Devir ve atamalar", desc: "Size devredilen müşteri, portföy, iş yükü ve sizin adınıza açılan randevular" },
  { key: "authority", label: "Portföy yetki bitimi", desc: "Portföy yetkisinin bitişine 30 / 7 gün kala ve bittiğinde" },
  { key: "survey", label: "Anket sonuçları", desc: "Düşük puan takibi, destekleyen müşteri ve ekip nabzı daveti" },
];

export function NotificationPrefsPanel({ initial, channels }: { initial?: NotifPrefs; channels?: { push: boolean; sms: boolean } }) {
  const { push } = useToast();
  const [prefs, setPrefs] = useState<NotifPrefs>(initial ?? DEFAULTS);
  const [pending, startTransition] = useTransition();

  function toggle(key: keyof NotifPrefs) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    startTransition(async () => {
      const res = await saveNotificationPrefs(next);
      if (res.error) push(res.error, "err");
      else push("Bildirim tercihleri kaydedildi", "ok");
    });
  }

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
          {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <BellRing className="h-5 w-5" />}
        </span>
        <div>
          <h2 className="font-display font-bold text-ink-950">Bildirim tercihleri</h2>
          <p className="text-xs text-text-muted">Hesabınıza kaydedilir · cron ve zil aynı kuralları kullanır.</p>
        </div>
      </div>
      {channels && (!channels.push || !channels.sms) ? (
        <ul className="mt-3 space-y-1.5" aria-label="Kapalı bildirim kanalları">
          {!channels.push ? (
            <li className="flex items-start gap-2 rounded-[var(--radius-control)] border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs text-amber-800">
              <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                <strong className="font-semibold">Tarayıcı bildirimi (push) kanalı kapalı.</strong> Bu ortamda push anahtarı tanımlı değil; bildirimler
                yalnız uygulama içindeki zile düşer.
              </span>
            </li>
          ) : null}
          {!channels.sms ? (
            <li className="flex items-start gap-2 rounded-[var(--radius-control)] border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs text-amber-800">
              <MessageSquareOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                <strong className="font-semibold">SMS kanalı kapalı.</strong> Ofisin SMS (Netgsm) entegrasyonu yok; müşterilere otomatik SMS (anket
                bağlantısı, hatırlatma) gönderilmez. Ayarlar &gt; Entegrasyonlar bölümünden bağlanabilir.
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
      <div className="mt-4 space-y-2">
        {ROWS.map((row) => (
          <button
            key={row.key}
            type="button"
            disabled={pending}
            onClick={() => toggle(row.key)}
            className="flex w-full items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 px-3 py-3 text-left transition hover:border-brand-300 disabled:opacity-60"
          >
            <span
              className={`grid h-5 w-5 place-items-center rounded-md border ${
                prefs[row.key] ? "border-mint-500 bg-mint-500 text-white" : "border-line bg-surface"
              }`}
            >
              {prefs[row.key] ? <Check className="h-3 w-3" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink-950">{row.label}</span>
              <span className="block text-xs text-text-muted">{row.desc}</span>
            </span>
          </button>
        ))}
        <PushSubscribeToggle />
      </div>
    </section>
  );
}

/** Bildirim satırını tercihe göre filtrele */
export function filterByNotifPrefs(title: string, body: string | null, prefs: NotifPrefs): boolean {
  const t = `${title} ${body ?? ""}`.toLocaleLowerCase("tr-TR");
  if (!prefs.portal && (t.includes("portal") || t.includes("teyit"))) return false;
  if (!prefs.appointment && t.includes("randevu")) return false;
  if (!prefs.commission && (t.includes("komisyon") || t.includes("anlaşma") || t.includes("satış kapandı"))) return false;
  if (!prefs.digest && t.includes("günlük")) return false;
  if (!prefs.marketing && (t.includes("duyuru") || t.includes("yeni özellik"))) return false;
  if (!prefs.priceDrop && t.includes("fiyatı düştü")) return false;
  if (!prefs.savedSearch && t.includes("kayıtlı arama")) return false;
  if (!prefs.share && (t.includes("paylaşım") || t.includes("paylaştığınız"))) return false;
  if (!prefs.dunning && (t.includes("ödemeniz gecikti") || t.includes("fatura"))) return false;
  if (!prefs.rentOverdue && (t.includes("kira tahakkuku") || t.includes("kira yenileme"))) return false;
  if (!prefs.network && t.includes("iş birliği")) return false;
  if (prefs.support === false && t.includes("destek talebi")) return false;
  if (prefs.assignment === false && (t.includes("size devredildi") || t.includes("size atandı") || t.includes("iş yükü devri"))) return false;
  if (prefs.authority === false && t.includes("portföy yetkisi")) return false;
  if (prefs.survey === false && (t.includes("anket") || t.includes("ekip nabzı"))) return false;
  return true;
}
