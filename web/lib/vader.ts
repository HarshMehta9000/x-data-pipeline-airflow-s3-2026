/*
  VADER, ported from the installed vaderSentiment package so the page can run
  the repo's other scorer in the browser.

  transform._make_scorer picks VADER when it imports and the 28 word lexicon
  when it does not, which means the contents of the lake depend on what happens
  to be installed on the worker. Showing that honestly needs both scorers on
  the same text, live, so this is a real port rather than a table of
  precomputed answers.

  Fidelity notes, because several of these look like bugs and are load bearing:
    - _but_check looks up sentiments.index(sentiment), which finds the first
      element with an equal value rather than the element being iterated. With
      repeated values that rescales the wrong entry. Reproduced as written.
    - _strip_punc_if_word returns the original token when stripping leaves two
      or fewer characters, which is how emoticons survive.
    - The negation window walks three words back, with the 0.95 and 0.9 decay
      applied only when the modifier is not itself a lexicon word.

  gates/gate6-vader.mjs asserts compound, pos, neu and neg against Python on
  every fixture post, VADER's own documentation examples, and a generated
  corpus that exercises negation, boosters, caps, punctuation and emoji.
*/

import { pyRound } from "./pyround";

export interface VaderData {
  constants: { B_INCR: number; B_DECR: number; C_INCR: number; N_SCALAR: number };
  negate: string[];
  booster: Record<string, number>;
  special_cases: Record<string, number>;
  lexicon: Record<string, number>;
  emoji: Record<string, string>;
  counts: { lexicon: number; emoji: number };
}

export interface VaderScores {
  neg: number;
  neu: number;
  pos: number;
  compound: number;
}

// string.punctuation
const PUNCTUATION = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const PUNCT_SET = new Set(PUNCTUATION.split(""));

// Python's str.split(), same set as lib/pipeline.ts.
const PY_SPACE =
  /[\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;

function pySplit(text: string): string[] {
  return text.split(PY_SPACE).filter((t) => t.length > 0);
}

/*
  Python's str.strip() with no argument, which is not JavaScript's trim().
  ECMAScript counts U+FEFF as whitespace and Python does not, so trim() eats a
  byte order mark that Python keeps attached to the following word. A post
  beginning with a BOM then scores 0 in Python and scores the word in the
  browser, which is exactly the kind of difference this port exists to avoid.
*/
const PY_SPACE_CHARS = new Set(
  "\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\u00a0\u1680\u2028\u2029\u202f\u205f\u3000".split(""),
);
for (let c = 0x2000; c <= 0x200a; c += 1) PY_SPACE_CHARS.add(String.fromCharCode(c));

function pyStrip(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && PY_SPACE_CHARS.has(text[start] as string)) start += 1;
  while (end > start && PY_SPACE_CHARS.has(text[end - 1] as string)) end -= 1;
  return text.slice(start, end);
}

function strip(token: string): string {
  let start = 0;
  let end = token.length;
  while (start < end && PUNCT_SET.has(token[start] as string)) start += 1;
  while (end > start && PUNCT_SET.has(token[end - 1] as string)) end -= 1;
  return token.slice(start, end);
}

/** _strip_punc_if_word: two or fewer characters left means it was an emoticon. */
function stripPuncIfWord(token: string): string {
  const stripped = strip(token);
  return stripped.length <= 2 ? token : stripped;
}

/** Python's str.isupper(): at least one cased character, none of them lower. */
function isUpper(s: string): boolean {
  let cased = false;
  for (const ch of s) {
    const lower = ch.toLowerCase();
    const upper = ch.toUpperCase();
    if (lower === upper) continue; // uncased
    cased = true;
    if (ch === lower) return false;
  }
  return cased;
}

function countOccurrences(text: string, needle: string): number {
  let n = 0;
  for (const ch of text) if (ch === needle) n += 1;
  return n;
}

export class Vader {
  private d: VaderData;
  private negateSet: Set<string>;

  constructor(data: VaderData) {
    this.d = data;
    this.negateSet = new Set(data.negate.map((w) => w.toLowerCase()));
  }

  get lexiconSize(): number {
    return this.d.counts.lexicon;
  }

  /** VADER's `negated`, including the "n't" substring rule. */
  private negated(words: string[]): boolean {
    const lowered = words.map((w) => String(w).toLowerCase());
    for (const w of lowered) if (this.negateSet.has(w)) return true;
    for (const w of lowered) if (w.includes("n't")) return true;
    return false;
  }

  private scalarIncDec(word: string, valence: number, isCapDiff: boolean): number {
    let scalar = 0.0;
    const wordLower = word.toLowerCase();
    const booster = this.d.booster[wordLower];
    if (booster !== undefined) {
      scalar = booster;
      if (valence < 0) scalar *= -1;
      if (isUpper(word) && isCapDiff) {
        scalar += valence > 0 ? this.d.constants.C_INCR : -this.d.constants.C_INCR;
      }
    }
    return scalar;
  }

  /** The tokens VADER actually scores, punctuation stripped but contractions kept. */
  tokenize(text: string): string[] {
    return pySplit(text).map(stripPuncIfWord);
  }

