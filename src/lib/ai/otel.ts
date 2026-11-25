/**
 * Registers the OpenTelemetry tracer that exports LLM spans to the self-hosted
 * Langfuse. Called once at server start (instrumentation.node.ts). Langfuse's
 * default filter only exports Langfuse / GenAI spans, so Next.js request spans
 * stay out of it.
 */
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { createLogger } from "@/lib/logger";
import { tracingEnabled } from "./tracing";

const log = createLogger("ai/otel");
const g = globalThis as unknown as { __langfuseProcessor?: LangfuseSpanProcessor };

export function startLangfuseTracing(): void {
  if (g.__langfuseProcessor || !tracingEnabled()) return;
  const processor = new LangfuseSpanProcessor({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL || "http://localhost:3030",
    environment: process.env.LANGFUSE_TRACING_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.IMAGE_TAG || undefined,
  });
  new NodeTracerProvider({ spanProcessors: [processor] }).register();
  g.__langfuseProcessor = processor;
  const flush = () => void processor.forceFlush().catch(() => {});
  process.once("SIGTERM", flush);
  process.once("beforeExit", flush);
  log.info(`Langfuse tracing on → ${process.env.LANGFUSE_BASE_URL || "http://localhost:3030"}`);
}
