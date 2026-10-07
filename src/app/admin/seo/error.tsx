"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminSeoError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="SEO" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
