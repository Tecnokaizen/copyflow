import { normalizeRichText } from "@/lib/rich-text/html";
import { cn } from "@/lib/utils";

const contentClassName =
  "min-w-0 max-w-full break-words [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5";

export function RichTextContent({
  value,
  className,
  textStyles = false,
}: {
  value: string | null | undefined;
  className?: string;
  /** Render the stored text sizes and colors (fields that opt in, e.g. orders). */
  textStyles?: boolean;
}) {
  const html = normalizeRichText(value, { textStyles });
  if (!html) {
    return null;
  }

  return (
    <div
      className={cn(contentClassName, className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
