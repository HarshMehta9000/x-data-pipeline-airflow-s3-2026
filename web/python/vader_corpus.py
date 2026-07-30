"""Score a corpus with the installed vaderSentiment, for the port to match.

The texts deliberately exercise the parts of VADER that are easy to port
incorrectly: negation at one, two and three words of distance, boosters and
dampeners, the bigram boosters, ALL CAPS emphasis, exclamation and question
mark amplification, the "but" clause rescaling, the special case idioms, the
"no" handling, "at least" versus "least", emoticons that survive punctuation
stripping, and emoji substitution.
"""
from __future__ import annotations

import json
import random
import sys

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

analyzer = SentimentIntensityAnalyzer()

DOC_EXAMPLES = [
    "VADER is smart, handsome, and funny.",
    "VADER is smart, handsome, and funny!",
    "VADER is very smart, handsome, and funny.",
    "VADER is VERY SMART, handsome, and FUNNY.",
    "VADER is VERY SMART, handsome, and FUNNY!!!",
    "VADER is VERY SMART, uber handsome, and FRIGGIN FUNNY!!!",
    "VADER is not smart, handsome, nor funny.",
    "The book was good.",
    "At least it isn't a horrible book.",
    "The plot was good, but the characters are uncompelling and the dialog is not great.",
    "Today SUX!",
    "Today only kinda sux! But I'll get by, lol",
    "Make sure you :) or :D today!",
    "Catch utf-8 emoji such as such as \U0001f4a5 and \U0001f622 and \U0001f60d",
    "Not bad at all",
]

TARGETED = [
    # negation distance
    "not good", "not very good", "not at all good", "never so good",
    "never this good", "without doubt good", "isn't good", "ain't good",
    "no good", "no, good", "no one is good", "not or good",
    # least
    "at least it is good", "least good", "very least good", "it is least good",
    # boosters and dampeners
    "very good", "marginally good", "sort of good", "kind of good", "kinda good",
    "absolutely terrible", "barely terrible", "SO GOOD", "so good",
    # bigram boosters at distance
    "good sort of thing", "the sort of good thing",
    # but clause
    "good but bad", "bad but good", "good good but bad bad",
    "great but great", "terrible but terrible",
    # special cases
    "the shit", "the bomb", "bad ass", "yeah right", "to die for",
    "kiss of death", "beating heart", "bus stop", "cut the mustard",
    # punctuation emphasis
    "good!", "good!!", "good!!!", "good!!!!", "good!!!!!",
    "good?", "good??", "good???", "good????",
    "bad!!!", "bad???",
    # caps
    "GOOD", "GOOD bad", "GOOD BAD", "good BAD", "VERY GOOD day", "NOT GOOD",
    # emoticons and punctuation edges
    ":)", ":(", ":-)", "...good...", "'good'", "\"good\"", "good.", "(good)",
    # empty and neutral
    "", "   ", "the a an", "12345", "!!!", "???",
    # unicode
    "café good", "日本語 good", "good bad",
    "\U0001f680 launch", "good \U0001f622",
    # the repo's own fixture texts
    "This is an amazing milestone for the team. Huge win and I am so excited!",
    "The launch was delayed again. This is a problem and pretty disappointing.",
    "Shipping the update tonight. Status report to follow.",
    "Incredible progress today. The best engineers in the world made this happen.",
    "Some servers went down. Working on a fix now.",
]

LEX_SAMPLE_WORDS = [
    "good", "bad", "great", "terrible", "love", "hate", "win", "fail", "amazing",
    "awful", "happy", "sad", "best", "worst", "broken", "excited", "problem",
    "delay", "disaster", "wonderful", "huge", "incredible", "success", "angry",
]
MODIFIERS = ["", "not ", "very ", "so ", "never ", "hardly ", "at least ", "no ", "kind of "]
TAILS = ["", "!", "!!", "?", "??", " but not really", " and more", "..."]


def generated(n: int = 360) -> list[str]:
    rng = random.Random(20260728)
    out = []
    for _ in range(n):
        k = rng.randint(1, 4)
        parts = []
        for _ in range(k):
            word = rng.choice(LEX_SAMPLE_WORDS)
            if rng.random() < 0.25:
                word = word.upper()
            parts.append(rng.choice(MODIFIERS) + word)
        out.append(" ".join(parts) + rng.choice(TAILS))
    return out


def main() -> None:
    texts = DOC_EXAMPLES + TARGETED + generated()
    rows = []
    for t in texts:
        scores = analyzer.polarity_scores(t)
        rows.append({"text": t, "scores": scores, "tokens": analyzer.lexicon and None})
    json.dump({"count": len(rows), "rows": [{"text": r["text"], "scores": r["scores"]} for r in rows]}, sys.stdout)


if __name__ == "__main__":
    main()
