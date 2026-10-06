"use client";

import { LANDING_SECTIONS, LIMITS, normalizeLayout, type SiteContent, type validateSiteContent } from "@/lib/site-content/schema";
import { Card, CtaFields, Full, ListShell, Txt, nextId, type Update } from "./editor-fields";

/**
 * Ana sayfanın koda gömülü olan bölümlerinin editör sekmeleri: bölüm düzeni (sıra + görünürlük), ürün turu,
 * özellik ızgarası, karşılaştırma tablosu ve EmlakFiyati kontör bölümü. Yapı (ekran çizimi, ızgara yerleşimi,
 * illüstrasyon) kimlikten gelir; burada yalnız metin, sıra ve gösterim düzenlenir.
 */

type TabProps = { cfg: SiteContent; update: Update; issues: ReturnType<typeof validateSiteContent>["issues"]; readOnly: boolean };

const SECTION_LABEL = Object.fromEntries(LANDING_SECTIONS.map((s) => [s.id, s.label])) as Record<string, string>;

/** Değerleme bölümünün iki anahtarı (düzen + `valuation.hidden`) tek düğme gibi davranır. */
export function valuationVisible(cfg: SiteContent): boolean {
  return !cfg.valuation.hidden && !cfg.layout.some((s) => s.id === "degerleme" && s.hidden);
}

export function setValuationVisible(d: SiteContent, on: boolean): void {
  d.valuation.hidden = !on;
  d.layout = normalizeLayout(d.layout).map((s) => (s.id === "degerleme" ? { ...s, hidden: !on } : s));
}

const gateHint = "Paket rozeti için /app sayfa yolu (ör. /app/kayip-kacak). Rozet metni sayfa kilidinden üretilir; boş = rozet yok.";

export function LayoutTab({ cfg, update, readOnly }: TabProps) {
  const items = normalizeLayout(cfg.layout);
  return (
    <>
      <p className="text-xs text-text-muted">
        Ana başlık (hero) her zaman en üsttedir. Diğer bölümlerin sırasını oklarla değiştirin, göz simgesiyle gizleyin. Gizlenen bölüm sayfadan ve
        (SSS için) yapılandırılmış veriden çıkar; içerikleri silinmez.
      </p>
      <ListShell
        title={`Bölüm sırası (${items.filter((s) => !s.hidden).length}/${items.length} görünür)`}
        items={items}
        setItems={(n) =>
          update((d) => {
            d.layout = n;
            const val = n.find((s) => s.id === "degerleme");
            if (val) d.valuation.hidden = val.hidden;
          })
        }
        readOnly={readOnly}
        summary={(s) => SECTION_LABEL[s.id] ?? s.id}
        render={() => null}
      />
    </>
  );
}

export function TourTab({ cfg, update, issues, readOnly }: TabProps) {
  const f = { issues, readOnly };
  return (
    <>
      <p className="text-xs text-text-muted">Her sekme sabit bir ekran çizimine bağlıdır (kimlik); sekme adı, açıklama, maddeler, sıra ve gösterim düzenlenir.</p>
      <ListShell
        title="Ürün turu sekmeleri"
        items={cfg.tour}
        setItems={(n) => update((d) => void (d.tour = n))}
        readOnly={readOnly}
        summary={(t) => `${t.label} (${t.id})`}
        render={(t, i) => (
          <>
            <Txt label="Sekme adı" value={t.label} max={30} onChange={(v) => update((d) => void (d.tour[i]!.label = v))} path={`tour.${i}.label`} {...f} />
            <Full><Txt label="Açıklama" value={t.text} max={LIMITS.cardText} onChange={(v) => update((d) => void (d.tour[i]!.text = v))} path={`tour.${i}.text`} {...f} /></Full>
            <Full>
              <ListShell
                title="Maddeler"
                items={t.points}
                setItems={(n) => update((d) => void (d.tour[i]!.points = n))}
                readOnly={readOnly}
                summary={(x) => x.text}
                render={(x, j) => (
                  <>
                    <Txt label="Madde" value={x.text} max={LIMITS.cardText} onChange={(v) => update((d) => void (d.tour[i]!.points[j]!.text = v))} path={`tour.${i}.points.${j}.text`} {...f} />
                    <Txt label="Paket rozeti yolu" value={x.gate} max={80} hint={gateHint} onChange={(v) => update((d) => void (d.tour[i]!.points[j]!.gate = v))} path={`tour.${i}.points.${j}.gate`} {...f} />
                  </>
                )}
                onAdd={() => update((d) => void d.tour[i]!.points.push({ id: nextId("p", d.tour[i]!.points.map((y) => y.id)), text: "", gate: "", hidden: false }))}
                max={LIMITS.maxChecks}
              />
            </Full>
          </>
        )}
      />
    </>
  );
}

