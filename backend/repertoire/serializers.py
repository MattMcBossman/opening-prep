"""DRF serializers for the repertoire app. See backend/API_CONTRACT.md for the shapes."""

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from . import services
from .models import (
    OpeningTemplate,
    OpeningTemplateRelease,
    ProfileModule,
    ProfileTemplateRelease,
    Repertoire,
    RepertoireLine,
    RepertoireLineStep,
    RepertoireProfile,
)


class RepertoireSerializer(serializers.ModelSerializer):
    """Shape for `GET/POST /repertoires/` - counts are computed, not stored."""

    moveCount = serializers.IntegerField(source="moves.count", read_only=True)
    lineCount = serializers.IntegerField(source="lines.count", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)
    description = serializers.CharField(required=False, allow_blank=True)
    hasResponseConflicts = serializers.SerializerMethodField()

    def get_hasResponseConflicts(self, obj):
        return bool(services.legacy_response_conflicts(obj))

    class Meta:
        model = Repertoire
        fields = [
            "id",
            "name",
            "description",
            "color",
            "moveCount",
            "lineCount",
            "hasResponseConflicts",
            "source_release",
            "createdAt",
            "updatedAt",
        ]
        read_only_fields = ["source_release"]


class ProfileModuleSerializer(serializers.ModelSerializer):
    """One module membership nested in a profile response."""

    id = serializers.IntegerField(source="module.id", read_only=True)
    name = serializers.CharField(source="module.name", read_only=True)
    description = serializers.CharField(source="module.description", read_only=True)
    color = serializers.CharField(source="module.color", read_only=True)
    moveCount = serializers.IntegerField(source="module.moves.count", read_only=True)
    lineCount = serializers.IntegerField(source="module.lines.count", read_only=True)
    hasResponseConflicts = serializers.SerializerMethodField()

    def get_hasResponseConflicts(self, obj):
        return bool(services.legacy_response_conflicts(obj.module))

    sortOrder = serializers.IntegerField(source="sort_order")

    class Meta:
        model = ProfileModule
        fields = [
            "id",
            "name",
            "description",
            "color",
            "moveCount",
            "lineCount",
            "hasResponseConflicts",
            "sortOrder",
            "enabled",
        ]


class RepertoireProfileSerializer(serializers.ModelSerializer):
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)
    modules = ProfileModuleSerializer(source="module_links", many=True, read_only=True)
    templateReleases = serializers.SerializerMethodField()

    @extend_schema_field({"type": "array", "items": {"type": "object"}})
    def get_templateReleases(self, obj):
        return ProfileTemplateReleaseSerializer(obj.template_links.all(), many=True).data

    class Meta:
        model = RepertoireProfile
        fields = ["id", "name", "description", "modules", "templateReleases", "createdAt", "updatedAt"]


class ProfileTemplateReleaseSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source="release.id", read_only=True)
    templateSlug = serializers.CharField(source="release.template.slug", read_only=True)
    name = serializers.CharField(source="release.template.name", read_only=True)
    color = serializers.CharField(source="release.template.color", read_only=True)
    version = serializers.IntegerField(source="release.version", read_only=True)
    sortOrder = serializers.IntegerField(source="sort_order")

    class Meta:
        model = ProfileTemplateRelease
        fields = ["id", "templateSlug", "name", "color", "version", "sortOrder", "enabled"]


class ProfileModuleMutationSerializer(serializers.Serializer):
    moduleId = serializers.IntegerField(min_value=1)
    sortOrder = serializers.IntegerField(required=False, min_value=0, default=0)
    enabled = serializers.BooleanField(required=False, default=True)


class ProfileTemplateMutationSerializer(serializers.Serializer):
    templateReleaseId = serializers.IntegerField(min_value=1)
    sortOrder = serializers.IntegerField(required=False, min_value=0, default=0)
    enabled = serializers.BooleanField(required=False, default=True)


class OpeningTemplateReleaseSerializer(serializers.ModelSerializer):
    templateSlug = serializers.CharField(source="template.slug", read_only=True)
    name = serializers.CharField(source="template.name", read_only=True)
    color = serializers.CharField(source="template.color", read_only=True)
    publishedAt = serializers.DateTimeField(source="published_at", read_only=True)

    class Meta:
        model = OpeningTemplateRelease
        fields = [
            "id",
            "templateSlug",
            "name",
            "color",
            "version",
            "changelog",
            "tree",
            "lines",
            "publishedAt",
        ]


