import { Celebration } from "./illustrations/celebration";

/**
 * Geriye uyumlu ad. Kutlamanın tek kaynağı `illustrations/celebration.tsx` içindeki
 * `<Celebration />` bileşenidir; `Celebrate` onun "disk + tik" (`tick`) biçimidir.
 * `tone="neutral"`: kayıp gibi kutlanmayacak sonuçlarda konfetisiz gri disk.
 */
export function Celebrate({ tone = "success", label }: { tone?: "success" | "neutral"; label?: string }) {
  return <Celebration tick tone={tone} label={label} />;
}

export { Celebration };
