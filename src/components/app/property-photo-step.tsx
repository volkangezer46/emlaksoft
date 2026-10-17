"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelperText } from "@/components/ui/simple-kit";
import { now } from "@/lib/clock";
import { compressPhoto, outputName } from "@/lib/field-capture/photo-resize";
import { fieldPhotoStore } from "@/lib/field-capture/photo-idb";
import { batchPhotos, coverSeq, MAX_BATCH_PHOTOS, nextSeq, type StoredPhoto } from "@/lib/field-capture/photo-queue";
import { configurePhotoSync, discardPhotoBatch, photoSyncScope, photoSyncSnapshot, refreshPhotos } from "@/lib/field-capture/photo-sync";
import { createFieldPhotoUploader } from "@/app/app/hizli/photo-upload";
import { usePhotoSync } from "@/app/app/hizli/field-photos";
import type { CaptureScope } from "@/lib/field-capture/outbox";
import type { WatermarkSettings } from "@/lib/watermark";

export type PropertyPhotoBrand = { watermark: WatermarkSettings; officeName: string; logoUrl: string | null };

/*
 * Yeni portföy formunun İLK bölümündeki fotoğraf adımı (sadeleştirme C16). Danışman sahada önce fotoğrafı çeker:
 *  - "Fotoğraf çek": arka kamera (`capture="environment"`), "Galeriden seç": telefon galerisi; ikisi de çoklu.
 *  - Fotoğraflar seçildiği anda cihazda küçültülür ve saklanır (hızlı kayıt ile AYNI kuyruk: `field-capture/photo-*`).
 *  - Form gönderilince sayfa, dönen portföy kimliğiyle partiyi bağlar (`attachPhotoBatch`); yükleme kayıttan SONRA
 *    arka planda, ilerlemesiyle (portföyün Fotoğraflar sekmesinde) sürer. Bağlantı yoksa cihazda bekler.
 * Dosya girdileri `name` taşımaz: fotoğraf portföy kaydının FormData'sına girmez (sunucu eylemi değişmez).
 */
