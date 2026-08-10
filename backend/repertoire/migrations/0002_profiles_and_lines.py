import hashlib
import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"


def _enumerate_paths(edges_by_origin):
    paths = []

    def walk(fen, steps, visited):
        edges = edges_by_origin.get(fen, [])
        if not edges:
            if steps:
                paths.append(steps)
            return
        advanced = False
        for edge in edges:
            if edge.resulting_fen in visited:
                continue
            advanced = True
            walk(edge.resulting_fen, [*steps, edge], {*visited, fen})
        if not advanced and steps:
            paths.append(steps)

    walk(START_FEN, [], set())
    return paths


def migrate_existing_repertoires(apps, schema_editor):
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    Repertoire = apps.get_model("repertoire", "Repertoire")
    RepertoireMove = apps.get_model("repertoire", "RepertoireMove")
    RepertoireProfile = apps.get_model("repertoire", "RepertoireProfile")
    ProfileModule = apps.get_model("repertoire", "ProfileModule")
    RepertoireLine = apps.get_model("repertoire", "RepertoireLine")
    RepertoireLineStep = apps.get_model("repertoire", "RepertoireLineStep")

    for user in User.objects.all().iterator():
        profile = RepertoireProfile.objects.create(owner_id=user.pk, name="Default")
        modules = list(Repertoire.objects.filter(owner_id=user.pk).order_by("id"))
        for module_order, repertoire in enumerate(modules):
            ProfileModule.objects.create(
                profile_id=profile.pk,
                module_id=repertoire.pk,
                sort_order=module_order,
            )

            moves = list(RepertoireMove.objects.filter(repertoire_id=repertoire.pk).order_by("id"))
            edges_by_origin = {}
            origin_counts = {}
            for move in moves:
                move.sort_order = origin_counts.get(move.origin_fen, 0)
                origin_counts[move.origin_fen] = move.sort_order + 1
                move.save(update_fields=["sort_order"])
                edges_by_origin.setdefault(move.origin_fen, []).append(move)

            for line_order, path in enumerate(_enumerate_paths(edges_by_origin)):
                uci_path = " ".join(move.uci for move in path)
                line = RepertoireLine.objects.create(
                    id=uuid.uuid4(),
                    repertoire_id=repertoire.pk,
                    line_key=hashlib.sha256(uci_path.encode()).hexdigest(),
                    uci_path=uci_path,
                    source="migrated",
                    sort_order=line_order,
                )
                RepertoireLineStep.objects.bulk_create(
                    RepertoireLineStep(line_id=line.pk, ply=ply, move_id=move.pk)
                    for ply, move in enumerate(path)
                )


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("repertoire", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="repertoire",
            name="description",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="repertoiremove",
            name="sort_order",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AlterModelOptions(
            name="repertoiremove",
            options={"ordering": ["origin_fen", "sort_order", "id"]},
        ),
        migrations.CreateModel(
            name="RepertoireProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=100)),
                ("description", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="repertoire_profiles",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["id"]},
        ),
        migrations.CreateModel(
            name="RepertoireLine",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("line_key", models.CharField(max_length=64)),
                ("uci_path", models.TextField()),
                ("label", models.CharField(blank=True, max_length=150)),
                (
                    "source",
                    models.CharField(
                        choices=[("manual", "Manual"), ("pgn_import", "PGN import"), ("migrated", "Migrated graph")],
                        default="manual",
                        max_length=16,
                    ),
                ),
                ("sort_order", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "repertoire",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="lines",
                        to="repertoire.repertoire",
                    ),
                ),
            ],
            options={"ordering": ["sort_order", "id"]},
        ),
        migrations.CreateModel(
            name="ProfileModule",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("sort_order", models.PositiveIntegerField(default=0)),
                ("enabled", models.BooleanField(default=True)),
                (
                    "module",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="profile_links",
                        to="repertoire.repertoire",
                    ),
                ),
                (
                    "profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="module_links",
                        to="repertoire.repertoireprofile",
                    ),
                ),
            ],
            options={"ordering": ["sort_order", "id"]},
        ),
        migrations.CreateModel(
            name="RepertoireLineStep",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("ply", models.PositiveIntegerField()),
                (
                    "line",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="steps",
                        to="repertoire.repertoireline",
                    ),
                ),
                (
                    "move",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="line_steps",
                        to="repertoire.repertoiremove",
                    ),
                ),
            ],
            options={"ordering": ["ply"]},
        ),
        migrations.AddConstraint(
            model_name="repertoireprofile",
            constraint=models.UniqueConstraint(fields=("owner", "name"), name="unique_profile_name_per_owner"),
        ),
        migrations.AddConstraint(
            model_name="profilemodule",
            constraint=models.UniqueConstraint(fields=("profile", "module"), name="unique_module_per_profile"),
        ),
        migrations.AddConstraint(
            model_name="repertoireline",
            constraint=models.UniqueConstraint(fields=("repertoire", "line_key"), name="unique_line_per_module"),
        ),
        migrations.AddConstraint(
            model_name="repertoirelinestep",
            constraint=models.UniqueConstraint(fields=("line", "ply"), name="unique_ply_per_line"),
        ),
        migrations.RunPython(migrate_existing_repertoires, migrations.RunPython.noop),
    ]
