"use client";

import { useEffect, useState, useTransition } from "react";
import { MapPin } from "lucide-react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { listDistricts, listNeighborhoods, type GeoOption } from "@/app/actions/geo";

type Props = {
  provinces: GeoOption[];
  defaultProvinceId?: string | null;
  defaultDistrictId?: string | null;
  defaultNeighborhoodId?: string | null;
  /** Mahalle alanını gizle — müşteri/şube gibi ilçe yeterli olan yerlerde. */
  withNeighborhood?: boolean;
  required?: boolean;
  /** Form alan adları; varsayılanlar DB kolon adlarıyla birebir. */
  names?: { province?: string; district?: string; neighborhood?: string };
  className?: string;
};

const toOptions = (list: GeoOption[]): ComboboxOption[] =>
  list.map((x) => ({ value: x.id, label: x.name }));

/**
 * İl / İlçe / Mahalle kademeli seçici.
 *
 * NEDEN VAR: Şemada `properties.district_id` ve `neighborhood_id` kolonları
 * baştan beri duruyordu ama HİÇBİR FORM bunları doldurmuyordu — tüm formlar
 * yalnızca il soruyordu. Bu, `find_comparables(p_district_id …)` ve
 * `estimate_property_value(p_district_id …)` fonksiyonlarının her zaman NULL
 * ilçeyle çağrılması demekti; emsal motoru veri bulamıyordu. Bu bileşen o
 * boşluğu kapatıyor.
 *
 * DAVRANIŞ: İl değişince ilçe ve mahalle sıfırlanır (İstanbul'un ilçesi
 * Ankara'ya taşınamaz). İlçe değişince mahalle sıfırlanır. Sıfırlama sırasında
 * eski liste de temizlenir; aksi hâlde bir an için önceki ilin ilçeleri
 * görünürdü.
 */
export function GeoSelect({
  provinces,
  defaultProvinceId,
  defaultDistrictId,
  defaultNeighborhoodId,
  withNeighborhood = true,
  required,
  names,
  className,
}: Props) {
  const provinceName = names?.province ?? "province_id";
  const districtName = names?.district ?? "district_id";
  const neighborhoodName = names?.neighborhood ?? "neighborhood_id";

  const [provinceId, setProvinceId] = useState(defaultProvinceId ?? "");
  const [districtId, setDistrictId] = useState(defaultDistrictId ?? "");
  const [neighborhoodId, setNeighborhoodId] = useState(defaultNeighborhoodId ?? "");

  const [districts, setDistricts] = useState<GeoOption[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<GeoOption[]>([]);
  const [loadingD, startD] = useTransition();
  const [loadingN, startN] = useTransition();

  // Düzenleme formunda açılışta mevcut il/ilçenin alt listeleri yüklenmeli,
  // yoksa kutu "Yükleniyor" da değil, boş görünür ve seçili değer kaybolur.
  useEffect(() => {
    // Listeyi BOŞALTMA işi burada değil, değişim işleyicisinde: efekt gövdesinde
    // senkron setState zincirleme render doğurur. Bu efekt yalnızca getirir.
    if (!provinceId) return;
    let stale = false;
    startD(async () => {
      const rows = await listDistricts(provinceId);
      // Kullanıcı yanıt gelmeden başka bir il seçtiyse eskiyen sonucu yazma.
      if (!stale) setDistricts(rows);
    });
    return () => {
      stale = true;
    };
  }, [provinceId]);

  useEffect(() => {
    if (!withNeighborhood || !districtId) return;
    let stale = false;
    startN(async () => {
      const rows = await listNeighborhoods(districtId);
      if (!stale) setNeighborhoods(rows);
    });
    return () => {
      stale = true;
    };
  }, [districtId, withNeighborhood]);

  return (
    <div className={className}>
      <div className={withNeighborhood ? "grid gap-3 sm:grid-cols-3" : "grid gap-3 sm:grid-cols-2"}>
        <div className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-sm text-text-muted">
            <MapPin className="h-3.5 w-3.5" /> İl {required ? "*" : null}
          </span>
          <Combobox
            name={provinceName}
            value={provinceId}
            onValueChange={(v) => {
              setProvinceId(v);
              setDistrictId("");
              setNeighborhoodId("");
              setDistricts([]);
              setNeighborhoods([]);
            }}
            options={toOptions(provinces)}
            placeholder="İl seçin"
            searchPlaceholder="İl ara…"
            required={required}
            aria-label="İl"
          />
        </div>

        <div className="block">
          <span className="mb-1.5 block text-sm text-text-muted">İlçe</span>
          <Combobox
            name={districtName}
            value={districtId}
            onValueChange={(v) => {
              setDistrictId(v);
              setNeighborhoodId("");
              setNeighborhoods([]);
            }}
            options={toOptions(districts)}
            disabled={!provinceId}
            loading={loadingD}
            placeholder={provinceId ? "İlçe seçin" : "Önce il seçin"}
            searchPlaceholder="İlçe ara…"
            emptyText="Bu ilde kayıtlı ilçe yok"
            aria-label="İlçe"
          />
        </div>

        {withNeighborhood ? (
          <div className="block">
            <span className="mb-1.5 block text-sm text-text-muted">Mahalle</span>
            <Combobox
              name={neighborhoodName}
              value={neighborhoodId}
              onValueChange={setNeighborhoodId}
              options={toOptions(neighborhoods)}
              disabled={!districtId}
              loading={loadingN}
              placeholder={districtId ? "Mahalle seçin" : "Önce ilçe seçin"}
              searchPlaceholder="Mahalle ara…"
              emptyText="Bu ilçede kayıtlı mahalle yok"
              aria-label="Mahalle"
            />
          </div>
        ) : null}
      </div>
      {provinceId && !districtId ? (
        <p className="mt-1.5 text-[11px] text-text-faint">
          İlçe seçmek emsal karşılaştırma ve değerleme doğruluğunu belirgin şekilde artırır.
        </p>
      ) : null}
    </div>
  );
}
