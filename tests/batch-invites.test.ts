import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalisePhone, profileToResumeText, validateProfile } from "@/lib/documents/cv-profile";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/messaging/secrets";
import {
  DEFAULT_TEMPLATES,
  emailHtml,
  formatScheduleNotice,
  renderTemplate,
  renderWhatsappPreview,
  whatsappBodyVariables,
  type TemplateVars,
} from "@/lib/messaging/templates";

const CV = `# Priya Sharma
Senior Frontend Engineer · priya.sharma@example.com · +91 98765 43210
Skills: React, TypeScript, Node.js
## Experience
Acme Corp — Frontend Engineer (2019 – Present)`;

describe("validateProfile", () => {
  it("keeps values that appear in the CV and normalises the phone", () => {
    const { profile, reviewFlags } = validateProfile(
      { name: "Priya Sharma", email: "Priya.Sharma@example.com", phone: "+91 98765 43210", techStack: ["React", "react", "TypeScript"] },
      CV,
    );
    assert.equal(profile.name, "Priya Sharma");
    assert.equal(profile.email, "priya.sharma@example.com");
    assert.equal(profile.phone, "+919876543210");
    assert.deepEqual(profile.techStack, ["React", "TypeScript"]);
    assert.equal(reviewFlags.filter((f) => ["name", "email", "phone"].includes(f.field)).length, 0);
  });

  it("drops and flags hallucinated contact details instead of guessing", () => {
    const { profile, reviewFlags } = validateProfile(
      { name: "Rahul Verma", email: "rahul@example.com", phone: "+1 555 123 4567" },
      CV,
    );
    assert.equal(profile.name, null);
    assert.equal(profile.email, null);
    assert.equal(profile.phone, null);
    assert.ok(reviewFlags.some((f) => f.field === "email" && /not found/.test(f.reason)));
    assert.ok(reviewFlags.some((f) => f.field === "phone" && /not found/.test(f.reason)));
  });

  it("rejects implausible numbers", () => {
    const { profile, reviewFlags } = validateProfile(
      { name: "Priya Sharma", totalExperienceYears: 140, education: [{ institution: "IIT", graduationYear: 3020 }] },
      CV,
    );
    assert.equal(profile.totalExperienceYears, null);
    assert.equal(profile.education[0].graduationYear, null);
    assert.ok(reviewFlags.some((f) => f.field === "education.graduationYear"));
  });

  it("flags [unreadable] regions from OCR", () => {
    const { reviewFlags } = validateProfile({ name: "Priya Sharma" }, `${CV}\nPhone: [unreadable]`);
    assert.ok(reviewFlags.some((f) => f.field === "document"));
  });
});

describe("normalisePhone", () => {
  it("keeps explicit country codes", () => {
    assert.deepEqual(normalisePhone("+44 20 7946 0958"), { phone: "+442079460958", assumedCountry: false });
    assert.deepEqual(normalisePhone("0044 20 7946 0958"), { phone: "+442079460958", assumedCountry: false });
  });
  it("applies the default country code and marks it as assumed", () => {
    assert.deepEqual(normalisePhone("09876543210", "91"), { phone: "+919876543210", assumedCountry: true });
  });
  it("recognises a number that already starts with the default code", () => {
    assert.deepEqual(normalisePhone("919876543210", "91"), { phone: "+919876543210", assumedCountry: false });
  });
  it("rejects non-phones", () => {
    assert.equal(normalisePhone("2019").phone, null);
  });
});

describe("profileToResumeText", () => {
  it("renders the structured profile as markdown", () => {
    const md = profileToResumeText({
      name: "Priya Sharma",
      email: null,
      phone: null,
      location: null,
      headline: "Senior Frontend Engineer",
      totalExperienceYears: 6,
      techStack: ["React", "TypeScript"],
      experience: [{ company: "Acme", role: "Engineer", start: "2019", end: "Present", summary: null }],
      projects: [{ name: "Design system", description: null, technologies: ["Storybook"] }],
      education: [],
      summary: null,
    });
    assert.match(md, /## Tech stack\nReact, TypeScript/);
    assert.match(md, /Engineer @ Acme \(2019 – Present\)/);
    assert.match(md, /Design system \[Storybook\]/);
  });
});

describe("secrets", () => {
  it("round-trips and masks without exposing the key", () => {
    process.env.AUTH_SECRET = "test-secret";
    const enc = encryptSecret("re_1234567890abcdef");
    assert.ok(enc.startsWith("enc:v1:"));
    assert.ok(!enc.includes("re_1234"));
    assert.equal(decryptSecret(enc), "re_1234567890abcdef");
    assert.equal(maskSecret(enc), "re_1…cdef");
    assert.equal(decryptSecret(null), null);
  });
});

describe("message templates", () => {
  const vars: TemplateVars = {
    name: "Priya",
    interviewTitle: "Frontend <Engineer>",
    organization: "Acme",
    link: "https://app.test/i/invite/abc",
    duration: "20 minutes",
    batchName: "Oct",
  };

  it("fills placeholders and leaves unknown ones intact", () => {
    assert.equal(renderTemplate("Hi {{name}} {{ unknown }}", vars), "Hi Priya {{ unknown }}");
  });

  it("formats schedule notices properly for all scenario combinations", () => {
    assert.equal(
      formatScheduleNotice(undefined, undefined),
      "You may start at your convenience.",
    );
    const sched = new Date("2026-11-07T10:00:00Z");
    const exp = new Date("2026-11-08T23:59:00Z");
    const fullNotice = formatScheduleNotice(sched, exp);
    assert.match(fullNotice, /Scheduled for:.*Link active until:/);

    const schedOnly = formatScheduleNotice(sched, null);
    assert.match(schedOnly, /^Scheduled for:/);

    const expOnly = formatScheduleNotice(null, exp);
    assert.match(expOnly, /^Link active until:/);
  });

  it("default email shares the unified layout with WhatsApp and includes link & schedule notice", () => {
    const text = renderTemplate(DEFAULT_TEMPLATES.emailBody, vars);
    assert.match(text, /^Hello Priya, your interview for Frontend <Engineer> with Acme is ready\./);
    assert.match(text, /You may start at your convenience\./);
    assert.ok(text.includes(vars.link));
    assert.match(text, /open it on a laptop using Chrome or Edge/);
  });

  it("email HTML escapes content and renders a button for a standalone link", () => {
    const html = emailHtml(DEFAULT_TEMPLATES.emailBody, vars);
    assert.ok(html.includes("Frontend &lt;Engineer&gt;"));
    assert.ok(html.includes(">Start interview</a>"));
  });

  it("WhatsApp 5-variable template fills name, title, organization, schedule notice, and link in order", () => {
    const customVars: TemplateVars = {
      ...vars,
      scheduleNotice: "Scheduled for: Saturday, Nov 2 at 10:00 AM",
    };
    const bodyVars = whatsappBodyVariables(customVars);
    assert.deepEqual(bodyVars, [
      "Priya",
      "Frontend <Engineer>",
      "Acme",
      "Scheduled for: Saturday, Nov 2 at 10:00 AM",
      "https://app.test/i/invite/abc",
    ]);

    const text = renderWhatsappPreview(customVars);
    assert.match(text, /^Hello Priya, your interview for Frontend <Engineer> with Acme is ready\./);
    assert.match(text, /Scheduled for: Saturday, Nov 2 at 10:00 AM/);
    assert.ok(text.includes(vars.link));
  });
});
