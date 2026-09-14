export function formatOperativeProfile(
  member: {
    name: string;
    job_title?: string | null;
    department?: string | null;
  } | null
    | undefined
) {
  if (!member) {
    return "Sin asociar";
  }

  return [member.name, member.job_title, member.department]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" · ");
}
