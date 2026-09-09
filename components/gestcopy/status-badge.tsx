import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  tone?: "neutral" | "success" | "warning" | "danger" | "brand";
  children: React.ReactNode;
  className?: string;
};

const TONE_CLASS: Record<NonNullable<StatusBadgeProps["tone"]>, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200/80",
  success:
    "bg-emerald-50/90 text-emerald-800 ring-1 ring-inset ring-emerald-200/70",
  warning:
    "bg-amber-50/90 text-amber-900/90 ring-1 ring-inset ring-amber-200/70",
  danger: "bg-red-50/80 text-red-800/90 ring-1 ring-inset ring-red-200/70",
  brand: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20",
};

export function StatusBadge({
  tone = "neutral",
  children,
  className,
}: StatusBadgeProps) {
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
