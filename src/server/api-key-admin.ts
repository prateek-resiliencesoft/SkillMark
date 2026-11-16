/**
 * Hard-delete an organization API key. Kept free of tRPC imports so it can be
 * unit-tested with a fake database.
 *
 * Usage logs and form submissions keep their rows: their "apiKeyId" foreign
 * keys are ON DELETE SET NULL (db/init/03-integrations.sql).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST builder or test fake
type Db = { from: (table: string) => any };

export type DeletedKey = { id: string; name: string | null; keyPrefix: string | null };

export async function deleteOrgApiKey(
  db: Db,
  input: { organizationId: string; id: string; actorId: string },
): Promise<DeletedKey | null> {
  const { data: key } = await db
    .from("api_keys")
    .select("id, name, keyPrefix")
    .eq("id", input.id)
    .eq("organizationId", input.organizationId)
    .maybeSingle();
  if (!key) return null;

  const { error } = await db.from("api_keys").delete().eq("id", input.id).eq("organizationId", input.organizationId);
  if (error) throw new Error(error.message ?? "Could not delete key");

  try {
    await db.from("audit_logs").insert({
      userId: input.actorId,
      action: "api_key.delete",
      resourceType: "api_key",
      resourceId: key.id,
      metadata: { organizationId: input.organizationId, name: key.name, keyPrefix: key.keyPrefix },
    });
  } catch {
    // Audit is best-effort; never block the delete.
  }
  return key as DeletedKey;
}
