"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { TOUR_PARAM, TOUR_STORAGE_KEY } from "@/lib/product-tour-storage";

// Tur kodu (Radix Dialog dahil) yalnız tur gerçekten açılacaksa indirilir.
const ProductTour = dynamic(() => import("./product-tour").then((m) => m.ProductTour), { ssr: false });

/** Turun başlama ön koşulları (product-tour.tsx ile aynı): yalnız o zaman parçayı yükle. */
function shouldLoadTour(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get("tv") === "1") return false;
  if (params.get(TOUR_PARAM) === "1") return true;
  try {
    if (window.localStorage.getItem(TOUR_STORAGE_KEY)) return false;
  } catch {
    return false;
  }
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ProductTourLazy() {
  const [load, setLoad] = useState(false);
  useEffect(() => {
    if (!shouldLoadTour()) return;
    const t = window.setTimeout(() => setLoad(true), 0);
    return () => window.clearTimeout(t);
  }, []);
  return load ? <ProductTour /> : null;
}
