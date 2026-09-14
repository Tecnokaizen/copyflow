import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description?: string;
  className?: string;
  action?: ReactNode;
  children?: ReactNode;
};

export function EmptyState({
  title,
  description,
  className,
  action,
  children,
}: EmptyStateProps) {
  return (
    <div className={cn("px-6 py-12 text-center", className)}>
      <p className="text-base font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-[0.9375rem] leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
      {children}
    </div>
  );
}
