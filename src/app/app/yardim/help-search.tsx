"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Bot, Search } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { GUIDES, matchesQuery } from "@/lib/help-content";
import { FAQ, FAQ_CATEGORIES } from "@/lib/help-faq";

const PANEL = "rounded-[var(--radius-panel)] border border-line bg-surface p-5";

/** Aramayı URL'ye (?q=) yazar; sunucuyu yeniden çağırmaz (süzgeç istemcidedir). */
function syncUrl(q: string) {
  try {
    const url = new URL(window.location.href);
    if (q.trim()) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url.toString());
  } catch {
    /* adres çubuğu güncellenemezse süzgeç yine çalışır */
  }
}

function AskAssistant({ q }: { q: string }) {
  const href = q.trim() ? `/app/asistan?q=${encodeURIComponent(q.trim())}` : "/app/asistan";
  return (
    <div className={`${PANEL} flex flex-wrap items-center justify-between gap-3`}>
      <p className="text-sm text-text-muted">Rehberde bulamadın mı? AI Asistana sor.</p>
      <ButtonLink href={href} variant="secondary" icon={Bot}>
        AI Asistana sor
      </ButtonLink>
    </div>
  );
}

function SearchBox({ q, onChange, label }: { q: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" aria-hidden />
      <input
        type="search"
        value={q}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        placeholder={label}
        className="focus-ring min-h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface py-2 pl-9 pr-3 text-sm text-text"
      />
    </div>
  );
}

export function GuidesSearch({ initialQ }: { initialQ: string }) {
  const [q, setQ] = useState(initialQ);
  const list = GUIDES.filter((g) => matchesQuery([g.title, g.intro, ...g.steps], q));
  function change(v: string) {
    setQ(v);
    syncUrl(v);
  }
  return (
    <section aria-label="Rehberler" className="space-y-4">
      <SearchBox q={q} onChange={change} label="Rehberlerde ara" />
      <p className="text-xs text-text-muted" role="status" aria-live="polite">
        {list.length} rehber{q.trim() ? ` bulundu` : ""}
      </p>
      {list.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Rehber listesi">
          {list.map((g) => (
            <li key={g.slug}>
              <a
                href={`#${g.slug}`}
                className="focus-ring inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold text-text-muted transition hover:border-brand-300 hover:text-ink-950"
              >
                {g.title}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className={PANEL}>
          <p className="text-sm text-text-muted">Aramanıza uyan rehber yok. Başka bir sözcük deneyin ya da AI Asistana sorun.</p>
        </div>
      )}
      {list.map((g) => (
        <article key={g.slug} id={g.slug} className={`${PANEL} scroll-mt-24`}>
          <h2 className="font-display text-lg font-bold text-ink-950">{g.title}</h2>
          <p className="mt-1 text-sm text-text-muted">{g.intro}</p>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-base leading-relaxed text-text marker:font-bold marker:text-brand-600">
            {g.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="mt-5">
            <ButtonLink href={g.href} iconRight={ArrowRight}>
              Şimdi dene: {g.cta}
            </ButtonLink>
          </div>
        </article>
      ))}
      <AskAssistant q={q} />
    </section>
  );
}

export function FaqSearch({ initialQ }: { initialQ: string }) {
  const [q, setQ] = useState(initialQ);
  const list = FAQ.filter((f) => matchesQuery([f.q, f.a], q));
  function change(v: string) {
    setQ(v);
    syncUrl(v);
  }
  return (
    <section aria-label="Sık sorulan sorular" className="space-y-4">
      <SearchBox q={q} onChange={change} label="Sık sorulan sorularda ara" />
      <p className="text-xs text-text-muted" role="status" aria-live="polite">
        {list.length} soru{q.trim() ? ` bulundu` : ""}
      </p>
      {list.length === 0 ? (
        <div className={PANEL}>
          <p className="text-sm text-text-muted">Aramanıza uyan soru yok. Başka bir sözcük deneyin ya da AI Asistana sorun.</p>
        </div>
      ) : null}
      {FAQ_CATEGORIES.map((c) => {
        const items = list.filter((f) => f.category === c.id);
        if (items.length === 0) return null;
        return (
          <div key={c.id} className="space-y-2">
            <h2 className="font-display text-base font-bold text-ink-950">{c.label}</h2>
            {items.map((f) => (
              <details key={f.id} id={f.id} open={q.trim() ? true : undefined} className={`${PANEL} scroll-mt-24 py-3`}>
                <summary className="focus-ring min-h-11 cursor-pointer text-base font-semibold text-ink-950">{f.q}</summary>
                <p className="mt-2 text-base leading-relaxed text-text">{f.a}</p>
                {f.href ? (
                  <Link
                    href={f.href}
                    className="focus-ring mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-600 hover:underline"
                  >
                    {f.hrefLabel ?? "Sayfaya git"} <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                ) : null}
              </details>
            ))}
          </div>
        );
      })}
      <AskAssistant q={q} />
    </section>
  );
}