  /** polarity_scores, including the emoji substitution pass that precedes it. */
  polarityScores(rawText: string): VaderScores {
    const text = pyStrip(this.replaceEmoji(rawText));
    const words = this.tokenize(text);
    const isCapDiff = allCapDifferential(words);

    let sentiments: number[] = [];
    for (let i = 0; i < words.length; i += 1) {
      const item = words[i] as string;
      const lower = item.toLowerCase();
      if (this.d.booster[lower] !== undefined) {
        sentiments.push(0);
        continue;
      }
      if (
        i < words.length - 1 &&
        lower === "kind" &&
        (words[i + 1] as string).toLowerCase() === "of"
      ) {
        sentiments.push(0);
        continue;
      }
      sentiments = this.sentimentValence(0, words, isCapDiff, item, i, sentiments);
    }

    sentiments = butCheck(words, sentiments);
    return this.scoreValence(sentiments, text);
  }

  private replaceEmoji(text: string): string {
    let out = "";
    let prevSpace = true;
    for (const ch of text) {
      const description = this.d.emoji[ch];
      if (description !== undefined) {
        if (!prevSpace) out += " ";
        out += description;
        prevSpace = false;
      } else {
        out += ch;
        prevSpace = ch === " ";
      }
    }
    return out;
  }

  private sentimentValence(
    valenceIn: number,
    words: string[],
    isCapDiff: boolean,
    item: string,
    i: number,
    sentiments: number[],
  ): number[] {
    let valence = valenceIn;
    const lower = item.toLowerCase();
    const lex = this.d.lexicon;

    if (lower in lex) {
      valence = lex[lower] as number;

      // "no" as a negation of the next lexicon word, rather than as itself.
      if (
        lower === "no" &&
        i !== words.length - 1 &&
        (words[i + 1] as string).toLowerCase() in lex
      ) {
        valence = 0.0;
      }
      if (
        (i > 0 && (words[i - 1] as string).toLowerCase() === "no") ||
        (i > 1 && (words[i - 2] as string).toLowerCase() === "no") ||
        (i > 2 &&
          (words[i - 3] as string).toLowerCase() === "no" &&
          ["or", "nor"].includes((words[i - 1] as string).toLowerCase()))
      ) {
        valence = (lex[lower] as number) * this.d.constants.N_SCALAR;
      }

      if (isUpper(item) && isCapDiff) {
        valence += valence > 0 ? this.d.constants.C_INCR : -this.d.constants.C_INCR;
      }

      for (let startI = 0; startI < 3; startI += 1) {
        const prev = words[i - (startI + 1)];
        if (i > startI && !((prev as string).toLowerCase() in lex)) {
          let s = this.scalarIncDec(prev as string, valence, isCapDiff);
          if (startI === 1 && s !== 0) s = s * 0.95;
          if (startI === 2 && s !== 0) s = s * 0.9;
          valence = valence + s;
          valence = this.negationCheck(valence, words, startI, i);
          if (startI === 2) valence = this.specialIdiomsCheck(valence, words, i);
        }
      }

      valence = this.leastCheck(valence, words, i);
    }

    sentiments.push(valence);
    return sentiments;
  }

  private leastCheck(valenceIn: number, words: string[], i: number): number {
    let valence = valenceIn;
    const lex = this.d.lexicon;
    const prev1 = i > 0 ? (words[i - 1] as string).toLowerCase() : "";
    if (i > 1 && !(prev1 in lex) && prev1 === "least") {
      const prev2 = (words[i - 2] as string).toLowerCase();
      if (prev2 !== "at" && prev2 !== "very") valence = valence * this.d.constants.N_SCALAR;
    } else if (i > 0 && !(prev1 in lex) && prev1 === "least") {
      valence = valence * this.d.constants.N_SCALAR;
    }
    return valence;
  }

  private negationCheck(
    valenceIn: number,
    words: string[],
    startI: number,
    i: number,
  ): number {
    let valence = valenceIn;
    const lower = words.map((w) => String(w).toLowerCase());
    const N = this.d.constants.N_SCALAR;

    if (startI === 0) {
      if (this.negated([lower[i - 1] as string])) valence = valence * N;
    }
    if (startI === 1) {
      if (lower[i - 2] === "never" && (lower[i - 1] === "so" || lower[i - 1] === "this")) {
        valence = valence * 1.25;
      } else if (lower[i - 2] === "without" && lower[i - 1] === "doubt") {
        // left as is, deliberately
      } else if (this.negated([lower[i - 2] as string])) {
        valence = valence * N;
      }
    }
    if (startI === 2) {
      /*
        Reproduced exactly, including the precedence: Python's `A and (B or C)
        or (D or E)` means the trailing pair fires on its own, so any "so" or
        "this" immediately before the word boosts by 1.25 regardless of never.
      */
      if (
        (lower[i - 3] === "never" && (lower[i - 2] === "so" || lower[i - 2] === "this")) ||
        lower[i - 1] === "so" ||
        lower[i - 1] === "this"
      ) {
        valence = valence * 1.25;
      } else if (
        lower[i - 3] === "without" &&
        (lower[i - 2] === "doubt" || lower[i - 1] === "doubt")
      ) {
        // left as is, deliberately
      } else if (this.negated([lower[i - 3] as string])) {
        valence = valence * N;
      }
    }
    return valence;
  }

