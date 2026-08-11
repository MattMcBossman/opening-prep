from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("explorer_cache", "0002_playerstatscache_engine_version")]

    operations = [
        migrations.CreateModel(
            name="PositionAnalysis",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("fen", models.CharField(max_length=100)),
                ("engine_version", models.CharField(max_length=64)),
                ("analysis_profile", models.CharField(max_length=64)),
                ("depth", models.PositiveSmallIntegerField()),
                ("multi_pv", models.PositiveSmallIntegerField()),
                ("candidates", models.JSONField(default=list)),
                ("recurring_moves", models.JSONField(default=list)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.AddConstraint(
            model_name="positionanalysis",
            constraint=models.UniqueConstraint(
                fields=("fen", "engine_version", "analysis_profile"), name="unique_position_analysis_key"
            ),
        ),
        migrations.AddIndex(
            model_name="positionanalysis",
            index=models.Index(
                fields=["fen", "engine_version", "analysis_profile"], name="explorer_ca_analysis_key_idx"
            ),
        ),
    ]
