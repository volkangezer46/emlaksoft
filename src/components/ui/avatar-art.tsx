import type { ReactNode } from "react";
import { AVATAR_TONE_VARS, presetMeta, type AvatarPresetKey } from "@/lib/avatar-presets";

const INK = "var(--avatar-art-ink, #ffffff)";
const SHADE = "var(--navy-900, #0f1a33)";

/** 64x64 koordinatında, beyaz çizgi/dolgu motifler. Cinsiyet/etnik kimlik içermez: nesne ve doğa simgeleri. */
const MOTIFS: Record<AvatarPresetKey, ReactNode> = {
  ev: (
    <>
      <path d="M32 15 51 31h-5v18H18V31h-5z" fill={INK} />
      <rect x="28" y="36" width="8" height="13" rx="1.5" fill={SHADE} fillOpacity=".28" />
    </>
  ),
  anahtar: (
    <>
      <circle cx="23" cy="32" r="9" fill="none" stroke={INK} strokeWidth="5" />
      <path d="M31 32h20M44 32v8M51 32v6" stroke={INK} strokeWidth="5" strokeLinecap="round" fill="none" />
    </>
  ),
  bina: (
    <>
      <rect x="19" y="14" width="26" height="36" rx="2" fill={INK} />
      <g fill={SHADE} fillOpacity=".28">
        <rect x="24" y="20" width="5" height="5" />
        <rect x="35" y="20" width="5" height="5" />
        <rect x="24" y="30" width="5" height="5" />
        <rect x="35" y="30" width="5" height="5" />
        <rect x="28" y="41" width="8" height="9" />
      </g>
    </>
  ),
  kapi: (
    <>
      <path d="M21 50V28a11 11 0 0 1 22 0v22z" fill={INK} />
      <circle cx="38" cy="38" r="2" fill={SHADE} fillOpacity=".35" />
    </>
  ),
  yaprak: (
    <>
      <path d="M17 47C14 28 26 16 48 15c1 22-9 33-26 33z" fill={INK} />
      <path d="M20 45C28 36 34 30 41 23" stroke={SHADE} strokeOpacity=".3" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </>
  ),
  dag: (
    <>
      <path d="M10 48 27 20l9 14 5-7 13 21z" fill={INK} />
      <circle cx="47" cy="17" r="4" fill={INK} opacity=".85" />
    </>
  ),
  dalga: (
    <g fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round">
      <path d="M12 24q5-6 10 0t10 0 10 0 10 0" />
      <path d="M12 34q5-6 10 0t10 0 10 0 10 0" />
      <path d="M12 44q5-6 10 0t10 0 10 0 10 0" />
    </g>
  ),
  gunes: (
    <>
      <circle cx="32" cy="32" r="9" fill={INK} />
      <g stroke={INK} strokeWidth="4" strokeLinecap="round">
        <path d="M32 11v6M32 47v6M11 32h6M47 32h6M17 17l4 4M43 43l4 4M47 17l-4 4M21 43l-4 4" />
      </g>
    </>
  ),
  ay: <path d="M40 14a19 19 0 1 0 10 28A16 16 0 0 1 40 14z" fill={INK} />,
  yildiz: <path d="M32 12c2 11 7 16 20 20-13 4-18 9-20 20-2-11-7-16-20-20 13-4 18-9 20-20z" fill={INK} />,
  pusula: (
    <>
      <circle cx="32" cy="32" r="19" fill="none" stroke={INK} strokeWidth="4" />
      <path d="M32 18 38 32 32 46 26 32z" fill={INK} />
      <circle cx="32" cy="32" r="2.5" fill={SHADE} fillOpacity=".35" />
    </>
  ),
  kule: (
    <>
      <path d="M32 10v8M27 18h10l-2 8h-6zM29 26h6l3 24H26z" fill={INK} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <rect x="20" y="50" width="24" height="4" rx="1.5" fill={INK} />
    </>
  ),
  kopru: (
    <>
      <path d="M10 40h44" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
      <path d="M14 40Q32 12 50 40" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M22 40v-7M32 40V28M42 40v-7" stroke={INK} strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  elmas: (
    <>
      <path d="M20 22h24l8 10-20 22L12 32z" fill={INK} />
      <path d="M12 32h40M26 22l6 32 6-32" stroke={SHADE} strokeOpacity=".28" strokeWidth="2" fill="none" strokeLinejoin="round" />
    </>
  ),
  bulut: <path d="M20 46a9 9 0 0 1-1-18 12 12 0 0 1 23-3 10 10 0 0 1 3 21z" fill={INK} />,
  halka: (
    <g fill="none" stroke={INK}>
      <circle cx="32" cy="32" r="18" strokeWidth="4" />
      <circle cx="32" cy="32" r="9" strokeWidth="4" />
    </g>
  ),
};

/** Dairesel hazır avatar; kapsayıcıyı (boyut/yuvarlaklık) çağıran verir. Dekoratif: alt metni üst bileşen taşır. */
export function AvatarArt({ preset, className }: { preset: AvatarPresetKey; className?: string }) {
  const tone = presetMeta(preset)?.tone ?? "brand";
  const [from, to] = AVATAR_TONE_VARS[tone];
  const gid = `av-${preset}`;
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill={`url(#${gid})`} />
      {MOTIFS[preset]}
    </svg>
  );
}
