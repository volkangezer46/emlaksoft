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

export const DUPLICATE_DEBOUNCE_MS = 500;

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

function run(kind: DuplicateKind, v: Values): Promise<DuplicateCheckResult> {
  if (kind === "customer") return checkCustomerDuplicate({ phone: v.phone, email: v.email });
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
 * Form alanları yazıldıkça (debounce 500 ms) salt-okunur mükerrer aramasını çalıştırır.
 * `form` null iken bekler. Eski yanıtlar yeni girdiyi ezmez (istek sayacı).
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
      run(kind, values)
        .then((r) => {
          if (mine !== seq.current) return;
          setHits(r.ok ? r.hits : []);
        })
        .catch(() => {
          if (mine === seq.current) setHits([]);
        })
        .finally(() => {
          if (mine === seq.current) setLoading(false);
        });
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(evaluate, DUPLICATE_DEBOUNCE_MS);
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
