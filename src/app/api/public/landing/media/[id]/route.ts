import { getLandingMedia } from "@landing/server/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  return getLandingMedia(request, params);
}
