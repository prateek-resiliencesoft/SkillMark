import { safeFetch } from "@/lib/network-security";

export const MAX_REMOTE_DOCUMENT_BYTES = 10 * 1024 * 1024;

export class RemoteDocumentError extends Error {
  constructor() {
    super("Could not fetch that URL");
    this.name = "RemoteDocumentError";
  }
}

export type RemoteDocument = { kind: "pdf"; buffer: Buffer } | { kind: "html"; html: string };

/**
 * Downloads a user-supplied page/PDF through the SSRF guard. Only public https hosts,
 * only HTML or PDF bodies, size-capped; every failure is the same generic error so the
 * endpoint can't be used to probe internal services.
 */
export async function fetchRemoteDocument(
  url: string,
  fetcher: typeof safeFetch = safeFetch,
): Promise<RemoteDocument> {
  let res: Response;
  try {
    res = await fetcher(url.trim(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ResilienceSoftInterviewBot/1.0; +https://resiliencesoftinterview.com)",
        Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9",
      },
      maxBytes: MAX_REMOTE_DOCUMENT_BYTES,
      timeoutMs: 15_000,
    });
  } catch {
    throw new RemoteDocumentError();
  }

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const isPdf = contentType.includes("application/pdf");
  const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
  if (!res.ok || (!isPdf && !isHtml)) {
    await res.body?.cancel().catch(() => {});
    throw new RemoteDocumentError();
  }

  try {
    return isPdf
      ? { kind: "pdf", buffer: Buffer.from(await res.arrayBuffer()) }
      : { kind: "html", html: await res.text() };
  } catch {
    throw new RemoteDocumentError();
  }
}
