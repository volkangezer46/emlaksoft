"use client";

import { useState, useTransition } from "react";
import { BellOff, BellRing, Check, Loader2, MessageSquareOff, Moon } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";
import { saveNotificationPrefs } from "@/app/actions/notification-prefs";
import { PushSubscribeToggle } from "@/components/app/push-subscribe";
import { Switch } from "@/components/ui/switch";
import { FormSelect } from "@/components/ui/form-controls";
import { DEFAULT_QUIET_HOURS, type QuietHours } from "@/lib/notification-delivery";

/** Tür anahtarları (true = uygulama içi + telefon açık). `push`: yalnız telefon kanalı; `quiet`: sessiz saatler (GA-09). */
export type NotifPrefFlags = {
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
  task: boolean;
};
export type NotifPrefs = NotifPrefFlags & { push: Partial<Record<keyof NotifPrefFlags, boolean>>; quiet: QuietHours };

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
  task: true,
  push: {},
  quiet: DEFAULT_QUIET_HOURS,
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

type Row = { key: keyof NotifPrefFlags; label: string; desc: string };

const ROWS: Row[] = [
  { key: "task", label: "Görev hatırlatmaları", desc: "Vadesi yaklaşan ve geciken görevleriniz" },
  { key: "appointment", label: "Randevu", desc: "Yaklaşan randevu hatırlatmaları ve müşteri talepleri" },
  { key: "assignment", label: "Devir ve atamalar", desc: "Size devredilen müşteri, portföy, iş yükü ve sizin adınıza açılan randevular" },
  { key: "digest", label: "Günlük özet", desc: "Her sabah gününüzün planı" },
  { key: "insight", label: "Önemli öneriler", desc: "Yüksek öncelikli öneriler (günde en çok 3 bildirim)" },
  { key: "portal", label: "Portal teyit", desc: "Gecikmiş ilan teyit uyarıları" },
  { key: "priceDrop", label: "Fiyat düşüşü eşleşmeleri", desc: "Fiyatı düşen portföyle eşleşen talepler" },
  { key: "savedSearch", label: "Vitrin kayıtlı aramaları", desc: "Ziyaretçi aramaları ve yeni ilan eşleşmeleri" },
  { key: "share", label: "Paylaşım bildirimleri", desc: "Paylaşım bağlantısı açılışları ve beğeniler" },
  { key: "authority", label: "Portföy yetki bitimi", desc: "Portföy yetkisinin bitişine 30 / 7 gün kala ve bittiğinde" },
  { key: "survey", label: "Anket sonuçları", desc: "Düşük puan takibi, destekleyen müşteri ve ekip nabzı daveti" },
  { key: "network", label: "Ağ iş birliği talepleri", desc: "Ofisler arası iş birliği bildirimleri" },
  { key: "commission", label: "Komisyon ve anlaşmalar", desc: "Tahsilatlar ve kazanılan anlaşmalar" },
  { key: "rentOverdue", label: "Kira gecikmeleri", desc: "Geciken kira tahakkuku ve kira yenileme bildirimleri" },
  { key: "dunning", label: "Ödeme hatırlatmaları", desc: "Gecikmiş fatura ve abonelik uyarıları" },
  { key: "support", label: "Destek talepleri", desc: "Destek talebinize gelen yanıt ve durum değişiklikleri" },
  { key: "marketing", label: "Ürün duyuruları", desc: "EmlakSoft yenilikleri (isteğe bağlı)" },
];

const SECTIONS: { title: string; keys: (keyof NotifPrefFlags)[] }[] = [
  { title: "Günlük iş", keys: ["task", "appointment", "assignment", "digest", "insight"] },
  { title: "Müşteri ve portföy", keys: ["portal", "priceDrop", "savedSearch", "share", "authority", "survey", "network"] },
  { title: "Finans", keys: ["commission", "rentOverdue", "dunning"] },
  { title: "Diğer", keys: ["support", "marketing"] },
];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

