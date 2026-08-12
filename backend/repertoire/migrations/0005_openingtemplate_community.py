from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("repertoire", "0004_repertoireline_annotations"),
    ]

    operations = [
        migrations.AddField(
            model_name="openingtemplate",
            name="kind",
            field=models.CharField(choices=[("official", "Official"), ("community", "Community")], default="official", max_length=12),
        ),
        migrations.AddField(
            model_name="openingtemplate",
            name="publisher",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="published_opening_templates", to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name="openingtemplate",
            name="source_module",
            field=models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="published_template", to="repertoire.repertoire"),
        ),
    ]
