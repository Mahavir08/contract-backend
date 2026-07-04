import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  storageDriver: (process.env.STORAGE_DRIVER ?? "local") as "local" | "gcs",
  localUploadDir: process.env.LOCAL_UPLOAD_DIR ?? "./uploads",
  gcsBucket: process.env.GCS_BUCKET ?? "",
};
