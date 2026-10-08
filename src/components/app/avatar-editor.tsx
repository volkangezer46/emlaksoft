"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { AvatarArt } from "@/components/ui/avatar-art";
import { Button, buttonClass } from "@/components/ui/button";
import { AVATAR_MAX_BYTES, AVATAR_PRESETS, AVATAR_SIZE_PX } from "@/lib/avatar-presets";
import { cn } from "@/lib/utils";

type ActionResult = { ok?: boolean; error?: string };

export type AvatarEditorActions = {
  upload: (fd: FormData) => Promise<ActionResult>;
  preset: (key: string) => Promise<ActionResult>;
  remove: () => Promise<ActionResult>;
};

const PREVIEW_PX = 240;
const SOURCE_MAX_BYTES = 12 * 1024 * 1024; // seçilen ham dosya; küçültülünce 2 MB altına iner

type Crop = { zoom: number; cx: number; cy: number }; // cx/cy: görselin odak noktası (0..1)

/** Kare kırpmayı verilen tuvale çizer (önizleme ve çıktı AYNI matematiği kullanır). */
function drawCrop(canvas: HTMLCanvasElement, img: HTMLImageElement, size: number, crop: Crop) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = size;
  canvas.height = size;
  const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight) * crop.zoom;
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  const x = Math.min(0, Math.max(size - w, size / 2 - crop.cx * w));
  const y = Math.min(0, Math.max(size - h, size / 2 - crop.cy * h));
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, x, y, w, h);
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/** 512x512 WebP (desteklenmezse JPEG); 2 MB'ı aşarsa kaliteyi düşürür. */
async function exportSquare(img: HTMLImageElement, crop: Crop): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  drawCrop(canvas, img, AVATAR_SIZE_PX, crop);
  for (const type of ["image/webp", "image/jpeg"]) {
    for (const q of [0.9, 0.8, 0.65, 0.5]) {
      const blob = await toBlob(canvas, type, q);
      if (blob && blob.type === type && blob.size <= AVATAR_MAX_BYTES) return blob;
    }
  }
  return null;
}

/**
 * Profil fotoğrafı kartının gövdesi: yükle (kare kırpma önizlemeli) / hazır avatar seç / kaldır.
 * Ağır kütüphane yok: canvas ile istemcide küçültülür; sunucu yine içeriği doğrular.
 * Eylemler prop olarak gelir (ofis ve platform ayrı action'lar kullanır).
 */
