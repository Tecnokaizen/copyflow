import {
  BookOpen,
  Circle,
  ClipboardList,
  Eye,
  Layers,
  PenTool,
  Printer,
  Scissors,
  Truck,
  type LucideIcon,
} from "lucide-react";

import { WORK_STAGE_ICON_LABELS, type WorkStageIcon as WorkStageIconCode } from "@/lib/orders/work-stage-icons";

// SUR4 E7/E8: the closed icon set of work_stages.icon, always Lucide (never emoji).
const ICONS: Record<WorkStageIconCode, LucideIcon> = {
  design: PenTool,
  prepare: ClipboardList,
  print: Printer,
  finish: Layers,
  cut: Scissors,
  bind: BookOpen,
  review: Eye,
  deliver: Truck,
  other: Circle,
};

export function WorkStageIcon({
  icon,
  className = "size-4",
  decorative = true,
}: {
  icon: string | null | undefined;
  className?: string;
  decorative?: boolean;
}) {
  const code = (icon && icon in ICONS ? icon : "other") as WorkStageIconCode;
  const Icon = ICONS[code];
  return decorative ? (
    <Icon className={className} aria-hidden="true" />
  ) : (
    <Icon className={className} role="img" aria-label={WORK_STAGE_ICON_LABELS[code]} />
  );
}
