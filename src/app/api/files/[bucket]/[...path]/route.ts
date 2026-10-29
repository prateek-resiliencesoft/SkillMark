import { NextResponse } from "next/server";
import { readFile, verifyFileToken } from "@/lib/storage";

/** Serves files from local storage. Requires a signed ?token= (created by storage.createSignedUrl). */
export async function GET(req: Request, { params }: { params: { bucket: string; path: string[] } }) {
  const p = params.path.map(decodeURIComponent).join("/");
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!(await verifyFileToken(token, params.bucket, p))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { data, contentType } = await readFile(params.bucket, p);
    return new NextResponse(new Uint8Array(data), {
      headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
