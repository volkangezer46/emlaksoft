"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PanelTop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { saveBanner, setBannerActive } from "@/app/actions/platform-notifications";
import { SegmentBuilder, type SegmentInit, type SegmentOptions } from "./segment-builder";

export type BannerInit = {
  id: string;
  title: string;
  body: string | null;
  level: string;
  display: string;
  dismissible: boolean;
  href: string | null;
  startsLocal: string;
  endsLocal: string;
};

/** Banner/modal formu: içerik, seviye, görünüm, kapatılabilirlik, tarih aralığı ve hedef segment (boş = tüm ofisler). */
export function BannerForm({ options, init, segInit, minLocal }: { options: SegmentOptions; init?: BannerInit; segInit?: SegmentInit; minLocal: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  return (
    <form
      id="banner-formu"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        setDone(null);
        start(async () => {
          const r = await saveBanner(fd);
          if (r.error) {
            setError(r.error);
            return;
          }
          setDone(r.affected ? `Kaydedildi: ${r.affected} ofiste görünecek.` : "Kaydedildi: tüm ofislerde görünecek.");
          router.push("/admin/duyuru?sekme=banner");
          router.refresh();
        });
      }}
      className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5"
    >
      <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
        <PanelTop className="h-4 w-4 text-brand-600" /> {init ? "Banner'ı düzenle" : "Yeni banner"}
      </h2>
      {init ? <input type="hidden" name="id" value={init.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Başlık" htmlFor="bn-title" required className="sm:col-span-2">
          <FormInput id="bn-title" name="title" required maxLength={120} defaultValue={init?.title} placeholder="Örn. Cumartesi 02:00-03:00 planlı bakım" />
        </FormField>
        <FormField label="Metin (isteğe bağlı)" htmlFor="bn-body" className="sm:col-span-2">
          <FormTextarea id="bn-body" name="body" rows={3} maxLength={600} defaultValue={init?.body ?? ""} />
        </FormField>
        <FormField label="Bağlantı (isteğe bağlı)" htmlFor="bn-href" hint="/app/... ya da https://">
          <FormInput id="bn-href" name="href" maxLength={500} defaultValue={init?.href ?? ""} placeholder="/app/abonelik" />
        </FormField>
        <FormField label="Seviye" htmlFor="bn-level">
          <FormSelect id="bn-level" name="level" defaultValue={init?.level ?? "info"}>
            <option value="info">Bilgi</option>
            <option value="warning">Uyarı</option>
            <option value="critical">Kritik</option>
          </FormSelect>
        </FormField>
        <FormField label="Görünüm" htmlFor="bn-display">
          <FormSelect id="bn-display" name="display" defaultValue={init?.display ?? "banner"}>
            <option value="banner">Sayfa üstü şerit</option>
            <option value="modal">Açılır pencere (modal)</option>
          </FormSelect>
        </FormField>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 self-end text-sm text-ink-950">
          <input type="checkbox" name="dismissible" defaultChecked={init ? init.dismissible : true} className="h-4 w-4 accent-[var(--brand-600)]" />
          Kullanıcı kapatabilir
        </label>
        <FormField label="Başlangıç" htmlFor="bn-starts" hint="Boş: hemen (Türkiye saati)">
          <FormInput id="bn-starts" name="starts_at" type="datetime-local" defaultValue={init?.startsLocal} />
        </FormField>
        <FormField label="Bitiş" htmlFor="bn-ends" hint="Boş: kaldırılana kadar">
          <FormInput id="bn-ends" name="ends_at" type="datetime-local" min={minLocal} defaultValue={init?.endsLocal} />
        </FormField>
      </div>
      <details className="rounded-[var(--radius-control)] border border-line p-3" open={Boolean(segInit && Object.values(segInit).some((v) => (Array.isArray(v) ? v.length : Boolean(v))))}>
        <summary className="cursor-pointer text-sm font-semibold text-ink-950">Hedef ofisler (boş bırakılırsa tüm ofisler)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <SegmentBuilder options={options} init={segInit} allowUser={false} allowOwners={false} />
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="navy" size="md" disabled={pending}>
          {pending ? "Kaydediliyor…" : init ? "Değişiklikleri kaydet" : "Banner'ı yayınla"}
        </Button>
        {error ? <span role="alert" className="text-sm font-semibold text-danger-600">{error}</span> : null}
        {done ? <span role="status" className="text-sm font-semibold text-mint-600">{done}</span> : null}
      </div>
    </form>
  );
}

/** Liste satırındaki yayından kaldır / yeniden aç düğmesi. */
export function BannerToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const fd = new FormData();
            fd.set("id", id);
            fd.set("active", active ? "0" : "1");
            const r = await setBannerActive(fd);
            if (r.error) setError(r.error);
            else router.refresh();
          })
        }
      >
        {pending ? "…" : active ? "Yayından kaldır" : "Yeniden yayınla"}
      </Button>
      {error ? <span role="alert" className="text-xs font-semibold text-danger-600">{error}</span> : null}
    </span>
  );
}
