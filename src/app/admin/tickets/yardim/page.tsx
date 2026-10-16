import Link from "@/components/ui/smart-link";
import { LifeBuoy, Plus, ThumbsDown, ThumbsUp } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ButtonLink } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-chip";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { GLOSSARY, GUIDES, matchesQuery } from "@/lib/help-content";
import { FAQ } from "@/lib/help-faq";
import { HELP_KINDS, isHelpKind, voteKey, type HelpArticleRow, type HelpKind } from "@/lib/help-center/core";
import { listHelpArticles, readVoteTallies } from "@/lib/help-center/store";
import { requirePlatformModule } from "@/lib/platform";
import { HelpSearchBox } from "./help-search-box";

export const metadata = { title: "Yardım merkezi içeriği" };

type Item = {
  kind: HelpKind;
  slug: string;
  title: string;
  text: string;
  source: "kod" | "kod-degisti" | "yeni";
  state: "yayinda" | "taslak" | "gizli";
  pendingEdit: boolean;
};

const STATES = [
  { id: "yayinda", label: "Yayında" },
  { id: "taslak", label: "Taslak" },
  { id: "gizli", label: "Gizli" },
] as const;

function buildItems(rows: readonly HelpArticleRow[]): Item[] {
  const byKey = new Map(rows.map((r) => [voteKey(r.kind, r.slug), r]));
  const code: { kind: HelpKind; slug: string; title: string; text: string }[] = [
    ...GUIDES.map((g) => ({ kind: "guide" as const, slug: g.slug, title: g.title, text: `${g.intro} ${g.steps.join(" ")}` })),
    ...FAQ.map((f) => ({ kind: "faq" as const, slug: f.id, title: f.q, text: f.a })),
    ...GLOSSARY.map((g) => ({ kind: "glossary" as const, slug: g.slug, title: g.term, text: `${g.short} ${g.detail ?? ""}` })),
  ];
  const out: Item[] = [];
  const seen = new Set<string>();
  for (const c of code) {
    const k = voteKey(c.kind, c.slug);
    seen.add(k);
    const r = byKey.get(k);
    if (!r) {
      out.push({ ...c, source: "kod", state: "yayinda", pendingEdit: false });
      continue;
    }
    // Koddaki madde DB'de değiştirildi: taslak satırı henüz yayında değilse okuyucu koddaki metni görür.
    out.push({
      kind: c.kind,
      slug: c.slug,
      title: r.title,
      text: `${r.summary} ${r.body}`,
      source: "kod-degisti",
      state: r.status === "hidden" ? "gizli" : r.status === "published" ? "yayinda" : "taslak",
      pendingEdit: Boolean(r.draft) || r.status === "draft",
    });
  }
  for (const r of rows) {
    if (seen.has(voteKey(r.kind, r.slug))) continue;
    out.push({
      kind: r.kind,
      slug: r.slug,
      title: r.title,
      text: `${r.summary} ${r.body}`,
      source: "yeni",
      state: r.status === "hidden" ? "gizli" : r.status === "published" ? "yayinda" : "taslak",
      pendingEdit: Boolean(r.draft),
    });
  }
  return out;
}

function href(sp: { tur?: string; durum?: string; q?: string }, patch: Record<string, string | undefined>) {
  const next = { ...sp, ...patch };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `/admin/tickets/yardim?${s}` : "/admin/tickets/yardim";
}

const editHref = (kind: HelpKind, slug: string) => `/admin/tickets/yardim/duzenle?tur=${kind}&slug=${encodeURIComponent(slug)}`;
const SOURCE_LABEL = { kod: "Kod", "kod-degisti": "Kod (değiştirildi)", yeni: "Yeni" } as const;
const STATE_TONE = { yayinda: "bg-mint-500/15 text-mint-700", taslak: "bg-amber-100 text-amber-900", gizli: "bg-ink-950/8 text-text-muted" } as const;

/**
 * Yardım merkezi CMS'i (AD12; Talepler > Yardım merkezi): koddaki nasıl yapılır/SSS/sözlük maddeleri + DB makaleleri tek listede; tür,
 * durum ve metin araması URL'de (sunucu süzgeci). Oy sayıları makalenin düzenleme ekranına götürür. Yayın anında
 * /app/yardim ve AI SSS bağlamı güncellenir.
 */
