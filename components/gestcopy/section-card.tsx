import { cn } from "@/lib/utils";

type SectionCardProps = {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
};

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: SectionCardProps) {
  return (
    <section className={cn("gc-card", className)}>
      {(title || actions) && (
        <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-5">
          <div className="min-w-0">
            {title ? <h2 className="gc-section-title">{title}</h2> : null}
            {description ? (
              <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions}
        </div>
      )}
      <div className={cn(bodyClassName)}>{children}</div>
    </section>
  );
}
