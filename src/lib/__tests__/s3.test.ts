const mockSend = jest.fn();

jest.mock("@aws-sdk/client-s3", () => {
  const actual = jest.requireActual("@aws-sdk/client-s3");
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

describe("lib/s3 upload encryption", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    process.env = {
      ...ORIGINAL_ENV,
      AWS_S3_BUCKET: "test-bucket",
      AWS_REGION: "ca-central-1",
      AWS_ACCESS_KEY_ID: "test-key",
      AWS_SECRET_ACCESS_KEY: "test-secret",
      AWS_KMS_KEY_ID: "arn:aws:kms:ca-central-1:123456789012:key/test-key-id",
    };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("sends PutObjectCommand with SSE-KMS params on uploadStreamToS3", async () => {
    const { uploadStreamToS3 } = await import("lib/s3");

    await uploadStreamToS3(Buffer.from("data"), "projects/1/photo.png", "image/png");

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command.input).toMatchObject({
      Bucket: "test-bucket",
      Key: "projects/1/photo.png",
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: "arn:aws:kms:ca-central-1:123456789012:key/test-key-id",
      BucketKeyEnabled: true,
    });
  });

  it("sends the same SSE-KMS params via uploadToS3", async () => {
    const { uploadToS3 } = await import("lib/s3");

    await uploadToS3(Buffer.from("data"), "documents/1/proof.pdf", "application/pdf");

    const command = mockSend.mock.calls[0][0];
    expect(command.input).toMatchObject({
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: "arn:aws:kms:ca-central-1:123456789012:key/test-key-id",
      BucketKeyEnabled: true,
    });
  });

  it("throws and does not call S3 when AWS_KMS_KEY_ID is unset", async () => {
    process.env.AWS_KMS_KEY_ID = "";
    const { uploadStreamToS3 } = await import("lib/s3");

    await expect(
      uploadStreamToS3(Buffer.from("data"), "projects/1/photo.png", "image/png")
    ).rejects.toThrow(/AWS_KMS_KEY_ID/);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
