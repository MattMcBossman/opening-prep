from common.fen import normalize_fen

from .models import PositionFeatureSet
from .position_features import FEATURE_EXTRACTOR_VERSION, extract_position_features


def get_or_create_position_features(fen: str) -> PositionFeatureSet:
    normalized = normalize_fen(fen)
    existing = PositionFeatureSet.objects.filter(
        fen=normalized, extractor_version=FEATURE_EXTRACTOR_VERSION
    ).first()
    if existing:
        return existing
    extracted = extract_position_features(normalized)
    row, _ = PositionFeatureSet.objects.get_or_create(
        fen=normalized,
        extractor_version=FEATURE_EXTRACTOR_VERSION,
        defaults={
            "schema_version": extracted["schemaVersion"],
            "facts": extracted["facts"],
            "checksum": extracted["checksum"],
        },
    )
    return row
