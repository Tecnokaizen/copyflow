"use client";

import { createContext, useContext } from "react";

// Order Detail Views V1 · view C: a layout may ask the sequence to show what
// is pending first on phones. Done steps fold into one line (still there,
// with «Deshacer»); data, permissions and writes are unchanged.
export type WorkSequencePresentation = { pendingFirstOnMobile: boolean };

const WorkSequencePresentationContext = createContext<WorkSequencePresentation>({
  pendingFirstOnMobile: false,
});

export const WorkSequencePresentationProvider = WorkSequencePresentationContext.Provider;

export function useWorkSequencePresentation() {
  return useContext(WorkSequencePresentationContext);
}
