"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PhotoUploadStatus, usePhotoSync } from "@/app/app/hizli/field-photos";

/**
 * Portföy detayının Fotoğraflar sekmesi: yeni portföy formunda çekilen fotoğrafların kayıttan SONRA süren yüklemesinin
 * ilerlemesi (sadeleştirme C16). Kuyrukta bu portföye ait iş yoksa hiçbir şey çizilmez. Her fotoğraf yüklendikçe ve
 * hepsi bitince sayfa sessizce tazelenir: yüklenen fotoğraflar medya listesinde görünür.
 */
export function PropertyPhotoUploadStatus({ propertyId }: { propertyId: string }) {
  const snap = usePhotoSync();
  const router = useRouter();
  const summary = snap.summaries.find((s) => s.propertyId === propertyId);
  const uploaded = summary?.uploaded ?? 0;
  const last = useRef(uploaded);
  useEffect(() => {
    if (uploaded > last.current) router.refresh();
    last.current = uploaded;
  }, [uploaded, router]);
  return <PhotoUploadStatus propertyId={propertyId} />;
}
