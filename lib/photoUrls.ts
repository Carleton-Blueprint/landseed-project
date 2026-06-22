import { getSignedDownloadUrlFromS3Url } from "lib/s3";

const DEFAULT_DISPLAY_URL_TTL_SECONDS = 3600;

export function isPrivateS3PhotoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes(".s3.") && parsed.hostname.endsWith(".amazonaws.com");
  } catch {
    return false;
  }
}

export async function signPhotoUrlForDisplay(
  url: string,
  expiresIn = DEFAULT_DISPLAY_URL_TTL_SECONDS
): Promise<string> {
  if (!isPrivateS3PhotoUrl(url)) {
    return url;
  }

  try {
    return await getSignedDownloadUrlFromS3Url(url, expiresIn);
  } catch {
    return url;
  }
}

export async function signPhotosForDisplay<T extends { id: string; url: string }>(
  photos: T[],
  expiresIn = DEFAULT_DISPLAY_URL_TTL_SECONDS
): Promise<T[]> {
  return Promise.all(
    photos.map(async (photo) => ({
      ...photo,
      url: await signPhotoUrlForDisplay(photo.url, expiresIn),
    }))
  );
}
