import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGeneratorPrompt, buildImprovePrompt } from "../src/lib/ai/prompts/generator";

describe("Generator Prompt with Premade Questions", () => {
  it("builds prompt without premade questions when omitted", () => {
    const messages = buildGeneratorPrompt("Senior Frontend Engineer");
    assert.equal(messages.length, 2);
    const systemPrompt = String(messages[0].content);
    assert.ok(!systemPrompt.includes("PREMADE STANDARDIZED QUESTIONS"));
  });

  it("injects premade questions with round names and complementary instructions", () => {
    const premadeQuestions = [
      {
        text: "Please introduce yourself and your background.",
        type: "OPEN_ENDED",
        sectionName: "Screening Round",
        description: "Assess verbal communication",
      },
      {
        text: "Explain your experience with micro-frontends.",
        type: "OPEN_ENDED",
        sectionName: "Technical Round",
      },
    ];

    const messages = buildGeneratorPrompt(
      "Senior Frontend Engineer",
      45,
      "en",
      "Must have React and TypeScript experience.",
      undefined,
      premadeQuestions,
    );

    assert.equal(messages.length, 2);
    const systemPrompt = String(messages[0].content);
    assert.ok(systemPrompt.includes("PREMADE STANDARDIZED QUESTIONS (MANDATORY)"));
    assert.ok(systemPrompt.includes("[Round: Screening Round]"));
    assert.ok(systemPrompt.includes("Please introduce yourself and your background."));
    assert.ok(systemPrompt.includes("[Round: Technical Round]"));
    assert.ok(systemPrompt.includes("Explain your experience with micro-frontends."));
    assert.ok(systemPrompt.includes("COMPLEMENTARY"));
    assert.ok(systemPrompt.includes("DO NOT duplicate"));
  });
});

describe("Improve / refine prompt", () => {
  it("makes user feedback mandatory and allows role pivots (e.g. HR)", () => {
    const messages = buildImprovePrompt(
      {
        title: "Senior Frontend Engineer",
        description: "Tech screen",
        objective: "Assess React skills",
        assessmentCriteria: [{ name: "React", description: "Component design" }],
        questions: [
          { text: "Explain React hooks.", type: "OPEN_ENDED" },
          { text: "Write a debounce function.", type: "CODING" },
        ],
      },
      "ask questions for HR — hiring process and management",
      "en",
      "Looking for an HR Business Partner.",
      "Candidate CV text",
    );

    assert.equal(messages.length, 2);
    const system = String(messages[0].content);
    const user = String(messages[1].content);
    assert.ok(system.includes("REFINEMENT PRIORITY"));
    assert.ok(system.includes("USER FEEDBACK"));
    assert.ok(system.includes("hiring process") || system.includes("HR"));
    assert.ok(system.includes("Do NOT keep coding"));
    assert.ok(user.includes("USER FEEDBACK (mandatory"));
    assert.ok(user.includes("ask questions for HR — hiring process and management"));
    assert.ok(user.includes("--- JOB DESCRIPTION ---"));
    assert.ok(user.includes("--- CANDIDATE RESUME ---"));
  });
});

describe("Generator Prompt intro rules", () => {
  it("asks the AI to add an intro when premade questions have none", () => {
    const messages = buildGeneratorPrompt("Backend Engineer", 30, "en");
    const systemPrompt = String(messages[0].content);
    assert.ok(systemPrompt.includes("INTRO QUESTION (MANDATORY"));
    assert.ok(systemPrompt.includes("Please introduce yourself and walk us through your most relevant work experience."));
    assert.ok(systemPrompt.includes("must not replace or count as one of the complementary"));
    assert.ok(systemPrompt.includes("Start with the intro question"));
  });

  it("keeps an existing premade intro and forbids a second one", () => {
    const messages = buildGeneratorPrompt(
      "Senior Frontend Engineer",
      45,
      "en",
      undefined,
      undefined,
      [{ text: "Please introduce yourself and your background.", type: "OPEN_ENDED", sectionName: "Screening Round" }],
    );
    const systemPrompt = String(messages[0].content);
    assert.ok(systemPrompt.includes("already includes an introduction"));
    assert.ok(!systemPrompt.includes("INTRO QUESTION (MANDATORY"));
    assert.ok(systemPrompt.includes("Do NOT add another intro"));
  });

  it("uses Hinglish suggested wording for Hindi interviews", () => {
    const messages = buildGeneratorPrompt("Backend Engineer", 30, "hi");
    const systemPrompt = String(messages[0].content);
    assert.ok(systemPrompt.includes("Please introduce yourself aur apne sabse relevant work experience ke baare mein briefly bataiye."));
  });
});

