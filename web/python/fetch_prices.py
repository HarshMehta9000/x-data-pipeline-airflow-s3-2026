"""Pull the prices the cost model uses from the AWS Price List API.

Not from a blog post, not from memory. Each entry keeps the SKU, the unit, the
publication date of the offer file it came from and the URL it was read from, so
the number on the page can be traced to its source. gate 4 checks that every
price carries that provenance and re-derives the arithmetic independently.

Run: python python/fetch_prices.py > data/prices.json
"""
from __future__ import annotations

import json
import sys
import urllib.request
from datetime import datetime, timezone

BASE = "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws"
REGION = "us-east-1"
LOCATION = "US East (N. Virginia)"


def fetch(service: str) -> dict:
    url = f"{BASE}/{service}/current/{REGION}/index.json"
    with urllib.request.urlopen(url, timeout=60) as fh:
        return json.loads(fh.read().decode("utf-8")), url


def first_dimension(offer: dict, sku: str) -> dict:
    for term in offer["terms"]["OnDemand"].get(sku, {}).values():
        for dim in term["priceDimensions"].values():
            return dim
    raise KeyError(sku)


def main() -> None:
    s3, s3_url = fetch("AmazonS3")
    athena, athena_url = fetch("AmazonAthena")

    entries = {}

    for sku, product in s3["products"].items():
        attrs = product.get("attributes", {})
        if attrs.get("location") != LOCATION:
            continue
        family = product.get("productFamily")
        usage = attrs.get("usagetype", "")

        if (
            family == "Storage"
            and attrs.get("storageClass") == "General Purpose"
            and attrs.get("volumeType") == "Standard"
            and usage == "TimedStorage-ByteHrs"
        ):
            dim = first_dimension(s3, sku)
            entries["s3_standard_storage_gb_month"] = {
                "value": float(dim["pricePerUnit"]["USD"]),
                "unit": "USD per GB-month",
                "description": dim["description"],
                "sku": sku,
                "service": "Amazon S3",
                "region": REGION,
                "tier": f'{dim.get("beginRange")} to {dim.get("endRange")} GB',
                "source_url": s3_url,
                "offer_published": s3.get("publicationDate"),
            }

        if family == "API Request" and usage == "Requests-Tier1":
            dim = first_dimension(s3, sku)
            entries["s3_put_request"] = {
                "value": float(dim["pricePerUnit"]["USD"]),
                "unit": "USD per request",
                "description": dim["description"],
                "sku": sku,
                "service": "Amazon S3",
                "region": REGION,
                "source_url": s3_url,
                "offer_published": s3.get("publicationDate"),
            }

        if family == "API Request" and usage == "Requests-Tier2":
            dim = first_dimension(s3, sku)
            entries["s3_get_request"] = {
                "value": float(dim["pricePerUnit"]["USD"]),
                "unit": "USD per request",
                "description": dim["description"],
                "sku": sku,
                "service": "Amazon S3",
                "region": REGION,
                "source_url": s3_url,
                "offer_published": s3.get("publicationDate"),
            }

    for sku, product in athena["products"].items():
        attrs = product.get("attributes", {})
        if attrs.get("location") != LOCATION:
            continue
        if attrs.get("usagetype") != "USE1-DataScannedInTB":
            continue
        dim = first_dimension(athena, sku)
        entries["athena_tb_scanned"] = {
            "value": float(dim["pricePerUnit"]["USD"]),
            "unit": "USD per TB scanned",
            "description": dim["description"],
            "sku": sku,
            "service": "Amazon Athena",
            "region": REGION,
            "source_url": athena_url,
            "offer_published": athena.get("publicationDate"),
        }

    missing = {
        "s3_standard_storage_gb_month",
        "s3_put_request",
        "s3_get_request",
        "athena_tb_scanned",
    } - set(entries)
    if missing:
        raise SystemExit(f"missing prices: {sorted(missing)}")

    json.dump(
        {
            "version": 1,
            "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "produced_by": "web/python/fetch_prices.py",
            "note": (
                "On demand list prices from the AWS Price List API for us-east-1. "
                "No per query minimum is applied to the Athena figure, because the "
                "pricing page and the FAQ do not state one, so the query cost here "
                "is a lower bound. Storage is charged on the average stored volume "
                "over the month; the model charges the volume standing at the end "
                "of the simulated period, which overstates a lake that is still "
                "filling."
            ),
            "prices": entries,
        },
        sys.stdout,
        indent=2,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
