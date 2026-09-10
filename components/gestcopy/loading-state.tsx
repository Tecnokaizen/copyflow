import { cn } from "@/lib/utils";

type LoadingStateProps = {
  label: string;
  className?: string;
};

export function LoadingState({ label, className }: LoadingStateProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center px-6 py-12 text-center",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <p className="text-[0.9375rem] text-muted-foreground">{label}</p>
    </div>
  );
}