export function AvatarEditor({
  name,
  avatarUrl,
  avatarPreset,
  actions,
}: {
  name: string;
  avatarUrl: string | null;
  avatarPreset: string | null;
  actions: AvatarEditorActions;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>({ zoom: 1, cx: 0.5, cy: 0.5 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const objectUrl = useRef<string | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (img && canvasRef.current) drawCrop(canvasRef.current, img, PREVIEW_PX, crop);
  }, [img, crop]);

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  function run(fn: () => Promise<ActionResult>, okText: string, after?: () => void) {
    setNotice(null);
    start(async () => {
      const res = await fn();
      if (res.error) setNotice({ tone: "error", text: res.error });
      else {
        setNotice({ tone: "ok", text: okText });
        after?.();
        router.refresh();
      }
    });
  }

  function closeCropper() {
    setImg(null);
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setNotice({ tone: "error", text: "Yalnızca JPEG, PNG veya WebP görsel yüklenebilir." });
      return;
    }
    if (file.size > SOURCE_MAX_BYTES) {
      setNotice({ tone: "error", text: "Seçilen dosya çok büyük (en çok 12 MB)." });
      return;
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    const url = URL.createObjectURL(file);
    objectUrl.current = url;
    const el = new Image();
    el.onload = () => {
      setNotice(null);
      setCrop({ zoom: 1, cx: 0.5, cy: 0.5 });
      setImg(el);
    };
    el.onerror = () => setNotice({ tone: "error", text: "Görsel okunamadı. Başka bir dosya deneyin." });
    el.src = url;
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drag.current || !img) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    const scale = Math.max(PREVIEW_PX / img.naturalWidth, PREVIEW_PX / img.naturalHeight) * crop.zoom;
    setCrop((c) => ({
      ...c,
      cx: Math.min(1, Math.max(0, c.cx - dx / (img.naturalWidth * scale))),
      cy: Math.min(1, Math.max(0, c.cy - dy / (img.naturalHeight * scale))),
    }));
  }

  function save() {
    if (!img) return;
    setNotice(null);
    start(async () => {
      const blob = await exportSquare(img, crop);
      if (!blob) {
        setNotice({ tone: "error", text: "Fotoğraf 2 MB altına küçültülemedi. Daha küçük bir görsel deneyin." });
        return;
      }
      const fd = new FormData();
      fd.set("photo", new File([blob], blob.type === "image/webp" ? "avatar.webp" : "avatar.jpg", { type: blob.type }));
      const res = await actions.upload(fd);
      if (res.error) setNotice({ tone: "error", text: res.error });
      else {
        setNotice({ tone: "ok", text: "Profil fotoğrafı güncellendi." });
        closeCropper();
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={name} src={avatarUrl} preset={avatarPreset} size="xl" />
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <label
              className={buttonClass({ variant: "outline", className: cn("cursor-pointer", pending && "pointer-events-none opacity-60") })}
            >
              <Camera className="h-4 w-4" aria-hidden /> Fotoğraf yükle
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onPick} disabled={pending} />
            </label>
            {avatarUrl || avatarPreset ? (
              <Button type="button" variant="ghost" icon={Trash2} disabled={pending} onClick={() => run(actions.remove, "Avatar kaldırıldı.")}>
                Kaldır
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-text-muted">JPEG, PNG veya WebP. Kare kırpılır, 512x512 olarak kaydedilir (en çok 2 MB).</p>
        </div>
      </div>

      {img ? (
        <div className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface-raised p-4">
          <p className="text-sm font-semibold text-text">Kırpma önizlemesi</p>
          <canvas
            ref={canvasRef}
            width={PREVIEW_PX}
            height={PREVIEW_PX}
            aria-label="Kare kırpma önizlemesi; sürükleyerek konumlandırın"
            className="h-60 w-60 cursor-grab touch-none rounded-full border border-hairline active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          />
          <label className="flex max-w-60 items-center gap-3 text-xs text-text-muted">
            Yakınlaştır
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={crop.zoom}
              onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))}
              className="flex-1"
            />
          </label>
          <div className="flex gap-2">
            <Button type="button" icon={Check} loading={pending} onClick={save}>
              Kaydet
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={closeCropper}>
              Vazgeç
            </Button>
          </div>
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-sm font-semibold text-text">Hazır avatarlar</p>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8" role="radiogroup" aria-label="Hazır avatar seçimi">
          {AVATAR_PRESETS.map((p) => {
            const selected = !avatarUrl && avatarPreset === p.key;
            return (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={p.label}
                title={p.label}
                disabled={pending}
                onClick={() => run(() => actions.preset(p.key), `${p.label} avatarı seçildi.`)}
                className={cn(
                  "focus-ring press grid aspect-square place-items-center overflow-hidden rounded-full border-2 transition disabled:opacity-60",
                  selected ? "border-accent ring-2 ring-accent/30" : "border-transparent hover:border-border-interactive",
                )}
              >
                <AvatarArt preset={p.key} className="h-full w-full" />
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-text-muted">Fotoğraf yüklüyse o gösterilir; hazır avatar seçmek fotoğrafı kaldırır.</p>
      </div>

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium",
            notice.tone === "error" ? "bg-danger-500/8 text-danger-600" : "bg-mint-500/10 text-mint-700",
          )}
        >
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
