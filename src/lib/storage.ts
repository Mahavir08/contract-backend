import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { env } from "./env";

export type StoredFile = { storageKey: string };

// Storage abstraction: local disk in dev, Google Cloud Storage in prod.
// Selected via STORAGE_DRIVER; keeps the rest of the app storage-agnostic.
export interface Storage {
  save(orgId: string, contractId: string, fileName: string, contentType: string, buffer: Buffer): Promise<StoredFile>;
  read(storageKey: string): Promise<Buffer>;
}

class LocalStorage implements Storage {
  async save(orgId: string, contractId: string, fileName: string, _contentType: string, buffer: Buffer): Promise<StoredFile> {
    const safeName = `${randomUUID()}-${fileName.replace(/[^\w.\-]/g, "_")}`;
    const dir = path.join(env.localUploadDir, orgId, contractId);
    await fs.mkdir(dir, { recursive: true });
    const fullPath = path.join(dir, safeName);
    await fs.writeFile(fullPath, buffer);
    // storageKey is relative to the upload dir so it stays portable.
    return { storageKey: path.relative(env.localUploadDir, fullPath) };
  }

  async read(storageKey: string): Promise<Buffer> {
    return fs.readFile(path.join(env.localUploadDir, storageKey));
  }
}

class GcsStorage implements Storage {
  private bucketName = env.gcsBucket;

  private async bucket() {
    // Lazy import so local dev doesn't require GCS credentials.
    const { Storage: GCS } = await import("@google-cloud/storage");
    return new GCS().bucket(this.bucketName);
  }

  async save(orgId: string, contractId: string, fileName: string, contentType: string, buffer: Buffer): Promise<StoredFile> {
    const key = `${orgId}/${contractId}/${randomUUID()}-${fileName.replace(/[^\w.\-]/g, "_")}`;
    const bucket = await this.bucket();
    await bucket.file(key).save(buffer, { contentType });
    return { storageKey: key };
  }

  async read(storageKey: string): Promise<Buffer> {
    const bucket = await this.bucket();
    const [contents] = await bucket.file(storageKey).download();
    return contents;
  }
}

export const storage: Storage = env.storageDriver === "gcs" ? new GcsStorage() : new LocalStorage();
