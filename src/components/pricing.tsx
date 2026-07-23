"use client";

import Link from "next/link";
import { useState, type ComponentType } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  Check,
  Crown,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";

type Plan = {
  name: string;
  monthly: number;
  desc: string;
  eyebrow: string;
  icon: ComponentType<{ className?: string }>;
  popular?: boolean;
  features: string[];
};

const plans: Plan[] = [
  {
    name: "Danışman",
    monthly: 990,
    desc: "Tek başına çalışan danışmanlar",
    eyebrow: "BAŞLANGIÇ",
    icon: UserRound,
    features: [
      "1 kullanıcı",
      "1.000 müşteri",
      "150 aktif portföy",
      "Temel komisyon",
      "Akıllı arama kartı",
    ],
  },
  {
    name: "Ofis",
    monthly: 2490,
    desc: "2–10 kişilik ofisler",
    eyebrow: "EN ÇOK TERCİH",
    icon: Building2,
    popular: true,
    features: [
      "5 kullanıcı dahil",
      "Sınırsız müşteri/portföy",
      "Kayıp-kaçak panosu",
      "Komisyon bölüşümü",
      "Portal teyit + kapanış formu",
    ],
  },
  {
    name: "Profesyonel",
    monthly: 5990,
    desc: "Büyük ofis ve çok şube",
    eyebrow: "ÖLÇEKLENEN EKİP",
    icon: BriefcaseBusiness,
    features: [
      "20 kullanıcı dahil",
      "AI eşleştirme",
      "Bölge fiyat istihbaratı",
      "API erişimi",
      "Softphone entegrasyonu",
    ],
  },
  {
    name: "Kurumsal",
    monthly: 12900,
    desc: "Franchise ve proje satış",
    eyebrow: "KURUMSAL GÜÇ",
    icon: Crown,
    features: [
      "50+ kullanıcı",
      "Franchise finans",
      "Beyaz etiket",
      "Özel destek (SLA)",
      "Özel entegrasyon",
    ],
  },
];

function formatTL(n: number) {
  return n.toLocaleString("tr-TR");
}

