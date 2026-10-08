import Link from "@/components/ui/smart-link";
import { ArrowRight, Circle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { isOfficeProfileDone, PROFILE_WIZARD_HREF, profileStepHref, type ProfileCompletion } from "@/lib/profile-completion";

/**
 * Adım 1 (Ofis bilgileri): TEK kaynak `/app/ayarlar/profil-tamamla` sihirbazıdır — aynı alanları iki yerde sormayız.
 * Burada yalnız ilerleme (profil-tamamlama ile AYNI hesap; ekip daveti kurulumda ayrı adım olduğundan sayılmaz) ve
 * eksik maddelerden ilgili sihirbaz adımına bağlantılar gösterilir; form, doğrulama ve kayıt sihirbazdadır.
 */
export function OfficeStep({ canEdit, completion }: { canEdit: boolean; completion: ProfileCompletion }) {
  if (!canEdit) {
    return <Alert tone="info">Ofis bilgilerini yalnız ayar yetkisi olan kullanıcılar düzenleyebilir. Bu adımı atlayabilirsiniz.</Alert>;
  }
  const missing = completion.missing.filter((m) => m.step !== "ekip");
  const done = isOfficeProfileDone(completion);
  const total = completion.total - completion.items.filter((i) => i.step === "ekip").length;
  const doneCount = total - missing.length;
  const percent = total === 0 ? 100 : Math.round((doneCount / total) * 100);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-text">
            {doneCount} / {total} ofis bilgisi tamam
          </p>
          <p className="text-sm font-semibold text-text-muted">%{percent}</p>
        </div>
        <Progress value={percent} label="Ofis bilgileri ilerlemesi" tone={done ? "success" : "accent"} />
      </div>
      {done ? (
        <Alert tone="success">Ofis bilgileriniz tamam. Değiştirmek için profil sihirbazını açabilirsiniz.</Alert>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label="Eksik bilgiler">
          {missing.map((m) => (
            <li key={m.id}>
              <Link
                href={profileStepHref(m.step)}
                className="focus-ring inline-flex min-h-9 touch:min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-ink-950"
              >
                <Circle className="h-3 w-3 text-text-faint" aria-hidden="true" />
                {m.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ButtonLink href={done ? PROFILE_WIZARD_HREF : profileStepHref(missing[0]?.step ?? "konum")} iconRight={ArrowRight}>
        {done ? "Ofis profilini aç" : "Ofis profilini tamamla"}
      </ButtonLink>
    </div>
  );
}
