"use client";

import { useEffect } from "react";
import { reportClientError } from "@/app/actions/report-error";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
    // Vercel loguna ek olarak DB'ye de yaz: log satirlari toplanmiyor ve
    // aranamiyordu. Ayni hata tekrar gelirse yeni satir degil sayac artiyor.
    void reportClientError({
      message: error.message || "Bilinmeyen hata",
      digest: error.digest,
      stack: error.stack,
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
    });
  }, [error]);

  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f6f8fc",
          color: "#172033",
          fontFamily: "system-ui, sans-serif",
          padding: "16px",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <div
            style={{
              margin: "0 auto",
              width: 64,
              height: 64,
              borderRadius: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(229,72,77,0.1)",
              fontSize: 30,
            }}
          >
            ⚠️
          </div>
          <h1 style={{ marginTop: 16, fontSize: 24, fontWeight: 800 }}>Beklenmeyen bir hata oluştu</h1>
          <p style={{ marginTop: 8, fontSize: 14, color: "#667085" }}>
            Uygulama yeniden başlatılıyor. Sorun devam ederse lütfen daha sonra tekrar deneyin.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 24,
              padding: "12px 24px",
              borderRadius: 11,
              border: "none",
              background: "#1463ff",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Tekrar dene
          </button>
        </div>
      </body>
    </html>
  );
}
