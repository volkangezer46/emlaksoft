"use client";

import { useEffect, useRef, useState } from "react";
import {
  checkCustomerDuplicate,
  checkDemandDuplicate,
  checkPropertyDuplicate,
  type DuplicateCheckResult,
} from "@/app/actions/duplicates";
import { readFormValues } from "@/components/app/use-form-values";
import type { DuplicateHit } from "@/lib/duplicate-match";
import { emailLookupKey, phoneLookupVariants } from "@/lib/duplicate-match";

export type DuplicateKind = "customer" | "property" | "demand";

/**
 * Bekleme (B036): müşteri telefonunda numara tamamlanınca (yerel 10 hane) HEMEN, aksi halde 150 ms; portföy/talep
 * metin alanlarında 500 ms (yazarken her tuşta sunucu turu olmasın).
 */
export const DUPLICATE_DEBOUNCE_MS = 500;
export const CUSTOMER_DEBOUNCE_MS = 150;

/** Girdi tamamlanmış bir telefon mu? (TR: 0/90 hariç 10 hane; yabancı +ülke kodu ile ≥10 hane) */
export function isCompletePhone(raw: string | null | undefined): boolean {
  const s = String(raw ?? "");
  if (/[a-z@]/i.test(s)) return false;
  let digits = s.replace(/\D/g, "");
  if (digits.startsWith("0090")) digits = digits.slice(4);
  else if (s.trim().startsWith("+90") || (digits.startsWith("90") && digits.length === 12)) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.length >= 10;
}

/** Bir sonraki denetimin gecikmesi: tamamlanmış telefon → 0 ms. */
export function duplicateDelay(kind: DuplicateKind, typed: string | null | undefined): number {
  if (kind !== "customer") return DUPLICATE_DEBOUNCE_MS;
  return isCompletePhone(typed) ? 0 : CUSTOMER_DEBOUNCE_MS;
}

/** Her tür için izlenen form alanları (name). */
export const DUPLICATE_WATCH: Record<DuplicateKind, readonly string[]> = {
  customer: ["phone", "email"],
  property: ["title", "address_line", "parcel_block", "parcel_lot", "property_type", "transaction_type", "district_id", "neighborhood_id"],
  demand: ["customer_id", "transaction_type", "property_type", "demand_district_id"],
};

type Values = Record<string, string>;

/** Aramaya değer mi? (gereksiz sunucu çağrısını istemcide ele). */
export function isSearchable(kind: DuplicateKind, v: Values): boolean {
  if (kind === "customer") return phoneLookupVariants(v.phone).length > 0 || emailLookupKey(v.email) !== "";
  if (kind === "property") {
    const hasArea = !!(v.neighborhood_id || v.district_id);
    const hasParcel = !!(v.parcel_block && v.parcel_lot);
    const hasText = (v.title ?? "").trim().length >= 8 || (v.address_line ?? "").trim().length >= 8;
    return hasArea && (hasParcel || hasText);
  }
  return !!(v.customer_id && v.transaction_type);
}

function run(kind: DuplicateKind, v: Values, detail = true): Promise<DuplicateCheckResult> {
  if (kind === "customer") return checkCustomerDuplicate({ phone: v.phone, email: v.email }, { detail });
  if (kind === "property") {
    return checkPropertyDuplicate({
      title: v.title,
      address: v.address_line,
      block: v.parcel_block,
      lot: v.parcel_lot,
      propertyType: v.property_type,
      transactionType: v.transaction_type,
      districtId: v.district_id,
      neighborhoodId: v.neighborhood_id,
    });
  }
  return checkDemandDuplicate({
    customerId: v.customer_id,
    transactionType: v.transaction_type,
    propertyType: v.property_type,
    districtId: v.demand_district_id,
  });
}

/**
 * Form alanları yazıldıkça salt-okunur mükerrer aramasını çalıştırır (müşteri: numara tamamlanınca hemen, aksi halde
 * 150 ms; diğerleri 500 ms). Müşteride ilk yanıt yalnız var/yok + ad (tek tur), danışman adı ve son temas ikinci
 * yanıtla dolar. `form` null iken bekler. Eski yanıtlar yeni girdiyi ezmez (istek sayacı).
 */
export function useDuplicateCheck(form: HTMLFormElement | null, kind: DuplicateKind) {
  const [hits, setHits] = useState<DuplicateHit[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const lastKey = useRef("");

  useEffect(() => {
    if (!form) return;
    const names = DUPLICATE_WATCH[kind];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const evaluate = () => {
      const values = readFormValues(form, names) as Values;
      const key = JSON.stringify(values);
      if (key === lastKey.current) return;
      lastKey.current = key;
      const mine = ++seq.current;
      if (!isSearchable(kind, values)) {
        setHits([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const twoPhase = kind === "customer";
      run(kind, values, !twoPhase)
        .then(async (r) => {
          if (mine !== seq.current) return;
          setHits(r.ok ? r.hits : []);
          // İkinci tur yalnız eşleşme varsa: ayrıntı (danışman adı, son temas) aynı kartı doldurur.
          if (twoPhase && r.ok && r.hits.some((h) => h.visible && h.id)) {
            const full = await run(kind, values, true);
            if (mine === seq.current && full.ok) setHits(full.hits);
          }
        })
        .catch(() => {
          if (mine === seq.current) setHits([]);
        })
        .finally(() => {
          if (mine === seq.current) setLoading(false);
        });
    };
    const schedule = (e?: Event) => {
      if (timer) clearTimeout(timer);
      const typed = e?.target instanceof HTMLInputElement ? e.target.value : readFormValues(form, ["phone"]).phone;
      // 0 ms bile setTimeout ile: PhoneInput gizli alanı React işlediğinde yazılmış olur.
      timer = setTimeout(evaluate, duplicateDelay(kind, typed));
    };
    // PhoneInput/Combobox gizli alanları React render'ından sonra yazılır; debounce bunu zaten kapsar.
    form.addEventListener("input", schedule);
    form.addEventListener("change", schedule);
    schedule();
    return () => {
      form.removeEventListener("input", schedule);
      form.removeEventListener("change", schedule);
      if (timer) clearTimeout(timer);
    };
  }, [form, kind]);

  return { hits, loading };
}
