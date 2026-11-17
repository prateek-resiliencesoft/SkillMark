import { getAuthUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/server/tenant";
import { writePlatformAudit } from "@/server/tenant";
import {
  isAllowedMediaMime,
  MAX_MEDIA_BYTES,
  publicMediaPath,
  uploadLandingMedia,
} from "@landing/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Multipart upload for the landing media library. Platform admins only. */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await requirePlatformAdmin(supabaseAdmin, user.id);
  } catch {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const alt = ((form.get("alt") as string | null) ?? "").trim();

  if (!(file instanceof File)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_MEDIA_BYTES) {
    return Response.json({ error: "Image must be 5 MB or smaller" }, { status: 413 });
  }

  const mime = file.type || "application/octet-stream";
  if (!isAllowedMediaMime(mime)) {
    return Response.json(
      { error: "Only PNG, JPEG, WebP, AVIF and GIF images are allowed" },
      { status: 400 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const row = await uploadLandingMedia(
      supabaseAdmin,
      { buffer, mime, fileName: file.name, alt },
      user.id,
    );
    await writePlatformAudit(supabaseAdmin, {
      actorId: user.id,
      action: "landing.media_upload",
      targetType: "landing_media",
      targetId: row.id,
      meta: { fileName: row.fileName, size: row.size, mime: row.mime },
    });

    return Response.json({
      data: {
        ...row,
        url: publicMediaPath(row.id),
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 },
    );
  }
}
