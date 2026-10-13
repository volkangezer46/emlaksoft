"use client";

import { Button } from "@/components/ui/button";
import { useId } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { LIMITS, newCardId } from "@/lib/site-content/schema-core";
import type { SiteContent, validateSiteContent } from "@/lib/site-content/schema";
import { CARD_TONES, TONE_LABEL, isCardTone, type CardTone } from "@/lib/site-content/tones";
import { isMenuIconName, type MenuIconName } from "@/lib/site-menu/icon-registry";
import { IconPicker } from "../site-menu/editor-ui";
import { Card, Full, ListShell, Txt, type Update } from "./editor-fields";

/**
 * Ana sayfa kart görünümü (ikon + ton), portal şeridi ve kanıtlı müşteri yorumları editörleri.
 * İkon site menüsünün kontrollü listesinden, ton kapalı listeden seçilir; serbest sınıf/renk girilemez.
 */

type TabProps = { cfg: SiteContent; update: Update; issues: ReturnType<typeof validateSiteContent>["issues"]; readOnly: boolean };

const selectCls =
  "focus-ring surface-sunken h-10 w-full rounded-[var(--radius-control)] border border-hairline px-2.5 text-sm text-ink-950 disabled:opacity-60";

/** İkon (+ isteğe bağlı ton) seçimi. Boş = bilinen kartta bugünkü görünüm, yeni kartta bileşenin varsayılanı. */
export function LookFields({
  icon,
  tone,
  withTone,
  onIcon,
  onTone,
  readOnly,
}: {
  icon?: MenuIconName;
  tone?: CardTone;
  withTone: boolean;
  onIcon: (v: MenuIconName | undefined) => void;
  onTone: (v: CardTone | undefined) => void;
  readOnly: boolean;
}) {
  const toneId = useId();
  return (
    <>
      <div className="min-w-0">
        <p className="mb-1 text-xs font-semibold text-ink-950">İkon <span className="font-normal text-text-faint">(“Yok” = varsayılan ikon)</span></p>
        <IconPicker
          value={icon ? { kind: "lucide", name: icon } : { kind: "none" }}
          onChange={(v) => onIcon(v.kind === "lucide" && isMenuIconName(v.name) ? v.name : undefined)}
          onMedia={() => undefined}
          readOnlyMediaOk={false}
          disabled={readOnly}
        />
      </div>
      {withTone ? (
        <div className="min-w-0">
          <label htmlFor={toneId} className="mb-1 block text-xs font-semibold text-ink-950">Renk tonu</label>
          <select id={toneId} className={selectCls} disabled={readOnly} value={tone ?? ""} onChange={(e) => onTone(isCardTone(e.target.value) ? e.target.value : undefined)}>
            <option value="">Varsayılan</option>
            {CARD_TONES.map((t) => <option key={t} value={t}>{TONE_LABEL[t]}</option>)}
          </select>
        </div>
      ) : <div className="hidden sm:block" />}
    </>
  );
}

/** İsteğe bağlı alanı ayarlar/siler (undefined yazmak yerine anahtarı kaldırır: taslak JSON'u temiz kalır). */
export function setOpt<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined): void {
  if (value === undefined) delete obj[key];
  else obj[key] = value;
}

