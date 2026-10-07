"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function HizliError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Hızlı kayıt" />;
}
