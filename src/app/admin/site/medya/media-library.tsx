"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { AlertTriangle, CheckCircle2, ImagePlus, Loader2, RefreshCw, Save, Trash2, Upload } from "lucide-react";
import { deleteSiteMedia, updateSiteMediaAlt } from "@/app/actions/site-media";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { kb, SITE_MEDIA_LIMITS } from "@/lib/site-media/quota";
import { mediaUrl, type SiteMediaRow } from "@/lib/site-media/types";
import { InlineConfirm } from "../../site-menu/editor-ui";
import { ACCEPT_IMAGES, postSiteMedia } from "./upload-client";

export type MediaCard = SiteMediaRow & { usage: string[]; heroBytes: number; heroOver: boolean; large: boolean };

type Msg = { kind: "ok" | "error" | "warn"; text: string };

function Note({ msg }: { msg: Msg | null }) {
  if (!msg) return null;
  const tone = msg.kind === "error" ? "text-danger-500" : msg.kind === "warn" ? "text-amber-700" : "text-mint-700";
  return (
    <p role={msg.kind === "error" ? "alert" : "status"} className={`mt-2 flex items-start gap-1.5 text-xs font-semibold ${tone}`}>
      {msg.kind === "ok" ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {msg.text}
    </p>
  );
}

/** Önizleme küçük resmi: en küçük WebP (yoksa ilk varyant). */
function thumb(m: SiteMediaRow) {
  const v = [...m.variants].filter((x) => x.format === "webp").sort((a, b) => a.w - b.w)[0] ?? m.variants[0];
  return v ? mediaUrl(m.id, v.file) : null;
}

/** Yeni görsel yükleme kartı (dosya + zorunlu alt metin + isteğe bağlı başlık). */
function UploadCard() {
  const router = useRouter();
  const fileId = useId();
  const altId = useId();
  const titleId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return setMsg({ kind: "error", text: "Dosya seçin." });
    if (file.size > SITE_MEDIA_LIMITS.inputBytes) return setMsg({ kind: "error", text: `Dosya en fazla ${kb(SITE_MEDIA_LIMITS.inputBytes)} olabilir.` });
    setMsg(null);
    start(async () => {
      const res = await postSiteMedia(form);
      if (res.error) return setMsg({ kind: "error", text: res.error });
      formRef.current?.reset();
      setMsg(res.warnings?.length ? { kind: "warn", text: `Yüklendi. ${res.warnings.join(" ")}` } : { kind: "ok", text: "Yüklendi; Site içeriği > Ana başlık ekranından seçebilirsiniz." });
      router.refresh();
    });
  };

  return (
    <form ref={formRef} onSubmit={submit} className="rounded-[var(--radius-panel)] border border-dashed border-brand-400 bg-surface p-4" aria-label="Görsel yükle">
      <h2 className="flex items-center gap-2 font-display text-base font-extrabold text-ink-950"><ImagePlus className="h-4 w-4 text-brand-600" aria-hidden="true" /> Görsel yükle</h2>
      <p className="mt-1 text-xs text-text-muted">PNG, JPEG, WebP veya AVIF; en çok {kb(SITE_MEDIA_LIMITS.inputBytes)}. SVG ve video kabul edilmez. Ana başlık görseli için 960 px AVIF çıktısı {kb(SITE_MEDIA_LIMITS.heroBudgetBytes)} altında kalmalı.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={fileId} className="mb-1 block text-xs font-semibold text-ink-950">Dosya</label>
          <input id={fileId} name="file" type="file" accept={ACCEPT_IMAGES} required className="block w-full text-xs text-text-muted file:mr-2 file:rounded file:border-0 file:bg-brand-600/10 file:px-2 file:py-1.5 file:text-xs file:font-bold file:text-brand-700" />
        </div>
        <div>
          <label htmlFor={altId} className="mb-1 block text-xs font-semibold text-ink-950">Alt metin (zorunlu)</label>
          <Input id={altId} name="alt" required maxLength={SITE_MEDIA_LIMITS.altMax} placeholder="Görselde ne var? ör. Ofiste danışman ve müşteri" />
        </div>
        <div>
          <label htmlFor={titleId} className="mb-1 block text-xs font-semibold text-ink-950">Başlık (isteğe bağlı, yalnız yönetimde)</label>
          <Input id={titleId} name="title" maxLength={SITE_MEDIA_LIMITS.titleMax} />
        </div>
      </div>
      <div className="mt-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />} {pending ? "İşleniyor…" : "Yükle"}
        </Button>
      </div>
      <Note msg={msg} />
    </form>
  );
}

