import { checkRateLimit } from "@/lib/api-rate-limit";
import { getAuthUser } from "@/lib/auth";
import { canonicalMimeForDetected, normaliseDetected, sniffFileType } from "@/lib/forms/schema";
import { createLogger } from "@/lib/logger";
import { isStorageCapError } from "@/lib/storage-cap";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const log = createLogger("api/support");

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
/** Multipart overhead on top of the attachments plus the text fields. */
const MAX_BODY_BYTES = MAX_TOTAL_BYTES + 512 * 1024;
const MAX_MESSAGE_CHARS = 20_000;
const HOURLY_TICKETS = 10;
const HOUR_MS = 60 * 60_000;
const ATTACHMENT_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "log", "csv", "json", "mp4", "webm", "mov"]);

const ticketsByUser = new Map<string, number[]>();

function hourlyLimited(userId: string): boolean {
  const now = Date.now();
  if (ticketsByUser.size > 10_000) {
    ticketsByUser.forEach((arr, k) => {
      if (!arr.some((t) => now - t < HOUR_MS)) ticketsByUser.delete(k);
    });
  }
  const recent = (ticketsByUser.get(userId) ?? []).filter((t) => now - t < HOUR_MS);
  if (recent.length >= HOURLY_TICKETS) return true;
  recent.push(now);
  ticketsByUser.set(userId, recent);
  return false;
}

async function readBodyCapped(request: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get("content-length") || "0") > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

const str = (v: FormDataEntryValue | null, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = checkRateLimit(`support:${user.id}`, 3);
  if (limited) return limited;
  if (hourlyLimited(user.id)) {
    return NextResponse.json({ error: "Too many support requests. Please try again later." }, { status: 429 });
  }

  const raw = await readBodyCapped(request, MAX_BODY_BYTES);
  if (!raw) {
    return NextResponse.json({ error: "Attachments exceed 20 MB in total" }, { status: 413 });
  }
  let formData: FormData;
  try {
    formData = await new Response(raw, {
      headers: { "content-type": request.headers.get("content-type") || "" },
    }).formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const type = str(formData.get("type"), 50);
  const severity = str(formData.get("severity"), 50);
  const topic = str(formData.get("topic"), 200);
  const message = str(formData.get("message"), MAX_MESSAGE_CHARS);

  if (!message?.trim()) {
    return NextResponse.json(
      { error: "Message is required" },
      { status: 400 },
    );
  }

  const files = formData.getAll("attachments").filter((f): f is File => typeof f !== "string" && f.size > 0);
  if (files.length > MAX_ATTACHMENTS) {
    return NextResponse.json({ error: `At most ${MAX_ATTACHMENTS} attachments` }, { status: 400 });
  }
  const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
  if (tooBig) {
    return NextResponse.json({ error: `${tooBig.name.slice(0, 100)} exceeds 10 MB` }, { status: 413 });
  }

  const supabase = createClient();
  const storedAttachments: { name: string; path: string; size: number }[] = [];
  const removeStored = () =>
    storedAttachments.length
      ? supabase.storage.from("support-attachments").remove(storedAttachments.map((a) => a.path))
      : Promise.resolve();
  // One at a time: each upload passes the storage cap gate before the next starts.
  for (const file of files) {
    const rawExt = (file.name.split(".").pop() || "").toLowerCase();
    const ext = ATTACHMENT_EXTS.has(rawExt) ? rawExt : "bin";
    const storagePath = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = canonicalMimeForDetected(normaliseDetected(sniffFileType(buffer.subarray(0, 4096)), file.name));

    const { error: uploadError } = await supabase.storage
      .from("support-attachments")
      .upload(storagePath, buffer, { contentType, upsert: false });

    if (uploadError) {
      log.error("Failed to upload attachment:", uploadError);
      await removeStored();
      if (isStorageCapError(uploadError.message)) {
        return NextResponse.json({ error: uploadError.message }, { status: 507 });
      }
      return NextResponse.json({ error: "Failed to upload attachment" }, { status: 500 });
    }
    storedAttachments.push({ name: file.name.slice(0, 200), path: storagePath, size: file.size });
  }

  const { error } = await supabaseAdmin.from("support_tickets").insert({
    user_id: user.id,
    email: user.email,
    type,
    severity,
    topic,
    message,
    attachments: storedAttachments,
  });

  if (error) {
    log.error("Failed to create support ticket:", error);
    await removeStored();
    return NextResponse.json(
      { error: "Failed to submit support request" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
