"use client";

import { AlertTriangle, Ban, CheckCircle2, CircleDot, Lock, Pin, Printer, UserRound } from "lucide-react";

import { StatusBadge } from "@/components/gestcopy/status-badge";
import { NOTE_STATE_LABELS, NOTE_VISIBILITY_LABELS } from "@/lib/orders/notes/format";
import { detectPersonalData, personalDataWarning } from "@/lib/orders/notes/pii";
import type { NoteState, NoteVisibility, OrderNoteView } from "@/lib/orders/notes/types";
import { cn } from "@/lib/utils";

// Small pieces shared by the strip, the panel and the dialogs. Every state is
// text plus icon: colour is never the only signal.

/** Native radios follow the dark color-scheme and look filled when unchecked: draw our own ring. */
export const NOTE_RADIO_CLASS =
  "size-4 shrink-0 cursor-pointer appearance-none rounded-full border border-primary bg-transparent shadow-sm transition-[border-width] checked:border-[5px] checked:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60";

const STATE_ICON = { open: CircleDot, resolved: CheckCircle2, voided: Ban } as const;
const STATE_TONE = { open: "warning", resolved: "success", voided: "neutral" } as const;

export function NoteStateBadge({ state }: { state: NoteState }) {
  const Icon = STATE_ICON[state];
  return (
    <StatusBadge tone={STATE_TONE[state]} className="gap-1">
      <Icon aria-hidden className="size-3.5" />
      {NOTE_STATE_LABELS[state]}
    </StatusBadge>
  );
}

export function NoteVisibilityBadge({ visibility }: { visibility: NoteVisibility }) {
  const Icon = visibility === "printable" ? Printer : Lock;
  return (
    <StatusBadge tone={visibility === "printable" ? "info" : "neutral"} className="gap-1">
      <Icon aria-hidden className="size-3.5" />
      {NOTE_VISIBILITY_LABELS[visibility]}
    </StatusBadge>
  );
}

export function NotePinnedBadge() {
  return (
    <StatusBadge tone="brand" className="gap-1">
      <Pin aria-hidden className="size-3.5" />
      Fijada
    </StatusBadge>
  );
}

export function NoteAddressee({ addressee, className }: { addressee: OrderNoteView["addressee"]; className?: string }) {
  if (!addressee) return null;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 text-xs font-medium text-foreground", className)}>
      <UserRound aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 break-words">
        Para: {addressee.name}
        {addressee.active ? null : <span className="font-normal text-muted-foreground"> (inactiva)</span>}
      </span>
    </span>
  );
}

/** Only a warning (N2/N22): it never blocks the action. */
export function PersonalDataNotice({
  text,
  context,
  className,
}: {
  /** Plain text to inspect. */
  text: string;
  /** What to check, e.g. «Revisa que se pueda imprimir». */
  context?: string;
  className?: string;
}) {
  const message = personalDataWarning(detectPersonalData(text));
  if (!message) return null;
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-md border border-[hsl(var(--gc-warning)/0.35)] bg-[hsl(var(--gc-warning)/0.08)] px-3 py-2 text-sm text-foreground",
        className
      )}
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-[hsl(var(--gc-warning))]" />
      <span className="min-w-0">
        <strong className="font-semibold">Posible dato personal.</strong> {message}
        {context ? ` ${context}` : null}
      </span>
    </p>
  );
}

export function NoteInlineMessage({
  tone,
  children,
}: {
  tone: "error" | "info";
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-[var(--radius)] border px-3 py-2 text-sm",
        tone === "error"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-border bg-secondary/40 text-foreground"
      )}
    >
      {children}
    </div>
  );
}
