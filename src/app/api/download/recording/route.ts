import { getAuthUser } from "@/lib/auth";
import { assertSafeRemoteUrl } from "@/lib/network-security";
import { NextRequest, NextResponse } from "next/server";

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const upstream = await fetch(safeUrl, {
      signal: controller.signal,
      redirect: "error",
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      return NextResponse.json({ error: "Failed to fetch file" }, { status: upstream.status });
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
