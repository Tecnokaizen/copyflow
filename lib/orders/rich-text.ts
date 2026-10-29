import type { RichTextOptions } from "@/lib/rich-text/html";

/**
 * Order instructions (`orders.description`) and internal notes (`orders.notes`)
 * keep text sizes and colors, so the shop floor can highlight what matters.
 * Every write and render of those two fields uses these options; other rich
 * text fields (quotes, footer, clients, services, kiosk) keep the basic set.
 */
export const ORDER_RICH_TEXT: RichTextOptions = { textStyles: true };
