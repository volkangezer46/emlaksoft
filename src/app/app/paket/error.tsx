"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function PaketError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Paket yükseltme" />;
}
