/**
 * Devanagari → Roman-script Hinglish ("मेरा नाम देवाशीष है" → "mera naam devashish hai").
 * English words the recogniser wrote in Devanagari go back to English spelling
 * ("एक्सपीरियंस" → "experience", see hinglish-lexicon.ts), and names from the
 * session vocabulary are matched by sound ("देवाशीष" → "Dewashish").
 * Pure and dependency-free so the relay, the browser and the save API share it.
 * Transcripts are stored in Hinglish (Roman script), never Devanagari; speech
 * recognition sometimes returns Devanagari for Hindi, so this is the fallback.
 * It follows everyday Hinglish spelling (aa, ee-less "i", schwa dropping), not
 * a scholarly scheme.
 */

import { AMBIGUOUS, LEXICON, parseLexicon } from "./hinglish-lexicon";

const DEVANAGARI = /[\u0900-\u097F]/;

const CONSONANTS: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n",
  च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n",
  त: "t", थ: "th", द: "d", ध: "dh", न: "n",
  प: "p", फ: "ph", ब: "b", भ: "bh", म: "m",
  य: "y", र: "r", ल: "l", व: "v", श: "sh", ष: "sh", स: "s", ह: "h",
  // Precomposed nukta letters
  क़: "q", ख़: "kh", ग़: "g", ज़: "z", ड़: "r", ढ़: "rh", फ़: "f", य़: "y", ऱ: "r", ऴ: "l", ऩ: "n",
};
/** Consonant + nukta (़) written as two code points. */
const NUKTA_FORMS: Record<string, string> = { क: "q", ख: "kh", ग: "g", ज: "z", ड: "r", ढ: "rh", फ: "f" };

const VOWELS: Record<string, string> = {
  अ: "a", आ: "aa", इ: "i", ई: "i", उ: "u", ऊ: "u", ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au",
  ऑ: "o", ऍ: "e", ॲ: "a",
};
const MATRAS: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
  "ॉ": "o", "ॅ": "e",
};
const VIRAMA = "्";
const NUKTA = "़";
const ANUSVARA = "ं";
const CHANDRABINDU = "ँ";
const VISARGA = "ः";
const DIGITS = "०१२३४५६७८९";

/** Very common words where everyday Hinglish spelling differs from the rules. */
const COMMON: Record<string, string> = {
  "में": "mein", "मैं": "main", "हैं": "hain", "है": "hai", "नहीं": "nahi", "हाँ": "haan", "हां": "haan",
  "यह": "yeh", "वह": "woh", "वो": "woh", "क्या": "kya", "और": "aur", "आप": "aap", "ठीक": "theek", "मैंने": "maine",
  "क्यों": "kyon", "लिए": "liye", "चाहिए": "chahiye", "कुछ": "kuch", "बहुत": "bahut", "कैसे": "kaise", "भी": "bhi", "तो": "to", "हम": "hum", "तुम": "tum", "एक": "ek",
};

for (const k of Object.keys(COMMON)) COMMON[k.normalize("NFD")] = COMMON[k];

/** One letter group; `vowel`: it already ends in a written vowel sound. */
type Unit = { text: string; consonant: boolean; schwa: boolean; vowel: boolean };

function transliterateWord(raw: string): string {
  // Precomposed nukta letters (U+0958–095F, e.g. "ज़") become letter + nukta.
  const word = raw.normalize("NFD");
  if (COMMON[word]) return COMMON[word];
  const units: Unit[] = [];
  const chars = Array.from(word);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const next = chars[i + 1];
    if (CONSONANTS[c] !== undefined) {
      let roman = CONSONANTS[c];
      if (next === NUKTA && NUKTA_FORMS[c]) { roman = NUKTA_FORMS[c]; i += 1; }
      const after = chars[i + 1];
      if (after === VIRAMA) { units.push({ text: roman, consonant: true, schwa: false, vowel: false }); i += 1; }
      else if (after && MATRAS[after] !== undefined) { units.push({ text: roman + MATRAS[after], consonant: true, schwa: false, vowel: true }); i += 1; }
      else units.push({ text: roman, consonant: true, schwa: true, vowel: false });
      continue;
    }
    if (VOWELS[c] !== undefined) { units.push({ text: VOWELS[c], consonant: false, schwa: false, vowel: true }); continue; }
    if (c === ANUSVARA || c === CHANDRABINDU) {
      // Before न / म the nasal is already spelled ("मैंने" → "maine").
      const following = chars[i + 1];
      if (following === "न" || following === "म") continue;
      const prev = units[units.length - 1];
      if (prev) { if (prev.schwa) { prev.text += "a"; prev.schwa = false; prev.vowel = true; } prev.text += "n"; }
      continue;
    }
    if (c === VISARGA) { units.push({ text: "h", consonant: false, schwa: false, vowel: false }); continue; }
    if (c === NUKTA || c === VIRAMA) continue;
    const d = DIGITS.indexOf(c);
    if (d >= 0) { units.push({ text: String(d), consonant: false, schwa: false, vowel: false }); continue; }
    units.push({ text: c, consonant: false, schwa: false, vowel: false });
  }
  // Schwa: drop at the end of a word, and in the middle when a vowel comes
  // before and the next consonant carries its own vowel ("करना" → "karna").
  let out = "";
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!u.schwa) { out += u.text; continue; }
    const isLast = i === units.length - 1;
    if (isLast) { out += units.length === 1 ? `${u.text}a` : u.text; continue; }
    const prev = units[i - 1];
    const next = units[i + 1];
    const prevHasVowel = !!prev && (prev.vowel || prev.schwa);
    const nextHasOwnVowel = !!next && next.consonant && next.vowel;
    const dropMedial = i > 0 && prevHasVowel && nextHasOwnVowel && i + 1 < units.length;
    out += dropMedial ? u.text : `${u.text}a`;
  }
  // Long ā at the end of a word is written "a" in Hinglish ("मेरा" → "mera").
  return out.replace(/aa$/, "a").replace(/chchh/g, "cch");
}

