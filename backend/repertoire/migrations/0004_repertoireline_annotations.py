from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("repertoire", "0003_openingtemplate_openingtemplaterelease_and_more")]

    operations = [
        migrations.AddField(
            model_name="repertoireline",
            name="annotations",
            field=models.JSONField(blank=True, default=list),
        )
    ]