export function NotificationPrefsPanel({ initial, channels }: { initial?: NotifPrefs; channels?: { push: boolean; sms: boolean } }) {
  const { push } = useToast();
  const [prefs, setPrefs] = useState<NotifPrefs>(initial ?? DEFAULTS);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const pushChannel = channels?.push !== false;

  function commit(next: NotifPrefs) {
    setPrefs(next);
    setSaved(false);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    startTransition(async () => {
      const res = await saveNotificationPrefs(next);
      if (res.error) push(res.error, "err");
      else setSaved(true);
    });
  }

  const setType = (key: keyof NotifPrefFlags, on: boolean) => commit({ ...prefs, [key]: on });
  const setPush = (key: keyof NotifPrefFlags, on: boolean) => commit({ ...prefs, push: { ...prefs.push, [key]: on } });
  const setQuiet = (patch: Partial<QuietHours>) => commit({ ...prefs, quiet: { ...prefs.quiet, ...patch } });
  const byKey = new Map(ROWS.map((r) => [r.key, r]));

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
          {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <BellRing className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-bold text-ink-950">Bildirim tercihleri</h2>
          <p className="text-xs text-text-muted">Her tür için uygulama içi bildirimi ve telefona gelen anlık bildirimi ayrı seçebilirsiniz.</p>
        </div>
        <span role="status" aria-live="polite" className="hidden shrink-0 items-center gap-1 text-xs font-semibold text-mint-600 sm:inline-flex">
          {saved && !pending ? (
            <>
              <Check className="h-3.5 w-3.5" aria-hidden /> Kaydedildi
            </>
          ) : null}
        </span>
      </div>
      {channels && (!channels.push || !channels.sms) ? (
        <ul className="mt-3 space-y-1.5" aria-label="Kapalı bildirim kanalları">
          {!channels.push ? (
            <li className="flex items-start gap-2 rounded-[var(--radius-control)] border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs text-amber-800">
              <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                <strong className="font-semibold">Anlık bildirim (push) kanalı kapalı.</strong> Bu ortamda push anahtarı tanımlı değil; bildirimler
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

      {pushChannel ? (
        <div className="mt-4">
          <PushSubscribeToggle />
        </div>
      ) : null}

      {SECTIONS.map((section) => (
        <fieldset key={section.title} className="mt-5">
          <legend className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-text-faint">{section.title}</legend>
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-canvas/40">
            {section.keys.map((key) => {
              const row = byKey.get(key)!;
              const on = prefs[key];
              const pushOn = on && prefs.push[key] !== false;
              const id = `np-${key}`;
              return (
                <li key={key} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <span className="min-w-0 flex-1">
                    <span id={id} className="block text-sm font-semibold text-ink-950">{row.label}</span>
                    <span className="block text-xs text-text-muted">{row.desc}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-5">
                    <label className="flex min-h-11 items-center gap-2 text-xs font-semibold text-text-muted sm:min-h-0">
                      <Switch checked={on} disabled={pending} onCheckedChange={(v) => setType(key, v)} aria-label={`${row.label}: uygulama içi bildirim`} />
                      Uygulama
                    </label>
                    {pushChannel ? (
                      <label className="flex min-h-11 items-center gap-2 text-xs font-semibold text-text-muted sm:min-h-0">
                        <Switch checked={pushOn} disabled={pending || !on} onCheckedChange={(v) => setPush(key, v)} aria-label={`${row.label}: telefona anlık bildirim`} />
                        Telefon
                      </label>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}

      {pushChannel ? (
        <fieldset className="mt-5 rounded-[var(--radius-card)] border border-line bg-canvas/40 p-3">
          <legend className="sr-only">Sessiz saatler</legend>
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-ink-950/6 text-ink-950">
              <Moon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink-950">Sessiz saatler</span>
              <span className="block text-xs text-text-muted">
                Bu aralıkta telefona anlık bildirim gönderilmez; bildirimler uygulama içinde sizi bekler (Türkiye saati).
              </span>
            </span>
            <Switch checked={prefs.quiet.on} disabled={pending} onCheckedChange={(v) => setQuiet({ on: v })} aria-label="Sessiz saatler" />
          </div>
          {prefs.quiet.on ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-sm">
              <label className="text-xs font-semibold text-text-muted">
                Başlangıç
                <FormSelect className="mt-1" value={prefs.quiet.from} disabled={pending} onChange={(e) => setQuiet({ from: e.target.value })}>
                  {TIME_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </FormSelect>
              </label>
              <label className="text-xs font-semibold text-text-muted">
                Bitiş
                <FormSelect className="mt-1" value={prefs.quiet.to} disabled={pending} onChange={(e) => setQuiet({ to: e.target.value })}>
                  {TIME_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </FormSelect>
              </label>
              <label className="col-span-2 flex min-h-11 items-center gap-2 text-xs font-semibold text-text-muted">
                <Switch checked={prefs.quiet.urgent} disabled={pending} onCheckedChange={(v) => setQuiet({ urgent: v })} aria-label="Kritik bildirimler sessiz saatte de gelsin" />
                Kritik bildirimler sessiz saatte de gelsin
              </label>
            </div>
          ) : null}
        </fieldset>
      ) : null}
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
  if (prefs.task === false && (t.includes("geciken görev") || t.includes("yaklaşan görev"))) return false;
  return true;
}
