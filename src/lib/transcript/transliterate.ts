/**
 * Devanagari → Roman-script Hinglish ("मेरा नाम देवाशीष है" → "mera naam devashish hai").
 * Pure and dependency-free so the relay, the browser and the save API share it.
 * Transcripts are stored in Hinglish (Roman script), never Devanagari; speech
 * recognition sometimes returns Devanagari for Hindi, so this is the fallback.
 * It follows everyday Hinglish spelling (aa, ee-less "i", schwa dropping), not
 * a scholarly scheme.
 */

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
  "यह": "yeh", "वह": "woh", "क्या": "kya", "और": "aur", "आप": "aap", "ठीक": "theek", "मैंने": "maine",
  "क्यों": "kyon", "कैसे": "kaise", "भी": "bhi", "तो": "to", "हम": "hum", "तुम": "tum", "एक": "ek",
};

/** One letter group; `vowel`: it already ends in a written vowel sound. */
type Unit = { text: string; consonant: boolean; schwa: boolean; vowel: boolean };

function transliterateWord(word: string): string {
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

/** Convert all Devanagari words to Roman Hinglish; other text is left as is. */
export function devanagariToRoman(text: string): string {
  if (!hasDevanagari(text)) return text;
  const out = text
    .replace(/[\u0900-\u097F]+/g, (w) => {
      const danda = w.replace(/[।॥]/g, ".");
      return danda.split(/(\.)/).map((part) => (part === "." ? "." : part ? transliterateWord(part) : "")).join("");
    })
    .replace(/\s+([.,!?])/g, "$1");
  // Sentence starts get a capital letter, like typed Hinglish.
  return out.replace(/(^|[.!?]\s+)([a-z])/g, (_m, p: string, ch: string) => p + ch.toUpperCase());
}
