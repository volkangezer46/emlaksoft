"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Target, UserPlus, ListChecks, UserRound } from "lucide-react";
import { FileInput } from "@/components/ui/file-input";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Celebrate } from "@/components/ui/celebrate";
import { PhoneInput } from "@/components/ui/phone-input";
import { Progress } from "@/components/ui/progress";
import { completeWelcomeFlow, saveOwnPhone } from "@/app/actions/onboarding-setup";
import { uploadAgentPhoto } from "@/app/actions/agent-profile";
import { WELCOME_STEP_IDS, type WelcomeStepId } from "@/lib/welcome-flow";

type Props = {
  firstName: string;
  phone: string;
  photoUrl: string | null;
  canUploadPhoto: boolean;
  target: { deals: number; revenue: number } | null;
  canSeeTargets: boolean;
  customers: number;
  tasks: { id: string; title: string; due_at: string | null }[];
  taskCount: number;
};

const LABELS: Record<WelcomeStepId, { label: string; icon: typeof UserRound }> = {
  profil: { label: "Profilim", icon: UserRound },
  hedef: { label: "Hedefim", icon: Target },
  musteri: { label: "İlk müşterim", icon: UserPlus },
  gorev: { label: "Bugünkü görevlerim", icon: ListChecks },
};

const inputCls =
  "focus-ring w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm text-text";
