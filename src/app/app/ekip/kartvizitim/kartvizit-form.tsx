"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Camera,
  Check,
  Copy,
  ExternalLink,
  Eye,
  Globe,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { removeAgentPhoto, saveAgentProfile, uploadAgentPhoto } from "@/app/actions/agent-profile";
import { useToast } from "@/components/app/toast-provider";
import { VitrinQr } from "@/components/public/vitrin-qr";
import {
  AGENT_BIO_MAX,
  AGENT_LANGUAGES_MAX,
  AGENT_SPECIALTIES_MAX,
  AGENT_TITLE_MAX,
  agentInitials,
  isValidAgentSlug,
} from "@/lib/agent-profile";

export type KartvizitView = {
  targetId: string;
  isSelf: boolean;
  fullName: string;
  phone: string | null;
  title: string;
  bio: string;
  photoUrl: string | null;
  specialties: string[];
  languages: string[];
  slug: string;
  suggestedSlug: string;
  isPublic: boolean;
  viewCount: number;
  officeName: string;
  officeSlug: string | null;
};

// origin sayfa ömrü boyunca değişmez — abonelik gerekmez (booking-link-form deseni).
function subscribeNoop() {
  return () => {};
}

const inputCls =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm text-ink-950 outline-none transition focus:border-brand-400";

/** Çip (etiket) girişi — Enter/virgül ile ekler, çarpı ile siler. */
function ChipInput({
  label,
  hint,
  values,
  setValues,
  max,
  placeholder,
}: {
  label: string;
  hint: string;
  values: string[];
  setValues: (v: string[]) => void;
  max: number;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const value = raw.trim().replace(/\s+/g, " ").slice(0, 32);
    if (!value) return;
    if (values.length >= max) return;
    if (values.some((v) => v.toLocaleLowerCase("tr") === value.toLocaleLowerCase("tr"))) return;
    setValues([...values, value]);
    setDraft("");
  }

  return (
    <div>
      <label className="text-xs font-semibold text-ink-950">{label}</label>
      <p className="mt-0.5 text-[11px] text-text-muted">{hint}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/10 px-3 py-1.5 text-xs font-semibold text-brand-600"
          >
            {v}
            <button
              type="button"
              onClick={() => setValues(values.filter((x) => x !== v))}
              aria-label={`${v} etiketini kaldır`}
              className="focus-ring rounded-full transition hover:text-danger-500"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      {values.length < max ? (
        <div className="mt-2 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add(draft);
              }
            }}
            placeholder={placeholder}
            className={inputCls}
          />
          <button
            type="button"
            onClick={() => add(draft)}
            className="inline-flex shrink-0 items-center gap-1 rounded-[10px] border border-line px-3 py-2 text-xs font-bold text-brand-600 transition hover:border-brand-300"
          >
            <Plus className="h-3.5 w-3.5" /> Ekle
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-text-faint">En fazla {max} etiket eklenebilir.</p>
      )}
    </div>
  );
}

/**
 * Kartvizit düzenleme formu.
 *
 * NEDEN CLIENT: çip girişi, slug canlı önizlemesi, fotoğraf yükleme geri
 * bildirimi ve pano/QR işlemleri tarayıcı gerektirir. Kaydetme server action
 * ile (saveAgentProfile), sonuç toast + router.refresh (booking-link-form deseni).
 */
