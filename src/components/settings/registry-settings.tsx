import Link from "next/link";
import { SettingField } from "@/components/settings/setting-field";
import { getPlatformSettingViews } from "@/lib/settings/read";

/**
 * Bölüm sayfasındaki "Ayarlar" kısmı: ayar defterinden (src/lib/settings/registry) verilen anahtarların TEK düzenleme
 * yeri. İkinci form yazılmaz; yazma, doğrulama, gerekçe, geçmiş ve geri alma `SettingField` + `writeSetting` ile aynıdır.
 * Sunucu bileşeni; değerler gizli değildir (gizli ayarlar burada gösterilmez).
 */
export async function RegistrySettings({
  id = "ayarlar",
  title,
  description,
  keys,
  canEdit,
}: {
  id?: string;
  title: string;
  description?: string;
  keys: readonly string[];
  canEdit: boolean;
}) {
  const views = await getPlatformSettingViews();
  const shown = keys.map((k) => views.find((v) => v.key === k)).filter((v): v is NonNullable<typeof v> => Boolean(v) && v!.sensitivity !== "secret");
  if (shown.length === 0) return null;
  return (
    <section id={id} aria-labelledby={`${id}-baslik`} className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={`${id}-baslik`} className="text-base font-semibold text-ink-950">
            {title}
          </h2>
          {description ? <p className="text-xs text-text-muted">{description}</p> : null}
        </div>
        <Link href="/admin/ayarlar/merkez" className="text-xs font-semibold text-brand-600 hover:underline">
          Tüm ayarlar →
        </Link>
      </div>
      <div className="grid gap-3">
        {shown.map((v) => (
          <SettingField key={v.key} view={v} canEdit={canEdit} />
        ))}
      </div>
    </section>
  );
}
