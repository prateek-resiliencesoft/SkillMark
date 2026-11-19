import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { parseRangeHeader } from "@/lib/http-range";
import {
  copyLegacyObjectToLocal,
  isLegacyS3ReadEnabled,
  isS3CapExceededMessage,
  openLocalObjectStream,
  statLocalObject,
  verifyFileToken,
} from "@/lib/storage";

export const dynamic = "force-dynamic";

const LEGACY_CAP_MESSAGE =
  "This file is still being moved from the old storage (Backblaze), which has reached its daily download limit. " +
  "It will be available after the limit resets (00:00 UTC).";

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

  let file = await statLocalObject(objKey);
  if (!file && isLegacyS3ReadEnabled()) {
    // Not copied to the server yet: copy it now, then serve it from disk.
    try {
      await copyLegacyObjectToLocal(objKey);
      file = await statLocalObject(objKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isS3CapExceededMessage(message)) {
        return new NextResponse(LEGACY_CAP_MESSAGE, {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "3600" },
        });
      }
      if (!/\((403|404)\)/.test(message)) {
        return NextResponse.json({ error: "Could not load this file. Try again shortly." }, { status: 502 });
      }
    }
  }
  if (!file) {
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
