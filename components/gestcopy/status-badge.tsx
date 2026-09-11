import { cn } from "@/lib/utils";

export type StatusBadgeStatus = {
  name: string;
  code?: string | null;
  is_initial?: boolean;
  is_ready?: boolean;
  is_closed?: boolean;
  is_cancelled?: boolean;
} | null;

export type StatusBadgeTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "brand"
  | "info";

type StatusBadgeProps = {
  /** Order-status object: derives tone from flags (preferred over name). */
  status?: StatusBadgeStatus;
  /** Manual tone when not using `status`. */
  tone?: StatusBadgeTone;
  children?: React.ReactNode;
  className?: string;
};

const TONE_CLASS: Record<StatusBadgeTone, string> = {
  neutral:
    "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
  success:
    "bg-[hsl(var(--gc-success)/0.14)] text-[hsl(var(--gc-success))] ring-1 ring-inset ring-[hsl(var(--gc-success)/0.28)]",
  warning:
    "bg-[hsl(var(--gc-warning)/0.14)] text-[hsl(var(--gc-warning))] ring-1 ring-inset ring-[hsl(var(--gc-warning)/0.28)]",
  danger:
    "bg-[hsl(var(--gc-danger)/0.14)] text-[hsl(var(--gc-danger))] ring-1 ring-inset ring-[hsl(var(--gc-danger)/0.28)]",
  brand: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20",
  info: "bg-[hsl(var(--gc-info)/0.14)] text-[hsl(var(--gc-info))] ring-1 ring-inset ring-[hsl(var(--gc-info)/0.28)]",
};

/** Flag-first tone for tenant order statuses. */
export function resolveOrderStatusTone(
  status: StatusBadgeStatus
): StatusBadgeTone {
  if (!status) {
    return "neutral";
  }

  if (status.is_cancelled) {
    return "danger";
  }

  if (status.is_closed) {
    return "success";
  }

  if (status.is_ready || status.code === "ready") {
    return "info";
  }

  if (status.is_initial) {
    return "neutral";
  }

  // Intermediate (incl. code in_progress / custom without flags).
  return "warning";
}

export function StatusBadge({
  status,
  tone = "neutral",
  children,
  className,
}: StatusBadgeProps) {
  if (status !== undefined) {
    const label = status?.name?.trim() ? status.name : "—";
    const resolvedTone = resolveOrderStatusTone(status);

    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium tracking-wide",
          TONE_CLASS[resolvedTone],
          className
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium tracking-wide",
        TONE_CLASS[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
