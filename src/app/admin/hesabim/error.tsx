"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminHesabimError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Hesabım" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
