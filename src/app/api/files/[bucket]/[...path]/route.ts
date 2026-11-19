import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { parseRangeHeader } from "@/lib/http-range";
import {
  isLegacyS3ReadEnabled,
  legacyS3SignedUrl,
  openLocalObjectStream,
  statLocalObject,
  verifyFileToken,
} from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Serves files from the server disk. Requires a signed ?token= (created by
 * storage.createSignedUrl). Supports HTTP Range so audio/video can seek.
 * The path is the object key itself (orgs/.../recordings/file.webm).
 */
export async function GET(req: Request, { params }: { params: { bucket: string; path: string[] } }) {
  const objKey = params.path.map(decodeURIComponent).join("/");
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!(await verifyFileToken(token, params.bucket, objKey))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const file = await statLocalObject(objKey);
  if (!file) {
    // Not copied to the server yet: send the browser to the old bucket.
    if (isLegacyS3ReadEnabled()) {
      const url = await legacyS3SignedUrl(objKey, 3600).catch(() => null);
      if (url) return NextResponse.redirect(url, 302);
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
  if (!file) return new NextResponse(null, { status: 404 });
  return new NextResponse(null, {
    status: 200,
    headers: { "Content-Type": file.contentType, "Content-Length": String(file.size), "Accept-Ranges": "bytes" },
  });
}
