/**
 * StorageProvider abstraction for persisting artifact files (images, PDFs, etc.)
 * uploaded alongside documents. Currently backed by S3 / Lightsail Object Storage.
 *
 * The interface is intentionally minimal — upload a key and later get a
 * time-limited URL to retrieve it. Keeping it narrow makes it easy to swap
 * in a different backend (local FS, GCS, etc.) without changing callers.
 */

import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface StorageProvider {
	/**
	 * Upload a file to persistent storage under the given key.
	 * Throws on hard failures; callers should try/catch for best-effort semantics.
	 */
	upload(key: string, data: Buffer, contentType: string): Promise<void>;

	/**
	 * Generate a pre-signed URL that gives time-limited read access to a stored
	 * artifact without requiring the caller to have AWS credentials.
	 *
	 * @param key - The storage key returned at upload time.
	 * @param ttlSeconds - How long the URL should remain valid.
	 */
	getPresignedUrl(key: string, ttlSeconds: number): Promise<string>;

	/** Permanently delete a stored artifact. Throws on failure. */
	delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// S3 implementation (also works with Lightsail Object Storage buckets)
// ---------------------------------------------------------------------------

export class S3StorageProvider implements StorageProvider {
	private client: S3Client;
	private bucket: string;

	constructor(bucket: string, region: string) {
		this.bucket = bucket;
		// Standard S3 client — Lightsail Object Storage uses the same AWS SDK
		// wire protocol, so no custom endpoint override is needed.
		this.client = new S3Client({ region });
	}

	async upload(key: string, data: Buffer, contentType: string): Promise<void> {
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: key,
				Body: data,
				ContentType: contentType,
			}),
		);
	}

	async getPresignedUrl(key: string, ttlSeconds: number): Promise<string> {
		const command = new GetObjectCommand({
			Bucket: this.bucket,
			Key: key,
		});
		return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
	}

	async delete(key: string): Promise<void> {
		await this.client.send(
			new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
		);
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Returns an S3StorageProvider when AWS_BUCKET is set,
 * or `null` for local dev environments where artifact storage is optional.
 *
 * Required env vars:
 *   AWS_BUCKET   — bucket name
 *   AWS_REGION   — AWS region (default: us-east-1)
 *
 * Credentials are resolved via the default AWS credential provider chain
 * (env vars, ~/.aws/credentials, instance role, etc.).
 * AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are only needed when no
 * other credential source (e.g. an IAM instance role) is available.
 */
export function createStorageProvider(): StorageProvider | null {
	const bucket = process.env.AWS_BUCKET;
	if (!bucket) {
		// No bucket configured — artifact storage is disabled gracefully.
		return null;
	}
	const region = process.env.AWS_REGION ?? "us-east-1";
	return new S3StorageProvider(bucket, region);
}
