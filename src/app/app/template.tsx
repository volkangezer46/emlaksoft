/**
 * Panel sayfa geçişi — iki katmanlı progressive enhancement:
 *
 * 1) View Transitions destekleyen tarayıcı: React <ViewTransition> (experimental.viewTransition
 *    bayrağı ile) navigasyonda tarayıcının native cross-fade'ini tetikler; süre/easing
 *    globals.css'te ::view-transition-*(root) ve .page-fade sınıfında (180ms).
 *    Bu durumda .page-in keyframe'i @supports (view-transition-name: root) bloğunda
 *    .vt-page üzerinden kapatılır — çift animasyon olmaz.
 * 2) Desteklemeyen tarayıcı: eski davranış aynen — .page-in ile 0.3s yükselme + fade.
 *
 * Not: canary TİP augmentasyonu triple-slash ile yüklenir (runtime importu Turbopack'te
 * çözülemiyor); çalışma zamanında App Router'ın React sürümü ViewTransition'ı export ediyor.
 */
/// <reference types="react/canary" />
import { ViewTransition } from "react";

export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition default="page-fade">
      <div className="page-in vt-page">{children}</div>
    </ViewTransition>
  );
}
