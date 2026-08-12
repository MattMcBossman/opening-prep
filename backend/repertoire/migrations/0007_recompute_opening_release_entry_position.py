from django.db import migrations


def recompute_entry_positions(apps, schema_editor):
    release_model = apps.get_model("repertoire", "OpeningTemplateRelease")
    for release in release_model.objects.select_related("template").all().iterator():
        lines = release.lines or []
        step_lines = [line.get("steps", []) for line in lines]
        common = []
        for steps in zip(*step_lines, strict=False):
            first = steps[0]
            if any(step.get("uci") != first.get("uci") for step in steps[1:]):
                break
            common.append(str(first.get("san", "")))
        entry_plies = 3 if release.template.color == "white" else 2
        tokens = []
        for ply, san in enumerate(common[:entry_plies]):
            if ply % 2 == 0:
                tokens.extend([f"{ply // 2 + 1}.", san])
            else:
                tokens.append(san)
        release_model.objects.filter(pk=release.pk).update(common_start=" ".join(tokens))


class Migration(migrations.Migration):
    dependencies = [("repertoire", "0006_opening_release_summary")]

    operations = [
        migrations.RunPython(recompute_entry_positions, migrations.RunPython.noop),
    ]
