"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function GelenKutusuError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Gelen kutusu" />;
}
