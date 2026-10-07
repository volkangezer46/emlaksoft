"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function EslestirmeError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Eşleştirme" />;
}
