import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "mb-8 flex flex-col gap-5 sm:mb-10 sm:flex-row sm:items-start sm:justify-between sm:gap-8",
        className
      )}
    >
      <div className="min-w-0 max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 text-base leading-relaxed text-muted-foreground md:text-[1.0625rem]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pt-1">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