export default async function HelpCenterAdminPage({ searchParams }: { searchParams: Promise<{ tur?: string; durum?: string; q?: string }> }) {
  const [staff, sp] = await Promise.all([requirePlatformModule("sitecontent"), searchParams]);
  const canWrite = staff.role === "super_admin";
  const [list, votes] = await Promise.all([listHelpArticles().catch(() => ({ status: "error" as const, error: "okunamadı" })), readVoteTallies().catch(() => new Map())]);
  const rows = list.status === "ok" ? list.rows : [];
  const kind = isHelpKind(sp.tur) ? sp.tur : null;
  const state = STATES.find((s) => s.id === sp.durum)?.id ?? null;
  const q = (sp.q ?? "").slice(0, 100);
  const items = buildItems(rows).filter((i) => (!kind || i.kind === kind) && (!state || i.state === state) && matchesQuery([i.title, i.text, i.slug], q));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="support"
        eyebrow="Talepler"
        icon={LifeBuoy}
        title="Yardım merkezi"
        description="Nasıl yapılır, SSS ve sözlük maddeleri: taslak > yayın, kategori, 'işe yaradı mı' oyları. Yayınlanan makale ofislerin Yardım ekranında ve AI asistanın SSS bağlamında hemen görünür."
        actions={canWrite ? <ButtonLink href="/admin/tickets/yardim/duzenle" icon={Plus}>Yeni makale</ButtonLink> : null}
      />
      {list.status === "missing" ? (
        <p className="rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Yardım tabloları henüz kurulmadı (migration 20261013005100 bekliyor). Yardım merkezi koddaki içerikle çalışıyor; düzenleme kurulumdan sonra açılır.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip href={href(sp, { tur: undefined })} active={!kind}>
          Tümü
        </FilterChip>
        {HELP_KINDS.map((k) => (
          <FilterChip key={k.id} href={href(sp, { tur: k.id })} active={kind === k.id}>
            {k.label}
          </FilterChip>
        ))}
        <span className="mx-1 h-6 w-px bg-line" aria-hidden />
        {STATES.map((s) => (
          <FilterChip key={s.id} href={href(sp, { durum: state === s.id ? undefined : s.id })} active={state === s.id}>
            {s.label}
          </FilterChip>
        ))}
      </div>
      <HelpSearchBox initialQ={q} />
      <p className="text-xs text-text-muted" role="status">
        {items.length} madde
      </p>
      {items.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-surface p-5 text-sm text-text-muted">Bu süzgece uyan madde yok.</p>
      ) : (
        <TableFrame minWidth={760}>
          <Table>
            <caption className="sr-only">Yardım maddeleri, kaynakları, durumları ve oyları</caption>
            <THead>
              <TR>
                <TH>Başlık</TH>
                <TH>Tür</TH>
                <TH>Kaynak</TH>
                <TH>Durum</TH>
                <TH align="right">Oylar</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((i) => {
                const v = votes.get(voteKey(i.kind, i.slug)) as { helpful: number; notHelpful: number } | undefined;
                return (
                  <TR key={voteKey(i.kind, i.slug)}>
                    <TD>
                      <Link href={editHref(i.kind, i.slug)} className="font-semibold text-ink-950 hover:text-brand-600">
                        {i.title}
                      </Link>
                      <span className="block text-xs text-text-muted">{i.slug}</span>
                    </TD>
                    <TD className="text-sm">{HELP_KINDS.find((k) => k.id === i.kind)?.label}</TD>
                    <TD className="text-sm">{SOURCE_LABEL[i.source]}</TD>
                    <TD>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATE_TONE[i.state]}`}>{STATES.find((s) => s.id === i.state)?.label}</span>
                      {i.pendingEdit && i.state !== "taslak" ? <span className="ml-1 text-xs text-amber-800">bekleyen düzenleme</span> : null}
                    </TD>
                    <TD align="right">
                      {v ? (
                        <Link href={editHref(i.kind, i.slug)} className="inline-flex min-h-11 items-center gap-2 text-sm tabular-nums text-text hover:text-brand-600">
                          <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5" aria-hidden />{v.helpful}</span>
                          <span className="inline-flex items-center gap-1"><ThumbsDown className="h-3.5 w-3.5" aria-hidden />{v.notHelpful}</span>
                          <span className="sr-only">oy; makaleyi düzenle</span>
                        </Link>
                      ) : (
                        <span className="text-xs text-text-muted">Oy yok</span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableFrame>
      )}
    </div>
  );
}
