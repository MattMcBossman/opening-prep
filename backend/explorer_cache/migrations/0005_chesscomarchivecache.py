from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("explorer_cache", "0004_positionfeatureset")]

    operations = [
        migrations.CreateModel(
            name="ChessComArchiveCache",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("username", models.CharField(max_length=64)),
                ("archive_key", models.CharField(max_length=7)),
                ("response", models.JSONField()),
                ("fetched_at", models.DateTimeField(auto_now=True)),
                ("expires_at", models.DateTimeField()),
            ],
        ),
        migrations.AddConstraint(
            model_name="chesscomarchivecache",
            constraint=models.UniqueConstraint(
                fields=("username", "archive_key"), name="unique_chesscom_archive_cache_key"
            ),
        ),
    ]
