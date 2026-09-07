"use client";

import type { ReactNode } from "react";

type ServiceModalProps = {
  children: ReactNode;
};

export function ServiceModal({ children }: ServiceModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background p-6">
        {children}
      </div>
    </div>
  );
}
