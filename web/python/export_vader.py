"""Export the installed vaderSentiment lexicons for the browser port.

The page runs both scorers the repo can run, so it needs VADER's data as well
as its algorithm. Reading it out of the installed package rather than
transcribing it means the browser and the Python are scoring from the same
7,506 entries, and gate 6 asserts the counts match what the package holds.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

from vaderSentiment import vaderSentiment as vs

analyzer = vs.SentimentIntensityAnalyzer()

json.dump(
    {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "source": "vaderSentiment package, vader_lexicon.txt and emoji_utf8_lexicon.txt",
        "package_version": getattr(vs, "__version__", "unknown"),
        "counts": {"lexicon": len(analyzer.lexicon), "emoji": len(analyzer.emojis)},
        "constants": {
            "B_INCR": vs.B_INCR,
            "B_DECR": vs.B_DECR,
            "C_INCR": vs.C_INCR,
            "N_SCALAR": vs.N_SCALAR,
        },
        "negate": vs.NEGATE,
        "booster": vs.BOOSTER_DICT,
        "special_cases": vs.SPECIAL_CASES,
        "lexicon": analyzer.lexicon,
        "emoji": analyzer.emojis,
    },
    sys.stdout,
    ensure_ascii=False,
    separators=(",", ":"),
)
sys.stdout.write("\n")
