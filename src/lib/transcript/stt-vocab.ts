/**
 * Custom vocabulary / prompt hints for speech-to-text.
 * Pure (no I/O). The interview's own names and skills are what speech models
 * mishear most, so they come first; common Indian HR and tech terms fill the rest.
 */

/** Indian HR + common tech terms every interview can hit. */
export const BASE_VOCABULARY: readonly string[] = [
  "CTC", "LPA", "lakh", "lakhs", "crore", "in-hand", "fixed", "variable", "notice period", "serving notice",
  "B.Tech", "M.Tech", "MCA", "BCA", "MBA", "ESOP", "relocation", "work from home", "hybrid",
  "JavaScript", "TypeScript", "React", "Next.js", "Node.js", "Express", "MongoDB", "PostgreSQL", "MySQL", "Redis",
  "Python", "Django", "Flask", "FastAPI", "Java", "Spring Boot", "Kotlin", "Swift", "Flutter", "Dart", "Firebase",
  "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Git", "GitHub", "CI/CD", "REST API", "GraphQL", "SQL",
  "Android", "iOS", "Angular", "Vue", "HTML", "CSS", "Tailwind", "Redux", "microservices", "machine learning",
];

/** Capitalised words that are just sentence starters or ordinary English, not names or skills. */
const COMMON_CAPITALISED = new Set(
  (
    "i i'm i've i'll i'd the a an and or but so if when what why how which who whom whose where tell can could would " +
    "should do does did is are was were be been have has had will shall may might must please thank thanks hello hi " +
    "hey okay ok yes no not now then also next first second third last finally great good nice sure well let lets " +
    "let's your you we they he she it this that these those there here with without about from into for of in on at " +
    "to by as any all some more most very just tell describe explain walk give share talk imagine suppose consider " +
    "using use used tools tool team project projects role roles company interview interviewer candidate question " +
    "questions answer answers experience skills skill years year months month day days time work working worked " +
    "monday tuesday wednesday thursday friday saturday sunday january february march april june july august " +
    "september october november december"
  ).split(" "),
);

const clean = (s: string) => s.replace(/[<>\r\n]+/g, " ").replace(/\s+/g, " ").trim();

/** Tokens that look like a name, skill, product or acronym: CamelCase, ALLCAPS, Node.js, C++, C#, mid-sentence Capitalised. */
export function extractTerms(text: string): string[] {
  const out: string[] = [];
  const sentences = text.split(/(?<=[.!?\n])\s+/);
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    words.forEach((raw, idx) => {
      const w = raw.replace(/^[("'“‘\[]+|[)"'”’\],;:!?]+$/g, "").replace(/\.+$/, "");
      if (w.length < 2 || w.length > 40) return;
      const lower = w.toLowerCase();
      if (/^[A-Z]{2,8}$/.test(w)) out.push(w); // API, SQL, AWS
      else if (/^[A-Za-z]+[+#]{1,2}$/.test(w)) out.push(w); // C++, C#
      else if (/^[A-Za-z]+(\.[A-Za-z]+)+$/.test(w) && /[A-Za-z]{2}/.test(w) && /[A-Z]|js$/i.test(w)) out.push(w); // Node.js, B.Tech
      else if (/^[A-Z]?[a-z]+[A-Z][A-Za-z]*$/.test(w)) out.push(w); // FitPassio, TypeScript, iOS-like
      else if (/^[A-Z][a-z]{2,}$/.test(w) && idx > 0 && !COMMON_CAPITALISED.has(lower)) out.push(w); // mid-sentence name
    });
  }
  return out;
}

export type VocabularyInput = {
  candidateName?: string | null;
  companyName?: string | null;
  interviewTitle?: string | null;
  /** Interview questions, interviewer lines, skills, job description snippets. */
  texts?: string[];
  max?: number;
};

/** Ordered, de-duplicated vocabulary (default max 100: Google's recommended ceiling for best results). */
export function buildVocabulary(input: VocabularyInput): string[] {
  const max = input.max ?? 100;
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (term: string) => {
    const t = clean(term);
    if (t.length < 2 || t.length > 60) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  for (const part of [input.candidateName, input.companyName]) {
    if (!part) continue;
    add(part);
    for (const word of clean(part).split(" ")) if (word.length >= 3) add(word);
  }
  if (input.interviewTitle) {
    add(input.interviewTitle);
    extractTerms(input.interviewTitle).forEach(add);
  }

  // Terms from the interview's own text, most frequent first (stable on ties).
  const freq = new Map<string, { term: string; n: number; first: number }>();
  let order = 0;
  for (const text of input.texts ?? []) {
    for (const term of extractTerms(text)) {
      const key = term.toLowerCase();
      const cur = freq.get(key);
      if (cur) cur.n++;
      else freq.set(key, { term, n: 1, first: order++ });
    }
  }
  Array.from(freq.values())
    .sort((a, b) => b.n - a.n || a.first - b.first)
    .forEach((f) => add(f.term));

  for (const term of BASE_VOCABULARY) add(term);
  return out.slice(0, max);
}

/** Short plain-text hint for Whisper-style `prompt` fields (limited to ~224 tokens, so keep it brief). */
export function buildPromptHint(vocabulary: string[], opts: { hindi: boolean }): string {
  const style = opts.hindi
    ? "Interview answer in Hinglish (Hindi written in English letters, mixed with English). "
    : "Job interview answer in Indian English. ";
  const terms = vocabulary.slice(0, 40).join(", ");
  return `${style}Names and terms: ${terms}.`.slice(0, 600);
}
