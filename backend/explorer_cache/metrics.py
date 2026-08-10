"""Structured cache events suitable for log-based counters and dashboards."""

import json
import logging

logger = logging.getLogger("opening_prep.cache")


def cache_event(cache_name: str, outcome: str, **dimensions) -> None:
    logger.info(
        "cache_event %s",
        json.dumps({"cache": cache_name, "outcome": outcome, **dimensions}, sort_keys=True),
    )
