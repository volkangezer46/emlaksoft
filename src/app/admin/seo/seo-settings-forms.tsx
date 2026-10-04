"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { Switch } from "@/components/ui/switch";
import { EmailInput } from "@/components/ui/email-input";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  exportSeoSettings,
  importSeoSettings,
  regenerateIndexNowKey,
  runSeoRobotNow,
  saveSeoGlobal,
  saveSeoRobots,
  saveSeoSitemap,
  setIndexNowEnabled,
  type SeoActionResult,
} from "@/app/actions/seo-admin";
import { buildRobots, robotsToText } from "@/lib/seo/robots-rules";
import { validateJsonLd } from "@/lib/seo/jsonld";
import { AI_BOTS, type SeoGlobal, type SeoIndexNowSettings, type SeoRobotsSettings, type SeoSitemapSettings } from "@/lib/seo/schema";
import { LockedNote, ResultNote, SeoForm, SubmitButton } from "./seo-ui";

/* ------------------------------ Genel ------------------------------ */

export function GlobalForm({ value, canEdit }: { value: SeoGlobal; canEdit: boolean }) {
  const o = value.organization;
  return (
    <SeoForm action={saveSeoGlobal}>
      {!canEdit ? <LockedNote>Genel ayarları yalnız süper admin değiştirebilir; burada salt okunur görünür.</LockedNote> : null}
      <fieldset disabled={!canEdit} className="space-y-6">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Site kimliği ve varsayılanlar</CardTitle>
              <CardDescription>Sayfa kendi başlığını/açıklamasını vermediğinde bunlar kullanılır. Ayar boşken bugünkü canlı değerler geçerlidir.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <FormField label="Site adı" htmlFor="siteName"><FormInput id="siteName" name="siteName" defaultValue={value.siteName} maxLength={60} /></FormField>
            <FormField label="Başlık şablonu" htmlFor="titleTemplate" hint="%s yerine sayfa başlığı gelir. Örnek: %s | EmlakSoft">
              <FormInput id="titleTemplate" name="titleTemplate" defaultValue={value.titleTemplate} maxLength={80} />
            </FormField>
            <FormField label="Varsayılan başlık (ana sayfa)" htmlFor="defaultTitle" className="md:col-span-2">
              <FormInput id="defaultTitle" name="defaultTitle" defaultValue={value.defaultTitle} maxLength={120} />
            </FormField>
            <FormField label="Varsayılan açıklama" htmlFor="defaultDescription" hint="70-160 karakter önerilir." className="md:col-span-2">
              <FormTextarea id="defaultDescription" name="defaultDescription" rows={3} defaultValue={value.defaultDescription} maxLength={320} />
            </FormField>
            <FormField label="Varsayılan paylaşım görseli (OG)" htmlFor="ogImage" hint="Boşsa marka kartı (/opengraph-image) kullanılır; o kart Marka ayarındaki logodan üretilir. Yol (/…) ya da https adresi.">
              <FormInput id="ogImage" name="ogImage" defaultValue={value.ogImage} placeholder="/opengraph-image" />
            </FormField>
            <FormField label="X (Twitter) kullanıcı adı" htmlFor="twitterHandle" hint="@ olmadan ya da ile yazabilirsiniz; boş bırakılabilir.">
              <FormInput id="twitterHandle" name="twitterHandle" defaultValue={value.twitterHandle} maxLength={16} />
            </FormField>
            <p className="text-xs text-text-muted md:col-span-2">Dil ve ülke: tr-TR (tek dil; hreflang gerekmez). Open Graph yerel ayarı tr_TR.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Kuruluş bilgisi (Organization yapılandırılmış verisi)</CardTitle>
              <CardDescription>Yalnız doğrulanabilir bilgi girin. Boş bırakılan alan sayfaya hiç basılmaz; sahte telefon/adres/puan eklenmez.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <FormField label="Ad" htmlFor="orgName"><FormInput id="orgName" name="orgName" defaultValue={o.name} maxLength={120} /></FormField>
            <FormField label="Resmî unvan" htmlFor="orgLegalName"><FormInput id="orgLegalName" name="orgLegalName" defaultValue={o.legalName} maxLength={160} /></FormField>
            <FormField label="Logo adresi" htmlFor="orgLogo" hint="Yol (/…) ya da https adresi."><FormInput id="orgLogo" name="orgLogo" defaultValue={o.logo} /></FormField>
            <FormField label="Destek e-postası" htmlFor="orgEmail" inject={false}><EmailInput id="orgEmail" name="orgEmail" defaultValue={o.email} /></FormField>
            <FormField label="Destek telefonu" htmlFor="orgPhone" hint="Yalnız gerçekten yanıtlanan numara." inject={false}><PhoneInput id="orgPhone" name="orgPhone" defaultValue={o.phone} /></FormField>
            <FormField label="Sosyal profiller (sameAs)" htmlFor="orgSameAs" hint="Satır başına bir https adresi (en çok 10)." className="md:col-span-2">
              <FormTextarea id="orgSameAs" name="orgSameAs" rows={3} defaultValue={o.sameAs.join("\n")} />
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Arama motoru doğrulama kodları</CardTitle>
              <CardDescription>Yalnız kodun kendisini yapıştırın (meta etiketinin content değerini). Etiket otomatik eklenir.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <FormField label="Google Search Console" htmlFor="vGoogle"><FormInput id="vGoogle" name="vGoogle" defaultValue={value.verification.google} /></FormField>
            <FormField label="Bing Webmaster" htmlFor="vBing"><FormInput id="vBing" name="vBing" defaultValue={value.verification.bing} /></FormField>
            <FormField label="Yandex Webmaster" htmlFor="vYandex"><FormInput id="vYandex" name="vYandex" defaultValue={value.verification.yandex} /></FormField>
          </CardContent>
        </Card>
      </fieldset>
      {canEdit ? <SubmitButton>Genel ayarları kaydet</SubmitButton> : null}
    </SeoForm>
  );
}

