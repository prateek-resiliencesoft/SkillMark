import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { parseRangeHeader } from "@/lib/http-range";
import { getLegacyS3Object, isLegacyS3Enabled } from "@/lib/legacy-s3";
import { createLogger } from "@/lib/logger";
import { openLocalObjectStream, statLocalObject, verifyFileToken } from "@/lib/storage";

const log = createLogger("api/files");

export const dynamic = "force-dynamic";

/**
 * Serves files from the server disk. Requires a signed ?token= (created by
 * storage.createSignedUrl). Supports HTTP Range so audio/video can seek.
 * The path is the object key itself (orgs/.../recordings/file.webm).
 * Files not on disk yet (recorded before the move off the S3 bucket) are
 * proxied from the legacy bucket, Range included, so old recordings still play.
 */
export async function GET(req: Request, { params }: { params: { bucket: string; path: string[] } }) {
  const objKey = params.path.map(decodeURIComponent).join("/");
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!(await verifyFileToken(token, params.bucket, objKey))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const file = await statLocalObject(objKey);
  if (!file) {
    return (await legacyResponse(objKey, req, "GET")) ?? NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const base: Record<string, string> = {
    "Content-Type": file.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };

  const range = parseRangeHeader(req.headers.get("range"), file.size);
  if (range === "invalid") {
    return new NextResponse(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${file.size}` } });
  }

  if (range) {
    const stream = openLocalObjectStream(file.fullPath, range);
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        ...base,
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${file.size}`,
      },
    });
  }

  const stream = openLocalObjectStream(file.fullPath);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: { ...base, "Content-Length": String(file.size) },
  });
}

export async function HEAD(req: Request, { params }: { params: { bucket: string; path: string[] } }) {
  const objKey = params.path.map(decodeURIComponent).join("/");
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!(await verifyFileToken(token, params.bucket, objKey))) return new NextResponse(null, { status: 403 });
  const file = await statLocalObject(objKey);
  if (!file) return (await legacyResponse(objKey, req, "HEAD")) ?? new NextResponse(null, { status: 404 });
  return new NextResponse(null, {
    status: 200,
    headers: { "Content-Type": file.contentType, "Content-Length": String(file.size), "Accept-Ranges": "bytes" },
  });
}

/** Content type from the extension when the bucket stored a generic one. */
function typeForKey(objKey: string, stored: string | null): string {
  if (stored && stored !== "application/octet-stream" && stored !== "binary/octet-stream") return stored;
  const ext = objKey.split(".").pop()?.toLowerCase();
  if (ext === "m4a" || ext === "mp4") return "audio/mp4";
  if (ext === "webm") return "audio/webm";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  return stored || "application/octet-stream";
}

/** Proxy a file from the legacy bucket (null when not configured or not there either). */
async function legacyResponse(objKey: string, req: Request, method: "GET" | "HEAD"): Promise<NextResponse | null> {
  if (!isLegacyS3Enabled()) return null;
  try {
    const upstream = await getLegacyS3Object(objKey, { method, range: req.headers.get("range") });
    if (!upstream) return null;
    const headers: Record<string, string> = {
      "Content-Type": typeForKey(objKey, upstream.headers.get("content-type")),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    };
    for (const h of ["content-length", "content-range"]) {
      const v = upstream.headers.get(h);
      if (v) headers[h === "content-length" ? "Content-Length" : "Content-Range"] = v;
    }
    return new NextResponse(method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
  } catch (err) {
    log.error(`Legacy bucket read failed for ${objKey}:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Storage unavailable" }, { status: 502 });
  }
}
