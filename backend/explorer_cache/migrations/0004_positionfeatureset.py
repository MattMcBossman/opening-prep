from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("explorer_cache", "0003_positionanalysis")]

    operations = [
        migrations.CreateModel(
            name="PositionFeatureSet",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("fen", models.CharField(max_length=100)),
                ("schema_version", models.PositiveSmallIntegerField()),
                ("extractor_version", models.CharField(max_length=64)),
                ("facts", models.JSONField(default=list)),
                ("checksum", models.CharField(max_length=64)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.AddConstraint(
            model_name="positionfeatureset",
            constraint=models.UniqueConstraint(
                fields=("fen", "extractor_version"), name="unique_position_feature_set_key"
            ),
        ),
        migrations.AddIndex(
            model_name="positionfeatureset",
            index=models.Index(fields=["fen", "extractor_version"], name="explorer_ca_feature_key_idx"),
        ),
    ]