/** True when the text has any Devanagari. */
export function hasDevanagari(text: string | null | undefined): boolean {
  return !!text && DEVANAGARI.test(text);
}

export type HinglishOptions = {
  /** Names and terms from the session (candidate, company, skills) to match by sound. */
  vocabulary?: readonly string[];
};

/** Fold Devanagari spelling variants (ी/ि, nukta, ं/न्, ॉ/ो) so one key covers them. */
export function devanagariKey(word: string): string {
  return word
    .normalize("NFD")
    .replace(/[\u093C\u200C\u200D]/g, "")
    .replace(/ँ/g, "ं").replace(/ॅ/g, "े").replace(/ॉ/g, "ो").replace(/ी/g, "ि").replace(/ू/g, "ु")
    .replace(/ऑ/g, "ओ").replace(/ऍ/g, "ए").replace(/ई/g, "इ").replace(/ऊ/g, "उ")
    .replace(/ष/g, "श")
    .replace(/[ङञणनम]्(?=[क-ह])/g, "ं")
    .replace(/्$/, "");
}

/** Loose Roman key: "aa"/"a", "ee"/"i", w/v, z/j, doubled letters all match. */
export function romanKey(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/aa/g, "a").replace(/ee|ii/g, "i").replace(/oo|uu/g, "u").replace(/ai/g, "e").replace(/au/g, "o")
    .replace(/z/g, "j").replace(/f/g, "ph").replace(/w/g, "v").replace(/q/g, "k")
    .replace(/(.)\1+/g, "$1");
}

/** Consonant skeleton for matching names by sound ("devashish" ≈ "Dewashish"). */
export function soundSkeleton(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/ph/g, "f").replace(/(sh|ch|kh|gh|th|dh|bh|jh)/g, (m) => m[0])
    .replace(/ck/g, "k").replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/q/g, "k").replace(/x/g, "ks")
    .replace(/w/g, "v").replace(/[zj]/g, "s")
    .replace(/[aeiouhy]/g, "")
    .replace(/(.)\1+/g, "$1");
}

type Entry = { english: string; strong: boolean };
const DEVA_EN = new Map<string, Entry>();
const DEVA_AMBIG = new Map<string, Entry>();
const ROMAN_EN = new Map<string, Entry>();
const ROMAN_AMBIG = new Map<string, Entry>();
const ENGLISH_WORDS = new Set<string>();

/** Roman Hindi words that must never turn into English in the Roman repair. */
const ROMAN_HINDI = new Set(
  (
    "hai hain main mein ki ka ke ko se ne par aur bhi to ye yeh wo woh kya kaise nahi na ho tha thi the raha rahi rahe " +
    "kar karta karti karna kuch jo jab tab ab sab ek do teen haan ji aap hum mera meri mere uska unka apna liye saath " +
    "baad pehle phir bahut accha acha theek kaam naam ghar paas saal din abhi kaha kahan kab kyun koi kisi wala wale " +
    "gaya gayi kiya kiye diya liya hua hui hue tak bas sir madam"
  )
    .split(" ")
    .map(romanKey),
);

