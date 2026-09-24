export type UploadHead = {
  exists: boolean;
  contentLength: number | null;
};

/** Backend HEAD check before COMPLETE. Missing object and size mismatch both fail. */
export function uploadHeadFailure(
  head: UploadHead,
  expectedSize: number
): "missing" | "mismatch" | null {
  if (!head.exists) {
    return "missing";
  }
  if (head.contentLength !== expectedSize) {
    return "mismatch";
  }
  return null;
}
