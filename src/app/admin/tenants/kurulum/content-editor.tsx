"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Map as MapIcon, ListChecks, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { resetOnboardingContent, saveOnboardingContent } from "@/app/actions/onboarding-content";
import type { ChecklistStepContent, OnboardingContentFull, TourContent, TourStepContent } from "@/lib/onboarding-content";
import type { TourId } from "@/lib/product-tour-roles";

/**
 * Ürün turu ve kurulum adımları düzenleyicisi (SN5; Ofisler > Kurulum > İçerik). Tam içerik (kayıtlı + koddaki varsayılan)
 * düzenlenir, kaydedilince sunucu doğrular ve varsayılanla aynı kısımları yazmaz. Adımın rol/paket hedefi boşsa herkes görür.
 */

type Option = { value: string; label: string };

type Props = {
  initial: OnboardingContentFull;
  /** Koddaki varsayılan içerik ("Varsayılana dön" sonrası düzenleyici buna döner). */
  defaults: OnboardingContentFull;
  tourOrder: readonly TourId[];
  /** Turun varsayılan rolleri (adım rol hedefi yalnız bunları daraltır). */
  tourRoles: Record<TourId, Option[]>;
  roleOptions: Option[];
  planOptions: Option[];
  canEdit: boolean;
  customized: boolean;
};

type Section = "tur" | "kurulum";

const move = <T,>(list: readonly T[], i: number, d: -1 | 1): T[] => {
  const j = i + d;
  if (j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
};

const toggle = (list: readonly string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function TargetPicker({
  legend,
  options,
  value,
  onChange,
  disabled,
  hint,
}: {
  legend: string;
  options: Option[];
  value: readonly string[];
  onChange: (v: string[]) => void;
  disabled: boolean;
  hint: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-semibold text-ink-950">{legend}</legend>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {options.map((o) => (
          <label key={o.value} className="inline-flex items-center gap-1.5 text-xs text-text-muted touch:min-h-11">
            <Checkbox checked={value.includes(o.value)} disabled={disabled} onChange={() => onChange(toggle(value, o.value))} />
            {o.label}
          </label>
        ))}
      </div>
      <p className="text-xs text-text-faint">{value.length === 0 ? hint : `Yalnız seçilenler görür (${value.length}).`}</p>
    </fieldset>
  );
}

function RowTools({
  index,
  count,
  onMove,
  onRemove,
  disabled,
  label,
}: {
  index: number;
  count: number;
  onMove: (d: -1 | 1) => void;
  onRemove?: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" icon={ArrowUp} aria-label={`${label}: yukarı taşı`} disabled={disabled || index === 0} onClick={() => onMove(-1)} />
      <Button variant="ghost" size="icon" icon={ArrowDown} aria-label={`${label}: aşağı taşı`} disabled={disabled || index === count - 1} onClick={() => onMove(1)} />
      {onRemove ? <Button variant="ghost" size="icon" icon={Trash2} aria-label={`${label}: sil`} disabled={disabled} onClick={onRemove} /> : null}
    </div>
  );
}

