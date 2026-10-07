"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminDanismanError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Platform asistanı" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