export function KartvizitForm({ view }: { view: KartvizitView }) {
  const { push } = useToast();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [saving, startSave] = useTransition();
  const [uploading, startUpload] = useTransition();
  const [specialties, setSpecialties] = useState<string[]>(view.specialties);
  const [languages, setLanguages] = useState<string[]>(view.languages);
  const [slug, setSlug] = useState(view.slug || view.suggestedSlug);
  const [isPublic, setIsPublic] = useState(view.isPublic);
  const [bio, setBio] = useState(view.bio);
  const [copied, setCopied] = useState(false);

  const origin = useSyncExternalStore(
    subscribeNoop,
    () => window.location.origin,
    () => null,
  );
  const publicUrl = slug && origin ? `${origin}/danisman/${slug}` : "";
  const slugValid = slug.length === 0 || isValidAgentSlug(slug);

  async function copyLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      push("Kartvizit linki kopyalandı", "ok");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      push("Link panoya kopyalanamadı", "err");
    }
  }

  function save(fd: FormData) {
    fd.set("target_id", view.targetId);
    fd.set("specialties", specialties.join(","));
    fd.set("languages", languages.join(","));
    fd.set("public_slug", slug);
    startSave(async () => {
      const res = await saveAgentProfile(fd);
      if (res.error) {
        push(res.error, "err");
        return;
      }
      push(isPublic ? "Kartvizit kaydedildi ve yayında" : "Kartvizit kaydedildi (yayında değil)", "ok");
      router.refresh();
    });
  }

  function onPhotoPicked(file: File | null) {
    if (!file) return;
    const fd = new FormData();
    fd.set("target_id", view.targetId);
    fd.set("photo", file);
    startUpload(async () => {
      const res = await uploadAgentPhoto(fd);
      if (res.error) {
        push(res.error, "err");
        return;
      }
      push("Fotoğraf güncellendi", "ok");
      router.refresh();
    });
  }

  function onPhotoRemove() {
    const fd = new FormData();
    fd.set("target_id", view.targetId);
    startUpload(async () => {
      const res = await removeAgentPhoto(fd);
      if (res.error) {
        push(res.error, "err");
        return;
      }
      push("Fotoğraf kaldırıldı", "ok");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr] lg:items-start">
      {/* ------------------------------------------------------------- Form */}
      <form action={save} className="space-y-5 rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        {/* Fotoğraf */}
        <div className="flex flex-wrap items-center gap-4">
          {view.photoUrl ? (
            <Image
              src={view.photoUrl}
              alt={view.fullName}
              width={88}
              height={88}
              className="h-[88px] w-[88px] rounded-[20px] border border-line object-cover"
            />
          ) : (
            <span className="grid h-[88px] w-[88px] place-items-center rounded-[20px] bg-[image:var(--grad-brand)] font-display text-2xl font-extrabold text-white">
              {agentInitials(view.fullName)}
            </span>
          )}
          <div>
            <p className="text-sm font-bold text-ink-950">{view.fullName}</p>
            <p className="text-xs text-text-muted">{view.officeName}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  onPhotoPicked(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-xs font-bold text-brand-600 transition hover:border-brand-300 disabled:opacity-60"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                {view.photoUrl ? "Fotoğrafı değiştir" : "Fotoğraf yükle"}
              </button>
              {view.photoUrl ? (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={onPhotoRemove}
                  className="inline-flex items-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-danger-500/40 hover:text-danger-500 disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Kaldır
                </button>
              ) : null}
            </div>
            <p className="mt-1.5 text-[11px] text-text-faint">JPEG, PNG veya WebP · en fazla 3MB · kare kırpım önerilir</p>
          </div>
        </div>

        {/* Unvan */}
        <div>
          <label htmlFor="kv-title" className="text-xs font-semibold text-ink-950">
            Unvan
          </label>
          <input
            id="kv-title"
            name="title"
            defaultValue={view.title}
            maxLength={AGENT_TITLE_MAX}
            placeholder="Kıdemli Danışman"
            className={`mt-1.5 ${inputCls}`}
          />
        </div>

        {/* Bio */}
        <div>
          <label htmlFor="kv-bio" className="text-xs font-semibold text-ink-950">
            Kısa tanıtım
          </label>
          <textarea
            id="kv-bio"
            name="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, AGENT_BIO_MAX))}
            rows={4}
            placeholder="Hangi bölgede, hangi tip portföylerde çalıştığınızı ve müşteriye ne sağladığınızı 2-3 cümlede anlatın."
            className={`mt-1.5 ${inputCls} resize-y`}
          />
          <p className="mt-1 text-right text-[11px] text-text-faint">
            {bio.length} / {AGENT_BIO_MAX}
          </p>
        </div>

        <ChipInput
          label="Uzmanlık alanları"
          hint="Bölge veya portföy tipi — müşteri ilk bakışta doğru kişiye geldiğini anlasın."
          values={specialties}
          setValues={setSpecialties}
          max={AGENT_SPECIALTIES_MAX}
          placeholder="Kadıköy, Lüks konut…"
        />

        <ChipInput
          label="Konuşulan diller"
          hint="Yabancı müşteri için ayırt edici — yalnız gerçekten konuştuğunuz dilleri ekleyin."
          values={languages}
          setValues={setLanguages}
          max={AGENT_LANGUAGES_MAX}
          placeholder="Türkçe, İngilizce…"
        />

        {/* Slug */}
        <div>
          <label htmlFor="kv-slug" className="text-xs font-semibold text-ink-950">
            Kartvizit adresi
          </label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-xs text-text-muted">
              /danisman/
            </span>
            <input
              id="kv-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="ad-soyad"
              className={`flex-1 ${inputCls} ${slugValid ? "" : "border-danger-500/50"}`}
            />
            {view.suggestedSlug && slug !== view.suggestedSlug ? (
              <button
                type="button"
                onClick={() => setSlug(view.suggestedSlug)}
                className="rounded-[10px] border border-line px-3 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
              >
                Adımdan üret
              </button>
            ) : null}
          </div>
          {!slugValid ? (
            <p className="mt-1.5 text-[11px] font-semibold text-danger-500">
              Adres yalnız küçük harf, rakam ve tire içerebilir; 3-60 karakter olmalı ve tire ile başlayıp bitmemeli.
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] text-text-faint">
              Adres benzersizdir; başkası kullanıyorsa kaydederken uyarılırsınız.
            </p>
          )}
        </div>

        {/* Yayın anahtarı */}
        <label className="flex cursor-pointer items-start gap-3 rounded-[14px] border border-line bg-canvas px-4 py-3">
          <input
            type="checkbox"
            name="is_public"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--brand-600)]"
          />
          <span>
            <span className="flex items-center gap-1.5 text-sm font-bold text-ink-950">
              <Globe className="h-4 w-4 text-brand-600" /> Kartvizitim yayında
            </span>
            <span className="mt-0.5 block text-xs text-text-muted">
              Kapalıyken link 404 verir. Açıkken sayfa arama motorlarına da açıktır — adınızla
              arayan müşteri sizi bulabilir.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button
            type="submit"
            disabled={saving || !slugValid}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-600/90 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Kaydet
          </button>
          <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
            <Eye className="h-3.5 w-3.5" /> {view.viewCount} yaklaşık görüntülenme
          </span>
        </div>
      </form>

      {/* ------------------------------------------------------- Link + QR */}
      <div className="space-y-4">
        <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="font-display font-bold text-ink-950">Paylaşılabilir link</h2>
          {view.slug && view.isPublic ? (
            <>
              <code className="mt-3 block truncate rounded-[10px] border border-line bg-canvas px-3 py-2 text-xs text-ink-950">
                {publicUrl || `/danisman/${view.slug}`}
              </code>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex items-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-xs font-bold text-brand-600 transition hover:border-brand-300"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Kopyalandı" : "Linki kopyala"}
                </button>
                <a
                  href={`/danisman/${view.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Canlı önizleme
                </a>
              </div>
            </>
          ) : (
            <p className="mt-3 rounded-[12px] border border-dashed border-line-strong px-4 py-6 text-center text-xs text-text-muted">
              {view.slug
                ? "Kartvizit kayıtlı ama yayında değil. “Kartvizitim yayında” anahtarını açıp kaydedin."
                : "Adres belirleyip kaydedin; link ve QR kodu burada oluşacak."}
            </p>
          )}
        </section>

        {view.slug && view.isPublic ? (
          <VitrinQr
            vitrinUrl={publicUrl}
            heading="Kartvizit QR kodu"
            hint="Basılı kartvizitinize, ofis camına veya tabelaya koyun — tarayan kişi doğrudan profilinize gelir."
            emptyHint="QR kodu için önce kartvizit adresini kaydedip yayına alın."
            fileName={`kartvizit-${view.slug}.png`}
          />
        ) : null}

        {view.officeSlug ? (
          <p className="px-1 text-[11px] text-text-faint">
            Kartvizitiniz, size atanmış yayındaki portföyleri ve ofis vitrininizi (
            <span className="font-semibold">/vitrin/{view.officeSlug}</span>) otomatik gösterir.
          </p>
        ) : null}
      </div>
    </div>
  );
}
