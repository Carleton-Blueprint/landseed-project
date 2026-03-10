/**
 * Image optimization service (placeholder). Intended for Sharp: resize and compress uploaded photos
 * before storing in S3. Wire Sharp here and call from the upload flow when ready.
 */
// import Sharp from "sharp";

export async function optimizeImage(
  buffer: Buffer,
  options?: { width?: number; quality?: number }
): Promise<Buffer> {
  // Placeholder: wire Sharp when ready
  void options;
  // const { width = 1920, quality = 85 } = options ?? {};
  // return Sharp(buffer).resize(width).jpeg({ quality }).toBuffer();
  return buffer;
}
