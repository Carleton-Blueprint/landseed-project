import { getSignedDownloadUrlFromS3Url } from "lib/s3";
import {
  isPrivateS3PhotoUrl,
  signPhotoUrlForDisplay,
  signPhotosForDisplay,
} from "lib/photoUrls";

jest.mock("lib/s3", () => ({
  getSignedDownloadUrlFromS3Url: jest.fn(),
}));

describe("photoUrls", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("isPrivateS3PhotoUrl", () => {
    it("detects bucket-style S3 URLs", () => {
      expect(
        isPrivateS3PhotoUrl(
          "https://my-bucket.s3.ca-central-1.amazonaws.com/projects/p1/photos/a.jpg"
        )
      ).toBe(true);
    });

    it("ignores non-S3 URLs", () => {
      expect(isPrivateS3PhotoUrl("https://example.com/photo.jpg")).toBe(false);
    });
  });

  describe("signPhotoUrlForDisplay", () => {
    it("returns signed URLs for private S3 objects", async () => {
      (getSignedDownloadUrlFromS3Url as jest.Mock).mockResolvedValue(
        "https://signed.example/photo.jpg?sig=abc"
      );

      const signed = await signPhotoUrlForDisplay(
        "https://my-bucket.s3.ca-central-1.amazonaws.com/projects/p1/photos/a.jpg"
      );

      expect(getSignedDownloadUrlFromS3Url).toHaveBeenCalledWith(
        "https://my-bucket.s3.ca-central-1.amazonaws.com/projects/p1/photos/a.jpg",
        3600
      );
      expect(signed).toBe("https://signed.example/photo.jpg?sig=abc");
    });

    it("returns the original URL for non-S3 links", async () => {
      const url = "https://example.com/photo.jpg";
      await expect(signPhotoUrlForDisplay(url)).resolves.toBe(url);
      expect(getSignedDownloadUrlFromS3Url).not.toHaveBeenCalled();
    });
  });

  describe("signPhotosForDisplay", () => {
    it("signs each photo in a list", async () => {
      (getSignedDownloadUrlFromS3Url as jest.Mock)
        .mockResolvedValueOnce("https://signed.example/1.jpg")
        .mockResolvedValueOnce("https://signed.example/2.jpg");

      const signed = await signPhotosForDisplay([
        {
          id: "photo-1",
          url: "https://my-bucket.s3.ca-central-1.amazonaws.com/projects/p1/photos/1.jpg",
        },
        {
          id: "photo-2",
          url: "https://my-bucket.s3.ca-central-1.amazonaws.com/projects/p1/photos/2.jpg",
        },
      ]);

      expect(signed).toEqual([
        { id: "photo-1", url: "https://signed.example/1.jpg" },
        { id: "photo-2", url: "https://signed.example/2.jpg" },
      ]);
    });
  });
});
