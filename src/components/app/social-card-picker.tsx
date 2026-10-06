"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { FormSelect } from "@/components/ui/form-controls";

type Format = "kare" | "hikaye";

const FORMATS: { value: Format; label: string; w: number; h: number }[] = [
  { value: "kare", label: "Gönderi 1080×1080", w: 1080, h: 1080 },
  { value: "hikaye", label: "Hikâye 1080×1920", w: 1080, h: 1920 },
];

export function SocialCardPicker({
  propertyId,
  links,
  hasEidsNo,
  hasLicenseNo,
}: {
  propertyId: string;
  links: { id: string; label: string }[];
  hasEidsNo: boolean;
  hasLicenseNo: boolean;
}) {
  const [format, setFormat] = useState<Format>("kare");
  const [linkId, setLinkId] = useState(links[0]?.id ?? "");
  const src = `/api/app/portfoy/${propertyId}/sosyal-kart?bicim=${format}&ilan=${encodeURIComponent(linkId)}`;
  const current = FORMATS.find((f) => f.value === format)!;

  return (
    <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <div role="radiogroup" aria-label="Kart biçimi" className="flex flex-wrap gap-2">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={format === f.value}
              onClick={() => setFormat(f.value)}
              className={`focus-ring rounded-[var(--radius-control)] border px-3 py-1.5 text-xs font-semibold transition ${
                format === f.value ? "border-brand-500 bg-brand-600/10 text-brand-700" : "border-line text-text-muted hover:text-ink-950"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="block space-y-1.5">
          <span className="block text-xs font-semibold text-ink-950">EİDS doğrulanmış ilan bağlantısı</span>
          <FormSelect value={linkId} onChange={(e) => setLinkId(e.target.value)}>
            {links.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </FormSelect>
        </label>
        {!hasEidsNo || !hasLicenseNo ? (
          <p className="text-xs text-amber-700">
            {!hasLicenseNo ? "Ofis yetki belgesi no girilmemiş (Ayarlar > Firma bilgileri). " : ""}
            {!hasEidsNo ? "EİDS taşınmaz no girilmemiş (portföy > Yetki belgesi)." : ""} Girilmeyen numara kartta yer almaz.
          </p>
        ) : null}
        <a
          href={`${src}&indir=1`}
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-brand-700"
        >
          <Download className="h-3.5 w-3.5" aria-hidden /> Kartı indir (PNG)
        </a>
        <p className="text-xs text-text-faint">
          Paylaşım metni için AI içerik motorunda &quot;Sosyal medya&quot; sekmesini kullanın; bağlantı metne otomatik eklenir.
        </p>
      </div>
      <div className="flex justify-center rounded-[var(--radius-card)] border border-line bg-canvas p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- oturumlu dinamik PNG (next/og), next/image optimizasyonu gereksiz */}
        <img
          key={src}
          src={src}
          alt="Sosyal medya kartı önizlemesi"
          width={current.w / 4}
          height={current.h / 4}
          className="h-auto max-h-96 w-auto rounded-[var(--radius-control)] shadow-[var(--shadow-xs)]"
        />
      </div>
    </div>
  );
}