export function BentoTab({ cfg, update, issues, readOnly }: TabProps) {
  const f = { issues, readOnly };
  return (
    <>
      <p className="text-xs text-text-muted">Kartların illüstrasyonu, ızgaradaki yeri ve paket rozeti kimlikten gelir (değişmez); metin, sıra ve gösterim düzenlenir.</p>
      <ListShell
        title="Özellik kartları"
        items={cfg.bento.tiles}
        setItems={(n) => update((d) => void (d.bento.tiles = n))}
        readOnly={readOnly}
        summary={(t) => `${t.title} (${t.id})`}
        render={(t, i) => (
          <>
            <Txt label="Üst başlık" value={t.eyebrow} max={LIMITS.eyebrow} onChange={(v) => update((d) => void (d.bento.tiles[i]!.eyebrow = v))} path={`bento.tiles.${i}.eyebrow`} {...f} />
            <Txt label="Başlık" value={t.title} max={LIMITS.title} onChange={(v) => update((d) => void (d.bento.tiles[i]!.title = v))} path={`bento.tiles.${i}.title`} {...f} />
            <Full><Txt label="Açıklama" multiline value={t.text} max={LIMITS.text} onChange={(v) => update((d) => void (d.bento.tiles[i]!.text = v))} path={`bento.tiles.${i}.text`} {...f} /></Full>
            <Full>
              <ListShell
                title="Maddeler (isteğe bağlı)"
                items={t.points}
                setItems={(n) => update((d) => void (d.bento.tiles[i]!.points = n))}
                readOnly={readOnly}
                summary={(x) => x.text}
                render={(x, j) => <Full><Txt label="Madde" value={x.text} max={LIMITS.cardText} onChange={(v) => update((d) => void (d.bento.tiles[i]!.points[j]!.text = v))} path={`bento.tiles.${i}.points.${j}.text`} {...f} /></Full>}
                onAdd={() => update((d) => void d.bento.tiles[i]!.points.push({ id: nextId("b", d.bento.tiles[i]!.points.map((y) => y.id)), text: "", hidden: false }))}
                max={LIMITS.maxChecks}
              />
            </Full>
          </>
        )}
      />
      <Card title="Izgara dipnotu">
        <Full><Txt label="Dipnot" multiline value={cfg.bento.note} max={LIMITS.note} onChange={(v) => update((d) => void (d.bento.note = v))} path="bento.note" {...f} /></Full>
      </Card>
    </>
  );
}

export function WhyTab({ cfg, update, issues, readOnly }: TabProps) {
  const f = { issues, readOnly };
  const w = cfg.why;
  return (
    <>
      <Card title="Karşılaştırma tablosu (rakip veya firma adı yazmayın)">
        <Txt label="Eski yöntem sütunu" value={w.oldLabel} max={LIMITS.cardTitle} onChange={(v) => update((d) => void (d.why.oldLabel = v))} path="why.oldLabel" {...f} />
        <Txt label="EmlakSoft sütunu" value={w.newLabel} max={LIMITS.cardTitle} onChange={(v) => update((d) => void (d.why.newLabel = v))} path="why.newLabel" {...f} />
        <Full><Txt label="Dipnot" multiline value={w.note} max={LIMITS.note} onChange={(v) => update((d) => void (d.why.note = v))} path="why.note" {...f} /></Full>
      </Card>
      <ListShell
        title="Satırlar"
        items={w.rows}
        setItems={(n) => update((d) => void (d.why.rows = n))}
        readOnly={readOnly}
        summary={(r) => r.topic}
        render={(r, i) => (
          <>
            <Txt label="Konu" value={r.topic} max={LIMITS.cardTitle} onChange={(v) => update((d) => void (d.why.rows[i]!.topic = v))} path={`why.rows.${i}.topic`} {...f} />
            <Txt label="Paket rozeti yolu" value={r.gate} max={80} hint={gateHint} onChange={(v) => update((d) => void (d.why.rows[i]!.gate = v))} path={`why.rows.${i}.gate`} {...f} />
            <Full><Txt label="Eski yöntem" value={r.old} max={LIMITS.cardText} onChange={(v) => update((d) => void (d.why.rows[i]!.old = v))} path={`why.rows.${i}.old`} {...f} /></Full>
            <Full><Txt label="EmlakSoft ile" value={r.now} max={LIMITS.cardText} onChange={(v) => update((d) => void (d.why.rows[i]!.now = v))} path={`why.rows.${i}.now`} {...f} /></Full>
          </>
        )}
        onAdd={() => update((d) => void d.why.rows.push({ id: nextId("r", d.why.rows.map((x) => x.id)), topic: "", old: "", now: "", gate: "", hidden: false }))}
        addLabel="Satır ekle"
        max={LIMITS.maxList}
      />
    </>
  );
}

