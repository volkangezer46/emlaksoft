"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "@/components/ui/smart-link";
import { Camera, Check, CloudOff, CloudUpload, ImagePlus, Loader2, RotateCcw, Star, Trash2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/ui/form-controls";
import { Progress } from "@/components/ui/progress";
import { now } from "@/lib/clock";
import type { CaptureScope, OutboxItem } from "@/lib/field-capture/outbox";
import { assessPhoto, type PhotoIssue } from "@/lib/field-capture/photo-quality";
import { compressPhoto, outputName } from "@/lib/field-capture/photo-resize";
import { fieldPhotoStore, lowDeviceStorage } from "@/lib/field-capture/photo-idb";
import {
  batchPhotos,
  coverSeq,
  MAX_BATCH_PHOTOS,
  nextSeq,
  orphanBatches,
  PHOTO_BATCH_FIELD,
  type PropertyUploadSummary,
  type StoredPhoto,
} from "@/lib/field-capture/photo-queue";
import {
  discardPhotoBatch,
  dismissPropertySummary,
  dropFailedPropertyPhotos,
  photoSyncServerSnapshot,
  photoSyncSnapshot,
  refreshPhotos,
  retryPropertyPhotos,
  setForegroundProperty,
  subscribePhotoSync,
} from "@/lib/field-capture/photo-sync";

/*
 * Sahada portföy fotoğrafı (GA-13): kayıttan ÖNCE çek/seç → cihazda küçült + sakla → kayıt açılınca sırayla yükle.
 * Bağlantı yoksa fotoğraflar kayıtla birlikte bu cihazda bekler; bağlantı gelince yüklenir (ilerleme + yeniden deneme).
 */

export function usePhotoSync() {
  return useSyncExternalStore(subscribePhotoSync, photoSyncSnapshot, photoSyncServerSnapshot);
}

function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `p${now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

// Önizleme adresleri fotoğraf kimliğine göre bir kez üretilir (her depo okumasında yeni Blob gelir; görsel titremesin).
const thumbUrls = new Map<string, string>();
function thumbUrl(photo: StoredPhoto): string {
  let url = thumbUrls.get(photo.id);
  if (!url) {
    url = URL.createObjectURL(photo.blob);
    thumbUrls.set(photo.id, url);
  }
  return url;
}
function releaseThumbs(ids: Iterable<string>) {
  for (const id of ids) {
    const url = thumbUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    thumbUrls.delete(id);
  }
}

const ISSUE_SHORT: Record<PhotoIssue, string> = { low_resolution: "Düşük çözünürlük", portrait: "Dikey", panorama: "Çok geniş" };

/** Kuyruktaki portföy öğesinin fotoğraf partisi (forma geri yükleme / silmede). */
export function outboxPhotoBatch(item: Pick<OutboxItem, "fields">): string {
  return item.fields.find(([k]) => k === PHOTO_BATCH_FIELD)?.[1] ?? "";
}

/* ------------------------------ Seçici (form) ------------------------------ */

/**
 * Hızlı portföy formundaki fotoğraf alanı. Fotoğraflar seçildiği anda küçültülüp cihaza yazılır (sayfa kapansa da
 * kalır); form yalnız parti kimliğini (`photo_batch`) taşır. İlk fotoğraf kapak olur; başka fotoğrafa dokununca kapak
 * o olur.
 */
export function FieldPhotoPicker({
  scope,
  batchId,
  ensureBatch,
  outboxItems,
  onChange,
}: {
  scope: CaptureScope | null;
  batchId: string;
  /** Parti kimliği yoksa üretir (ilk fotoğrafta) ve döner. */
  ensureBatch: () => string;
  /** Kuyruktaki kayıtlar: onların partileri "önceki çekim" sayılmaz. */
  outboxItems: OutboxItem[];
  /** Fotoğraf eklendi/silindi (taslak kaydı). */
  onChange: () => void;
}) {
  const snap = usePhotoSync();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [lowStorage, setLowStorage] = useState(false);
  const photos = batchId ? batchPhotos(snap.photos, batchId) : [];
  const referenced = new Set(outboxItems.map(outboxPhotoBatch).filter(Boolean));
  if (batchId) referenced.add(batchId);
  const orphan = orphanBatches(snap.photos, referenced)[0] ?? null;
  const room = MAX_BATCH_PHOTOS - photos.length;
  const firstWarning = photos.map((p) => assessPhoto(p).warning).find(Boolean) ?? null;

  // Form kaldırılınca (kayıt açıldı / sekme değişti) önizleme adresleri bırakılır; fotoğraflar depoda kalır.
  const shownIds = useRef<string[]>([]);
  useEffect(() => {
    shownIds.current = photos.map((p) => p.id);
  });
  useEffect(() => () => releaseThumbs(shownIds.current), []);

  async function addFiles(files: File[]) {
    if (!scope || files.length === 0) return;
    const accepted = files.filter((f) => f.type === "" || f.type.startsWith("image/")).slice(0, Math.max(0, room));
    const skipped = files.length - accepted.length;
    const errs: string[] = skipped > 0 ? [`${skipped} dosya eklenmedi (yalnız fotoğraf; en çok ${MAX_BATCH_PHOTOS} fotoğraf).`] : [];
    if (accepted.length === 0) {
      setErrors(errs);
      return;
    }
    const batch = ensureBatch();
    setBusy(accepted.length);
    setErrors([]);
    void lowDeviceStorage().then(setLowStorage);
    const store = await fieldPhotoStore();
    let seq = nextSeq(photoSyncSnapshot().photos, batch);
    // Sırayla: düşük bellekli telefonda aynı anda tek fotoğraf çözülür.
    for (const file of accepted) {
      try {
        const out = await compressPhoto(file);
        await store.put({
          id: newId(),
          batchId: batch,
          tenantId: scope.tenantId,
          userId: scope.userId,
          blob: out.blob,
          name: outputName(seq + 1, out.type),
          width: out.width,
          height: out.height,
          createdAt: now(),
          seq,
          propertyId: null,
          attempts: 0,
        });
        seq += 1;
        await refreshPhotos();
      } catch (e) {
        const msg = e instanceof Error && e.message ? e.message : "Fotoğraf eklenemedi.";
        errs.push(/quota/i.test(msg) ? "Cihaz deposu dolu: fotoğraf saklanamadı. Yer açın ya da kaydı fotoğrafsız gönderin." : msg);
      }
      setBusy((n) => Math.max(0, n - 1));
    }
    setBusy(0);
    setErrors([...new Set(errs)]);
    onChange();
  }

  /** Tek dosya girdisi: "Fotoğraf çek" arka kamerayı açar (capture), "Galeriden seç" galeriyi. */
  function pick(camera: boolean) {
    const el = fileRef.current;
    if (!el) return;
    if (camera) el.setAttribute("capture", "environment");
    else el.removeAttribute("capture");
    el.click();
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Aynı fotoğraf yeniden seçilebilsin / kamera art arda çekebilsin.
    e.target.value = "";
    void addFiles(files);
  }

  async function remove(photo: StoredPhoto) {
    const store = await fieldPhotoStore();
    await store.remove([photo.id]);
    releaseThumbs([photo.id]);
    await refreshPhotos();
    onChange();
  }

  async function makeCover(photo: StoredPhoto) {
    const store = await fieldPhotoStore();
    await store.patch(photo.id, { seq: coverSeq(photoSyncSnapshot().photos, photo.batchId) });
    await refreshPhotos();
  }

  async function adoptOrphan() {
    if (!orphan) return;
    const batch = ensureBatch();
    const store = await fieldPhotoStore();
    let seq = nextSeq(photoSyncSnapshot().photos, batch);
    for (const p of batchPhotos(photoSyncSnapshot().photos, orphan.batchId)) await store.patch(p.id, { batchId: batch, seq: seq++ });
    await refreshPhotos();
    onChange();
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1.5 text-sm font-medium text-ink-950">Fotoğraflar (isteğe bağlı)</legend>
      {batchId ? <FormInput type="hidden" name={PHOTO_BATCH_FIELD} value={batchId} /> : null}

      {orphan ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 sm:flex-row sm:items-center">
          <span className="min-w-0 flex-1">Önceki çekimden {orphan.count} fotoğraf bu cihazda bekliyor.</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void adoptOrphan()}>Bu kayda ekle</Button>
            <Button variant="ghost" size="sm" icon={Trash2} className="text-danger-600" onClick={() => void discardPhotoBatch(orphan.batchId)}>Sil</Button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="lg" icon={Camera} onClick={() => pick(true)} disabled={!scope || room <= 0} className="min-h-11 w-full">
          Fotoğraf çek
        </Button>
        <Button variant="outline" size="lg" icon={ImagePlus} onClick={() => pick(false)} disabled={!scope || room <= 0} className="min-h-11 w-full">
          Galeriden seç
        </Button>
        <FormInput ref={fileRef} type="file" accept="image/*" multiple onChange={onPick} className="sr-only" tabIndex={-1} aria-hidden />
      </div>

      {photos.length > 0 || busy > 0 ? (
        <ul className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3 sm:grid-cols-4" aria-label="Eklenen fotoğraflar">
          {photos.map((p, i) => {
            const q = assessPhoto(p);
            return (
              <li key={p.id} className="relative aspect-square overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface-sunken">
                {/* eslint-disable-next-line @next/next/no-img-element -- yerel blob önizlemesi (next/image blob: adresini işlemez) */}
                <img src={thumbUrl(p)} alt={`Fotoğraf ${i + 1}`} className="h-full w-full object-cover" />
                {i === 0 ? (
                  <span className="pointer-events-none absolute bottom-1 left-1 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">
                    <Star className="h-3 w-3" aria-hidden /> Kapak
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    size="xs"
                    icon={Star}
                    onClick={() => void makeCover(p)}
                    className="absolute bottom-1 left-1 rounded-full px-2"
                    aria-label={`Fotoğraf ${i + 1}: kapak yap`}
                  >
                    Kapak yap
                  </Button>
                )}
                {q.issues[0] ? (
                  <span className="pointer-events-none absolute left-1 top-1 max-w-[calc(100%-3rem)] truncate rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-bold text-white" title={q.warning ?? undefined}>
                    {ISSUE_SHORT[q.issues[0]]}
                  </span>
                ) : null}
                <Button
                  variant="secondary"
                  size="icon"
                  icon={X}
                  onClick={() => void remove(p)}
                  className="absolute right-1 top-1 rounded-full"
                  aria-label={`Fotoğraf ${i + 1}: kaldır`}
                />
              </li>
            );
          })}
          {busy > 0 ? (
            <li className="grid aspect-square place-items-center rounded-[var(--radius-control)] border border-dashed border-line text-xs text-text-muted" role="status">
              <span className="flex flex-col items-center gap-1">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                {busy} hazırlanıyor…
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}

      {firstWarning ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-700">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {firstWarning}
        </p>
      ) : null}
      {errors.map((e) => (
        <p key={e} role="alert" className="text-xs font-medium text-danger-600">{e}</p>
      ))}
      {lowStorage ? (
        <p className="text-xs text-amber-700">Cihaz deposu azalmış: çok fotoğraf eklerseniz bazıları saklanamayabilir.</p>
      ) : null}
      <p className="text-xs text-text-faint">
        {photos.length > 0 ? `${photos.length} fotoğraf · ` : ""}
        Fotoğraflar cihazda küçültülür (konum bilgisi silinir) ve kayıtla birlikte yüklenir. Bağlantı yoksa bu cihazda bekler (en çok 7 gün).
        {!snap.persistent && photos.length > 0 ? " Bu tarayıcı fotoğrafları kalıcı saklayamıyor: kayıt gönderilene kadar sayfayı kapatmayın." : ""}
      </p>
    </fieldset>
  );
}

/* --------------------------- Yükleme ilerlemesi --------------------------- */

function SummaryRow({ s, online, showOpen, onDismiss }: { s: PropertyUploadSummary; online: boolean; showOpen: boolean; onDismiss?: () => void }) {
  const done = s.remaining === 0;
  const stuck = s.failed > 0;
  const pct = s.total > 0 ? (s.uploaded / s.total) * 100 : 0;
  return (
    <li className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 font-semibold text-ink-950">
          {done ? (
            <Check className="h-4 w-4 shrink-0 text-mint-600" aria-hidden />
          ) : !online ? (
            <CloudOff className="h-4 w-4 shrink-0 text-amber-700" aria-hidden />
          ) : stuck ? (
            <TriangleAlert className="h-4 w-4 shrink-0 text-danger-600" aria-hidden />
          ) : (
            <CloudUpload className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          )}
          <span className="truncate">
            {done ? `${s.uploaded} fotoğraf yüklendi` : `Fotoğraflar yükleniyor: ${s.uploaded}/${s.total}`}
            {s.label ? <span className="font-normal text-text-muted"> · {s.label}</span> : null}
          </span>
        </span>
        {showOpen ? (
          <Link href={`/app/portfoyler/${s.propertyId}`} className="text-xs font-semibold text-brand-600 underline underline-offset-2">
            Portföyü aç
          </Link>
        ) : null}
        {done && onDismiss ? (
          <Button variant="ghost" size="sm" onClick={onDismiss}>Tamam</Button>
        ) : null}
      </div>
      {!done ? <Progress value={pct} label={`Fotoğraf yükleme: ${s.uploaded}/${s.total}`} tone={stuck ? "danger" : "accent"} /> : null}
      {!done && !online ? <p className="text-xs text-amber-700">Bağlantı yok: fotoğraflar bu cihazda bekliyor, bağlantı gelince kaldığı yerden yüklenir.</p> : null}
      {stuck ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 text-xs text-danger-600">
            {s.failed} fotoğraf yüklenemedi{s.lastError ? `: ${s.lastError}` : "."}
          </span>
          <Button variant="secondary" size="sm" icon={RotateCcw} onClick={() => void retryPropertyPhotos(s.propertyId)} disabled={!online}>
            Tekrar dene
          </Button>
          <Button variant="ghost" size="sm" icon={Trash2} className="text-danger-600" onClick={() => void dropFailedPropertyPhotos(s.propertyId)}>
            Vazgeç
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Yükleme ilerlemesi. `propertyId` verilirse yalnız o portföy (kayıt sonrası ekranı; üst panel onu tekrar göstermez),
 * verilmezse kuyruktan gönderilen diğer portföyler (üst panel).
 */
export function PhotoUploadStatus({ propertyId }: { propertyId?: string }) {
  const snap = usePhotoSync();
  const online = useOnline();
  useEffect(() => {
    if (!propertyId) return;
    setForegroundProperty(propertyId);
    return () => setForegroundProperty(null);
  }, [propertyId]);
  const rows = propertyId
    ? snap.summaries.filter((s) => s.propertyId === propertyId)
    : snap.summaries.filter((s) => s.propertyId !== snap.foreground);
  if (rows.length === 0) return null;
  return (
    <section aria-label="Fotoğraf yüklemeleri" aria-live="polite" className={propertyId ? "text-sm" : "rounded-[var(--radius-panel)] border border-line bg-surface p-3 text-sm"}>
      <ul className="flex flex-col gap-3">
        {rows.map((s) => (
          <SummaryRow key={s.propertyId} s={s} online={online} showOpen={!propertyId} onDismiss={propertyId ? undefined : () => dismissPropertySummary(s.propertyId)} />
        ))}
      </ul>
    </section>
  );
}
