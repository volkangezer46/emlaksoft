import Link from "next/link";
import { ArrowLeft, IdCard, ShieldCheck } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { slugifyAgentName } from "@/lib/agent-profile";
import { KartvizitForm, type KartvizitView } from "./kartvizit-form";

/**
 * "Kartvizitim" — danışmanın kendi public mini profilini (/danisman/[slug])
 * düzenlediği sayfa.
 *
 * YETKİ: sayfa kapısı `team` modülü (requireModulePage). Kişi KENDİ kartını
 * `team:view` ile düzenler; `?uye=<id>` ile başka bir üyenin kartına geçmek
 * `team:edit` ister — bu kontrol server action'da (`saveAgentProfile`) yapılır,
 * burada yalnızca hangi profilin gösterileceği belirlenir. Profil okuması RLS'li
 * client ile yapıldığı için başka kiracının üyesi hiçbir koşulda açılmaz.
 */
export default async function KartvizitimPage({
  searchParams,
}: {
  searchParams?: Promise<{ uye?: string }>;
}) {
  const { userId, perms, tenantId } = await requireModulePage("team");
  const sp = (await searchParams) ?? {};
  const canEditOthers = (perms.team ?? []).includes("edit");

  // Yetkisi olmayan biri ?uye= ile başkasının kartını AÇAMAZ — kendi kartına düşer.
  const targetId = sp.uye && canEditOthers ? sp.uye : (userId ?? "");

  const supabase = await createClient();
  const [{ data: profile }, { data: tenant }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, title, bio, photo_url, specialties, languages, public_slug, is_public, public_view_count")
      .eq("id", targetId)
      .maybeSingle(),
    tenantId
      ? supabase.from("tenants").select("name, slug").eq("id", tenantId).maybeSingle()
      : Promise.resolve({ data: null as { name?: string; slug?: string } | null }),
  ]);

  if (!profile) {
    return (
      <div className="rounded-[20px] border border-dashed border-line bg-surface px-5 py-16 text-center">
        <IdCard className="mx-auto h-8 w-8 text-text-faint" />
        <p className="mt-3 text-sm font-semibold text-ink-950">Profil bulunamadı</p>
        <p className="mt-1 text-xs text-text-muted">
          Platform ekibi hesabıyla giriş yaptıysanız kartvizit düzenlenemez.
        </p>
        <Link
          href="/app/ekip"
          className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-xs font-bold text-brand-600 transition hover:border-brand-300"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Ekibe dön
        </Link>
      </div>
    );
  }

  const view: KartvizitView = {
    targetId: String(profile.id),
    isSelf: String(profile.id) === userId,
    fullName: String(profile.full_name ?? ""),
    phone: (profile.phone as string | null) ?? null,
    title: (profile.title as string | null) ?? "",
    bio: (profile.bio as string | null) ?? "",
    photoUrl: (profile.photo_url as string | null) ?? null,
    specialties: (profile.specialties as string[] | null) ?? [],
    languages: (profile.languages as string[] | null) ?? [],
    slug: (profile.public_slug as string | null) ?? "",
    suggestedSlug: slugifyAgentName(String(profile.full_name ?? "")),
    isPublic: profile.is_public === true,
    viewCount: Number(profile.public_view_count ?? 0),
    officeName: (tenant?.name as string | null) ?? "Ofisiniz",
    officeSlug: (tenant?.slug as string | null) ?? null,
  };

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-brand-600/30 blur-[90px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
              <IdCard className="h-4 w-4" /> Dijital kartvizit
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">
              {view.isSelf ? "Kartvizitim" : `${view.fullName} kartviziti`}
            </h1>
            <p className="mt-1 max-w-xl text-sm text-white/60">
              Tek link paylaşın: müşteri fotoğrafınızı, uzmanlığınızı, yayındaki portföylerinizi ve
              memnuniyet puanınızı görsün; tek tıkla arasın, WhatsApp yazsın veya randevu alsın.
            </p>
          </div>
          <Link
            href="/app/ekip"
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" /> Ekip
          </Link>
        </div>
      </section>

      {!view.isSelf ? (
        <div className="flex items-center gap-3 rounded-[14px] border border-amber-400/30 bg-amber-400/8 px-4 py-3 text-sm text-ink-950">
          <ShieldCheck className="h-5 w-5 text-amber-500" /> Başka bir ekip üyesinin kartvizitini
          düzenliyorsunuz. Değişiklikler denetim kaydına yazılır.
        </div>
      ) : null}

      <KartvizitForm view={view} />
    </div>
  );
}
