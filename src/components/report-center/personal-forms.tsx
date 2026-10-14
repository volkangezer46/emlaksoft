"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellPlus, BookmarkPlus, Pause, Play, Trash2, X } from "lucide-react";
import {
  createReportSubscription,
  deleteReportSubscription,
  deleteReportView,
  saveReportView,
  setReportSubscriptionActive,
} from "@/app/actions/report-center";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/components/app/toast-provider";
import type { ReportScope } from "@/lib/report-center/types";

/**
 * Rapor merkezi kişiselleştirme formları (İSTEMCİ, DG4): görünüm kaydet/sil, abonelik oluştur/durdur/sil.
 * Sunucu modülü İÇE AKTARMAZ (yalnız server action'lar ve saf tipler). Sonuç hem toast'la (panelde) hem satır içi
 * durum metniyle (toast sağlayıcısı olmayan /admin'de) bildirilir.
 */

type Res = { ok: true } | { ok: false; error: string };

function useAction() {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const run = (fn: () => Promise<Res>, okText: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setMessage({ tone: "err", text: res.error });
        push(res.error, "err");
        return;
      }
      setMessage({ tone: "ok", text: okText });
      push(okText, "ok");
      after?.();
      router.refresh();
    });
  return { pending, message, run };
}

function Status({ message }: { message: { tone: "ok" | "err"; text: string } | null }) {
  if (!message) return null;
  return (
    <p role="status" className={message.tone === "err" ? "text-xs font-medium text-danger-strong" : "text-xs font-medium text-success-strong"}>
      {message.text}
    </p>
  );
}

export function SaveViewButton({ scope, reportId, filters, shareLabel }: { scope: ReportScope; reportId: string; filters: Record<string, string>; shareLabel: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const { pending, message, run } = useAction();
  const hasFilter = Object.keys(filters).length > 0;
  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" icon={BookmarkPlus} disabled={!hasFilter} title={hasFilter ? undefined : "Önce filtre uygulayın"}>
            Bu görünümü kaydet
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-3">
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => saveReportView({ scope, reportId, name, filters, shared }), "Görünüm kaydedildi", () => {
                setOpen(false);
                setName("");
                setShared(false);
              });
            }}
          >
            <FormField label="Görünüm adı" htmlFor="rapor-gorunum-adi" required>
              <FormInput id="rapor-gorunum-adi" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus placeholder="ör. Bu ayın yeni müşterileri" />
            </FormField>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-text-muted">
              <Checkbox checked={shared} onChange={(e) => setShared(e.target.checked)} />
              {shareLabel}
            </label>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" size="sm" loading={pending} disabled={!name.trim()}>
                Kaydet
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
      <Status message={message} />
    </div>
  );
}

export function DeleteViewButton({ scope, id, name }: { scope: ReportScope; id: string; name: string }) {
  const { pending, run } = useAction();
  return (
    <Button
      variant="ghost"
      size="icon"
      icon={X}
      loading={pending}
      aria-label={`${name} görünümünü sil`}
      className="text-text-faint hover:text-danger-strong"
      onClick={() => run(() => deleteReportView({ scope, id }), `"${name}" görünümü silindi`)}
    />
  );
}

const WEEKDAYS = [
  [1, "Pazartesi"],
  [2, "Salı"],
  [3, "Çarşamba"],
  [4, "Perşembe"],
  [5, "Cuma"],
  [6, "Cumartesi"],
  [7, "Pazar"],
] as const;

