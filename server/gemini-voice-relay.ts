/**
 * Voice relay using the Gemini Live API (native audio).
 *
 * Browser ←→ this relay ←→ Gemini Live (BidiGenerateContent WebSocket)
 *
 * Speaks the same browser protocol as server/openai-voice-relay.ts, so the
 * frontend needs no changes. Run with:  npm run dev:voice:gemini
 *
 * Shared constants/helpers/system prompt below are copied from
 * openai-voice-relay.ts (that file cannot be imported: it starts its own
 * server and exits without Azure keys).
 */

import { config } from "dotenv";
import { WebSocket, WebSocketServer } from "ws";
import { createLogger } from "../src/lib/logger";

const log = createLogger("gemini-relay");

config({ path: ".env" });

const RELAY_PORT =
  Number(process.env.GEMINI_VOICE_RELAY_PORT || process.env.OPENAI_VOICE_RELAY_PORT) || 8082;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview";
const GEMINI_VOICE = process.env.GEMINI_LIVE_VOICE || "Sulafat";
const GEMINI_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

if (!GEMINI_API_KEY) {
  log.error("Missing GEMINI_API_KEY in .env");
  process.exit(1);
}

// Minimum RMS energy for user audio to be forwarded. 16-bit PCM silence is 0;
// typical speech is 500-5000. A threshold of 200 filters ambient noise while
// still capturing soft speech.
const MIN_AUDIO_RMS = 160;
const CONTINUATION_AUDIO_RMS = 100;
const TTS_BARGE_IN_RMS = 2400;
const TTS_BARGE_IN_FRAME_COUNT = 3;

// Whisper commonly hallucinates these phrases on silence / low-energy audio.
const WHISPER_HALLUCINATIONS = new Set([
  "thank you.", "thank you", "thanks.", "thanks",
  "thank you for watching.", "thanks for watching.",
  "bye.", "bye", "goodbye.", "goodbye",
  "you", "the end.", "subscribe.",
  ".", "..", "...", " ",
]);

function isWhisperHallucination(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return trimmed.length === 0 || WHISPER_HALLUCINATIONS.has(trimmed);
}

function looksLikeFarewell(text: string, isZh: boolean): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (/[?？]/.test(normalized)) return false;

  const zhPatterns = [
    /再见/,
    /保重/,
    /一路顺利/,
    /祝你(?:一切顺利|顺利|好运)/,
    /感谢你今天的参与/,
    /祝你未来(?:的)?面试顺利/,
  ];
  const enPatterns = [
    /\bgood\s*bye\b/,
    /\bgoodbye\b/,
    /\bbye for now\b/,
    /\bthat'?s all for now\b/,
    /\ball for now\b/,
    /\btake care\b/,
    /\bbest of luck\b/,
    /\bwish you (?:the )?best\b/,
    /\bthank you (?:so much )?for your time\b/,
    /\bfuture interviews\b/,
  ];

  const patterns = isZh ? [...zhPatterns, ...enPatterns] : [...enPatterns, ...zhPatterns];
  return patterns.some((pattern) => pattern.test(normalized));
}

function mergeAsrText(previous: string, incoming: string): string {
  const prev = previous.trim();
  const next = incoming.trim();
  if (!next) return prev;
  if (!prev) return next;

  const prevLower = prev.toLowerCase();
  const nextLower = next.toLowerCase();

  if (nextLower.includes(prevLower)) return next;
  if (prevLower.includes(nextLower)) return prev;

  // Avoid regressing a long interim transcript into a tiny trailing fragment.
  if (next.length + 8 < prev.length) return prev;

  return next.length >= prev.length ? next : prev;
}

const FAST_NEXT_PATTERNS = [
  /^(?:下一个问题|下一题|跳过|next\s*question|skip)\.?$/i,
];

const FAST_PREV_PATTERNS = [
  /^(?:上一个问题|上一题|previous\s*question)\.?$/i,
];