/** Hero altı portal şeridi: "Gizle" en üstte (hukuki itirazda tek tık). */
export function PortalStripCard({ cfg, update, issues, readOnly }: TabProps) {
  const s = cfg.hero.portalStrip;
  const f = { issues, readOnly };
  return (
    <Card
      title="Portal şeridi"
      aside={
        <label className="flex items-center gap-2 text-xs font-semibold text-ink-950">
          <input type="checkbox" disabled={readOnly} checked={s.hidden} onChange={(e) => update((d) => void (d.hero.portalStrip.hidden = e.target.checked))} />
          Gizle
        </label>
      }
    >
      <Full>
        <p className="text-xs text-text-muted">
          Marka adları yalnız ilan takibi için anılır; logo kullanılmaz. Bir portal itiraz ederse adını silin ya da şeridi tümden gizleyin.
          {s.hidden ? " Şerit şu an gizli: ana sayfada görünmez." : ""}
        </p>
      </Full>
      <Full><Txt label="Başlık" value={s.title} max={LIMITS.title} onChange={(v) => update((d) => void (d.hero.portalStrip.title = v))} path="hero.portalStrip.title" {...f} /></Full>
      <Full><Txt label="Açıklama" multiline value={s.text} max={LIMITS.text} onChange={(v) => update((d) => void (d.hero.portalStrip.text = v))} path="hero.portalStrip.text" {...f} /></Full>
      <Full><Txt label="Dipnot" multiline value={s.note} max={LIMITS.note} onChange={(v) => update((d) => void (d.hero.portalStrip.note = v))} path="hero.portalStrip.note" {...f} /></Full>
      <Full>
        <p className="mb-1 text-xs font-semibold text-ink-950">Portallar ({s.portals.length}/{LIMITS.maxPortals}) <span className="font-normal text-text-faint">· sonda her zaman “+ diğer portallar” çipi görünür</span></p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {s.portals.map((p, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <div className="min-w-0 flex-1">
                <Txt label={`Portal ${i + 1}`} value={p.name} max={LIMITS.portalName} onChange={(v) => update((d) => void (d.hero.portalStrip.portals[i]!.name = v))} path={`hero.portalStrip.portals.${i}.name`} {...f} />
              </div>
              {!readOnly ? (
                <Button type="button" variant="outline" size="icon" className="mt-5" aria-label={`${p.name || "Portal"} sil`} onClick={() => update((d) => void d.hero.portalStrip.portals.splice(i, 1))}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {!readOnly ? (
          <Button type="button" variant="outline" size="sm" className="mt-2" disabled={s.portals.length >= LIMITS.maxPortals} onClick={() => update((d) => void d.hero.portalStrip.portals.push({ name: "" }))}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Portal ekle
          </Button>
        ) : null}
      </Full>
    </Card>
  );
}

function DateField({ label, value, onChange, path, issues, readOnly }: { label: string; value: string; onChange: (v: string) => void; path: string; issues: TabProps["issues"]; readOnly: boolean }) {
  const id = useId();
  const err = issues.find((i) => i.path === path && i.level === "error");
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-ink-950">{label}</label>
      <Input id={id} type="date" value={value} readOnly={readOnly} aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-e` : undefined} onChange={(e) => onChange(e.target.value)} />
      {err ? (
        <span id={`${id}-e`} role="alert" className="mt-1 flex items-start gap-1 text-xs font-semibold text-danger-500">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {err.message}
        </span>
      ) : null}
    </div>
  );
}

/** Kanıtlı müşteri yorumları: yalnız yazılı onayı olan gerçek kişiler. Puan alanı yok. */
export function TestimonialsTab({ cfg, update, issues, readOnly }: TabProps) {
  const t = cfg.testimonials;
  const f = { issues, readOnly };
  const sectionOn = cfg.layout.some((s) => s.id === "testimonials" && !s.hidden);
  return (
    <>
      <div className="rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
        <p className="flex items-start gap-1.5 font-bold">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Yalnız yazılı onayı olan gerçek müşteri yorumu ekleyin. Onay tarihi ve onayın kaynağı (ör. “e-posta onayı 2026-10-01”) zorunludur; bunlar sayfada gösterilmez, kanıt olarak saklanır.
        </p>
        <p className="mt-1">Puan/yıldız alanı yoktur ve arama motorlarına değerlendirme verisi gönderilmez. Bölümü “Bölüm düzeni” sekmesinden açın; görünen yorum yoksa bölüm açık olsa da çizilmez.</p>
        <p className="mt-1 font-semibold">Bölüm şu an: {sectionOn ? "açık" : "gizli"}.</p>
      </div>
      <Card title="Bölüm başlığı">
        <Txt label="Üst başlık" value={t.heading.eyebrow} max={LIMITS.eyebrow} onChange={(v) => update((d) => void (d.testimonials.heading.eyebrow = v))} path="testimonials.heading.eyebrow" {...f} />
        <div className="hidden sm:block" />
        <Txt label="Başlık (başı)" value={t.heading.title} max={LIMITS.title} onChange={(v) => update((d) => void (d.testimonials.heading.title = v))} path="testimonials.heading.title" {...f} />
        <Txt label="Vurgulu kısım" value={t.heading.em} max={LIMITS.em} onChange={(v) => update((d) => void (d.testimonials.heading.em = v))} path="testimonials.heading.em" {...f} />
        <Txt label="Başlık (sonu)" value={t.heading.tail} max={LIMITS.tail} onChange={(v) => update((d) => void (d.testimonials.heading.tail = v))} path="testimonials.heading.tail" {...f} />
        <Full><Txt label="Açıklama" multiline value={t.heading.text} max={LIMITS.lead} onChange={(v) => update((d) => void (d.testimonials.heading.text = v))} path="testimonials.heading.text" {...f} /></Full>
      </Card>
      <ListShell
        title={`Yorumlar (${t.items.length}/${LIMITS.maxTestimonials})`}
        items={t.items}
        setItems={(n) => update((d) => void (d.testimonials.items = n))}
        readOnly={readOnly}
        summary={(x) => (x.name ? `${x.name}${x.office ? ` · ${x.office}` : ""}` : "")}
        render={(x, i) => {
          const p = `testimonials.items.${i}`;
          const set = (fn: (it: SiteContent["testimonials"]["items"][number]) => void) => update((d) => void fn(d.testimonials.items[i]!));
          return (
            <>
              <Full><Txt label="Yorum" multiline value={x.quote} max={LIMITS.quote} onChange={(v) => set((it) => void (it.quote = v))} path={`${p}.quote`} {...f} /></Full>
              <Txt label="Ad soyad" value={x.name} max={LIMITS.personName} onChange={(v) => set((it) => void (it.name = v))} path={`${p}.name`} {...f} />
              <Txt label="Unvan" value={x.role} max={LIMITS.personRole} onChange={(v) => set((it) => void (it.role = v))} path={`${p}.role`} {...f} />
              <Txt label="Ofis" value={x.office} max={LIMITS.office} onChange={(v) => set((it) => void (it.office = v))} path={`${p}.office`} {...f} />
              <Txt label="Şehir" value={x.city} max={LIMITS.city} onChange={(v) => set((it) => void (it.city = v))} path={`${p}.city`} {...f} />
              <DateField label="Yazılı onay tarihi (zorunlu)" value={x.consentDate} onChange={(v) => set((it) => void (it.consentDate = v))} path={`${p}.consentDate`} {...f} />
              <Txt label="Onay kaynağı (zorunlu)" value={x.source} max={LIMITS.source} onChange={(v) => set((it) => void (it.source = v))} path={`${p}.source`} hint="ör. e-posta onayı 2026-10-01" {...f} />
            </>
          );
        }}
        onAdd={() => update((d) => void d.testimonials.items.push({ id: newCardId(d.testimonials.items.map((y) => y.id)), quote: "", name: "", role: "", office: "", city: "", consentDate: "", source: "", hidden: false }))}
        addLabel="Yorum ekle"
        max={LIMITS.maxTestimonials}
      />
    </>
  );
}
