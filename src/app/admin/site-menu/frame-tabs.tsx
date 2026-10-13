"use client";

import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Link2, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PLANS } from "@/lib/billing/plans";
import { OG_THEME } from "@/lib/brand/og-theme";
import { readUtm, withUtm } from "@/lib/site-menu/announcements";
import { moveInArray } from "@/lib/site-menu/editor-model";
import { DEFAULT_CTAS, FOOTER_BADGE_ICONS, LIMITS, type CtaKey, type FooterBadgeIcon, type Issue } from "@/lib/site-menu/schema-core";
import type { SiteMenuConfig } from "@/lib/site-menu/schema";
import { Field, FieldIssue, InlineConfirm } from "./editor-ui";
import type { Update } from "./menu-tab";

/**
 * Site çerçevesi sekmeleri: alt bilgi marka bloğu, dönüşüm düğmeleri, paylaşım kartı (canlı 1200x630 önizleme), 404 sayfası.
 * Hepsi aynı taslak/yayın/geçmiş akışına yazar (site-menu-editor.tsx). Metinler düz metindir; bağlantılar yalnız site yolu
 * veya https olabilir (javascript:/data: vb. kaydedilemez). Riskli iddia kelimeleri uyarı verir, kaydı engellemez.
 */

type Props = { cfg: SiteMenuConfig; update: Update; issues: readonly Issue[]; readOnly: boolean };

export const selectCls =
  "focus-ring surface-sunken h-10 w-full rounded-[var(--radius-control)] border border-hairline px-2.5 text-sm text-ink-950 disabled:opacity-60";
export const textareaCls =
  "focus-ring surface-sunken w-full rounded-[var(--radius-control)] border border-hairline px-2.5 py-2 text-sm text-ink-950 disabled:opacity-60";

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-label={title}>
      <div>
        <h3 className="font-display text-sm font-extrabold text-ink-950">{title}</h3>
        {hint ? <p className="mt-0.5 text-xs text-text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={`text-xs ${value.length > max ? "font-bold text-danger-500" : "text-text-faint"}`}>{value.length}/{max}</span>;
}