for (const [english, spellings] of parseLexicon(LEXICON)) {
  ENGLISH_WORDS.add(english.toLowerCase());
  for (const sp of spellings) {
    DEVA_EN.set(devanagariKey(sp), { english, strong: false });
    const rk = romanKey(transliterateWord(sp));
    if (rk.length >= 3 && !ROMAN_HINDI.has(rk)) ROMAN_EN.set(rk, { english, strong: false });
  }
}
for (const [label, spellings] of parseLexicon(AMBIGUOUS)) {
  const strong = label.startsWith("!");
  const english = label.replace(/^!/, "");
  ENGLISH_WORDS.add(english.toLowerCase());
  for (const sp of spellings) {
    DEVA_AMBIG.set(devanagariKey(sp), { english, strong });
    const rk = romanKey(transliterateWord(sp));
    if (rk) ROMAN_AMBIG.set(rk, { english, strong });
  }
}
for (const w of ["i", "am", "a", "an", "the", "and", "as", "is", "it", "at", "of", "on", "in", "for", "to", "my", "we", "you", "with"]) {
  ENGLISH_WORDS.add(w);
}

type Token = {
  sep: string; // whitespace before the token
  lead: string;
  core: string;
  trail: string;
  out: string;
  english: boolean; // decided as English (or a session name)
  ambiguous?: Entry;
};

const PUNCT_SPLIT = /^([^\p{L}\p{M}\p{N}]*)([\s\S]*?)([^\p{L}\p{M}\p{N}]*)$/u;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /(\s*)(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const parts = m[2].match(PUNCT_SPLIT) ?? ["", "", m[2], ""];
    tokens.push({ sep: m[1], lead: parts[1], core: parts[2], trail: parts[3], out: parts[2], english: false });
  }
  return tokens;
}

/** A session term that sounds like these 1–3 words, if any. */
function matchVocabulary(roman: string, vocab: VocabEntry[]): string | null {
  const rk = romanKey(roman);
  const sk = soundSkeleton(roman);
  for (const v of vocab) {
    if (rk.length >= 4 && rk === v.key) return v.term;
    if (sk.length >= 3 && sk === v.skeleton && roman[0]?.toLowerCase() === v.first) return v.term;
  }
  return null;
}

function isHindiOrShortWord(deva: string): boolean {
  return DEVA_AMBIG.has(devanagariKey(deva)) || ROMAN_HINDI.has(romanKey(transliterateWord(deva)));
}

type VocabEntry = { term: string; key: string; skeleton: string; first: string };

