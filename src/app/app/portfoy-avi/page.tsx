import { AlarmClock, CalendarCheck, Home, Plus, Sparkles, UserCheck } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getListScope } from "@/lib/access-control";
import { ScopeBadge } from "@/components/app/scope-badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ListHero, ListPage } from "@/components/ui/list-page";
import { ICONS } from "@/lib/icons";
import { DAY_MS, now, trDayStartMs } from "@/lib/clock";
import { hasOfficeWideDataScope, MANAGER_ROLES } from "@/lib/team/assignable-roles";
import { getSetting } from "@/lib/settings/read";
import { FSBO_RETENTION_DAYS_KEY } from "@/lib/settings/registry/tenant";
import { buildHref } from "@/lib/ui/filter-params";
import {
  buildActiveChips,
  CategoryChips,
  FilterGrid,
  FilterSelect,
  KpiStrip,
  ListPager,
  ListToolbar,
  mergeResetPage,
  pageWindow,
  parsePage,
  type KpiItem,
} from "@/components/ui/list-kit";
import { AGE_BUCKETS, filtersToParams, FSBO_PAGE_SIZE, loadFsboList, parseFsboFilters, type FsboRawParams } from "@/lib/prospecting/load";
import { buildCallScript, CALL_NOTICE } from "@/lib/prospecting/script";
import { clampRetentionDays } from "@/lib/prospecting/retention";
import { STATUS_LABELS, FSBO_STATUSES } from "@/lib/prospecting/types";
import { PORTAL_LABELS, isCurrentPortal } from "@/lib/portals/catalog";
import { toCardData } from "@/lib/prospecting/view";
import type { Db } from "@/lib/prospecting/store";
import { FsboCard } from "./fsbo-card";

export const metadata = { title: "Sahibinden ilanlar" };
export const dynamic = "force-dynamic";

const PATH = "/app/portfoy-avi";

