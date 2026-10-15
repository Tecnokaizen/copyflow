"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

type ClientModalProps = {
  children: ReactNode;
};

export function ClientModal({ children }: ClientModalProps) {
  // Keep server rendering and initial hydration free of browser-only APIs.
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);

  if (!mounted) return null;

  // Keep the client form outside its caller's form, including quote drafts.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background p-6">
        {children}
      </div>
    </div>,
    document.body
  );
}