class OpeningTemplateSerializer(serializers.ModelSerializer):
    latestRelease = serializers.SerializerMethodField()
    publisherName = serializers.SerializerMethodField()

    @extend_schema_field(OpeningTemplateReleaseSerializer)
    def get_latestRelease(self, obj):
        release = obj.releases.order_by("-version").first()
        return OpeningTemplateReleaseSerializer(release).data if release else None

    def get_publisherName(self, obj):
        if obj.kind == OpeningTemplate.OFFICIAL:
            return "Mainline"
        return obj.publisher.username if obj.publisher else "Former member"

    class Meta:
        model = OpeningTemplate
        fields = ["slug", "name", "description", "color", "kind", "publisherName", "latestRelease"]


class PublishTemplateSerializer(serializers.Serializer):
    moduleId = serializers.IntegerField(min_value=1)
    changelog = serializers.CharField(required=False, allow_blank=True, max_length=1000)


class CopyTemplateSerializer(serializers.Serializer):
    name = serializers.CharField(required=False, max_length=100)
    profileId = serializers.IntegerField(required=False, min_value=1)


class CopyMissingTemplateLinesSerializer(serializers.Serializer):
    moduleId = serializers.IntegerField(min_value=1)


class RepertoireLineStepSerializer(serializers.ModelSerializer):
    originFen = serializers.CharField(source="move.origin_fen", read_only=True)
    san = serializers.CharField(source="move.san", read_only=True)
    uci = serializers.CharField(source="move.uci", read_only=True)
    resultingFen = serializers.CharField(source="move.resulting_fen", read_only=True)

    class Meta:
        model = RepertoireLineStep
        fields = ["ply", "originFen", "san", "uci", "resultingFen"]


class RepertoireLineSerializer(serializers.ModelSerializer):
    """Read shape for the explicit move-order lines currently derived from the graph."""

    lineKey = serializers.CharField(source="line_key", read_only=True)
    uciPath = serializers.CharField(source="uci_path", read_only=True)
    sortOrder = serializers.IntegerField(source="sort_order", read_only=True)
    steps = RepertoireLineStepSerializer(many=True, read_only=True)

    class Meta:
        model = RepertoireLine
        fields = ["id", "lineKey", "uciPath", "label", "annotations", "source", "sortOrder", "steps"]


class TreeEdgeSerializer(serializers.Serializer):
    """One `RepertoireMove` as it appears inside a `RepertoireTree` value - no
    `originFen`, since that's the dict key it's nested under."""

    san = serializers.CharField()
    uci = serializers.CharField()
    resultingFen = serializers.CharField()


class MoveInputSerializer(TreeEdgeSerializer):
    """One edge in the `POST .../moves/` body, which - unlike a tree value -
    needs its own origin since it isn't nested under one."""

    originFen = serializers.CharField()


class AddMovesSerializer(serializers.Serializer):
    moves = MoveInputSerializer(many=True)


class LineAnnotationInputSerializer(serializers.Serializer):
    ply = serializers.IntegerField(min_value=0)
    comment = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    nags = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=255), required=False, default=list
    )


class AuthoredLineInputSerializer(serializers.Serializer):
    conflictPolicy = serializers.ChoiceField(
        source="conflict_policy", choices=("reject", "replace"), required=False, default="reject"
    )
    label = serializers.CharField(required=False, allow_blank=True, max_length=150, default="")
    source = serializers.ChoiceField(choices=RepertoireLine.SOURCE_CHOICES, required=False, default="manual")
    annotations = LineAnnotationInputSerializer(many=True, required=False, default=list)
    steps = MoveInputSerializer(many=True, allow_empty=False)

    def validate(self, attrs):
        step_count = len(attrs["steps"])
        plies = [item["ply"] for item in attrs["annotations"]]
        if any(ply >= step_count for ply in plies):
            raise serializers.ValidationError({"annotations": "Annotation ply is outside the line."})
        if len(plies) != len(set(plies)):
            raise serializers.ValidationError(
                {"annotations": "Only one annotation entry is allowed per ply."}
            )
        return attrs


class RemoveMoveSerializer(serializers.Serializer):
    originFen = serializers.CharField()
    uci = serializers.CharField()


class ImportSerializer(serializers.Serializer):
    """Body of `POST /repertoires/import/`: the two trees exactly as
    `useRepertoire`'s localStorage shape stores them, e.g.
    `{"white": {"<fen>": [{san, uci, resultingFen}]}}`."""

    white = serializers.DictField(child=TreeEdgeSerializer(many=True), required=False, default=dict)
    black = serializers.DictField(child=TreeEdgeSerializer(many=True), required=False, default=dict)


class ImportCountsSerializer(serializers.Serializer):
    """Documentation-only: one color's entry in `POST /repertoires/import/`'s response."""

    imported = serializers.IntegerField()
    skipped = serializers.IntegerField()


class ImportResponseSerializer(serializers.Serializer):
    """Documentation-only: `import_tree`/the view build this dict by hand rather
    than via a serializer, so this exists purely to describe it to drf-spectacular."""

    white = ImportCountsSerializer()
    black = ImportCountsSerializer()
