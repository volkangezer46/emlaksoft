"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function HesaplayiciError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Hesaplayıcı" />;
}