export default async function PortfoyAviPage({ searchParams }: { searchParams?: Promise<FsboRawParams> }) {
  const ctx = await requireModulePage("prospecting", PATH);
  if (!ctx.tenantId) redirect("/app");
  const perms = ctx.perms.prospecting ?? [];
  const canCreate = perms.includes("create");
  const canEdit = perms.includes("edit");
  const canDelete = perms.includes("delete");
  const canPortals = (ctx.perms.portals ?? []).includes("view");
  const canProperties = (ctx.perms.properties ?? []).includes("view");
  const isManager = (MANAGER_ROLES as readonly string[]).includes(ctx.role);
  // Dönüştürme: portföy oluşturma yetkisi + çağrı merkezi hariç (sahip kararı).
  const canConvert = canEdit && ctx.role !== "call_center" && (ctx.perms.properties ?? []).includes("create");
  const raw = (await searchParams) ?? {};
  const filters = parseFsboFilters(raw, { isManager });
  const urlParams = filtersToParams(filters);
  const page = parsePage(raw.sayfa);
  const nowMs = now();
  const hrefWith = (patch: Record<string, string>) => buildHref(PATH, mergeResetPage(urlParams, patch));

  const supabase = (await createClient()) as Db;
  const [listScope, tenantRow, profileRow, membersRes, districtRes, retentionRaw] = await Promise.all([
    getListScope({ userId: ctx.userId, tenantId: ctx.tenantId, role: ctx.role, mineOnly: !(hasOfficeWideDataScope(ctx.role) || ctx.role === "team_lead") }),
    supabase.from("tenants").select("name, license_no").eq("id", ctx.tenantId).maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", ctx.userId).maybeSingle(),
    isManager || ctx.role === "team_lead"
      ? supabase.from("profiles").select("id, full_name, role").eq("tenant_id", ctx.tenantId).eq("is_active", true).order("full_name").limit(200)
      : Promise.resolve({ data: [] }),
    supabase
      .from("fsbo_leads")
      .select("district_id, district:geo_districts!fsbo_leads_district_id_fkey(name)")
      .eq("tenant_id", ctx.tenantId)
      .is("deleted_at", null)
      .not("district_id", "is", null)
      .limit(500),
    getSetting<number>(FSBO_RETENTION_DAYS_KEY, { tenantId: ctx.tenantId ?? undefined }).catch(() => 90),
  ]);
  const data = await loadFsboList(supabase, { tenantId: ctx.tenantId, scope: listScope.filter, filters, page, nowMs });

  const members = ((membersRes.data ?? []) as { id: string; full_name: string | null; role: string | null }[]).map((m) => ({ id: m.id, name: m.full_name ?? "İsimsiz", hint: m.role }));
  const districtMap = new Map<string, string>();
  for (const r of (districtRes.data ?? []) as { district_id: string; district: { name: string | null } | { name: string | null }[] | null }[]) {
    const d = Array.isArray(r.district) ? r.district[0] : r.district;
    if (r.district_id && d?.name) districtMap.set(r.district_id, d.name);
  }
  const districts = [...districtMap.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "tr"));
  const retentionDays = clampRetentionDays(retentionRaw);
  const office = tenantRow.data as { name: string | null; license_no: string | null } | null;
  const advisorName = (profileRow.data as { full_name: string | null } | null)?.full_name ?? null;
  const tomorrow = new Date(trDayStartMs(nowMs) + DAY_MS + 3 * 3_600_000).toISOString().slice(0, 10);

  const cards = data.rows.map((r) => {
    const card = toCardData(r, nowMs);
    return {
      card,
      script: buildCallScript({
        advisorName,
        officeName: office?.name ?? null,
        licenseNo: office?.license_no ?? null,
        districtName: r.districtName,
        rooms: r.rooms,
        portalLabel: isCurrentPortal(r.portal) ? PORTAL_LABELS[r.portal] : "ilan sitesi",
      }),
    };
  });

  const emptyAll = data.counts.toplam === 0 && !data.unavailable;
  const kpis: KpiItem[] = [
    { label: "Bugün aranacak", value: data.counts.bugun, icon: <AlarmClock />, tone: "warning", href: hrefWith({ gorunum: "bugun", durum: "" }), attention: data.counts.bugun > 0, hint: "tekrar arama günü" },
    { label: "Yeni", value: data.counts.yeni, icon: <Sparkles />, tone: "info", href: hrefWith({ durum: "yeni", gorunum: "" }), hint: "henüz konuşulmadı" },
    { label: "Randevu", value: data.counts.randevu, icon: <CalendarCheck />, tone: "info", href: hrefWith({ durum: "randevu", gorunum: "" }), hint: "görüşme planlandı" },
    { label: "Yetki alındı", value: data.counts.yetki, icon: <UserCheck />, tone: "success", href: hrefWith({ durum: "yetki_alindi", gorunum: "" }), hint: "sözleşme imzalandı" },
    { label: "Bu ay dönüşen", value: data.counts.donusen, icon: <Home />, tone: "success", href: hrefWith({ durum: "portfoye_donustu", donem: "bu-ay", gorunum: "" }), hint: "portföye döndü" },
  ];

  const chips = buildActiveChips(PATH, urlParams, [
    { key: "q", label: "Arama" },
    { key: "durum", label: "Durum", format: (v) => (v === "tumu" ? "Tümü" : (STATUS_LABELS as Record<string, string>)[v] ?? v) },
    { key: "gorunum", label: "Görünüm", format: () => "Bugün aranacaklar" },
    { key: "danisman", label: "Danışman", format: (v) => (v === "sahipsiz" ? "Sahipsiz" : members.find((m) => m.id === v)?.name ?? v) },
    { key: "islem", label: "İşlem", format: (v) => (v === "rent" ? "Kiralık" : "Satılık") },
    { key: "ilce", label: "İlçe", format: (v) => districtMap.get(v) ?? v },
    { key: "min", label: "En az fiyat" },
    { key: "max", label: "En çok fiyat" },
    { key: "yas", label: "İlan yaşı", format: (v) => AGE_BUCKETS.find((b) => b.key === v)?.label ?? v },
    { key: "fiyat_dustu", label: "Fiyat", format: () => "Düştü" },
    { key: "tekrar", label: "Tekrar ilan", format: () => "Evet" },
    { key: "aranmasin", label: "Aranmasınlar", format: () => "Göster" },
    { key: "aranmadi", label: "Aranma", format: () => "Hiç aranmadı" },
    { key: "hareketsiz", label: "Sahiplik", format: () => "Düşmek üzere" },
    { key: "donem", label: "Dönem", format: () => "Bu ay" },
  ]);
  const win = pageWindow(page, data.total, FSBO_PAGE_SIZE, data.rows.length);

  return (
    <ListPage>
      <ListHero
        art="sahibinden"
        eyebrow="Portföy kazanımı"
        title="Sahibinden ilanlar"
        description="İlan sahiplerini arayın, yetkiyi alıp portföye dönüştürün."
        meta={<ScopeBadge text={listScope.badge} />}
        actions={canCreate ? <ButtonLink href="/app/portfoy-avi/yeni" icon={Plus}>Sahibinden ilan ekle</ButtonLink> : null}
      />

      <details className="rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2 text-xs text-text-muted">
        <summary className="focus-ring cursor-pointer font-semibold text-ink-950 touch:min-h-11 touch:py-2.5">Arama kuralları ve kişisel veri saklama süresi</summary>
        <p className="mt-2">
          İlan sahibini arayabilirsiniz; toplu SMS/WhatsApp gönderemezsiniz. Kişi &apos;aramayın&apos; derse &apos;Aranmasın&apos;a ekleyin; numara ofisinizde bir daha aranmaz.
          Portföye dönüşmeyen kayıtların kişisel bilgileri son etkinlikten {retentionDays} gün sonra silinir.
        </p>
      </details>

      {data.unavailable ? (
        <EmptyState
          icon={ICONS.portfoy}
          illustration="start"
          title="Sahibinden ilanlar henüz etkin değil"
          description="Bu özellik için gerekli veritabanı güncellemesi henüz uygulanmamış. Yöneticinize ya da destek ekibine bildirin."
          tone="brand"
          action={canProperties ? { href: "/app/portfoyler", label: "Portföylere git" } : undefined}
        />
      ) : (
        <>
          {emptyAll ? null : <KpiStrip items={kpis} />}

          {emptyAll ? null : (
            <>
              <ListToolbar
                pathname={PATH}
                params={urlParams}
                searchPlaceholder="Başlık veya ilan numarası ara…"
                searchLabel="Sahibinden ilan ara"
                panelParamKeys={["danisman", "islem", "ilce", "min", "max", "yas", "fiyat_dustu", "tekrar", "aranmasin"]}
                panel={
                  <FilterGrid>
                    {isManager || ctx.role === "team_lead" ? (
                      <FilterSelect name="danisman" label="Danışman" value={filters.danisman} options={[{ value: "", label: "Tüm danışmanlar" }, { value: "sahipsiz", label: "Sahipsiz" }, ...members.map((m) => ({ value: m.id, label: m.name }))]} />
                    ) : null}
                    <FilterSelect name="islem" label="İşlem" value={filters.islem} options={[{ value: "", label: "Satılık ve kiralık" }, { value: "sale", label: "Satılık" }, { value: "rent", label: "Kiralık" }]} />
                    <FilterSelect name="ilce" label="İlçe" value={filters.ilce} options={[{ value: "", label: "Tüm ilçeler" }, ...districts]} />
                    <FilterSelect name="yas" label="İlan yaşı" value={filters.yas} options={[{ value: "", label: "Hepsi" }, ...AGE_BUCKETS.map((b) => ({ value: b.key, label: b.label }))]} />
                    <FilterSelect name="fiyat_dustu" label="Fiyat" value={filters.fiyatDustu ? "1" : ""} options={[{ value: "", label: "Hepsi" }, { value: "1", label: "Fiyatı düştü" }]} />
                    <FilterSelect name="tekrar" label="Tekrar ilan" value={filters.tekrar ? "1" : ""} options={[{ value: "", label: "Hepsi" }, { value: "1", label: "Tekrar ilana çıktı" }]} />
                    <FilterSelect name="aranmasin" label="Aranmasınlar" value={filters.aranmasin ? "1" : ""} options={[{ value: "", label: "Gizle" }, { value: "1", label: "Göster" }]} />
                  </FilterGrid>
                }
                chips={chips}
                resultCount={chips.length > 0 ? data.total : undefined}
                resultNoun="ilan"
              />
              <CategoryChips
                options={FSBO_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
                counts={null}
                total={null}
                allLabel="Açık kayıtlar"
                active={filters.durum === "tumu" ? "" : filters.durum}
                pathname={PATH}
                params={urlParams}
                paramName="durum"
                label="Durum"
              />
            </>
          )}

          {cards.length === 0 ? (
            <EmptyState
              icon={ICONS.portfoy}
              illustration={emptyAll ? "start" : "search"}
              title={emptyAll ? "Henüz sahibinden ilan kaydetmediniz" : "Bu filtrede ilan yok"}
              description={
                emptyAll
                  ? `Eklentiyi kurup açtığınız ilanı tek tıkla kaydedin ya da ilan bağlantısını yapıştırın. Kayıtlar takip ritmiyle size hatırlatılır.${canPortals ? "" : " Eklentiyi yöneticiniz kurar."}`
                  : "Arama ifadenizi ya da filtreleri değiştirip tekrar deneyin."
              }
              tone="brand"
              action={
                emptyAll
                  ? canCreate
                    ? { href: "/app/portfoy-avi/yeni", label: "İlan bağlantısı yapıştır" }
                    : canProperties
                      ? { href: "/app/portfoyler", label: "Portföylere git" }
                      : undefined
                  : { href: PATH, label: "Filtreleri temizle" }
              }
              secondary={emptyAll ? (canPortals ? { href: "/app/ilan-kontrol/eklenti", label: "Eklentiyi kur" } : undefined) : { href: `${PATH}?durum=tumu`, label: "Tüm kayıtları göster" }}
            />
          ) : (
            <div className="space-y-2">
              {cards.map(({ card, script }) => (
                <FsboCard
                  key={card.id}
                  data={card}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  canConvert={canConvert}
                  isManager={isManager}
                  people={members}
                  script={script}
                  callNotice={CALL_NOTICE}
                  dayDefault={tomorrow}
                />
              ))}
            </div>
          )}
          <ListPager pathname={PATH} params={urlParams} window={win} total={data.total} />
        </>
      )}
    </ListPage>
  );
}