function MediaItem({ m, canWrite }: { m: MediaCard; canWrite: boolean }) {
  const router = useRouter();
  const altId = useId();
  const replaceId = useId();
  const [alt, setAlt] = useState(m.alt);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [pending, start] = useTransition();
  const src = thumb(m);
  const used = m.usage.length > 0;

  const saveAlt = () =>
    start(async () => {
      const res = await updateSiteMediaAlt(m.id, alt, m.title ?? "");
      if (res.error) return setMsg({ kind: "error", text: res.error });
      setMsg({ kind: "ok", text: "Alt metin kaydedildi." });
      router.refresh();
    });

  const replace = (file: File | undefined) => {
    if (!file) return;
    if (file.size > SITE_MEDIA_LIMITS.inputBytes) return setMsg({ kind: "error", text: `Dosya en fazla ${kb(SITE_MEDIA_LIMITS.inputBytes)} olabilir.` });
    const form = new FormData();
    form.set("file", file);
    form.set("alt", alt);
    form.set("title", m.title ?? "");
    form.set("replaceId", m.id);
    start(async () => {
      const res = await postSiteMedia(form);
      if (res.error) return setMsg({ kind: "error", text: res.error });
      setMsg(res.warnings?.length ? { kind: "warn", text: `Değiştirildi. ${res.warnings.join(" ")}` } : { kind: "ok", text: used ? "Değiştirildi; kullanıldığı yerler yeni görseli gösterir." : "Değiştirildi." });
      router.refresh();
    });
  };

  const remove = () =>
    start(async () => {
      const res = await deleteSiteMedia(m.id);
      if (res.error) return setMsg({ kind: "error", text: res.error });
      router.refresh();
    });

  return (
    <li className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      <div className="relative aspect-[16/10] bg-ink-950/5">
        {src ? (
          // Yönetim küçük resmi: aynı köken /medya rotası (next/image optimizasyonu gerekmez; dosya zaten küçük WebP).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={m.alt} width={m.w} height={m.h} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : null}
        <span className="absolute left-2 top-2 flex flex-wrap gap-1">
          {used ? <span className="rounded-full bg-mint-500/90 px-2 py-0.5 text-xs font-bold text-white">Kullanımda</span> : <span className="rounded-full bg-ink-950/60 px-2 py-0.5 text-xs font-bold text-white">Kullanılmıyor</span>}
          {m.large ? <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">Büyük dosya</span> : null}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="text-xs text-text-muted">
          {m.w}×{m.h} px · {kb(m.bytes)} toplam · ilk ekran {kb(m.heroBytes)}
          {m.heroOver ? <span className="font-semibold text-amber-700"> (bütçe {kb(SITE_MEDIA_LIMITS.heroBudgetBytes)} aşıldı)</span> : null}
        </p>
        {used ? (
          <p className="text-xs text-ink-950">
            <span className="font-semibold">Kullanım:</span>{" "}
            <Link href="/admin/site-icerik" className="text-brand-700 underline">{m.usage.join(", ")}</Link>
          </p>
        ) : null}
        <div>
          <label htmlFor={altId} className="mb-1 block text-xs font-semibold text-ink-950">Alt metin</label>
          <div className="flex gap-1.5">
            <Input id={altId} value={alt} maxLength={SITE_MEDIA_LIMITS.altMax} readOnly={!canWrite} onChange={(e) => setAlt(e.target.value)} />
            {canWrite ? (
              <Button type="button" variant="outline" size="sm" disabled={pending || alt.trim() === m.alt || !alt.trim()} onClick={saveAlt} aria-label="Alt metni kaydet">
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>
        {canWrite ? (
          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
            <label htmlFor={replaceId} className={`focus-ring inline-flex h-8 cursor-pointer items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 text-xs font-bold text-ink-950 hover:border-brand-400 ${pending ? "pointer-events-none opacity-60" : ""}`}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} Değiştir
            </label>
            <input id={replaceId} type="file" accept={ACCEPT_IMAGES} className="sr-only" onChange={(e) => replace(e.target.files?.[0])} />
            {used ? (
              <span className="text-xs text-text-muted">Kullanımda olduğu için silinemez.</span>
            ) : (
              <InlineConfirm label="Sil" confirmLabel="Evet, sil" tone="danger" disabled={pending} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={remove} />
            )}
          </div>
        ) : null}
        <Note msg={msg} />
      </div>
    </li>
  );
}

export function MediaLibrary({ items, canWrite, filtered, clearHref }: { items: MediaCard[]; canWrite: boolean; filtered: boolean; clearHref: string }) {
  return (
    <div className="space-y-4">
      {canWrite ? <UploadCard /> : <p role="status" className="rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Bu ekran sizin rolünüz için salt okunurdur; yalnız süper admin görsel yükleyip değiştirebilir.</p>}
      {items.length === 0 ? (
        <div className="rounded-[var(--radius-panel)] border border-dashed border-line p-8 text-center">
          <ImagePlus className="mx-auto h-8 w-8 text-text-faint" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-ink-950">{filtered ? "Bu süzgeçle eşleşen görsel yok." : "Henüz görsel yok."}</p>
          <p className="mt-1 text-xs text-text-muted">
            {filtered ? <Link href={clearHref} className="font-semibold text-brand-700 underline">Süzgeci temizle</Link> : "İlk görseli yükleyin; ardından Site içeriği > Ana başlık ekranından ana sayfaya ekleyin."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((m) => <MediaItem key={`${m.id}-${m.variants[0]?.file ?? ""}`} m={m} canWrite={canWrite} />)}
        </ul>
      )}
    </div>
  );
}