const money = (n: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
const saat = (iso: string | null) => (iso ? new Intl.DateTimeFormat("tr-TR", { timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(iso)) : "");

/**
 * Yeni danışman "Hoş geldin" akışı: 4 kısa adım, hepsi atlanabilir. Bitince ya da kapatılınca
 * kullanıcı çerezi yazılır; ana ekran bir daha yönlendirmez.
 */
export function HosgeldinAkisi(p: Props) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [pending, startTransition] = useTransition();
  const step = WELCOME_STEP_IDS[index];
  const last = index === WELCOME_STEP_IDS.length - 1;

  function finish(to: string) {
    startTransition(async () => {
      await completeWelcomeFlow();
      router.push(to);
    });
  }

  if (finished) {
    return (
      <Card>
        <CardContent className="space-y-4 py-8 text-center">
          <div className="flex justify-center">
            <Celebrate label="Hazırsınız" />
          </div>
          <h1 className="font-display text-xl font-bold text-text">Hazırsınız{p.firstName ? `, ${p.firstName}` : ""}</h1>
          <p className="text-sm text-text-muted">Günlük işleriniz Bugün ekranında sizi bekliyor.</p>
          <Button loading={pending} iconRight={ArrowRight} onClick={() => finish("/app")}>
            Bugün ekranına git
          </Button>
        </CardContent>
      </Card>
    );
  }

  const percent = Math.round((index / WELCOME_STEP_IDS.length) * 100);
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Hoş geldiniz</p>
        <h1 className="font-display text-2xl font-bold text-text">
          Merhaba{p.firstName ? `, ${p.firstName}` : ""}. Dört kısa adımda hazırsınız.
        </h1>
      </div>

      <Card>
        <CardContent className="space-y-3">
          <Progress value={percent} label="Hoş geldin ilerlemesi" />
          <ol className="flex gap-1 overflow-x-auto pb-1" aria-label="Adımlar">
            {WELCOME_STEP_IDS.map((id, i) => {
              const Icon = LABELS[id].icon;
              return (
                <li key={id} className="shrink-0">
                  <button
                    type="button"
                    aria-current={i === index ? "step" : undefined}
                    onClick={() => setIndex(i)}
                    className={
                      "focus-ring flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition " +
                      (i === index ? "bg-accent text-white" : i < index ? "bg-mint-500/12 text-mint-600" : "bg-line text-text-muted hover:text-text")
                    }
                  >
                    {i < index ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Icon className="h-3.5 w-3.5" aria-hidden />}
                    {LABELS[id].label}
                  </button>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          {step === "profil" ? <ProfileStep {...p} onSaved={() => setIndex(1)} /> : null}
          {step === "hedef" ? <TargetStep {...p} /> : null}
          {step === "musteri" ? <CustomerStep {...p} /> : null}
          {step === "gorev" ? <TasksStep {...p} /> : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {index > 0 ? (
            <Button variant="ghost" icon={ArrowLeft} onClick={() => setIndex(index - 1)}>
              Geri
            </Button>
          ) : null}
          <Button variant="ghost" loading={pending} onClick={() => finish("/app")}>
            Şimdilik geç
          </Button>
        </div>
        <Button
          variant={last ? "primary" : "secondary"}
          iconRight={ArrowRight}
          onClick={() => (last ? setFinished(true) : setIndex(index + 1))}
        >
          {last ? "Bitir" : "İleri"}
        </Button>
      </div>
    </div>
  );
}

function StepHead({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h2 className="font-display text-lg font-bold text-text">{title}</h2>
      <p className="mt-0.5 text-sm text-text-muted">{text}</p>
    </div>
  );
}

function ProfileStep(p: Props & { onSaved: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await saveOwnPhone(fd);
      if (res.error) return setError(res.error);
      const file = fileRef.current?.files?.[0];
      if (p.canUploadPhoto && file && file.size > 0) {
        const up = new FormData();
        up.set("photo", file);
        const photo = await uploadAgentPhoto(up);
        if (photo.error) return setError(`Telefon kaydedildi ama fotoğraf yüklenemedi: ${photo.error}`);
      }
      router.refresh();
      p.onSaved();
    });
  }

  return (
    <>
      <StepHead title="Profiliniz" text="Müşteriler ve ekip arkadaşlarınız size bu numaradan ulaşır." />
      <form action={submit} className="space-y-3">
        <div>
          <label htmlFor="hg-phone" className="mb-1 block text-xs font-semibold text-text-muted">
            Telefon
          </label>
          <PhoneInput id="hg-phone" name="phone" defaultValue={p.phone} className={inputCls} />
        </div>
        {p.canUploadPhoto ? (
          <div>
            <label htmlFor="hg-photo" className="mb-1 block text-xs font-semibold text-text-muted">
              Fotoğraf (isteğe bağlı)
            </label>
            <div className="flex items-center gap-3">
              {p.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- depodan gelen portre
                <img src={p.photoUrl} alt="Mevcut fotoğraf" className="h-10 w-10 rounded-full border border-line object-cover" />
              ) : null}
              <FileInput id="hg-photo" ref={fileRef} accept="image/png,image/jpeg,image/webp" />
            </div>
          </div>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button type="submit" loading={pending}>
          Kaydet ve devam et
        </Button>
      </form>
    </>
  );
}

function TargetStep(p: Props) {
  return (
    <>
      <StepHead title="Hedefiniz" text="Bu ayki hedefiniz Bugün ekranındaki hedef kartında ilerlemenizle birlikte görünür." />
      {p.target && (p.target.deals > 0 || p.target.revenue > 0) ? (
        <dl className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3">
            <dt className="text-xs text-text-faint">Aylık anlaşma hedefi</dt>
            <dd className="numeric text-lg font-bold text-ink-950">{p.target.deals}</dd>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3">
            <dt className="text-xs text-text-faint">Aylık ciro hedefi</dt>
            <dd className="numeric text-lg font-bold text-ink-950">{money(p.target.revenue)}</dd>
          </div>
        </dl>
      ) : (
        <Alert tone="info">Bu ay için size henüz hedef atanmamış. Hedefinizi ofis yöneticiniz belirler; atanınca burada ve Bugün ekranında görünür.</Alert>
      )}
      {p.canSeeTargets ? (
        <ButtonLink href="/app/hedefler" variant="secondary" iconRight={ArrowRight}>
          Hedefler sayfası
        </ButtonLink>
      ) : null}
    </>
  );
}

function CustomerStep(p: Props) {
  return (
    <>
      <StepHead title="İlk müşteriniz" text="Müşteri kaydı talep, randevu ve anlaşmanın başlangıç noktasıdır. Ad ve telefon yeterli." />
      {p.customers > 0 ? (
        <Alert tone="success">
          Üzerinizde {p.customers} müşteri kaydı var. Yenisini istediğiniz zaman ekleyebilirsiniz.
        </Alert>
      ) : null}
      <ButtonLink href="/app/musteriler/yeni" iconRight={ArrowRight}>
        {p.customers > 0 ? "Yeni müşteri ekle" : "İlk müşterimi ekle"}
      </ButtonLink>
    </>
  );
}

function TasksStep(p: Props) {
  return (
    <>
      <StepHead title="Bugünkü görevleriniz" text="Her sabah Bugün ekranı sizi önce görevlerle karşılar." />
      {p.tasks.length > 0 ? (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
          {p.tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-text">{t.title}</span>
              <span className="numeric text-xs text-text-muted">{saat(t.due_at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Alert tone="info">Bugün için açık göreviniz yok. Görevler sayfasından ilk görevinizi ekleyebilirsiniz.</Alert>
      )}
      <Link href="/app/gorevler" className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
        {p.taskCount > p.tasks.length ? `${p.taskCount} görevin tamamı` : "Görevlerim"} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </>
  );
}
