from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("explorer_cache", "0007_remove_server_player_indexes")]

    operations = [
        migrations.CreateModel(
            name="MainlineOpeningName",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("fen", models.CharField(max_length=100, unique=True)),
                ("name", models.CharField(max_length=255)),
                ("eco", models.CharField(blank=True, max_length=8)),
                ("reference_url", models.URLField(blank=True)),
                ("curator_notes", models.TextField(blank=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["name"]},
        )
    ]
