"use client";

import dynamic from "next/dynamic";

/** Fiş okuma istemci parçaları ayrı yüklenir (ayarlar sekmesi ve belge sekmesi dışında indirilmez). */
const PANEL = () => <div aria-hidden="true" className="skeleton h-40 w-full rounded-[var(--radius-card)]" />;

export const ReceiptSettingsCard = dynamic(() => import("./receipt-settings-card").then((m) => m.ReceiptSettingsCard), { loading: PANEL });
export const ReceiptReview = dynamic(() => import("./receipt-review").then((m) => m.ReceiptReview), { loading: PANEL });
