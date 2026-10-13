"use client";

import { startTransition, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { TAB_ICONS as TI } from "@/lib/icons";
import { sendBroadcast } from "@/app/actions/platform-notifications";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import { KIND_OPTIONS } from "./broadcast-options";
import { BROADCAST_TABS } from "./broadcast-tabs";
import { SegmentBuilder, type SegmentCount, type SegmentInit, type SegmentOptions } from "./segment-builder";

const TAB_ICONS = { icerik: TI.icerik, hedef: TI.hedef, kanal: TI.kanal } as const;
const FIELD_LABELS = { title: "Başlık" };

const CHANNEL_OPTIONS = [
  { value: "in_app", label: "Uygulama içi", hint: "Ofis panelindeki zil (okunma ölçülür)" },
  { value: "email", label: "E-posta", hint: "Resend anahtarı yoksa 'kanal kapalı' raporlanır" },
  { value: "push", label: "Push", hint: "Cihaz bildirimi aboneliği olan kullanıcılara" },
] as const;

/**
 * Duyuru formu (sekmeli kabuk, AD8): içerik → hedef kitle (segment oluşturucu, canlı sayım) → kanal ve zaman.
 * Gönder = kuyruğa al: istek yalnız arşiv satırı yazar, teslim kuyrukta yapılır (zaman aşımı yok).
 */
export function BroadcastForm({
  options,
  init,
  title: pageTitle = "Yeni duyuru",
  minLocal,
}: {
  options: SegmentOptions;
  init?: SegmentInit;
  title?: string;
  /** datetime-local alt sınırı (Türkiye saatiyle şimdi; sunucuda hesaplanır). */
  minLocal: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<string[]>(["in_app"]);
  const [commercial, setCommercial] = useState(false);
  const [count, setCount] = useState<SegmentCount>(null);

  const tabs: FormTab[] = useMemo(
    () =>
      BROADCAST_TABS.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        icon: TAB_ICONS[t.id],
        fields: [...t.fields],
        required: [...t.required],
      })),
    [],
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (fd.getAll("channel").length === 0) {
      setError("En az bir kanal seçin.");
      return;
    }
    setError(null);
    setPending(true);
    startTransition(async () => {
      const res = await sendBroadcast(fd);
      setPending(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(res.id ? `/admin/duyuru?duyuru=${res.id}` : "/admin/duyuru");
      router.refresh();
    });
  }

  const tabPanels = {
    icerik: (
      <>
        <FormField label="Başlık" htmlFor="title" required className="sm:col-span-2">
          <FormInput name="title" required maxLength={120} placeholder="Örn: Yeni özellik yayında — portallar güncellendi" />
        </FormField>
        <FormField label="Mesaj (isteğe bağlı)" htmlFor="body" className="sm:col-span-2">
          <FormTextarea name="body" rows={5} maxLength={2000} placeholder="Detay veya açıklama ekleyebilirsiniz…" />
        </FormField>
        <FormField label="Bağlantı (isteğe bağlı)" htmlFor="href" hint="/app/... ya da https:// — tıklamalar ölçülür" className="sm:col-span-2">
          <FormInput name="href" maxLength={500} placeholder="/app/ayarlar" />
        </FormField>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-ink-950">Bildirim türü</legend>
          <div className="flex flex-wrap gap-2">
            {KIND_OPTIONS.map((k) => (
              <label key={k.value} className="cursor-pointer">
                <input type="radio" name="kind" value={k.value} defaultChecked={k.value === "info"} className="peer sr-only" />
                <span className={`inline-flex min-h-9 items-center rounded-full px-3 py-1.5 text-xs font-semibold ring-2 ring-transparent transition peer-checked:ring-current peer-focus-visible:ring-brand-500 ${k.cls}`}>
                  {k.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </>
    ),
    hedef: <SegmentBuilder init={init} options={options} onChange={({ count: c }) => setCount(c)} />,
    kanal: (
      <>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-ink-950">Kanallar</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {CHANNEL_OPTIONS.map((c) => (
              <label key={c.value} className="flex min-h-11 cursor-pointer items-start gap-2 rounded-[var(--radius-control)] border border-line bg-surface p-3 text-sm transition has-[:checked]:border-brand-600 has-[:checked]:bg-brand-600/5">
                <input
                  type="checkbox"
                  name="channel"
                  value={c.value}
                  checked={channels.includes(c.value)}
                  onChange={() => setChannels((prev) => (prev.includes(c.value) ? prev.filter((x) => x !== c.value) : [...prev, c.value]))}
                  className="mt-0.5 h-4 w-4 accent-[var(--brand-600)]"
                />
                <span>
                  <span className="font-semibold text-ink-950">{c.label}</span>
                  <span className="block text-xs text-text-muted">{c.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex min-h-11 cursor-pointer items-start gap-2 text-sm text-ink-950 sm:col-span-2">
          <input type="checkbox" name="commercial" checked={commercial} onChange={(e) => setCommercial(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand-600)]" />
          <span>
            Ticari ileti (kampanya, indirim, tanıtım)
            <span className="block text-xs text-text-muted">İYS uyumu: yalnız bildirim tercihlerinde pazarlama iletisine izin veren kullanıcılara gider; diğerleri raporda &quot;atlandı&quot; görünür.</span>
          </span>
        </label>
        <FormField label="Gönderim zamanı" htmlFor="scheduled_at" hint="Boş: hemen. Türkiye saatiyle.">
          <FormInput id="scheduled_at" name="scheduled_at" type="datetime-local" min={minLocal} />
        </FormField>
        <FormField label="Bitiş (isteğe bağlı)" htmlFor="expires_at" hint="Bu saatten sonra gönderilmemiş alıcılara gitmez.">
          <FormInput id="expires_at" name="expires_at" type="datetime-local" min={minLocal} />
        </FormField>
      </>
    ),
  };

  function renderSummary({ values }: TabbedSummaryContext) {
    const title = (values.title ?? "").trim();
    const body = (values.body ?? "").trim();
    const href = (values.href ?? "").trim();
    const kind = KIND_OPTIONS.find((k) => k.value === (values.kind ?? "info")) ?? KIND_OPTIONS[0];
    const sched = (values.scheduled_at ?? "").trim();
    const reach = count ? (commercial ? count.optedIn : count.recipients) : null;
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${kind.cls}`}>{kind.label}</span>
          <p className="mt-2 text-sm font-semibold text-ink-950">{title || "Başlık girilmedi"}</p>
          {body ? <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-text-muted">{body}</p> : null}
          {href ? <p className="mt-1 truncate text-xs font-medium text-brand-600">{href}</p> : null}
        </div>
        <SummaryGroup title="Gönderim özeti">
          <SummaryRow label="Başlık" value={title || "Zorunlu"} muted={!title} tab="icerik" field="title" />
          <SummaryRow label="Tür" value={kind.label} tab="icerik" field="kind" />
          <SummaryRow label="Ofis" value={count ? `${count.tenants} ofis` : "—"} muted={!count} tab="hedef" field="seg_status" />
          <SummaryRow label="Ulaşacağı kişi" value={reach === null ? "—" : `${reach} kişi`} muted={reach === null} tab="hedef" field="seg_status" />
          <SummaryRow
            label="Kanal"
            value={channels.length ? CHANNEL_OPTIONS.filter((c) => channels.includes(c.value)).map((c) => c.label).join(", ") : "Seçilmedi"}
            muted={channels.length === 0}
            tab="kanal"
            field="channel"
          />
          <SummaryRow label="Zaman" value={sched ? sched.replace("T", " ") : "Hemen"} tab="kanal" field="scheduled_at" />
          {commercial ? <SummaryRow label="Ticari ileti" value="Yalnız izinli kullanıcılar" tab="kanal" field="commercial" /> : null}
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
      title={pageTitle}
      description="Segment, kanal ve zaman seçin. Gönderim kuyrukta yapılır; teslim, okunma ve tıklama arşivde izlenir."
      eyebrow="Toplu duyuru"
      breadcrumbs={[{ label: "Duyurular", href: "/admin/duyuru" }, { label: pageTitle }]}
      cancelHref="/admin/duyuru"
      submitLabel="Kuyruğa al ve gönder"
      pendingLabel="Kuyruğa alınıyor…"
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
    />
  );
}
