"""Report the installed vaderSentiment's own counts and constants.

data/vader-lexicon.json is a build artefact. This is what the gate checks it
against, so a stale or hand edited export cannot pass.
"""
from __future__ import annotations

import json
import sys

from vaderSentiment import vaderSentiment as vs

analyzer = vs.SentimentIntensityAnalyzer()

SPOT = [
    "good", "bad", "great", "terrible", "amazing", "awful", "love", "hate",
    "win", "fail", "excited", "problem", "delay", "disaster", "huge",
    "incredible", "wonderful", "worst", "best", "broken",
]

json.dump(
    {
        "lexicon": len(analyzer.lexicon),
        "emoji": len(analyzer.emojis),
        "negate": len(vs.NEGATE),
        "booster": len(vs.BOOSTER_DICT),
        "special_cases": len(vs.SPECIAL_CASES),
        "constants": {
            "B_INCR": vs.B_INCR,
            "B_DECR": vs.B_DECR,
            "C_INCR": vs.C_INCR,
            "N_SCALAR": vs.N_SCALAR,
        },
        "spot_check": {w: analyzer.lexicon[w] for w in SPOT if w in analyzer.lexicon},
    },
    sys.stdout,
)