export function Pricing() {
  const [yearly, setYearly] = useState(false);

  return (
    <div>
      <div className="mx-auto mt-8 flex w-fit items-center gap-1 rounded-[14px] border border-line bg-surface p-1.5 shadow-[var(--shadow-sm)]">
        <span
          className={`rounded-[9px] px-3 py-2 text-sm font-semibold transition ${
            yearly ? "text-text-muted" : "bg-ink-950 text-white shadow-[var(--shadow-xs)]"
          }`}
        >
          Aylık
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={yearly}
          onClick={() => setYearly((v) => !v)}
          className={`relative mx-1 h-7 w-13 rounded-full p-0.5 transition-colors duration-300 ${
            yearly ? "bg-brand-600" : "bg-line-strong"
          }`}
          style={{ width: 52 }}
        >
          <span
            className={`block h-6 w-6 rounded-full bg-white shadow transition-transform duration-300 ${
              yearly ? "translate-x-6" : "translate-x-0"
            }`}
          />
        </button>
        <span
          className={`flex items-center gap-2 rounded-[9px] px-3 py-2 text-sm font-semibold transition ${
            yearly ? "bg-brand-600/10 text-brand-600" : "text-text-muted"
          }`}
        >
          Yıllık
          <span className="rounded-full bg-mint-500/15 px-2 py-0.5 text-xs font-semibold text-mint-600">
            %20 indirim
          </span>
        </span>
      </div>

      <div className="mt-9 grid gap-4 lg:grid-cols-4">
        {plans.map((plan) => {
          const price = yearly
            ? Math.round(plan.monthly * 0.8)
            : plan.monthly;
          return (
            <div
              key={plan.name}
              className={`pricing-card card-hover relative isolate flex flex-col overflow-hidden rounded-[22px] border p-6 ${
                plan.popular
                  ? "theme-dark border-brand-500/40 bg-[image:var(--grad-ink)] text-white shadow-[var(--shadow-lg)]"
                  : "border-line bg-surface"
              }`}
            >
              <plan.icon className={`pointer-events-none absolute -right-8 -top-8 -z-10 h-40 w-40 ${plan.popular ? "text-white/[0.045]" : "text-brand-600/[0.035]"}`} />
              {plan.popular ? (
                <>
                  <div
                    className="pointer-events-none absolute -inset-px -z-10 rounded-[20px] opacity-70 blur-md"
                    style={{ background: "var(--grad-brand)" }}
                  />
                  <span className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-xs font-bold text-ink-950">
                    <Sparkles className="h-3 w-3" />
                    Popüler
                  </span>
                </>
              ) : null}

              <div className="flex items-center gap-3">
                <span className={`grid h-11 w-11 place-items-center rounded-[13px] ${plan.popular ? "bg-white/10 text-mint-400" : "bg-brand-600/10 text-brand-600"}`}>
                  <plan.icon className="h-5 w-5" />
                </span>
                <div>
                  <span className={`text-[9px] font-extrabold tracking-[0.12em] ${plan.popular ? "text-mint-400" : "text-text-faint"}`}>{plan.eyebrow}</span>
                  <h3
                className={`font-display text-lg font-bold ${
                  plan.popular ? "text-white" : "text-ink-950"
                }`}
              >
                {plan.name}
              </h3>
                </div>
              </div>
              <p
                className={`mt-4 text-sm ${
                  plan.popular ? "text-white/70" : "text-text-muted"
                }`}
              >
                {plan.desc}
              </p>

              <div className="mt-5 flex items-end gap-1">
                <span
                  className={`font-display text-4xl font-bold tabular-nums ${
                    plan.popular ? "text-white" : "text-ink-950"
                  }`}
                >
                  {formatTL(price)} ₺
                </span>
                <span
                  className={`mb-1 text-sm ${
                    plan.popular ? "text-white/60" : "text-text-muted"
                  }`}
                >
                  /ay
                </span>
              </div>
              <p
                className={`mt-1 text-xs ${
                  plan.popular ? "text-white/50" : "text-text-faint"
                }`}
              >
                {yearly ? "Yıllık faturalandırılır · KDV hariç" : "KDV hariç"}
              </p>
              {yearly ? (
                <p className={`mt-2 text-[11px] font-semibold ${plan.popular ? "text-mint-400" : "text-mint-600"}`}>
                  Yılda {formatTL(plan.monthly * 12 * 0.2)} ₺ tasarruf
                </p>
              ) : null}

              <ul className="mt-5 flex-1 space-y-3 border-t border-current/10 pt-5 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span
                      className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${
                        plan.popular ? "bg-mint-500/25" : "bg-mint-500/15"
                      }`}
                    >
                      <Check
                        className={`h-3 w-3 ${
                          plan.popular ? "text-mint-400" : "text-mint-600"
                        }`}
                      />
                    </span>
                    <span
                      className={
                        plan.popular ? "text-white/85" : "text-text"
                      }
                    >
                      {f}
                    </span>
                  </li>
                ))}
              </ul>

              <Link
                href="/kayit"
                className={`btn-shine mt-7 inline-flex w-full items-center justify-center rounded-[10px] px-4 py-2.5 text-sm font-semibold transition ${
                  plan.popular
                    ? "bg-white text-ink-950 hover:bg-white/90"
                    : "bg-brand-600 text-white hover:bg-brand-700"
                }`}
              >
                14 gün ücretsiz başla <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
              <p className={`mt-3 flex items-center justify-center gap-1.5 text-[10px] ${plan.popular ? "text-white/45" : "text-text-faint"}`}>
                <ShieldCheck className="h-3.5 w-3.5" /> Kurulum ve veri aktarımı dahil
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
