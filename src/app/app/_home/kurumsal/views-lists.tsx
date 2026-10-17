/* eslint-disable @next/next/no-img-element -- yetkili küçük resim ucundan (`/api/property-media/<id>/thumb`) gelen sabit oranlı kapaklar; next/image istemci kodu eklemez */
import Link from "@/components/ui/smart-link";
import { ClipboardCheck, Layers, ListTodo } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { FavoriKalp } from "./favori-kalp";
import { GorevKutusu } from "./gorev-kutusu";
import { priceText, transactionLabel, type ListingCard } from "./core";
import { CardHead, MenuLink, RowMenu, SeeAll } from "./views";

/**
 * Ana ekranın liste kartları (son eklenen ilanlar, görevler) AYRI modülde: favori kalbi ve görev kutusu istemci adaları
 * yalnız bunları çizen sayfanın (/app ana ekranı) paketine girer; `views.tsx`'i paylaşan /admin kontrol paneli ve
 * yönetim sayfaları (ops-kit) bu adaları ilk yükte taşımaz.
 */

/** Fotoğrafsız ilan çizimi (son halka): sıcak gökyüzü + ev silueti; token renkleri, koyu temada da okunur. */
function ListingArt() {
  return (
    <svg viewBox="0 0 160 96" className="kh-ls-art" aria-hidden="true" preserveAspectRatio="xMidYMax slice">
      <rect width="160" height="96" className="kh-ls-art-sky" />
      <circle cx="122" cy="26" r="11" className="kh-ls-art-sun" />
      <path d="M0 78 Q40 66 80 74 T160 70 V96 H0Z" className="kh-ls-art-hill" />
      <path d="M52 52 L80 32 L108 52 V80 H52Z" className="kh-ls-art-wall" />
      <path d="M46 54 L80 28 L114 54" className="kh-ls-art-roof" />
      <rect x="73" y="60" width="14" height="20" rx="1.5" className="kh-ls-art-door" />
      <rect x="58" y="56" width="10" height="9" rx="1.5" className="kh-ls-art-win" />
      <rect x="92" y="56" width="10" height="9" rx="1.5" className="kh-ls-art-win" />
    </svg>
  );
}

/**
 * Son eklenen ilanlar. Kapak zinciri: ilanın kendi kapak fotoğrafı → ofisin vitrin kapağı (yayındaki portföy fotoğrafı,
 * "Fotoğraf eklenmedi" etiketiyle, soluk; başka ilanın fotoğrafı bu ilanınmış gibi gösterilmez) → çizim.
 */
export function RecentListings({ cards, scope, newHref, fallbackSrc }: { cards: ListingCard[]; scope: string; newHref?: string | null; fallbackSrc?: string | null }) {
  return (
    <section className="kh-card kh-listings" aria-labelledby="kh-ls-title">
      <CardHead icon={Layers} tone="brand" id="kh-ls-title" title="Son eklenen ilanlar" right={<SeeAll href="/app/portfoyler" />} />
      {cards.length === 0 ? (
        <EmptyState
          variant="compact"
          illustration="portfoy"
          title="Henüz portföy yok"
          description="İlk portföyünüzü ekleyin; fotoğraflı kartlar burada görünür."
          action={newHref ? { href: newHref, label: "Yeni ilan" } : undefined}
        />
      ) : (
        <ul className="kh-ls-grid">
          {cards.map((c) => {
            const tr = transactionLabel(c.transaction);
            return (
              <li key={c.id} className="kh-ls-card">
                <div className="kh-ls-media">
                  {c.coverSrc ? (
                    <img src={c.coverSrc} alt="" width={480} height={288} loading="lazy" decoding="async" className="kh-ls-img" />
                  ) : fallbackSrc ? (
                    <>
                      <img src={fallbackSrc} alt="" width={480} height={288} loading="lazy" decoding="async" className="kh-ls-img is-fallback" />
                      <span className="kh-ls-nophoto">Fotoğraf eklenmedi</span>
                    </>
                  ) : (
                    <>
                      <ListingArt />
                      <span className="kh-ls-nophoto">Fotoğraf eklenmedi</span>
                    </>
                  )}
                  {c.badge ? (
                    <span className={`kh-ls-badge t-${c.badge.tone}`} title={c.badge.hint}>
                      {c.badge.label}
                    </span>
                  ) : tr ? (
                    <span className="kh-ls-badge t-neutral">{tr}</span>
                  ) : null}
                  <span className="kh-ls-fav">
                    <FavoriKalp id={c.id} title={c.title} scope={scope} />
                  </span>
                </div>
                <Link href={`/app/portfoyler/${c.id}`} className="kh-ls-body focus-ring">
                  <span className="block truncate text-sm font-semibold text-[var(--heading)]">{c.title}</span>
                  <span className="block truncate text-xs text-text-muted">
                    {[c.district, c.rooms, c.sqm ? `${c.sqm.toLocaleString("tr-TR")} m²` : null].filter(Boolean).join(" · ") || "Konum girilmedi"}
                  </span>
                  <span className="kh-ls-price">{priceText(c.price, c.currency)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ================================ GÖREVLER ================================ */

export type TaskRowView = {
  id: string;
  title: string;
  href: string;
  due: { label: string; tone: "danger" | "brand" | "neutral" };
  high: boolean;
  assignee: { name: string; avatarUrl: string | null; avatarPreset: string | null } | null;
};

export function TaskList({ rows, canComplete, newHref }: { rows: TaskRowView[]; canComplete: boolean; newHref?: string | null }) {
  return (
    <section className="kh-card kh-tasks" aria-labelledby="kh-tk-title">
      <CardHead icon={ListTodo} tone="brand" id="kh-tk-title" title="Yapılacak görevlerim" right={<SeeAll href="/app/gorevler" />} />
      {rows.length === 0 ? (
        <EmptyState
          variant="compact"
          illustration="gorev"
          tone="mint"
          title="Bu hafta için açık görev yok"
          description="Yeni görev ekleyerek haftanızı planlayın."
          action={newHref ? { href: newHref, label: "Görev oluştur" } : undefined}
        />
      ) : (
        <ul className="kh-tk-list">
          {rows.map((t) => (
            <li key={t.id} className="kh-task">
              {canComplete ? <GorevKutusu id={t.id} title={t.title} /> : <ClipboardCheck className="h-4 w-4 text-text-faint" aria-hidden="true" />}
              <Link href={t.href} className="kh-task-title focus-ring">
                {t.high ? <span className="kh-prio" title="Yüksek öncelik" aria-label="Yüksek öncelik" /> : null}
                <span className="kh-clamp2" title={t.title}>
                  {t.title}
                </span>
              </Link>
              <span className={`kh-pill t-${t.due.tone === "danger" ? "danger" : t.due.tone === "brand" ? "brand" : "neutral"}`}>{t.due.label}</span>
              {t.assignee ? (
                <span title={t.assignee.name} className="shrink-0">
                  <Avatar name={t.assignee.name} src={t.assignee.avatarUrl} preset={t.assignee.avatarPreset} size="xs" />
                </span>
              ) : null}
              <RowMenu label={`${t.title}: seçenekler`}>
                <MenuLink href={t.href} icon={ClipboardCheck}>
                  Görevi aç
                </MenuLink>
              </RowMenu>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
