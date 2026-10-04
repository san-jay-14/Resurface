/**
 * Image validation for uploads. The client's declared MIME type and filename are never trusted: the
 * type is decided from the file's magic bytes, so a renamed script or HTML file cannot be stored as an
 * image and later served from our public domain.
 */
export interface DetectedImage {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  ext: "jpg" | "png" | "webp";
}

export function detectImage(b: Uint8Array): DetectedImage | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { contentType: "image/jpeg", ext: "jpg" };
  }
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return { contentType: "image/png", ext: "png" };
  }
  // WebP: "RIFF" <size> "WEBP"
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return { contentType: "image/webp", ext: "webp" };
  }
  return null;
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
