import { RegisterForm } from "./register-form";

export const metadata = {
  title: "Ofisinizi Ücretsiz Oluşturun",
  description:
    "14 gün ücretsiz deneme ile EmlakSoft'a başlayın. Kredi kartı gerekmez. Portföy, müşteri ve komisyon yönetimi tek platformda.",
  alternates: { canonical: "/kayit" },
  openGraph: {
    title: "EmlakSoft — Ücretsiz Başla",
    description: "14 gün ücretsiz deneme. Emlak ofisinizi bugün dijitalleştirin.",
    url: "/kayit",
  },
};

export default function RegisterPage() {
  return <RegisterForm />;
}
