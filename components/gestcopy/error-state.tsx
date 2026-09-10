import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ErrorStateProps = {
  title: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
};

export function ErrorState({
  title,
  description = "Inténtalo de nuevo.",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn("px-6 py-12 text-center", className)}>
      <p className="text-base font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-[0.9375rem] leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {onRetry ? (
        <div className="mt-5">
          <Button type="button" variant="outline" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      ) : null}
    </div>
  );
}