  private specialIdiomsCheck(valenceIn: number, words: string[], i: number): number {
    let valence = valenceIn;
    const lower = words.map((w) => String(w).toLowerCase());
    // Python indexes from the end for negatives; every call site here is
    // guarded by i > 2 so it never happens, but match the semantics anyway.
    const at = (k: number) => (lower[k < 0 ? lower.length + k : k] ?? "") as string;

    const onezero = `${at(i - 1)} ${at(i)}`;
    const twoonezero = `${at(i - 2)} ${at(i - 1)} ${at(i)}`;
    const twoone = `${at(i - 2)} ${at(i - 1)}`;
    const threetwoone = `${at(i - 3)} ${at(i - 2)} ${at(i - 1)}`;
    const threetwo = `${at(i - 3)} ${at(i - 2)}`;

    for (const seq of [onezero, twoonezero, twoone, threetwoone, threetwo]) {
      const special = this.d.special_cases[seq];
      if (special !== undefined) {
        valence = special;
        break;
      }
    }

    if (lower.length - 1 > i) {
      const zeroone = `${at(i)} ${at(i + 1)}`;
      const special = this.d.special_cases[zeroone];
      if (special !== undefined) valence = special;
    }
    if (lower.length - 1 > i + 1) {
      const zeroonetwo = `${at(i)} ${at(i + 1)} ${at(i + 2)}`;
      const special = this.d.special_cases[zeroonetwo];
      if (special !== undefined) valence = special;
    }

    for (const nGram of [threetwoone, threetwo, twoone]) {
      const booster = this.d.booster[nGram];
      if (booster !== undefined) valence = valence + booster;
    }
    return valence;
  }

  private scoreValence(sentiments: number[], text: string): VaderScores {
    if (sentiments.length === 0) {
      return { neg: 0.0, neu: 0.0, pos: 0.0, compound: 0.0 };
    }

    let sumS = 0;
    for (const s of sentiments) sumS += s;

    const punctEmph = punctuationEmphasis(text);
    if (sumS > 0) sumS += punctEmph;
    else if (sumS < 0) sumS -= punctEmph;

    const compound = normalizeScore(sumS);

    let posSum = 0.0;
    let negSum = 0.0;
    let neuCount = 0;
    for (const s of sentiments) {
      if (s > 0) posSum += s + 1;
      if (s < 0) negSum += s - 1;
      if (s === 0) neuCount += 1;
    }

    if (posSum > Math.abs(negSum)) posSum += punctEmph;
    else if (posSum < Math.abs(negSum)) negSum -= punctEmph;

    const total = posSum + Math.abs(negSum) + neuCount;
    return {
      neg: pyRound(Math.abs(negSum / total), 3),
      neu: pyRound(Math.abs(neuCount / total), 3),
      pos: pyRound(Math.abs(posSum / total), 3),
      compound: pyRound(compound, 4),
    };
  }
}

/* ----------------------------------------------------------- module helpers */

function allCapDifferential(words: string[]): boolean {
  let allcap = 0;
  for (const w of words) if (isUpper(w)) allcap += 1;
  const diff = words.length - allcap;
  return diff > 0 && diff < words.length;
}

/**
 * _but_check, quirk included. Python iterates the list it is mutating and looks
 * the element up by value, so a repeated value resolves to the first position
 * holding it. Reproducing that is the difference between matching VADER and
 * matching what VADER was trying to do.
 */
function butCheck(words: string[], sentiments: number[]): number[] {
  const lower = words.map((w) => String(w).toLowerCase());
  const bi = lower.indexOf("but");
  if (bi === -1) return sentiments;

  for (let pos = 0; pos < sentiments.length; pos += 1) {
    const sentiment = sentiments[pos] as number;
    const si = sentiments.indexOf(sentiment);
    if (si < bi) {
      sentiments.splice(si, 1);
      sentiments.splice(si, 0, sentiment * 0.5);
    } else if (si > bi) {
      sentiments.splice(si, 1);
      sentiments.splice(si, 0, sentiment * 1.5);
    }
  }
  return sentiments;
}

function punctuationEmphasis(text: string): number {
  return amplifyEp(text) + amplifyQm(text);
}

function amplifyEp(text: string): number {
  const count = Math.min(countOccurrences(text, "!"), 4);
  return count * 0.292;
}

function amplifyQm(text: string): number {
  const count = countOccurrences(text, "?");
  if (count > 1) return count <= 3 ? count * 0.18 : 0.96;
  return 0;
}

function normalizeScore(score: number, alpha = 15): number {
  const norm = score / Math.sqrt(score * score + alpha);
  if (norm < -1.0) return -1.0;
  if (norm > 1.0) return 1.0;
  return norm;
}