function prepareVocabulary(vocabulary: readonly string[] | undefined): VocabEntry[] {
  const out: VocabEntry[] = [];
  for (const raw of vocabulary ?? []) {
    const term = raw.trim();
    if (!term || term.length < 4 || !/^[A-Za-z][A-Za-z0-9.+# -]*$/.test(term)) continue;
    const letters = term.replace(/[^A-Za-z]/g, "");
    if (ENGLISH_WORDS.has(term.toLowerCase())) continue;
    const skeleton = soundSkeleton(letters);
    out.push({ term, key: romanKey(letters), skeleton, first: letters[0].toLowerCase() });
  }
  // Longer terms first, so "ResilioHub" wins over a shorter look-alike.
  return out.sort((a, b) => b.skeleton.length - a.skeleton.length);
}

const SENTENCE_END = /[.!?,;:]$/;

/** Decide the ambiguous words: English only beside English. */
function resolveAmbiguous(tokens: Token[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (!t.ambiguous || t.english) continue;
      const leftOpen = i > 0 && !SENTENCE_END.test(tokens[i - 1].trail) && !/^[,;:]/.test(t.lead);
      const rightOpen = i + 1 < tokens.length && !SENTENCE_END.test(t.trail);
      const left = leftOpen ? tokens[i - 1].english : null;
      const right = rightOpen ? tokens[i + 1].english : null;
      const ok = t.ambiguous.strong
        ? (left ?? true) && (right ?? true) && (left === true || right === true)
        : left === true || right === true;
      if (ok) {
        t.english = true;
        t.out = t.ambiguous.english;
        changed = true;
      }
    }
  }
}

function capitalizeSentences(text: string): string {
  return text.replace(/(^|[.!?]\s+)([a-z])/g, (_m, p: string, ch: string) => p + ch.toUpperCase());
}

/**
 * Convert Devanagari to Roman Hinglish; other text is left as is. English
 * loanwords come back in English spelling and session names are matched.
 * No Devanagari is ever left in the result.
 */
export function devanagariToRoman(text: string, options: HinglishOptions = {}): string {
  if (!hasDevanagari(text)) return text;
  const vocab = prepareVocabulary(options.vocabulary);
  const normalized = text.normalize("NFD").replace(/\s*[।॥]+/g, ". ").replace(/\s+$/, "");
  const tokens = tokenize(normalized);
  // Names first: they can span words ("रेजिलियो हब" → "ResilioHub").
  for (let i = 0; i < tokens.length; i++) {
    if (!hasDevanagari(tokens[i].core)) continue;
    for (let n = 1; n <= Math.min(3, tokens.length - i); n++) {
      const span = tokens.slice(i, i + n);
      if (span.some((t) => !hasDevanagari(t.core))) break;
      // A name never swallows a Hindi word ("देवाशीष है"); English parts are fine ("रेजिलिएंस सॉफ्ट").
      if (n > 1 && isHindiOrShortWord(span[n - 1].core)) break;
      if (span.slice(0, -1).some((t) => t.trail || span.indexOf(t) > 0 && t.lead)) continue;
      const roman = span.map((t) => transliterateWord(t.core)).join("");
      if (n === 1 && (DEVA_EN.has(devanagariKey(span[0].core)) || DEVA_AMBIG.has(devanagariKey(span[0].core)))) continue;
      if (n === 1 && ROMAN_HINDI.has(romanKey(roman))) continue;
      const term = matchVocabulary(roman, vocab);
      if (!term) continue;
      span[0].out = term;
      span[0].english = true;
      span[0].trail = span[n - 1].trail;
      for (const t of span.slice(1)) { t.core = ""; t.out = ""; t.sep = ""; t.lead = ""; t.trail = ""; t.english = true; }
      break;
    }
  }
  for (const t of tokens) {
    if (t.english || !t.core) continue;
    if (!hasDevanagari(t.core)) {
      t.english = ENGLISH_WORDS.has(t.core.toLowerCase()) || /^[A-Z][a-z]+[A-Z]/.test(t.core) || /^[A-Z]{2,}$/.test(t.core);
      continue;
    }
    const key = devanagariKey(t.core);
    const en = DEVA_EN.get(key);
    if (en) { t.out = en.english; t.english = true; continue; }
    const amb = DEVA_AMBIG.get(key);
    if (amb) t.ambiguous = amb;
    t.out = transliterateWord(t.core);
  }
  resolveAmbiguous(tokens);
  const joined = tokens
    .filter((t) => t.core || t.lead || t.trail)
    .map((t) => `${t.sep}${t.lead}${t.out}${t.trail}`)
    .join("")
    .replace(/[\u0900-\u097F]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .trim();
  return capitalizeSentences(joined);
}

/**
 * Repair Roman text that an older letter-by-letter conversion produced
 * ("eksapiriyans", "aai em varking") using the same word list. Only exact
 * matches of known converted spellings change; Hindi words never do.
 */
export function repairRomanHinglish(text: string, options: HinglishOptions = {}): string {
  if (!text) return text ?? "";
  if (hasDevanagari(text)) text = devanagariToRoman(text, options);
  const vocab = prepareVocabulary(options.vocabulary);
  const tokens = tokenize(text);
  let changedAny = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.core || !/^[A-Za-z']+$/.test(t.core)) continue;
    const lower = t.core.toLowerCase();
    const rk = romanKey(t.core);
    if (ENGLISH_WORDS.has(lower)) { t.english = true; continue; }
    if (ROMAN_HINDI.has(rk)) continue;
    const en = ROMAN_EN.get(rk);
    if (en) {
      t.english = true;
      if (en.english.toLowerCase() !== lower) { t.out = en.english; changedAny = true; }
      continue;
    }
    if (t.core.length >= 5 && /^[a-z]/i.test(t.core)) {
      // Two-word names ("resilio hab" → "ResilioHub") then one word.
      const next = tokens[i + 1];
      const nextKnown = !!next?.core && (ROMAN_HINDI.has(romanKey(next.core)) || ROMAN_AMBIG.has(romanKey(next.core)));
      if (next?.core && /^[A-Za-z]+$/.test(next.core) && !t.trail && !nextKnown) {
        const two = matchVocabulary(t.core + next.core, vocab);
        if (two) {
          t.out = two; t.english = true; t.trail = next.trail;
          next.core = ""; next.out = ""; next.sep = ""; next.lead = ""; next.trail = ""; next.english = true;
          changedAny = true; continue;
        }
      }
      const term = matchVocabulary(t.core, vocab);
      if (term && term !== t.core) { t.out = term; t.english = true; changedAny = true; continue; }
    }
    const amb = ROMAN_AMBIG.get(rk);
    if (amb) t.ambiguous = amb;
  }
  resolveAmbiguous(tokens);
  if (!changedAny && !tokens.some((t) => t.ambiguous && t.english && t.out.toLowerCase() !== t.core.toLowerCase())) return text;
  const joined = tokens
    .filter((t) => t.core || t.lead || t.trail)
    .map((t) => {
      const out = t.out !== t.core && /^[A-Z]/.test(t.core) && /^[a-z]/.test(t.out) ? t.out[0].toUpperCase() + t.out.slice(1) : t.out;
      return `${t.sep}${t.lead}${out}${t.trail}`;
    })
    .join("");
  return joined.replace(/\b(ke|ki) lie\b/g, "$1 liye");
}