export function OnboardingContentEditor({ initial, defaults, tourOrder, tourRoles, roleOptions, planOptions, canEdit, customized }: Props) {
  const router = useRouter();
  const [content, setContent] = useState<OnboardingContentFull>(initial);
  const [section, setSection] = useState<Section>("tur");
  const [tourId, setTourId] = useState<TourId>(tourOrder[0] ?? "ofis-sahibi");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const ro = !canEdit || pending;

  const tour = content.tours[tourId];
  const setTour = (patch: Partial<TourContent>) => {
    setMsg(null);
    setContent((c) => ({ ...c, tours: { ...c.tours, [tourId]: { ...c.tours[tourId], ...patch } } }));
  };
  const setStep = (i: number, patch: Partial<TourStepContent>) => setTour({ steps: tour.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const setCheck = (i: number, patch: Partial<ChecklistStepContent>) => {
    setMsg(null);
    setContent((c) => ({ ...c, checklist: c.checklist.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  };

  const save = () =>
    start(async () => {
      // Seçici alanı yazarken ham satırları tutar (boşluk/yeni satır anında silinmesin); temizlik kayıtta yapılır.
      const clean: OnboardingContentFull = {
        ...content,
        tours: Object.fromEntries(
          Object.entries(content.tours).map(([k, t]) => [
            k,
            { ...t, steps: t.steps.map((st) => ({ ...st, selectors: st.selectors.map((x) => x.trim()).filter(Boolean) })) },
          ]),
        ) as OnboardingContentFull["tours"],
      };
      const res = await saveOnboardingContent({ content: clean, reason });
      setMsg(res.error ? { tone: "danger", text: res.error } : { tone: "success", text: res.message ?? "Kaydedildi." });
    });
  const reset = async () => {
    const res = await resetOnboardingContent({ reason });
    if (res.error) return setMsg({ tone: "danger", text: res.error });
    setContent(defaults);
    setMsg({ tone: "success", text: res.message ?? "Varsayılana dönüldü." });
    router.refresh();
  };

  const tabClass = (on: boolean) =>
    cn("rounded-full", on ? "bg-surface text-ink-950 shadow-[var(--shadow-xs)]" : "text-text-muted");

  return (
    <div className="space-y-4">
      {!canEdit ? (
        <Alert tone="info">Salt okunur: tur ve kurulum içeriğini yalnız süper admin ve operasyon ekibi düzenleyebilir.</Alert>
      ) : null}
      <div role="group" aria-label="İçerik türü" className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas p-1">
        <Button variant="ghost" size="sm" icon={MapIcon} aria-pressed={section === "tur"} className={tabClass(section === "tur")} onClick={() => setSection("tur")}>
          Ürün turları
        </Button>
        <Button variant="ghost" size="sm" icon={ListChecks} aria-pressed={section === "kurulum"} className={tabClass(section === "kurulum")} onClick={() => setSection("kurulum")}>
          Kurulum adımları
        </Button>
      </div>

      {section === "tur" ? (
        <section className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Tur seçimi">
            {tourOrder.map((id) => (
              <Button key={id} size="sm" variant={id === tourId ? "primary" : "secondary"} onClick={() => setTourId(id)}>
                {content.tours[id].label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-text-muted">
            Bu turu varsayılan gören roller: {tourRoles[tourId].map((r) => r.label).join(", ")}. Kullanıcının menüsünde olmayan sayfanın adımı
            ayrıca kendiliğinden atlanır.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Tur adı" htmlFor="tour-label">
              <Input id="tour-label" value={tour.label} maxLength={60} disabled={ro} onChange={(e) => setTour({ label: e.target.value })} />
            </FormField>
            <FormField label="Tur açıklaması (Yardım sayfasındaki kart)" htmlFor="tour-desc">
              <Input id="tour-desc" value={tour.description} maxLength={200} disabled={ro} onChange={(e) => setTour({ description: e.target.value })} />
            </FormField>
          </div>
          <ol className="space-y-3">
            {tour.steps.map((s, i) => {
              const id = `t-${tourId}-${i}`;
              return (
                <li key={i} className={cn("space-y-3 rounded-[var(--radius-card)] border border-line bg-canvas p-4", !s.enabled && "opacity-70")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink-950 touch:min-h-11">
                      <Checkbox checked={s.enabled} disabled={ro} onChange={(e) => setStep(i, { enabled: e.target.checked })} />
                      {i + 1}. adım {s.enabled ? "" : "(kapalı)"}
                    </label>
                    <RowTools
                      index={i}
                      count={tour.steps.length}
                      label={`${i + 1}. adım`}
                      disabled={ro}
                      onMove={(d) => setTour({ steps: move(tour.steps, i, d) })}
                      onRemove={() => setTour({ steps: tour.steps.filter((_, k) => k !== i) })}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label="Başlık" htmlFor={`${id}-title`}>
                      <Input id={`${id}-title`} value={s.title} maxLength={80} disabled={ro} onChange={(e) => setStep(i, { title: e.target.value })} />
                    </FormField>
                    <FormField label="Sayfa" htmlFor={`${id}-path`} hint="Menüdeki /app yolu (ör. /app/musteriler).">
                      <Input id={`${id}-path`} value={s.path} maxLength={200} disabled={ro} onChange={(e) => setStep(i, { path: e.target.value })} />
                    </FormField>
                    <FormField label="Açıklama" htmlFor={`${id}-desc`} className="sm:col-span-2">
                      <Textarea id={`${id}-desc`} value={s.desc} maxLength={400} disabled={ro} className="min-h-16" onChange={(e) => setStep(i, { desc: e.target.value })} />
                    </FormField>
                    <FormField label="Telefonda açıklama (isteğe bağlı)" htmlFor={`${id}-mob`} hint="Boşsa telefonda da üstteki açıklama görünür.">
                      <Textarea id={`${id}-mob`} value={s.descMobile ?? ""} maxLength={400} disabled={ro} className="min-h-16" onChange={(e) => setStep(i, { descMobile: e.target.value })} />
                    </FormField>
                    <FormField label="Vurgulanacak öğe (her satıra bir seçici)" htmlFor={`${id}-sel`} hint='Sırayla denenir; ör. [data-tour="brifing"] ya da #main-content h1.'>
                      <Textarea
                        id={`${id}-sel`}
                        value={s.selectors.join("\n")}
                        disabled={ro}
                        className="min-h-16 font-mono text-xs"
                        onChange={(e) => setStep(i, { selectors: e.target.value.split("\n") })}
                      />
                    </FormField>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TargetPicker legend="Rol hedefi" options={tourRoles[tourId]} value={s.roles} disabled={ro} hint="Boş: turun tüm rolleri görür." onChange={(roles) => setStep(i, { roles })} />
                    <TargetPicker legend="Paket hedefi" options={planOptions} value={s.plans} disabled={ro} hint="Boş: tüm paketler görür." onChange={(plans) => setStep(i, { plans })} />
                  </div>
                </li>
              );
            })}
          </ol>
          {tour.steps.length === 0 ? <p className="text-sm text-text-muted">Bu turda adım yok; tur ofislerde açılmaz.</p> : null}
          <Button
            variant="outline"
            size="sm"
            icon={Plus}
            disabled={ro || tour.steps.length >= 12}
            onClick={() =>
              setTour({
                steps: [
                  ...tour.steps,
                  { path: "/app", selectors: ["#main-content h1"], title: "Yeni adım", desc: "Bu sayfada ne yapılacağını kısaca anlatın.", enabled: true, roles: [], plans: [] },
                ],
              })
            }
          >
            Adım ekle
          </Button>
        </section>
      ) : (
        <section className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <p className="text-xs text-text-muted">
            Kurulum sihirbazı, ana ekrandaki Başlangıç kartı ve ilerleme yüzdesi bu listeyi kullanır. Adımın &quot;tamamlandı&quot; kuralı ve gereken
            yetki kodda kalır; kapatılan ya da hedef dışında kalan adım yüzdeye sayılmaz.
          </p>
          <ol className="space-y-3">
            {content.checklist.map((s, i) => {
              const id = `c-${s.id}`;
              return (
                <li key={s.id} className={cn("space-y-3 rounded-[var(--radius-card)] border border-line bg-canvas p-4", !s.enabled && "opacity-70")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink-950 touch:min-h-11">
                      <Checkbox checked={s.enabled} disabled={ro} onChange={(e) => setCheck(i, { enabled: e.target.checked })} />
                      {i + 1}. {s.short} {s.enabled ? "" : "(kapalı)"}
                    </label>
                    <RowTools
                      index={i}
                      count={content.checklist.length}
                      label={s.short}
                      disabled={ro}
                      onMove={(d) => {
                        setMsg(null);
                        setContent((c) => ({ ...c, checklist: move(c.checklist, i, d) }));
                      }}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label="Kısa ad (ilerleme şeridi)" htmlFor={`${id}-short`}>
                      <Input id={`${id}-short`} value={s.short} maxLength={30} disabled={ro} onChange={(e) => setCheck(i, { short: e.target.value })} />
                    </FormField>
                    <FormField label="Başlık" htmlFor={`${id}-title`}>
                      <Input id={`${id}-title`} value={s.title} maxLength={80} disabled={ro} onChange={(e) => setCheck(i, { title: e.target.value })} />
                    </FormField>
                    <FormField label="Açıklama" htmlFor={`${id}-desc`} className="sm:col-span-2">
                      <Textarea id={`${id}-desc`} value={s.description} maxLength={300} disabled={ro} className="min-h-16" onChange={(e) => setCheck(i, { description: e.target.value })} />
                    </FormField>
                    <FormField label="Hedef sayfa (isteğe bağlı)" htmlFor={`${id}-href`} hint="Adımın kendi formu yoksa sihirbazın 'Aç' düğmesi buraya götürür.">
                      <Input id={`${id}-href`} value={s.href ?? ""} maxLength={200} disabled={ro} onChange={(e) => setCheck(i, { href: e.target.value })} />
                    </FormField>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TargetPicker legend="Rol hedefi" options={roleOptions} value={s.roles} disabled={ro} hint="Boş: adımı yapma yetkisi olan herkes görür." onChange={(roles) => setCheck(i, { roles })} />
                    <TargetPicker legend="Paket hedefi" options={planOptions} value={s.plans} disabled={ro} hint="Boş: tüm paketler görür." onChange={(plans) => setCheck(i, { plans })} />
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {canEdit ? (
        <div className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <FormField label="Değişiklik notu (isteğe bağlı)" htmlFor="content-reason" hint="Ayar geçmişinde ve denetim izinde görünür.">
            <Input id="content-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={Save} loading={pending} onClick={save}>
              Kaydet
            </Button>
            {customized ? (
              <ConfirmDialog
                trigger={
                  <Button variant="outline" icon={RotateCcw} disabled={pending}>
                    Varsayılana dön
                  </Button>
                }
                title="Varsayılan içeriğe dönülsün mü?"
                description="Tüm turlar ve kurulum adımları koddaki metin ve sıraya döner. Önceki sürüm ayar geçmişinde kalır."
                confirmLabel="Varsayılana dön"
                onConfirm={reset}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
