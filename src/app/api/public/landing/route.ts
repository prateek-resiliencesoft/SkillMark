import {
  getPublishedLanding,
  landingOptions,
} from "@landing/server/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return landingOptions();
}

export async function GET(request: Request) {
  return getPublishedLanding(request);
}