export function SubscriptionForm({
  scope,
  reportId,
  reportTitle,
  filters,
  people,
  selfId,
  hasDateRange,
  deliveryHour,
}: {
  scope: ReportScope;
  reportId: string;
  reportTitle: string;
  filters: Record<string, string>;
  people: { id: string; name: string; hint: string }[];
  selfId: string;
  hasDateRange: boolean;
  deliveryHour: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(reportTitle.slice(0, 80));
  const [format, setFormat] = useState("xlsx");
  const [frequency, setFrequency] = useState("weekly");
  const [weekday, setWeekday] = useState(1);
  const [monthDay, setMonthDay] = useState(1);
  const [relative, setRelative] = useState(true);
  const [recipients, setRecipients] = useState<string[]>(people.some((p) => p.id === selfId) ? [selfId] : []);
  const { pending, message, run } = useAction();

  if (!open) {
    return (
      <div className="space-y-1.5">
        <Button variant="outline" size="sm" icon={BellPlus} onClick={() => setOpen(true)}>
          E-postayla düzenli gönder
        </Button>
        <Status message={message} />
      </div>
    );
  }

  const toggle = (id: string) => setRecipients((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 10 ? cur : [...cur, id]));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            createReportSubscription({
              scope,
              reportId,
              name,
              format,
              frequency,
              weekday: frequency === "weekly" ? weekday : null,
              monthDay: frequency === "monthly" ? monthDay : null,
              recipientIds: recipients,
              relativeRange: hasDateRange ? relative : false,
              filters,
            }),
          "Abonelik oluşturuldu",
          () => setOpen(false),
        );
      }}
    >
      <FormField label="Abonelik adı" htmlFor="abonelik-adi" required>
        <FormInput id="abonelik-adi" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <FormField label="Sıklık" htmlFor="abonelik-siklik">
          <FormSelect id="abonelik-siklik" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            <option value="daily">Günlük</option>
            <option value="weekly">Haftalık</option>
            <option value="monthly">Aylık</option>
          </FormSelect>
        </FormField>
        {frequency === "weekly" ? (
          <FormField label="Gün" htmlFor="abonelik-gun">
            <FormSelect id="abonelik-gun" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAYS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </FormSelect>
          </FormField>
        ) : frequency === "monthly" ? (
          <FormField label="Ayın günü" htmlFor="abonelik-ay-gunu" hint="1-28 arası (her ay vardır)">
            <FormSelect id="abonelik-ay-gunu" value={monthDay} onChange={(e) => setMonthDay(Number(e.target.value))}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </FormSelect>
          </FormField>
        ) : null}
        <FormField label="Dosya biçimi" htmlFor="abonelik-bicim">
          <FormSelect id="abonelik-bicim" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="pdf">PDF</option>
            <option value="csv">CSV</option>
          </FormSelect>
        </FormField>
      </div>
      {hasDateRange ? (
        <label className="flex min-h-11 cursor-pointer items-start gap-2 text-xs text-text-muted">
          <Checkbox checked={relative} onChange={(e) => setRelative(e.target.checked)} className="mt-0.5" />
          <span>Tarih aralığını her gönderimde yenile (günlük: dün, haftalık: son 7 gün, aylık: geçen ay). Kapalıysa filtredeki tarihler aynen kalır.</span>
        </label>
      ) : null}
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-ink-950">Alıcılar ({recipients.length}/10)</legend>
        <p className="text-xs text-text-faint">Her alıcı raporu kendi yetkisi ve veri kapsamıyla alır.</p>
        <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-[var(--radius-control)] border border-line p-1.5">
          {people.length === 0 ? <p className="p-2 text-xs text-text-muted">Seçilebilecek kişi yok.</p> : null}
          {people.map((p) => (
            <label key={p.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-1.5 text-sm hover:bg-surface-hover touch:min-h-11">
              <Checkbox checked={recipients.includes(p.id)} onChange={() => toggle(p.id)} />
              <span className="min-w-0 flex-1 truncate">{p.id === selfId ? `${p.name} (siz)` : p.name}</span>
              <span className="shrink-0 text-xs text-text-faint">{p.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-text-faint">Gönderim saat {deliveryHour} civarında yapılır; ilk gönderim yarından itibaren ilk uygun gündür. Uygulanan filtreler aboneliğe kaydedilir.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" loading={pending} disabled={!name.trim() || recipients.length === 0}>
          Aboneliği kaydet
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
      </div>
      <Status message={message} />
    </form>
  );
}

export function SubscriptionActions({ scope, id, name, active }: { scope: ReportScope; id: string; name: string; active: boolean }) {
  const { pending, message, run } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button
        variant="ghost"
        size="xs"
        icon={active ? Pause : Play}
        loading={pending}
        onClick={() => run(() => setReportSubscriptionActive({ scope, id, active: !active }), active ? "Abonelik durduruldu" : "Abonelik yeniden başladı")}
      >
        {active ? "Durdur" : "Sürdür"}
      </Button>
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="xs" icon={Trash2} aria-label={`${name} aboneliğini sil`}>
            Sil
          </Button>
        }
        title="Abonelik silinsin mi?"
        description={`"${name}" aboneliği silinir; bundan sonra e-posta gönderilmez.`}
        confirmLabel="Sil"
        onConfirm={() => run(() => deleteReportSubscription({ scope, id }), "Abonelik silindi")}
      />
      <Status message={message} />
    </div>
  );
}
