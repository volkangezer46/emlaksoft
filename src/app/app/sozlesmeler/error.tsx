"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function SozlesmelerError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Sözleşmeler" />;
}
