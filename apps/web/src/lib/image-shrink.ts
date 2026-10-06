/**
 * Shrinks photos on the phone before upload (Phase 5.2): a photo of an
 * exercise book straight off a camera is 3–8 MB; resized to at most 1600 px
 * on the long side as a JPEG it's typically 200–500 KB — readable, and kind
 * to pupils' data plans and the school's storage share.
 *
 * Browser only. Anything that isn't a JPEG/PNG photo, or can't be decoded,
 * is returned unchanged (the server still checks every file).
 */

export const MAX_SIDE = 1600;
const QUALITY = 0.82;
/** Below this, a small image isn't worth re-encoding. */
const SMALL_ENOUGH = 600 * 1024;

/** Target size keeping the aspect ratio, never upscaling. Exported for tests. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function shrinkPhoto(file: File): Promise<File> {
  if (typeof window === "undefined" || !/^image\/(jpeg|png)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const target = fitWithin(bitmap.width, bitmap.height);
    if (file.size <= SMALL_ENOUGH && target.width === bitmap.width && target.height === bitmap.height) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff"; // PNG transparency → white, not black, as a JPEG
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.(png|jpe?g)$/i, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}
