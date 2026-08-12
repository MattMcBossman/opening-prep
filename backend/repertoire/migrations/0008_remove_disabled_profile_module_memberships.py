from django.db import migrations


def remove_disabled_memberships(apps, schema_editor):
    profile_module = apps.get_model("repertoire", "ProfileModule")
    profile_module.objects.filter(enabled=False).delete()


class Migration(migrations.Migration):
    dependencies = [("repertoire", "0007_recompute_opening_release_entry_position")]

    operations = [
        migrations.RunPython(remove_disabled_memberships, migrations.RunPython.noop),
    ]