/** UTM oluşturucu: plan, utm_source, utm_campaign alanlarından bağlantıyı üretir (yalnız "Uygula" ile yazılır). */
export function UtmBuilder({ href, onApply, disabled }: { href: string; onApply: (next: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState("");
  const [source, setSource] = useState("");
  const [campaign, setCampaign] = useState("");
  const next = withUtm(href, { plan, source, campaign });
  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={disabled}
        onClick={() => {
          // Alanlar bağlantının mevcut değerleriyle açılır: yalnız birini değiştirmek diğerlerini sessizce silmez.
          const cur = readUtm(href);
          setPlan(cur.plan);
          setSource(cur.source);
          setCampaign(cur.campaign);
          setOpen(true);
        }}
      >
        <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> UTM oluştur
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-[var(--radius-card)] border border-dashed border-line p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Plan">
          <select className={selectCls} value={plan} disabled={disabled} onChange={(e) => setPlan(e.target.value)}>
            <option value="">Plan seçilmesin</option>
            {PLANS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="utm_source">
          <Input value={source} disabled={disabled} placeholder="ör. instagram" onChange={(e) => setSource(e.target.value)} />
        </Field>
        <Field label="utm_campaign">
          <Input value={campaign} disabled={disabled} placeholder="ör. ekim-kampanyasi" onChange={(e) => setCampaign(e.target.value)} />
        </Field>
      </div>
      <p className="break-all text-xs text-text-muted">
        Sonuç: <code className="font-mono text-ink-950">{next}</code>
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="primary"
          size="xs"
          disabled={disabled || next === href}
          onClick={() => {
            onApply(next);
            setOpen(false);
          }}
        >
          Bağlantıya uygula
        </Button>
        <Button type="button" variant="ghost" size="xs" onClick={() => setOpen(false)}>Kapat</Button>
      </div>
    </div>
  );
}

const BADGE_ICON_LABELS: Record<FooterBadgeIcon, string> = {
  "shield-check": "Kalkan",
  scale: "Terazi",
  "file-signature": "İmza",
  check: "Onay",
  clock: "Saat",
  none: "İkon yok",
};

export function BrandTab({ cfg, update, issues, readOnly }: Props) {
  const b = cfg.footerBrand;
  const set = (fn: (x: SiteMenuConfig["footerBrand"]) => void) => update((d) => fn(d.footerBrand));
  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">
        Alt bilginin sol bloğu: logo altındaki açıklama, güven rozetleri, düğme, telif ve yasal not. Ana sayfa (statik sürüm dahil) ve tüm herkese açık sayfalarda görünür.
      </p>
      <Panel title="Açıklama ve rozetler">
        <Field label="Marka açıklaması">
          <textarea className={textareaCls} rows={3} value={b.description} disabled={readOnly} onChange={(e) => set((x) => { x.description = e.target.value; })} />
          <Counter value={b.description} max={LIMITS.footerDescription} />
          <FieldIssue issues={issues} path="footerBrand.description" />
        </Field>
        <ul className="space-y-2" aria-label="Güven rozetleri">
          {b.badges.map((badge, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2 rounded-[var(--radius-card)] border border-line p-2">
              <div className="min-w-[10rem] flex-1">
                <Field label={`Rozet ${i + 1}`}>
                  <Input value={badge.label} disabled={readOnly} onChange={(e) => set((x) => { x.badges[i].label = e.target.value; })} />
                  <FieldIssue issues={issues} path={`footerBrand.badges.${i}.label`} />
                </Field>
              </div>
              <div className="w-36">
                <Field label="İkon">
                  <select className={selectCls} value={badge.icon} disabled={readOnly} onChange={(e) => set((x) => { x.badges[i].icon = e.target.value as FooterBadgeIcon; })}>
                    {FOOTER_BADGE_ICONS.map((ic) => (
                      <option key={ic} value={ic}>{BADGE_ICON_LABELS[ic]}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="flex items-center gap-1">
                <Button type="button" variant="outline" size="icon" disabled={readOnly || i === 0} aria-label="Yukarı taşı" onClick={() => set((x) => { x.badges = moveInArray(x.badges, i, i - 1); })}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                <Button type="button" variant="outline" size="icon" disabled={readOnly || i === b.badges.length - 1} aria-label="Aşağı taşı" onClick={() => set((x) => { x.badges = moveInArray(x.badges, i, i + 1); })}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                <InlineConfirm label="Sil" confirmLabel="Evet, sil" tone="danger" disabled={readOnly} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={() => set((x) => { x.badges.splice(i, 1); })} />
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Button type="button" variant="primary" size="sm" disabled={readOnly || b.badges.length >= LIMITS.maxFooterBadges} onClick={() => set((x) => { x.badges.push({ label: "Yeni rozet", icon: "check" }); })}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Rozet ekle
          </Button>
          <span className="text-xs text-text-faint">{b.badges.length}/{LIMITS.maxFooterBadges}</span>
        </div>
      </Panel>

      <Panel title="Düğme">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Düğme metni (en çok ${LIMITS.footerCta})`}>
            <Input value={b.cta.label} disabled={readOnly} onChange={(e) => set((x) => { x.cta.label = e.target.value; })} />
            <FieldIssue issues={issues} path="footerBrand.cta.label" />
          </Field>
          <Field label="Hedef (site yolu veya https)">
            <Input list="site-menu-targets" value={b.cta.href} disabled={readOnly} onChange={(e) => set((x) => { x.cta.href = e.target.value; })} />
            <FieldIssue issues={issues} path="footerBrand.cta.href" />
          </Field>
        </div>
        <UtmBuilder href={b.cta.href} disabled={readOnly} onApply={(h) => set((x) => { x.cta.href = h; })} />
      </Panel>

      <Panel title="Alt satır ve iletişim">
        <Field label="Telif satırı" hint="{yil} yazdığınız yere bu yıl gelir (Türkiye saati).">
          <Input value={b.copyright} disabled={readOnly} onChange={(e) => set((x) => { x.copyright = e.target.value; })} />
          <FieldIssue issues={issues} path="footerBrand.copyright" />
        </Field>
        <Field label="Yasal not">
          <textarea className={textareaCls} rows={2} value={b.disclaimer} disabled={readOnly} onChange={(e) => set((x) => { x.disclaimer = e.target.value; })} />
          <Counter value={b.disclaimer} max={LIMITS.disclaimer} />
          <FieldIssue issues={issues} path="footerBrand.disclaimer" />
        </Field>
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-950">
          <input type="checkbox" className="h-4 w-4" checked={b.showContact} disabled={readOnly} onChange={(e) => set((x) => { x.showContact = e.target.checked; })} />
          İletişim ve sosyal medya satırını göster
        </label>
        <p className="text-xs text-text-muted">E-posta, telefon ve sosyal hesaplar SEO yönetimindeki kurum bilgisinden (Kurum: e-posta, telefon, sameAs) okunur; burada ayrıca yazılmaz.</p>
      </Panel>
    </div>
  );
}

const CTA_ROWS: Array<{ key: CtaKey; title: string; where: string }> = [
  { key: "login", title: "Giriş (masaüstü)", where: "Üst bar ve mobil menü çekmecesi" },
  { key: "trial", title: "Ücretsiz dene (ana düğme)", where: "Üst bar, mega menü alt çubuğu ve mobil menü çekmecesi" },
  { key: "mobileLogin", title: "Giriş (mobil)", where: "Mobil üst bar ve mobil alt çubuk" },
  { key: "mobileTrial", title: "Deneme (mobil alt çubuk)", where: "Mobil alt çubuk; boş bırakılırsa deneme günüyle otomatik" },
];

export function CtaTab({ cfg, update, issues, readOnly }: Props) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">
        Sitenin dönüşüm düğmeleri. Hedef bir site yolu (ör. /kayit?plan=office) veya https adresi olabilir; UTM oluşturucu kampanya bağlantısını hazırlar.
      </p>
      {CTA_ROWS.map(({ key, title, where }) => {
        const c = cfg.ctas[key];
        return (
          <Panel key={key} title={title} hint={where}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Metin (en çok ${LIMITS.ctaLabel})`}>
                <Input
                  value={c.label}
                  disabled={readOnly}
                  placeholder={key === "mobileTrial" ? "Otomatik: Ücretsiz dene — N gün" : DEFAULT_CTAS[key].label}
                  onChange={(e) => update((d) => { d.ctas[key].label = e.target.value; })}
                />
                <FieldIssue issues={issues} path={`ctas.${key}.label`} />
              </Field>
              <Field label="Hedef (site yolu veya https)">
                <Input list="site-menu-targets" value={c.href} disabled={readOnly} onChange={(e) => update((d) => { d.ctas[key].href = e.target.value; })} />
                <FieldIssue issues={issues} path={`ctas.${key}.href`} />
              </Field>
            </div>
            <UtmBuilder href={c.href} disabled={readOnly} onApply={(h) => update((d) => { d.ctas[key].href = h; })} />
          </Panel>
        );
      })}
    </div>
  );
}

/** Paylaşım kartının editör içi ölçekli kopyası (1200x630 düzeni og-card.tsx ile aynı; görüntü üretilmez). */
function OgPreview({ card }: { card: SiteMenuConfig["ogCard"] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / 1200));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={boxRef} className="relative w-full overflow-hidden rounded-[var(--radius-card)] border border-line" style={{ aspectRatio: "1200 / 630" }} aria-label="Paylaşım kartı önizlemesi" role="img">
      <div
        className="absolute left-0 top-0 flex flex-col justify-between overflow-hidden"
        style={{
          width: 1200,
          height: 630,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          padding: 72,
          background: OG_THEME.background,
          color: OG_THEME.text,
        }}
      >
        <div style={{ position: "absolute", top: -160, right: -120, width: 520, height: 520, borderRadius: "50%", background: OG_THEME.glowBlue }} />
        <div style={{ position: "absolute", bottom: -200, left: -140, width: 480, height: 480, borderRadius: "50%", background: OG_THEME.glowGold }} />
        {/* eslint-disable-next-line @next/next/no-img-element -- önizleme: varsayılan koyu logo */}
        <img src="/brand/logo-horizontal-dark.svg" alt="" style={{ height: 72, width: "auto", position: "relative", alignSelf: "flex-start" }} />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="font-display" style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5, maxWidth: 900 }}>{card.title}</div>
          {card.subtitle ? <div style={{ fontSize: 30, color: OG_THEME.subtitle, maxWidth: 880, lineHeight: 1.35 }}>{card.subtitle}</div> : null}
        </div>
        <div style={{ position: "relative", display: "flex", gap: 14 }}>
          {card.chips.map((t, i) => (
            <div key={i} style={{ fontSize: 24, fontWeight: 600, padding: "12px 22px", borderRadius: 999, border: OG_THEME.chipBorder, background: OG_THEME.chipBackground, color: OG_THEME.chipText }}>{t}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OgCardTab({ cfg, update, issues, readOnly }: Props) {
  const og = cfg.ogCard;
  const set = (fn: (x: SiteMenuConfig["ogCard"]) => void) => update((d) => fn(d.ogCard));
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Panel title="Kart metni" hint="Bağlantı WhatsApp, LinkedIn, X gibi yerlerde paylaşılınca görünen 1200x630 kart (/opengraph-image). Logo marka ayarından gelir.">
        <Field label={`Başlık (en çok ${LIMITS.ogTitle})`}>
          <Input value={og.title} disabled={readOnly} onChange={(e) => set((x) => { x.title = e.target.value; })} />
          <FieldIssue issues={issues} path="ogCard.title" />
        </Field>
        <Field label={`Alt başlık (en çok ${LIMITS.ogSubtitle})`}>
          <textarea className={textareaCls} rows={2} value={og.subtitle} disabled={readOnly} onChange={(e) => set((x) => { x.subtitle = e.target.value; })} />
          <Counter value={og.subtitle} max={LIMITS.ogSubtitle} />
          <FieldIssue issues={issues} path="ogCard.subtitle" />
        </Field>
        <ul className="space-y-2" aria-label="Kart rozetleri">
          {og.chips.map((c, i) => (
            <li key={i} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field label={`Rozet ${i + 1} (en çok ${LIMITS.ogChip})`}>
                  <Input value={c} disabled={readOnly} onChange={(e) => set((x) => { x.chips[i] = e.target.value; })} />
                  <FieldIssue issues={issues} path={`ogCard.chips.${i}`} />
                </Field>
              </div>
              <InlineConfirm label="Sil" confirmLabel="Evet, sil" tone="danger" disabled={readOnly} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={() => set((x) => { x.chips.splice(i, 1); })} />
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Button type="button" variant="primary" size="sm" disabled={readOnly || og.chips.length >= LIMITS.maxOgChips} onClick={() => set((x) => { x.chips.push("Yeni rozet"); })}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Rozet ekle
          </Button>
          <span className="text-xs text-text-faint">{og.chips.length}/{LIMITS.maxOgChips}</span>
        </div>
      </Panel>
      <Panel title="Canlı önizleme" hint="Ölçekli kopya; yayından sonra paylaşım sitelerinin önbelleği birkaç saat eski kartı gösterebilir.">
        <OgPreview card={og} />
      </Panel>
    </div>
  );
}

export function NotFoundTab({ cfg, update, issues, readOnly }: Props) {
  const nf = cfg.notFound;
  const set = (fn: (x: SiteMenuConfig["notFound"]) => void) => update((d) => fn(d.notFound));
  return (
    <div className="space-y-4">
      <Panel title="Metin" hint="Bulunamayan bir adrese gidildiğinde görünen sayfa. Ana sayfa ve Giriş düğmeleri her zaman görünür.">
        <Field label={`Başlık (en çok ${LIMITS.notFoundTitle})`}>
          <Input value={nf.title} disabled={readOnly} onChange={(e) => set((x) => { x.title = e.target.value; })} />
          <FieldIssue issues={issues} path="notFound.title" />
        </Field>
        <Field label={`Açıklama (en çok ${LIMITS.notFoundText})`}>
          <textarea className={textareaCls} rows={3} value={nf.text} disabled={readOnly} onChange={(e) => set((x) => { x.text = e.target.value; })} />
          <Counter value={nf.text} max={LIMITS.notFoundText} />
          <FieldIssue issues={issues} path="notFound.text" />
        </Field>
      </Panel>
      <Panel title="Popüler bağlantılar" hint="İkon hedefe göre seçilir (Fiyatlar, Kayıt, Araçlar; diğerleri pusula).">
        <ul className="space-y-2">
          {nf.links.map((l, i) => (
            <li key={i} className="flex flex-wrap items-start gap-2 rounded-[var(--radius-card)] border border-line p-2">
              <div className="grid min-w-[10rem] flex-1 gap-2 sm:grid-cols-3">
                <Field label="Ad">
                  <Input value={l.label} disabled={readOnly} onChange={(e) => set((x) => { x.links[i].label = e.target.value; })} />
                  <FieldIssue issues={issues} path={`notFound.links.${i}.label`} />
                </Field>
                <Field label="Kısa açıklama">
                  <Input value={l.desc} disabled={readOnly} onChange={(e) => set((x) => { x.links[i].desc = e.target.value; })} />
                </Field>
                <Field label="Hedef (site yolu veya https)">
                  <Input list="site-menu-targets" value={l.href} disabled={readOnly} onChange={(e) => set((x) => { x.links[i].href = e.target.value; })} />
                  <FieldIssue issues={issues} path={`notFound.links.${i}.href`} />
                </Field>
              </div>
              <div className="flex items-center gap-1 pt-5">
                <Button type="button" variant="outline" size="icon" disabled={readOnly || i === 0} aria-label="Yukarı taşı" onClick={() => set((x) => { x.links = moveInArray(x.links, i, i - 1); })}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                <Button type="button" variant="outline" size="icon" disabled={readOnly || i === nf.links.length - 1} aria-label="Aşağı taşı" onClick={() => set((x) => { x.links = moveInArray(x.links, i, i + 1); })}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                <InlineConfirm label="Sil" confirmLabel="Evet, sil" tone="danger" disabled={readOnly} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={() => set((x) => { x.links.splice(i, 1); })} />
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Button type="button" variant="primary" size="sm" disabled={readOnly || nf.links.length >= LIMITS.maxNotFoundLinks} onClick={() => set((x) => { x.links.push({ label: "Yeni bağlantı", desc: "", href: "/" }); })}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Bağlantı ekle
          </Button>
          <span className="text-xs text-text-faint">{nf.links.length}/{LIMITS.maxNotFoundLinks}</span>
        </div>
      </Panel>
    </div>
  );
}