const USER_SKIP_PATTERNS = [
  /(?:let'?s|please|can\s+(?:we|you))\s+(?:move\s+on|skip|proceed|go\s+to\s+(?:the\s+)?next)/i,
  /move\s+on(?:\s+to)?/i,
  /continue\s+to\s+(?:the\s+)?next/i,
  /go\s+(?:on\s+)?to\s+(?:the\s+)?next/i,
  /skip\s+(?:this|the)\s+(?:question|one|problem)/i,
  /I\s+(?:give\s+up|want\s+to\s+skip|'?d\s+like\s+to\s+skip)/i,
  /next\s+question/i,
  /please\s+(?:move\s+on|skip)/i,
  /(?:跳过|下一(?:个问题|题)|不做了|放弃了?|结束吧|请继续(?:下一|到下))/,
  /(?:我不会|不想做了|不想答了|过吧|换下一)/,
];

const USER_PREV_PATTERNS = [
  /(?:go|move|get)\s+back\s+(?:to\s+)?(?:the\s+)?(?:previous|last|prior)/i,
  /(?:return|go)\s+to\s+(?:the\s+)?(?:previous|last|prior)\s+(?:question|one|problem)/i,
  /(?:can|could)\s+(?:we|you|i)\s+(?:go|move|get)\s+back/i,
  /(?:let'?s|please|i\s+(?:want|need)\s+to)\s+(?:go|move|get)\s+back/i,
  /(?:revisit|re-visit)\s+(?:the\s+)?(?:previous|last|prior)/i,
  /previous\s+question/i,
  /(?:回到|返回|回去)(?:上一(?:个问题|题)|之前(?:的问题|那题))/,
  /(?:我(?:想|要|需要)|请|可以)(?:回到|返回|回去)上一/,
];

function isFastNextRequest(text: string): boolean {
  const trimmed = text.trim();
  return FAST_NEXT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isFastPrevRequest(text: string): boolean {
  const trimmed = text.trim();
  return FAST_PREV_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isUserSkipRequest(text: string): boolean {
  return USER_SKIP_PATTERNS.some((pattern) => pattern.test(text));
}

function isUserPrevRequest(text: string): boolean {
  return USER_PREV_PATTERNS.some((pattern) => pattern.test(text));
}

const CODING_DONE_PATTERNS = [
  /\bi(?:'m| am)\s+done\b/i,
  /\bi\s+finished\b/i,
  /\bit'?s\s+done\b/i,
  /\bthat'?s\s+done\b/i,
  /\bfinished\s+it\b/i,
  /\bdone\s+with\s+(?:it|this|the code|the problem)\b/i,
];

function isCodingDoneSignal(text: string): boolean {
  return CODING_DONE_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

// ── Interview context type ───────────────────────────────────────────

interface InterviewContext {
  title: string;
  objective?: string | null;
  aiName: string;
  aiTone: string;
  language: string;
  followUpDepth: string;
  startQuestionIndex?: number;
  questions: Array<{
    text: string;
    type: string;
    description?: string | null;
    options?: { options: string[]; allowMultiple?: boolean } | null;
    starterCode?: { language: string; code: string } | null;
    order: number;
  }>;
}

// ── Helpers ──────────────────────────────────────────────────────────

function isChineseInterview(ctx: InterviewContext): boolean {
  return ctx.language === "zh" || ctx.language.toLowerCase().includes("chinese");
}

/**
 * Resample 16kHz int16 PCM → 24kHz int16 PCM using linear interpolation.
 * OpenAI Realtime API only accepts 24kHz; browser captures at 16kHz.
 */
function resample16to24(input: Buffer): Buffer {
  const inputSamples = input.length / 2;
  const outputSamples = Math.floor((inputSamples * 3) / 2);
  const out = Buffer.alloc(outputSamples * 2);
  const ratio = inputSamples / outputSamples;

  for (let o = 0; o < outputSamples; o++) {
    const srcIdx = o * ratio;
    const idx0 = Math.floor(srcIdx);
    const idx1 = Math.min(idx0 + 1, inputSamples - 1);
    const frac = srcIdx - idx0;
    const s0 = input.readInt16LE(idx0 * 2);
    const s1 = input.readInt16LE(idx1 * 2);
    const sample = Math.round(s0 + (s1 - s0) * frac);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), o * 2);
  }
  return out;
}

/** Convert int16 LE PCM → float32 LE PCM (browser expects float32 at 24kHz) */
function int16ToFloat32(buf: Buffer): Buffer {
  const samples = buf.length / 2;
  const out = Buffer.alloc(samples * 4);
  for (let i = 0; i < samples; i++) {
    out.writeFloatLE(buf.readInt16LE(i * 2) / 32768, i * 4);
  }
  return out;
}

// ── System prompt builder ───────────────────────────────────────────

function buildSystemPrompt(ctx: InterviewContext, startIdx: number): string {
  const isZh = isChineseInterview(ctx);
  const sorted = ctx.questions.sort((a, b) => a.order - b.order);

  let maxFollowUps: number;
  switch (ctx.followUpDepth) {
    case "LIGHT":    maxFollowUps = 1; break;
    case "MODERATE": maxFollowUps = 3; break;
    case "DEEP":     maxFollowUps = 5; break;
    default:         maxFollowUps = 2;
  }

  const questionList = sorted.map((q, i) => {
    let entry = `  ${i + 1}. [${q.type}] ${q.text}`;
    if (q.description) entry += `\n     Context: ${q.description}`;
    if (q.options?.options?.length) {
      const labels = q.options.options.map((o, j) => `${String.fromCharCode(65 + j)}) ${o}`).join(", ");
      const multi = q.options.allowMultiple ? " (multiple choice)" : " (single choice)";
      entry += `\n     Options${multi}: ${labels}`;
    }
    if (q.type === "CODING") entry += `\n     Note: The participant has a code editor. You cannot see their code unless they describe it.`;
    if (q.type === "WHITEBOARD") entry += `\n     Note: The participant has a whiteboard. You will receive image updates silently — do NOT speak when you receive them. Only describe what you see when the participant asks you to look at it.`;
    return entry;
  }).join("\n");

  const currentQ = startIdx + 1;

  if (isZh) {
    return `你是"${ctx.aiName}"，一位${ctx.aiTone}的AI面试官。

## 面试信息
- 主题: "${ctx.title}"
${ctx.objective ? `- 目标: ${ctx.objective}` : ""}
- 问题数量: ${sorted.length}
- 当前问题: 第${currentQ}个
- 每题追问深度: 最多${maxFollowUps}次追问

## 问题列表
${questionList}

## 你的行为准则
1. 从第${currentQ}个问题开始。先用温暖友好的方式自我介绍（提到你的名字、面试主题和问题数量）。然后说一句过渡语，比如"我们开始吧，这是第一个问题。"之后再提出问题。问候、过渡语和问题必须是三个独立的句子，不要合并。
2. 对每个问题，根据受访者的回答进行${maxFollowUps}次以内的追问。语气要像友好、耐心的真人面试官，而不是冷冰冰地连珠发问。
3. 当一个问题讨论充分后，调用 signal_question_change 函数来进入下一个问题。"讨论充分"是指受访者给出了详细、具体的回答——不是模糊的表述如"我遇到过很多挑战"。如果回答模糊，应追问以获取更多细节。
4. 切换后，自然地过渡到新问题。通常先用一句简短的认可或感谢来承接上一段回答，再进入下一题，而不是直接生硬地抛出问题。
5. 所有问题结束后，调用 signal_question_change 并设 questionIndex 为 ${sorted.length}（超出范围），然后做简短总结告别。
6. 保持对话自然流畅，回复简洁（1-3句话）。语速要平缓，略慢于日常对话，让受访者能轻松跟上。可以使用简短友好的衔接语，比如"谢谢你的分享"、"我明白了"、"这很有帮助"。
7. 如果受访者要求"跳过"或"下一题"，简短回应后立即调用 signal_question_change 并设 userRequested=true。
8. 如果受访者要求"上一题"，调用 signal_question_change 并设 questionIndex 为上一题的索引，设 userRequested=true。

## 选择题的特殊规则
当提问单选题或多选题时，你必须把所有选项（A、B、C等）逐一朗读出来作为问题的一部分。受访者只能听到你说话——如果你不说出选项，他们就无法知道有哪些选择。列出选项后，请受访者选择并解释理由。对于多选题，提醒他们可以选择多个选项。

## 编程题/白板题的特殊规则
当进入编程题或白板题时：
- 不要朗读完整的题目内容！题目详情已经显示在受访者的屏幕上。只需简短说明这是编程题/白板题，请他们查看屏幕上的题目并使用编辑器/白板。
- 回复要保持简短，让受访者专注于思考和编码/绘画。
- 受访者的发言分为以下几类，请对应回复：
  1. 向你提问或对话 → 正常回应
  2. 说"完成了"/"做好了" → 请他们解释思路、复杂度和可能的优化
  3. 自言自语或思考中 → 只用非常简短的鼓励（如"好的，继续"）
  4. 明确要跳过/放弃 → 简短鼓励后调用 signal_question_change
  5. 讨论已自然结束 → 简短感谢后调用 signal_question_change

## 语言要求
- 你必须始终用中文进行面试。你必须用中文回答。不要使用其他语言。

## 代码和白板可见性
- 你可以看到受访者的代码和白板内容！系统会通过 [CODE_UPDATE] 和 [WHITEBOARD_UPDATE] 消息将受访者编辑器中的代码和白板图片实时发送给你。
- 当受访者问你"能看到我的代码吗"或"看一下我写的"时，回答"是"并参考你收到的最新代码/白板内容。
- 不要在收到更新时主动开口——只在受访者和你说话时才提及。

## 重要规则
- 必须通过 signal_question_change 函数来切换问题。不要只口头说"让我们进入下一题"而不调用函数。
- 如果受访者只是简单打招呼、确认性问题或模糊回答（如"你好"、"能听到吗?"、"我遇到过很多挑战"），先友好回应，再继续当前问题；不要调用 signal_question_change。这些不是实质性回答。必须等受访者给出详细、具体的回答后再切换。如果回答太简短或模糊，应追问以获取更多信息。
- 始终关注当前问题，不要跳到其他话题。
- 对于选择题，确保受访者给出选择并解释理由。
- 当受访者让你看白板时，描述你看到的内容并给出反馈。不要在收到图片更新时自动开口说话。`;
  }

  return `You are "${ctx.aiName}", a ${ctx.aiTone} AI interviewer.

## Interview Details
- Topic: "${ctx.title}"
${ctx.objective ? `- Objective: ${ctx.objective}` : ""}
- Total questions: ${sorted.length}
- Starting at: Question ${currentQ}
- Follow-up depth: Up to ${maxFollowUps} follow-ups per question

## Questions
${questionList}

## Your Behavior
1. Start at question ${currentQ}. First, give a warm greeting — introduce yourself by name, mention the topic "${ctx.title}" and that there are ${sorted.length} questions. Then say a transition phrase like "Let's get started. Here is the first question." ONLY AFTER that, ask the question. The greeting, the transition phrase, and the question MUST be three separate sentences — NEVER combine them into one.
2. For each question, follow up based on the participant's answers (up to ${maxFollowUps} follow-ups). Sound like a warm, patient human interviewer, not a rapid-fire questionnaire.
3. When a question is sufficiently discussed, call the signal_question_change function to move forward. "Sufficiently discussed" means the participant has given a detailed, specific answer — NOT a vague statement like "I had many challenges" or "that's a good question." If their answer is vague, ask them to elaborate before moving on.
4. After transitioning, naturally introduce the next question. Usually start with a short acknowledgement or appreciation of the participant's last answer before asking the next question.
5. After all questions are done, call signal_question_change with questionIndex=${sorted.length} (out of bounds), then give a brief wrap-up and farewell.
6. Keep responses concise (1-3 sentences) and conversational. Speak at a calm, unhurried pace — slightly slower than normal conversation speed so the participant can follow easily. Use brief friendly bridges like "Thanks for sharing that", "I appreciate the context", or "That makes sense" when appropriate.
7. If the participant asks to "skip" or "next question", briefly acknowledge and immediately call signal_question_change with userRequested=true.
8. If the participant asks for "previous question", call signal_question_change with the previous question's index and userRequested=true.

## Special Rules for Choice Questions
When asking a SINGLE_CHOICE or MULTIPLE_CHOICE question, you MUST read out ALL the answer options (A, B, C, etc.) as part of asking the question. The participant can only hear you — they cannot see the options unless you say them. After listing the options, ask the participant to choose and explain their reasoning. For multiple-choice questions, remind them they can select more than one option.

## Special Rules for Coding / Whiteboard Questions
When transitioning to a CODING or WHITEBOARD question:
- Do NOT read out the full question text! The question details are already displayed on the participant's screen. Just briefly say it's a coding/whiteboard question and ask them to read the problem on their screen and use the code editor/whiteboard.
- Keep your responses short — let the participant focus on thinking and coding/drawing.
- Categorize the participant's speech and respond accordingly:
  1. Talking TO YOU (asking questions, discussing approach) → Respond naturally
  2. Saying they're DONE ("I'm done", "finished") → Ask about their approach, time/space complexity, and possible improvements
  3. Thinking ALOUD (self-talk, "hmm", reading code) → Brief encouragement only (e.g. "Take your time")
  4. Wanting to SKIP ("I can't do this", "skip", "next question") → Brief encouragement, then call signal_question_change
  5. Discussion naturally CONCLUDED → Brief acknowledgement, then call signal_question_change

## Language Requirements
- YOU MUST ALWAYS RESPOND IN ENGLISH. You must conduct this interview entirely in English. Do not switch to any other language under any circumstance.

## Code and Whiteboard Visibility
- You CAN see the participant's code and whiteboard! The system sends you real-time updates via [CODE_UPDATE] and [WHITEBOARD_UPDATE] messages containing their editor code and whiteboard images.
- When the participant asks "can you see my code?" or "look at what I wrote", answer YES and reference the latest code/whiteboard content you received.
- Do NOT proactively speak when you receive an update — only reference the content when the participant addresses you.

## Important Rules
- You MUST use the signal_question_change function to transition between questions. NEVER verbally say "let's move on" without also calling the function — the UI only updates when the function is called.
- Do NOT call signal_question_change if the participant has only said a brief greeting, clarifying remark, or vague statement (e.g. "hi", "can you hear me?", "I had many challenges"). First respond warmly and helpfully, then continue the current question. These are NOT substantive answers. You MUST wait for a detailed, specific response that actually addresses the question before moving on. If their answer is too brief or vague, probe deeper.
- Stay focused on the current question. Do not jump to unrelated topics.
- For choice questions, ensure the participant both selects an option AND explains their reasoning.
- When the participant asks you to look at the whiteboard, describe what you see and give feedback. Do NOT automatically start speaking when you receive a whiteboard image update — wait for the participant to address you.`;
}

// ── OpenAI tool definitions ─────────────────────────────────────────

const OPENAI_TOOLS = [{
  type: "function" as const,
  name: "signal_question_change",
  description: "Signal that the interview should move to a different question. Call this ONLY when the current question has been substantively discussed (the participant gave a real, detailed answer — NOT a vague statement like 'I had many challenges'), or when the participant explicitly asks to skip/go back. Do NOT call this after a brief greeting or clarification like 'can you hear me'. After calling, naturally introduce the next question in your spoken response.",
  parameters: {
    type: "object",
    properties: {
      questionIndex: {
        type: "integer",
        description: "Zero-based index of the question to move to. Use current+1 for next, current-1 for previous, or total_questions to signal interview end.",
      },
      userRequested: {
        type: "boolean",
        description: "Set to true ONLY if the participant explicitly asked to skip, go to next/previous question, or go back. Set to false (or omit) when you are transitioning because the discussion is complete.",
      },
    },
    required: ["questionIndex"],
  },
}];

// ── Gemini Live helpers ─────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
type GeminiMsg = Record<string, any>;

const GEMINI_TOOLS = [{
  functionDeclarations: OPENAI_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  })),
}];

function languageCode(ctx: InterviewContext | null, lang?: string): string {
  const l = (ctx?.language || lang || "en").toLowerCase();
  if (l === "zh" || l.includes("chinese")) return "cmn-CN";
  if (l === "hi" || l.includes("hindi")) return "hi-IN";
  return "en-US";
}

function pcmRms(buf: Buffer): number {
  const n = Math.floor(buf.length / 2);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) { const s = buf.readInt16LE(i * 2); sum += s * s; }
  return Math.sqrt(sum / n);
}

interface GeminiConnectOpts {
  systemInstruction?: string;
  tools?: boolean;
  langCode: string;
  resumeHandle?: string | null;
}

function connectGemini(opts: GeminiConnectOpts): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${GEMINI_WS_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("Gemini setup timeout")); }, 15_000);
    ws.once("open", () => {
      const setup: GeminiMsg = {
        model: `models/${GEMINI_LIVE_MODEL}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            languageCode: opts.langCode,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } },
          },
          thinkingConfig: { thinkingLevel: "MINIMAL" },
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
            prefixPaddingMs: 200,
            silenceDurationMs: 700,
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption: opts.resumeHandle ? { handle: opts.resumeHandle } : {},
        contextWindowCompression: { slidingWindow: {} },
      };
      if (opts.systemInstruction) setup.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
      if (opts.tools) setup.tools = GEMINI_TOOLS;
      ws.send(JSON.stringify({ setup }));
    });
    const onMsg = (data: Buffer) => {
      try {
        const m = JSON.parse(data.toString());
        if (m.setupComplete !== undefined) {
          clearTimeout(timer);
          ws.removeListener("message", onMsg);
          resolve(ws);
        }
      } catch { /* ignore */ }
    };
    ws.on("message", onMsg);
    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      reject(new Error(`Gemini closed during setup: ${code} ${reason.toString()}`));
    });
    ws.once("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

// ── Relay server ────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: RELAY_PORT });
log.info(`Gemini voice relay listening on ws://localhost:${RELAY_PORT}`);
log.info(`Model: ${GEMINI_LIVE_MODEL}, Voice: ${GEMINI_VOICE}`);

wss.on("connection", (browserWs) => {
  log.info("Browser connected, waiting for init...");
  const timeout = setTimeout(() => {
    log.error("No init message received within 10s");
    browserWs.close();
  }, 10_000);
  const handler = (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "mic_test") {
        clearTimeout(timeout);
        browserWs.removeListener("message", handler);
        void handleMicTest(browserWs, msg.language);
      } else if (msg.type === "init" && msg.context) {
        clearTimeout(timeout);
        browserWs.removeListener("message", handler);
        void handleInterview(browserWs, msg.context as InterviewContext);
      }
    } catch { /* not JSON */ }
  };
  browserWs.on("message", handler);
});

// ── Mic test: transcription only ────────────────────────────────────

async function handleMicTest(browserWs: WebSocket, language?: string) {
  log.info("Mic test mode (Gemini)");
  const send = (m: Record<string, unknown>) => {
    if (browserWs.readyState === WebSocket.OPEN) browserWs.send(JSON.stringify(m));
  };
  let gem: WebSocket;
  try {
    gem = await connectGemini({
      langCode: languageCode(null, language),
      systemInstruction: "This is a microphone test. Do not speak. Reply with silence.",
    });
  } catch (err) {
    send({ type: "error", message: `Mic test failed: ${err instanceof Error ? err.message : err}` });
    browserWs.close();
    return;
  }
  let heard = "";
  gem.on("message", (data: Buffer) => {
    let m: GeminiMsg;
    try { m = JSON.parse(data.toString()); } catch { return; }
    const sc = m.serverContent;
    if (sc?.inputTranscription?.text) {
      heard += sc.inputTranscription.text;
      send({ type: "asr", data: { results: [{ text: heard.trim() }] } });
    }
    if ((sc?.turnComplete || sc?.generationComplete) && heard.trim()) {
      send({ type: "asr_ended", text: heard.trim() });
    }
  });
  gem.on("close", () => send({ type: "disconnected" }));
  send({ type: "ready" });
  browserWs.on("message", (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "ping") { send({ type: "pong" }); return; }
      if (msg.type !== "audio" || !msg.data || gem.readyState !== WebSocket.OPEN) return;
      const pcm = Buffer.from(msg.data, "hex");
      gem.send(JSON.stringify({ realtimeInput: { audio: { data: pcm.toString("base64"), mimeType: "audio/pcm;rate=16000" } } }));
    } catch { /* ignore */ }
  });
  browserWs.on("close", () => gem.close());
}

