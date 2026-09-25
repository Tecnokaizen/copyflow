/**
 * Order of logo persistence. Once tenant_settings points at a logo, that
 * object is authoritative: a failed R2 cleanup must not delete it or roll
 * the row back.
 */
export async function commitLogoReplacement(input: {
  newKey: string;
  save: () => Promise<{ previousKey: string | null }>;
  remove: (key: string) => Promise<void>;
  warn: (message: string) => void;
}): Promise<"saved" | "save_failed"> {
  let previousKey: string | null;
  try {
    previousKey = (await input.save()).previousKey;
  } catch {
    await input.remove(input.newKey).catch(() => undefined);
    return "save_failed";
  }

  if (previousKey && previousKey !== input.newKey) {
    try {
      await input.remove(previousKey);
    } catch {
      input.warn("previous logo cleanup failed");
    }
  }
  return "saved";
}

export async function commitLogoRemoval(input: {
  currentKey: string | null;
  save: () => Promise<void>;
  remove: (key: string) => Promise<void>;
  warn: (message: string) => void;
}): Promise<"cleared" | "save_failed"> {
  try {
    await input.save();
  } catch {
    return "save_failed";
  }

  if (input.currentKey) {
    try {
      await input.remove(input.currentKey);
    } catch {
      input.warn("logo object cleanup failed");
    }
  }
  return "cleared";
}
