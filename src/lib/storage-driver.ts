/**
 * Which backend handles storage writes and whether B2/S3 stays on as a read
 * fallback. Pure (no I/O) so it can be unit-tested.
 *
 *   STORAGE_DRIVER unset / "s3"  + S3 creds  → writes to S3, reads from S3 (old behaviour)
 *   STORAGE_DRIVER unset         + no creds  → local disk only
 *   STORAGE_DRIVER = "local"     + S3 creds  → writes to local disk, files not on disk yet
 *                                              are read from S3 (migration period)
 *   STORAGE_DRIVER = "local"     + no creds  → local disk only (after migration)
 */
export type StorageDriver = { writes: "s3" | "local"; legacyS3Reads: boolean };

export function resolveStorageDriver(input: { driver?: string | null; hasS3Credentials: boolean }): StorageDriver {
  const driver = (input.driver ?? "").trim().toLowerCase();
  if (driver === "local") return { writes: "local", legacyS3Reads: input.hasS3Credentials };
  return { writes: input.hasS3Credentials ? "s3" : "local", legacyS3Reads: false };
}
