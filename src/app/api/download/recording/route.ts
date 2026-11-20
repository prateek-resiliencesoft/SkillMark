import { getAuthUser } from "@/lib/auth";
import { assertSafeRemoteUrl, safeFetch } from "@/lib/network-security";
import { NextRequest, NextResponse } from "next/server";

const MAX_RECORDING_BYTES = 2 * 1024 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const urlParam = req.nextUrl.searchParams.get("url");
  const filename = req.nextUrl.searchParams.get("filename") || "recording.webm";

  if (!urlParam) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  let safeUrl: URL;
  try {
    safeUrl = await assertSafeRemoteUrl(urlParam);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Invalid or disallowed URL" },
      { status: 400 },
    );
  }

  try {
    const upstream = await safeFetch(safeUrl, {
      redirect: "error",
      maxBytes: MAX_RECORDING_BYTES,
      timeoutMs: 10 * 60_000,
    });

    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => {});
      return NextResponse.json({ error: "Failed to fetch file" }, { status: 502 });
    }

    const headers = new Headers();
    // Sanitize filename to prevent header injection or directory traversal
    const safeFilename = filename.replace(/[/\\?%*:|"<>]/g, "_").trim() || "recording.webm";
    headers.set("Content-Disposition", `attachment; filename="${safeFilename}"`);
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch {
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
