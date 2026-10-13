// Rota açılış ekranı. Vitrin kökündeki loading.tsx kaldırıldı (SP7): /vitrin/[slug] kabuğu metadata ile birlikte
// <head>'e girsin diye o sayfa kendi <Suspense> sınırlarını taşır; alt sayfalar bugünkü açılış ekranını korur.
export { default } from "@/components/route-splash";