export function PropertyPhotoStep({
  scope,
  brand,
  onBatchChange,
}: {
  scope: CaptureScope;
  brand: PropertyPhotoBrand;
  /** Parti kimliği (ilk fotoğrafta üretilir); boşsa fotoğraf yok. */
  onBatchChange: (batchId: string, count: number) => void;
}) {
  const snap = usePhotoSync();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [batchId, setBatchId] = useState("");
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const savedRef = useRef(false);
  const batchRef = useRef("");

  // Kuyruk motoru bu oturuma bağlanır (filigran yükleme anında basılır; hızlı kayıtla aynı yükleyici).
  useEffect(() => {
    if (!scope.tenantId || !scope.userId) return;
    configurePhotoSync(scope, createFieldPhotoUploader(brand));
  }, [scope, brand]);

  // Kaydedilmeden ayrılırsa çekilen fotoğraflar cihazda yetim kalmasın.
  useEffect(
    () => () => {
      if (!savedRef.current && batchRef.current) void discardPhotoBatch(batchRef.current);
    },
    [],
  );

  const photos = batchId ? batchPhotos(snap.photos, batchId) : [];
  const room = MAX_BATCH_PHOTOS - photos.length;
  const ready = Boolean(scope.tenantId && scope.userId);

  useEffect(() => {
    onBatchChange(batchId, photos.length);
  }, [batchId, photos.length, onBatchChange]);

  // Form kayıt olunca çağıran `markPhotoBatchSaved` ile işaret eder (aşağıdaki olay).
  useEffect(() => {
    const onSaved = () => {
      savedRef.current = true;
    };
    window.addEventListener(PHOTO_STEP_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(PHOTO_STEP_SAVED_EVENT, onSaved);
  }, []);

  function ensureBatch(): string {
    if (batchRef.current) return batchRef.current;
    let id: string;
    try {
      id = crypto.randomUUID();
    } catch {
      id = `b${now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    }
    batchRef.current = id;
    setBatchId(id);
    return id;
  }

  async function addFiles(files: File[]) {
    const scopeNow = photoSyncScope();
    if (!scopeNow || files.length === 0) return;
    const accepted = files.filter((f) => f.type === "" || f.type.startsWith("image/")).slice(0, Math.max(0, room));
    if (accepted.length < files.length) setError(`Yalnız fotoğraf eklenir (en çok ${MAX_BATCH_PHOTOS}).`);
    else setError(null);
    if (accepted.length === 0) return;
    const batch = ensureBatch();
    setBusy(accepted.length);
    const store = await fieldPhotoStore();
    let seq = nextSeq(photoSyncSnapshot().photos, batch);
    for (const file of accepted) {
      try {
        const out = await compressPhoto(file);
        await store.put({
          id: `${batch}-${seq}-${now().toString(36)}`,
          batchId: batch,
          tenantId: scopeNow.tenantId,
          userId: scopeNow.userId,
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
        setError(/quota/i.test(msg) ? "Telefonun deposu dolu: fotoğraf saklanamadı." : msg);
      }
      setBusy((n) => Math.max(0, n - 1));
    }
    setBusy(0);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    void addFiles(files);
  }

  async function remove(photo: StoredPhoto) {
    const store = await fieldPhotoStore();
    await store.remove([photo.id]);
    const u = thumbUrls.get(photo.id);
    if (u) URL.revokeObjectURL(u);
    thumbUrls.delete(photo.id);
    await refreshPhotos();
  }

  async function makeCover(photo: StoredPhoto) {
    const store = await fieldPhotoStore();
    await store.patch(photo.id, { seq: coverSeq(photoSyncSnapshot().photos, photo.batchId) });
    await refreshPhotos();
  }

  return (
    <fieldset className="flex flex-col gap-3 sm:col-span-2" data-photo-step="">
      <legend className="mb-1.5 text-sm font-semibold text-ink-950">Fotoğraflar</legend>
      {/* "Fotoğraf çek" yalnız dokunmatik (kaba imleç) cihazda: masaüstünde kamera düğmesi ikinci birincil eylem gibi duruyordu
          (WP1 hizalama denetimi); orada tek "Galeriden seç" tam genişlik. */}
      <div className="grid grid-cols-2 gap-2 pointer-fine:grid-cols-1">
        <Button variant="outline" size="lg" icon={Camera} onClick={() => cameraRef.current?.click()} disabled={!ready || room <= 0} className="min-h-11 w-full pointer-fine:hidden">
          Fotoğraf çek
        </Button>
        <Button variant="outline" size="lg" icon={ImagePlus} onClick={() => galleryRef.current?.click()} disabled={!ready || room <= 0} className="min-h-11 w-full">
          Galeriden seç
        </Button>
        {/* Ayrı iki girdi: Android'de `capture` arka kamerayı doğrudan açar, diğeri galeriyi. `name` yok (FormData'ya girmez). */}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple onChange={onPick} className="sr-only" tabIndex={-1} aria-hidden />
        <input ref={galleryRef} type="file" accept="image/*" multiple onChange={onPick} className="sr-only" tabIndex={-1} aria-hidden />
      </div>

      {photos.length > 0 || busy > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Eklenen fotoğraflar">
          {photos.map((p, i) => (
            <PhotoThumb key={p.id} photo={p} index={i} onRemove={() => void remove(p)} onCover={() => void makeCover(p)} />
          ))}
          {busy > 0 ? (
            <li className="grid aspect-square place-items-center rounded-[var(--radius-control)] border border-dashed border-line text-sm text-text-muted" role="status">
              <span className="flex flex-col items-center gap-1">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                Hazırlanıyor
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger-600">{error}</p>
      ) : null}
      <HelperText>
        {photos.length > 0 ? `${photos.length} fotoğraf hazır. ` : "İsteğe bağlı. "}
        Fotoğraflar kaydettikten sonra yüklenir; bağlantı yoksa telefonda bekler.
      </HelperText>
    </fieldset>
  );
}

/** Form kaydı başarıyla bitince çağrılır: adım sökülürken parti silinmez (artık portföye bağlıdır). */
export const PHOTO_STEP_SAVED_EVENT = "emlaksoft:property-photo-step-saved";
export function markPhotoBatchSaved() {
  window.dispatchEvent(new Event(PHOTO_STEP_SAVED_EVENT));
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

function PhotoThumb({ photo, index, onRemove, onCover }: { photo: StoredPhoto; index: number; onRemove: () => void; onCover: () => void }) {
  return (
    <li className="relative aspect-square overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface-sunken">
      {/* eslint-disable-next-line @next/next/no-img-element -- yerel blob önizlemesi (next/image blob: adresini işlemez) */}
      <img src={thumbUrl(photo)} alt={`Fotoğraf ${index + 1}`} className="h-full w-full object-cover" />
      {index === 0 ? (
        <span className="pointer-events-none absolute bottom-1 left-1 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">
          <Star className="h-3 w-3" aria-hidden /> Kapak
        </span>
      ) : (
        <Button variant="secondary" size="xs" icon={Star} onClick={onCover} className="absolute bottom-1 left-1 rounded-full px-2" aria-label={`Fotoğraf ${index + 1}: kapak yap`}>
          Kapak
        </Button>
      )}
      <Button variant="secondary" size="icon" icon={X} onClick={onRemove} className="absolute right-1 top-1 rounded-full" aria-label={`Fotoğraf ${index + 1}: kaldır`} />
    </li>
  );
}