// ── Interview ───────────────────────────────────────────────────────

async function handleInterview(browserWs: WebSocket, ctx: InterviewContext) {
  const sortedQuestions = ctx.questions.sort((a, b) => a.order - b.order);
  const isZh = isChineseInterview(ctx);
  const langCode = languageCode(ctx);
  let currentQuestionIndex = ctx.startQuestionIndex ?? 0;
  let questionEnteredAt = Date.now();
  const MIN_QUESTION_DWELL_MS = 15_000;

  let gem: WebSocket | null = null;
  let resumeHandle: string | null = null;
  let reconnecting = false;
  let browserClosed = false;
  let intentionalClose = false;

  let userBuf = "";            // current user utterance (input transcription)
  let modelBuf = "";           // full model text for this turn
  let modelPending = "";       // text not yet sent as tts_text
  let modelAudioBytes = 0;
  let playbackEndsAt = 0;      // estimated time the browser finishes playing
  let lastUserSpeech = 0;
  let userSpokeThisQuestion = false;
  let interviewDone = false;
  let pendingComplete = false;
  let completeTimer: ReturnType<typeof setTimeout> | null = null;
  const history: Array<{ role: "user" | "assistant"; text: string }> = [];

  const send = (m: Record<string, unknown>) => {
    if (browserWs.readyState === WebSocket.OPEN) browserWs.send(JSON.stringify(m));
  };
  const sendBinary = (b: Buffer) => {
    if (browserWs.readyState === WebSocket.OPEN) browserWs.send(b, { binary: true });
  };
  const gemSend = (m: GeminiMsg) => {
    if (gem && gem.readyState === WebSocket.OPEN) gem.send(JSON.stringify(m));
  };
  const sayText = (text: string) => gemSend({ realtimeInput: { text } });
  const addContext = (text: string) =>
    gemSend({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: false } });

  function pushHistory(role: "user" | "assistant", text: string) {
    if (!text.trim()) return;
    history.push({ role, text: text.trim() });
    while (history.length > 40) history.shift();
  }

  function flushUser() {
    const t = userBuf.trim();
    userBuf = "";
    if (!t) return;
    send({ type: "asr_ended", text: t });
    pushHistory("user", t);
    userSpokeThisQuestion = true;
    log.info(`User: ${JSON.stringify(t)}`);
    if (!interviewDone) tryUserNavigation(t);
  }

  function flushModelText(force: boolean) {
    // Send transcript in sentence-sized pieces (the browser joins pieces with spaces).
    const re = /^[\s\S]*?[.!?。！？]+(\s|$)/;
    let m: RegExpMatchArray | null;
    while ((m = modelPending.match(re))) {
      const piece = m[0].trim();
      if (piece) send({ type: "tts_text", data: { text: piece } });
      modelPending = modelPending.slice(m[0].length);
    }
    if (force && modelPending.trim()) {
      send({ type: "tts_text", data: { text: modelPending.trim() } });
      modelPending = "";
    }
  }

  function endModelTurn() {
    flushModelText(true);
    const text = modelBuf.trim();
    if (text || modelAudioBytes > 0) {
      if (text) { pushHistory("assistant", text); log.info(`AI: ${JSON.stringify(text)}`); }
      send({ type: "tts_ended" });
    }
    modelBuf = "";
    modelAudioBytes = 0;
    if (!pendingComplete && !interviewDone && currentQuestionIndex >= sortedQuestions.length - 1
        && text && looksLikeFarewell(text, isZh) && userSpokeThisQuestion) {
      interviewDone = true;
      pendingComplete = true;
    }
    if (pendingComplete) {
      const wait = Math.max(0, playbackEndsAt - Date.now()) + 500;
      setTimeout(() => markComplete("farewell finished"), wait);
    }
  }

  function markComplete(reason: string) {
    if (!pendingComplete) return;
    pendingComplete = false;
    if (completeTimer) { clearTimeout(completeTimer); completeTimer = null; }
    send({ type: "interview_complete" });
    log.info(`Interview complete (${reason})`);
  }

  function beginEnding() {
    if (interviewDone) return;
    interviewDone = true;
    pendingComplete = true;
    completeTimer = setTimeout(() => markComplete("timeout fallback"), 20_000);
  }

  function moveTo(idx: number, auto: boolean) {
    const dir = idx > currentQuestionIndex ? "next" : "previous";
    send({ type: "transitioning", direction: dir, ...(auto ? { auto: true } : {}) });
    currentQuestionIndex = idx;
    questionEnteredAt = Date.now();
    userSpokeThisQuestion = false;
    send({
      type: "question_change",
      questionIndex: currentQuestionIndex,
      totalQuestions: sortedQuestions.length,
      ...(auto ? { auto: true } : {}),
    });
    log.info(`→ Q${currentQuestionIndex + 1}/${sortedQuestions.length}`);
  }

  function requestTransition(targetIdx: number, label: string, reason: "button" | "user_request") {
    if (targetIdx === currentQuestionIndex) return;
    // Stop current speech in the browser
    send({ type: "interrupt" });
    playbackEndsAt = 0;
    if (targetIdx >= sortedQuestions.length) {
      beginEnding();
      sayText(`[SYSTEM] The participant ${reason === "button" ? `clicked "${label}"` : "asked to finish"}. All questions are done. Give a brief thank-you and farewell now. Do not call any function.`);
      return;
    }
    moveTo(targetIdx, false);
    const q = sortedQuestions[currentQuestionIndex];
    sayText(reason === "user_request"
      ? `[SYSTEM] The participant explicitly asked to go ${label.toLowerCase()}. We are now on question ${currentQuestionIndex + 1}: "${q?.text}". Briefly acknowledge and introduce this question now. Do not call signal_question_change.`
      : `[SYSTEM] The participant clicked "${label}". We are now on question ${currentQuestionIndex + 1}: "${q?.text}". Briefly introduce this question now. Do not call signal_question_change.`);
  }

  function tryUserNavigation(text: string) {
    if (isFastPrevRequest(text) || isUserPrevRequest(text)) {
      if (currentQuestionIndex > 0) requestTransition(currentQuestionIndex - 1, "Previous Question", "user_request");
    } else if (isFastNextRequest(text) || isUserSkipRequest(text)) {
      requestTransition(Math.min(currentQuestionIndex + 1, sortedQuestions.length), "Next Question", "user_request");
    }
  }

  function handleToolCall(calls: Array<{ id: string; name: string; args?: Record<string, unknown> }>) {
    const responses: GeminiMsg[] = [];
    for (const c of calls) {
      let result: string;
      if (c.name !== "signal_question_change") {
        result = "Unknown function.";
      } else {
        const args = (c.args || {}) as { questionIndex?: number; userRequested?: boolean };
        const newIdx = typeof args.questionIndex === "number" ? args.questionIndex : currentQuestionIndex + 1;
        const userRequested = args.userRequested === true;
        const dwell = Date.now() - questionEnteredAt;
        log.info(`Gemini called signal_question_change → Q${newIdx + 1}${userRequested ? " (user requested)" : ""}`);
        if (newIdx === currentQuestionIndex) {
          result = `You are already on question ${newIdx + 1}. Continue naturally.`;
        } else if (newIdx < sortedQuestions.length && newIdx > currentQuestionIndex && !userRequested
                   && (!userSpokeThisQuestion || dwell < MIN_QUESTION_DWELL_MS)) {
          result = `Rejected: the participant has not given a substantive answer yet. Keep discussing question ${currentQuestionIndex + 1}. Do NOT say you are moving on.`;
          log.warn("Rejected premature question change");
        } else if (newIdx >= sortedQuestions.length) {
          beginEnding();
          result = "Interview is now complete. Please give a brief farewell.";
        } else if (newIdx >= 0) {
          moveTo(newIdx, true);
          result = `Moved to question ${newIdx + 1}: "${sortedQuestions[newIdx]?.text}". Naturally transition and ask this question.`;
        } else {
          result = "Invalid question index.";
        }
      }
      responses.push({ id: c.id, name: c.name, response: { result } });
    }
    gemSend({ toolResponse: { functionResponses: responses } });
  }

  function onGeminiMessage(data: Buffer) {
    let m: GeminiMsg;
    try { m = JSON.parse(data.toString()); } catch { return; }

    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) {
      resumeHandle = m.sessionResumptionUpdate.newHandle;
    }
    if (m.goAway) {
      log.warn(`Gemini goAway (timeLeft=${m.goAway.timeLeft}) — reconnecting with resumption handle`);
      void reconnect("goAway");
      return;
    }
    if (m.toolCall?.functionCalls) {
      handleToolCall(m.toolCall.functionCalls);
    }
    const sc = m.serverContent;
    if (!sc) return;

    if (sc.inputTranscription?.text) {
      userBuf += sc.inputTranscription.text;
      lastUserSpeech = Date.now();
      send({ type: "asr", data: { results: [{ text: userBuf.trim() }] } });
    }
    if (sc.interrupted) {
      log.info("Gemini: interrupted (barge-in)");
      send({ type: "interrupt" });
      playbackEndsAt = 0;
      flushModelText(true);
      if (modelBuf.trim()) pushHistory("assistant", modelBuf.trim());
      if (modelBuf.trim() || modelAudioBytes) send({ type: "tts_ended" });
      modelBuf = ""; modelAudioBytes = 0;
    }
    const parts = sc.modelTurn?.parts as Array<GeminiMsg> | undefined;
    if (parts) {
      for (const p of parts) {
        const inline = p.inlineData;
        if (inline?.data && String(inline.mimeType || "").startsWith("audio/")) {
          if (userBuf.trim()) flushUser();
          const int16 = Buffer.from(inline.data, "base64");
          const rate = Number(/rate=(\d+)/.exec(inline.mimeType)?.[1] || 24000);
          modelAudioBytes += int16.length;
          const now = Date.now();
          playbackEndsAt = Math.max(playbackEndsAt, now) + (int16.length / 2 / rate) * 1000;
          sendBinary(int16ToFloat32(int16));
        }
      }
    }
    if (sc.outputTranscription?.text) {
      if (userBuf.trim()) flushUser();
      modelBuf += sc.outputTranscription.text;
      modelPending += sc.outputTranscription.text;
      if (modelAudioBytes > 0) flushModelText(false);
    }
    if (sc.generationComplete || sc.turnComplete) {
      if (modelBuf.trim() || modelAudioBytes > 0) endModelTurn();
      else if (sc.turnComplete && userBuf.trim()) flushUser();
    }
  }

  function attach(ws: WebSocket) {
    ws.on("message", onGeminiMessage);
    ws.on("close", (code, reason) => {
      if (ws !== gem) return;
      log.warn(`Gemini session closed: ${code} ${reason.toString()}`);
      if (!intentionalClose && !browserClosed) void reconnect(`close ${code}`);
    });
    ws.on("error", (err) => log.error("Gemini WS error:", err.message));
  }

  async function reconnect(why: string) {
    if (reconnecting || browserClosed) return;
    reconnecting = true;
    const old = gem;
    send({ type: "session_reconnecting" });
    flushModelText(true);
    if (modelBuf.trim()) pushHistory("assistant", modelBuf.trim());
    modelBuf = ""; modelAudioBytes = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const handle = attempt === 1 ? resumeHandle : null;
        const ws = await connectGemini({
          langCode, tools: true, resumeHandle: handle,
          systemInstruction: buildSystemPrompt(ctx, currentQuestionIndex),
        });
        gem = ws;
        try { old?.removeAllListeners("close"); old?.close(); } catch { /* ignore */ }
        attach(ws);
        if (!handle) {
          const recap = history.slice(-12).map((h) => `${h.role === "user" ? "Participant" : "You"}: ${h.text}`).join("\n");
          addContext(`[SYSTEM] The connection was restored. Conversation so far:\n${recap}`);
          sayText(`[SYSTEM] Connection restored. We are on question ${currentQuestionIndex + 1}: "${sortedQuestions[currentQuestionIndex]?.text}". Briefly continue the interview from where it left off.`);
        }
        log.info(`Gemini session reconnected (${why}, ${handle ? "resumed" : "fresh"})`);
        send({ type: "session_reconnected" });
        reconnecting = false;
        return;
      } catch (err) {
        log.warn(`Reconnect attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    reconnecting = false;
    send({ type: "disconnected" });
  }

  // ── Initial connection ──
  try {
    gem = await connectGemini({ langCode, tools: true, systemInstruction: buildSystemPrompt(ctx, currentQuestionIndex) });
    attach(gem);
    log.info("Gemini session established");
    send({ type: "ready", sessionId: "gemini-session" });
    send({ type: "question_change", questionIndex: currentQuestionIndex, totalQuestions: sortedQuestions.length });
    await new Promise((r) => setTimeout(r, 1_500));
    sayText(currentQuestionIndex > 0
      ? `[SYSTEM] The participant is returning to the interview. Continue from question ${currentQuestionIndex + 1}.`
      : "[SYSTEM] The participant has just joined. Please greet them and begin with question 1.");
  } catch (err) {
    log.error("Failed to connect to Gemini:", err);
    send({ type: "error", message: `Gemini connection failed: ${err instanceof Error ? err.message : err}` });
    browserWs.close();
    return;
  }

  // ── Browser → Gemini ──
  browserWs.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) return;
    let msg: GeminiMsg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    try {
      if (msg.type === "ping") { send({ type: "pong" }); return; }
      if (msg.type === "next_question") {
        requestTransition(Math.min(currentQuestionIndex + 1, sortedQuestions.length), "Next Question", "button");
        return;
      }
      if (msg.type === "prev_question") {
        if (currentQuestionIndex > 0) requestTransition(currentQuestionIndex - 1, "Previous Question", "button");
        return;
      }
      if (reconnecting) return;
      if (msg.type === "audio" && msg.data) {
        const pcm = Buffer.from(msg.data as string, "hex");
        // Echo guard: while the browser is still playing our audio, only pass
        // loud speech through (barge-in). Gemini's own VAD handles the rest.
        const speaking = Date.now() < playbackEndsAt + 300;
        if (speaking && pcmRms(pcm) < TTS_BARGE_IN_RMS) {
          return;
        }
        gemSend({ realtimeInput: { audio: { data: pcm.toString("base64"), mimeType: "audio/pcm;rate=16000" } } });
      } else if (msg.type === "text_input" && msg.content) {
        const text = String(msg.content).trim();
        if (!text) return;
        pushHistory("user", text);
        userSpokeThisQuestion = true;
        lastUserSpeech = Date.now();
        send({ type: "interrupt" });
        playbackEndsAt = 0;
        tryUserNavigation(text);
        sayText(text);
      } else if (msg.type === "text" && msg.content) {
        sayText(`[SYSTEM] Please say the following aloud: ${msg.content}`);
      } else if (msg.type === "code_update" && msg.content) {
        const language = (msg.language as string) || "plaintext";
        addContext(`[CODE_UPDATE] The participant's current code (${language}):\n\`\`\`${language}\n${msg.content}\n\`\`\`\n(Do not respond to this update.)`);
      } else if (msg.type === "whiteboard_update" && msg.imageDataUrl) {
        const m = /^data:(image\/[a-z]+);base64,([\s\S]*)$/.exec(String(msg.imageDataUrl));
        if (m) {
          gemSend({ realtimeInput: { video: { data: m[2], mimeType: m[1] } } });
          log.info("Whiteboard image sent to Gemini");
        }
      }
    } catch (err) {
      log.error("Error handling browser message:", err);
    }
  });

  browserWs.on("close", () => {
    log.info("Browser disconnected");
    browserClosed = true;
    intentionalClose = true;
    if (completeTimer) clearTimeout(completeTimer);
    gem?.close();
  });
  browserWs.on("error", (err) => log.error("Browser WS error:", err.message));
  void lastUserSpeech;
}