/* ------------------------------ Sitemap ------------------------------ */

export type SitemapPreview = { total: number; chunks: number; sample: string[]; counts: { label: string; n: number }[] };

export function SitemapForm({ value, canEdit, preview }: { value: SeoSitemapSettings; canEdit: boolean; preview: SitemapPreview }) {
  return (
    <div className="space-y-6">
      <SeoForm action={saveSeoSitemap}>
        {!canEdit ? <LockedNote>Sitemap kapsamını yalnız süper admin değiştirebilir.</LockedNote> : null}
        <fieldset disabled={!canEdit} className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Sitemap kapsamı</CardTitle>
                <CardDescription>
                  Token’lı portallar, giriş, ödeme, imza, anket, randevu, sunum ve demo (örnek) kayıtlar bu ayarlardan bağımsız olarak ASLA sitemap’e girmez.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {(
                [
                  ["staticPages", "Statik sayfalar", "Ana sayfa, fiyatlar, demo, kayıt, yasal sayfalar (sayfa bazlı ayar Sayfalar sekmesinde).", value.staticPages],
                  ["tools", "Ücretsiz araçlar", "/araclar ve yayındaki hesaplayıcılar.", value.tools],
                  ["vitrinOffices", "Vitrin ofis sayfaları", "/vitrin/<ofis>", value.vitrinOffices],
                  ["vitrinListings", "Vitrin ilanları", "Yalnız yayındaki (live), silinmemiş, örnek olmayan ilanlar.", value.vitrinListings],
                  ["advisors", "Danışman kartvizitleri", "Yalnız yayına alınmış profiller ve kapsama giren ofisler.", value.advisors],
                ] as const
              ).map(([name, label, hint, on]) => (
                <label key={name} className="flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-line p-3">
                  <span>
                    <span className="block text-sm font-semibold text-ink-950">{label}</span>
                    <span className="block text-xs text-text-muted">{hint}</span>
                  </span>
                  <Switch name={name} defaultChecked={on} aria-label={label} />
                </label>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Ofis vitrini: opt-in</CardTitle>
                <CardDescription>
                  Varsayılan güvenli mod: yalnız aşağıya yazdığınız ofis slug’ları (vitrin, ilanları ve danışmanları) sitemap’e girer. Kapatırsanız tüm aktif ofisler girer.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-ink-950">Yalnız opt-in ofisler (önerilen)</span>
                <Switch name="onlyOptIn" defaultChecked={value.onlyOptIn} aria-label="Yalnız opt-in ofisler" />
              </label>
              <FormField label="Opt-in ofis slug listesi" htmlFor="optInTenantSlugs" hint="YEDEK liste: ofis ayarındaki \"vitrinim aramalarda görünsün\" onayı (Ayarlar, Vitrin) asıl kaynaktır; veritabanı güncellemesi uygulanana kadar yalnız bu liste geçerlidir. Satır başına bir slug; ofis sahibinin onayı olmadan eklemeyin.">
                <FormTextarea id="optInTenantSlugs" name="optInTenantSlugs" rows={4} defaultValue={value.optInTenantSlugs.join("\n")} />
              </FormField>
              <FormField label="Parça başına en çok URL" htmlFor="maxUrlsPerSitemap" hint="1.000 - 50.000. Aşılırsa sitemap indeksi ve /sitemap/1.xml, /sitemap/2.xml parçaları otomatik oluşur.">
                <FormInput id="maxUrlsPerSitemap" name="maxUrlsPerSitemap" type="number" min={1000} max={50000} defaultValue={value.maxUrlsPerSitemap} className="max-w-40" />
              </FormField>
            </CardContent>
          </Card>
        </fieldset>
        {canEdit ? <SubmitButton>Sitemap ayarlarını kaydet</SubmitButton> : null}
      </SeoForm>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Canlı önizleme</CardTitle>
            <CardDescription>
              Şu an üretilen sitemap: {preview.total} adres, {preview.chunks} parça.{" "}
              <a href="/sitemap.xml" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
                sitemap.xml <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="flex flex-wrap gap-2">
            {preview.counts.map((c) => (
              <li key={c.label} className="rounded-full border border-line px-2.5 py-0.5 text-xs font-semibold text-text-muted">
                {c.label}: {c.n}
              </li>
            ))}
          </ul>
          <ul className="max-h-64 space-y-0.5 overflow-auto rounded-[var(--radius-control)] bg-canvas p-3 font-mono text-xs text-text-muted">
            {preview.sample.map((u) => (
              <li key={u}>
                <a href={u} target="_blank" rel="noreferrer" className="hover:text-ink-950 hover:underline">{u}</a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------ robots ------------------------------ */

export function RobotsForm({ value, canEdit, base }: { value: SeoRobotsSettings; canEdit: boolean; base: string }) {
  const [extra, setExtra] = useState(value.extraDisallow.join("\n"));
  const [blocked, setBlocked] = useState<string[]>(value.blockedAiBots);
  const preview = robotsToText(
    buildRobots(base, {
      ...value,
      extraDisallow: extra.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("/") && l !== "/" && l !== "/*"),
      blockedAiBots: blocked as SeoRobotsSettings["blockedAiBots"],
    }),
  );
  return (
    <div className="space-y-6">
      <SeoForm action={saveSeoRobots}>
        {!canEdit ? <LockedNote>robots.txt kurallarını yalnız süper admin değiştirebilir (yanlış kural siteyi aramalardan düşürebilir).</LockedNote> : null}
        <fieldset disabled={!canEdit} className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Ek Disallow yolları</CardTitle>
                <CardDescription>
                  Portallar, /app, /admin ve /api kuralları koddadır ve buradan çıkarılamaz. Tüm siteyi engelleyen (“/”) kural kabul edilmez. Crawl-delay bilerek yoktur.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <FormField label="Ek Disallow listesi" htmlFor="extraDisallow" hint="Satır başına bir yol, '/' ile başlar. Örnek: /ozel/">
                <FormTextarea id="extraDisallow" name="extraDisallow" rows={4} value={extra} onChange={(e) => setExtra(e.target.value)} />
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Yapay zekâ tarayıcıları</CardTitle>
                <CardDescription>İşaretli olan tarayıcıya izin verilir (varsayılan: hepsine izin). İşareti kaldırırsanız ilgili tarayıcı için Disallow: / yazılır.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2">
              {AI_BOTS.map((b) => {
                const allowed = !blocked.includes(b.id);
                return (
                  <label key={b.id} className="flex items-center gap-2.5 rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm">
                    <Checkbox
                      name="allowAi"
                      value={b.id}
                      checked={allowed}
                      onChange={(e) => setBlocked((cur) => (e.target.checked ? cur.filter((x) => x !== b.id) : [...cur, b.id]))}
                    />
                    <span className="text-ink-950">{b.label}</span>
                  </label>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>llms.txt (isteğe bağlı)</CardTitle>
                <CardDescription>Yapay zekâ araçları için site özeti. Varsayılan KAPALI; açıkken boş bırakırsanız ayarlardaki site açıklamasından güvenli bir özet üretilir.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-ink-950">llms.txt yayınla</span>
                <Switch name="llmsTxtEnabled" defaultChecked={value.llmsTxtEnabled} aria-label="llms.txt yayınla" />
              </label>
              <FormField label="Özel içerik (düz metin, en çok 4000 karakter)" htmlFor="llmsTxt">
                <FormTextarea id="llmsTxt" name="llmsTxt" rows={5} defaultValue={value.llmsTxt} maxLength={4000} />
              </FormField>
            </CardContent>
          </Card>
        </fieldset>
        {canEdit ? <SubmitButton>robots ayarlarını kaydet</SubmitButton> : null}
      </SeoForm>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>robots.txt önizlemesi (kaydedilmemiş değişikliklerle)</CardTitle>
            <CardDescription>
              Yayındaki dosya:{" "}
              <a href="/robots.txt" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
                robots.txt <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <pre className="max-h-80 overflow-auto rounded-[var(--radius-control)] bg-canvas p-3 font-mono text-xs text-text-muted">{preview}</pre>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------ IndexNow ve robot ------------------------------ */

export function IndexNowPanel({ value, canEdit, base }: { value: SeoIndexNowSettings; canEdit: boolean; base: string }) {
  const router = useRouter();
  const [res, setRes] = useState<SeoActionResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<SeoActionResult>) =>
    start(async () => {
      const r = await fn();
      setRes(r);
      if (r.ok) router.refresh();
    });
  const keyUrl = value.key ? `${base}/${value.key}.txt` : "";
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>IndexNow (Bing, Yandex, Seznam, Naver)</CardTitle>
          <CardDescription>
            Dış çağrıdır: yalnız açıkken ve yalnız yeni/değişen, indekslenebilir adresler için api.indexnow.org’a gönderim yapılır (günlük en çok 2.000 URL). Varsayılan KAPALI.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid gap-2 text-sm md:grid-cols-2">
          <div><dt className="text-xs text-text-muted">Durum</dt><dd className="font-semibold text-ink-950">{value.enabled ? "Etkin" : "Kapalı"}</dd></div>
          <div><dt className="text-xs text-text-muted">Son gönderim</dt><dd className="font-semibold text-ink-950">{value.lastSentAt ? `${value.lastSentAt.slice(0, 16).replace("T", " ")} UTC · ${value.lastCount} URL · ${value.lastStatus}` : value.lastStatus || "Henüz yok"}</dd></div>
          <div className="md:col-span-2">
            <dt className="text-xs text-text-muted">Anahtar dosyası</dt>
            <dd className="break-all font-mono text-xs text-ink-950">{keyUrl || "Etkinleştirince üretilir"}</dd>
          </div>
        </dl>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={value.enabled ? "secondary" : "primary"}
              loading={pending}
              onClick={() => {
                const fd = new FormData();
                if (!value.enabled) fd.set("enabled", "true");
                run(() => setIndexNowEnabled(fd));
              }}
            >
              {value.enabled ? "IndexNow'u kapat" : "IndexNow'u etkinleştir"}
            </Button>
            {value.key ? (
              <Button variant="secondary" loading={pending} onClick={() => run(() => regenerateIndexNowKey())}>
                Anahtarı yenile
              </Button>
            ) : null}
          </div>
        ) : (
          <LockedNote>IndexNow ayarını yalnız süper admin değiştirebilir.</LockedNote>
        )}
        <ResultNote res={res} />
        <p className="text-xs text-text-muted">
          Google IndexNow desteklemez ve sitemap ping’ini kaldırmıştır: Google Search Console &gt; Sitemaps bölümüne {base}/sitemap.xml adresini bir kez ekleyin.
        </p>
      </CardContent>
    </Card>
  );
}

export function RobotRunPanel({ canRun }: { canRun: boolean }) {
  const router = useRouter();
  const [res, setRes] = useState<SeoActionResult | null>(null);
  const [pending, start] = useTransition();
  if (!canRun) return <LockedNote>Robotu elle çalıştırmak yalnız süper admin içindir; günlük otomatik çalışma sürer.</LockedNote>;
  return (
    <div className="space-y-2">
      <Button
        icon={Play}
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await runSeoRobotNow();
            setRes(r);
            if (r.ok) router.refresh();
          })
        }
      >
        {pending ? "Robot çalışıyor (en çok 1 dakika)…" : "Robotu şimdi çalıştır"}
      </Button>
      <ResultNote res={res} />
    </div>
  );
}

/* ------------------------------ Yedek ------------------------------ */

export function BackupPanel({ canImport }: { canImport: boolean }) {
  const [json, setJson] = useState("");
  const [res, setRes] = useState<SeoActionResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Dışa aktar</CardTitle>
            <CardDescription>Genel, sayfa, sitemap, robots ve yönlendirme ayarları tek JSON olarak. Denetim sonuçları dahil değildir.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="secondary"
            icon={Copy}
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await exportSeoSettings();
                setRes(r.ok ? { ok: true, message: "Yedek aşağıdaki alana yazıldı." } : r);
                if (r.data) setJson(r.data);
              })
            }
          >
            Yedeği hazırla
          </Button>
          <FormTextarea aria-label="Yedek JSON" rows={10} value={json} onChange={(e) => setJson(e.target.value)} className="font-mono text-xs" spellCheck={false} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>İçe aktar</CardTitle>
            <CardDescription>Yukarıdaki alana yapıştırılan yedek, mevcut ayarların üzerine yazar. Önce hepsi doğrulanır; biri bozuksa hiçbir şey yazılmaz.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!canImport ? (
            <LockedNote>İçe aktarma yalnız süper admin içindir.</LockedNote>
          ) : confirming ? (
            <div role="alert" className="space-y-2 rounded-[var(--radius-control)] border border-danger-400 p-3">
              <p className="text-sm font-semibold text-danger-600">Mevcut SEO ayarları üzerine yazılacak. Emin misiniz?</p>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  loading={pending}
                  onClick={() =>
                    start(async () => {
                      const fd = new FormData();
                      fd.set("json", json);
                      fd.set("confirm", "evet");
                      const r = await importSeoSettings(fd);
                      setRes(r);
                      setConfirming(false);
                      if (r.ok) router.refresh();
                    })
                  }
                >
                  Evet, içe aktar
                </Button>
                <Button variant="secondary" onClick={() => setConfirming(false)}>Vazgeç</Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" disabled={!json.trim()} onClick={() => setConfirming(true)}>İçe aktar…</Button>
          )}
          <ResultNote res={res} />
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------ JSON-LD doğrulayıcı ------------------------------ */

export function JsonLdValidator() {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>JSON-LD doğrulayıcı</CardTitle>
          <CardDescription>
            Zorunlu alan kontrolü yerel çalışır; veri hiçbir yere gönderilmez. Resmî doğrulama için{" "}
            <a href="https://search.google.com/test/rich-results" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
              Google Rich Results Test <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
            .
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <FormTextarea aria-label="JSON-LD" rows={8} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" spellCheck={false} placeholder='{"@context":"https://schema.org","@type":"Organization","name":"…","url":"https://…"}' />
        <Button
          variant="secondary"
          disabled={!text.trim()}
          onClick={() => {
            try {
              const obj = JSON.parse(text) as unknown;
              setParseError(null);
              setErrors(validateJsonLd(obj));
            } catch (e) {
              setErrors(null);
              setParseError(e instanceof Error ? e.message : "JSON ayrıştırılamadı.");
            }
          }}
        >
          Doğrula
        </Button>
        {parseError ? <p role="alert" className="text-sm font-medium text-danger-600">JSON hatası: {parseError}</p> : null}
        {errors ? (
          errors.length === 0 ? (
            <p role="status" className="text-sm font-medium text-success-strong">Zorunlu alanlar tam; yasaklı (puan/yorum) alan yok.</p>
          ) : (
            <ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-danger-600">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
