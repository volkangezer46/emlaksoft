"use client";

import { useState, useTransition } from "react";
import { BellRing, Check, Loader2 } from "lucide-react";
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
];

export function NotificationPrefsPanel({ initial }: { initial?: NotifPrefs }) {
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
    <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-brand-600/10 text-brand-600">
          {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <BellRing className="h-5 w-5" />}
        </span>
        <div>
          <h2 className="font-display font-bold text-ink-950">Bildirim tercihleri</h2>
          <p className="text-xs text-text-muted">Hesabınıza kaydedilir · cron ve zil aynı kuralları kullanır.</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {ROWS.map((row) => (
          <button
            key={row.key}
            type="button"
            disabled={pending}
            onClick={() => toggle(row.key)}
            className="flex w-full items-center gap-3 rounded-[12px] border border-line bg-canvas/50 px-3 py-3 text-left transition hover:border-brand-300 disabled:opacity-60"
          >
            <span
              className={`grid h-5 w-5 place-items-center rounded-[6px] border ${
                prefs[row.key] ? "border-mint-500 bg-mint-500 text-white" : "border-line bg-surface"
              }`}
            >
              {prefs[row.key] ? <Check className="h-3 w-3" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink-950">{row.label}</span>
              <span className="block text-[11px] text-text-muted">{row.desc}</span>
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
  return true;
}
