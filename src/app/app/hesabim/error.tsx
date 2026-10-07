"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function HesabimError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Hesabım" />;
}