export function EfTab({ cfg, update, issues, readOnly }: TabProps) {
  const f = { issues, readOnly };
  const e = cfg.efSection;
  return (
    <>
      <p className="text-xs text-text-muted">
        Sayılar (aylık kontör, değerleme bedeli, paket fiyatları) plan tanımı, kontör tarifesi ve paket kataloğundan gelir; buraya sayı yazmayın. “Canlı / Yakında” durumu
        EmlakFiyati bağlantısından otomatik okunur. Bölüm, hiçbir pakette aylık kontör yoksa kendiliğinden gizlenir.
      </p>
      <Card title="EmlakFiyati kontör bölümü">
        <Txt label="Üst başlık" value={e.eyebrow} max={LIMITS.eyebrow} onChange={(v) => update((d) => void (d.efSection.eyebrow = v))} path="efSection.eyebrow" {...f} />
        <div className="hidden sm:block" />
        <Full>
          <div className="grid gap-3 sm:grid-cols-3">
            <Txt label="Başlık (başı)" value={e.title} max={LIMITS.title} onChange={(v) => update((d) => void (d.efSection.title = v))} path="efSection.title" {...f} />
            <Txt label="Vurgulu kısım" value={e.em} max={LIMITS.em} onChange={(v) => update((d) => void (d.efSection.em = v))} path="efSection.em" {...f} />
            <Txt label="Başlık (sonu)" value={e.tail} max={LIMITS.tail} onChange={(v) => update((d) => void (d.efSection.tail = v))} path="efSection.tail" {...f} />
          </div>
        </Full>
        <Full><Txt label="Canlıyken açıklama" multiline value={e.liveText} max={LIMITS.lead} onChange={(v) => update((d) => void (d.efSection.liveText = v))} path="efSection.liveText" {...f} /></Full>
        <Full><Txt label="Canlı değilken açıklama" multiline value={e.soonText} max={LIMITS.lead} onChange={(v) => update((d) => void (d.efSection.soonText = v))} path="efSection.soonText" {...f} /></Full>
        <Txt label="Paket kontörü başlığı" value={e.plansTitle} max={LIMITS.title} onChange={(v) => update((d) => void (d.efSection.plansTitle = v))} path="efSection.plansTitle" {...f} />
        <Txt label="Ek paket başlığı" value={e.packsTitle} max={LIMITS.title} onChange={(v) => update((d) => void (d.efSection.packsTitle = v))} path="efSection.packsTitle" {...f} />
        <Full><Txt label="Paket kontörü dipnotu" multiline value={e.plansNote} max={LIMITS.note} onChange={(v) => update((d) => void (d.efSection.plansNote = v))} path="efSection.plansNote" {...f} /></Full>
        <Full><Txt label="Ek paket açıklaması" multiline value={e.packsText} max={LIMITS.text} onChange={(v) => update((d) => void (d.efSection.packsText = v))} path="efSection.packsText" {...f} /></Full>
        <Full><Txt label="Paket yokken metin" value={e.packsEmpty} max={LIMITS.text} onChange={(v) => update((d) => void (d.efSection.packsEmpty = v))} path="efSection.packsEmpty" {...f} /></Full>
        <CtaFields label="Ayrıntı bağlantısı" value={e.detailLink} onChange={(v) => update((d) => void (d.efSection.detailLink = v))} path="efSection.detailLink" {...f} />
        <Full><Txt label="Dipnot" multiline value={e.note} max={LIMITS.note} onChange={(v) => update((d) => void (d.efSection.note = v))} path="efSection.note" {...f} /></Full>
      </Card>
      <ListShell
        title="Nasıl çalışır adımları (“onay” adımına değerleme bedeli tarifeden eklenir)"
        items={e.steps}
        setItems={(n) => update((d) => void (d.efSection.steps = n))}
        readOnly={readOnly}
        summary={(s) => s.title}
        render={(s, i) => (
          <>
            <Full><Txt label="Başlık" value={s.title} max={LIMITS.title} onChange={(v) => update((d) => void (d.efSection.steps[i]!.title = v))} path={`efSection.steps.${i}.title`} {...f} /></Full>
            <Full><Txt label="Açıklama" multiline value={s.text} max={LIMITS.text} onChange={(v) => update((d) => void (d.efSection.steps[i]!.text = v))} path={`efSection.steps.${i}.text`} {...f} /></Full>
          </>
        )}
      />
    </>
  );
}
