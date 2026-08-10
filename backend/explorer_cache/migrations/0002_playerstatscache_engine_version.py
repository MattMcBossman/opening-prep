from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("accounts", "0001_initial"), ("explorer_cache", "0001_initial")]

    operations = [
        migrations.AlterField(
            model_name="enginelinecache",
            name="fen",
            field=models.CharField(max_length=100),
        ),
        migrations.AddField(
            model_name="enginelinecache",
            name="engine_version",
            field=models.CharField(default="stockfish-18-lite-single", max_length=64),
        ),
        migrations.AddConstraint(
            model_name="enginelinecache",
            constraint=models.UniqueConstraint(
                fields=("fen", "engine_version"), name="unique_engine_line_cache_key"
            ),
        ),
        migrations.AddIndex(
            model_name="enginelinecache",
            index=models.Index(fields=["fen", "engine_version"], name="explorer_ca_fen_engi_idx"),
        ),
        migrations.CreateModel(
            name="PlayerStatsCache",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("fen", models.CharField(max_length=100)),
                ("color", models.CharField(max_length=5)),
                ("params_key", models.CharField(max_length=64)),
                ("response", models.JSONField()),
                ("fetched_at", models.DateTimeField(auto_now=True)),
                ("expires_at", models.DateTimeField()),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="accounts.user")),
            ],
        ),
        migrations.AddConstraint(
            model_name="playerstatscache",
            constraint=models.UniqueConstraint(
                fields=("user", "fen", "color", "params_key"), name="unique_player_stats_cache_key"
            ),
        ),
        migrations.AddIndex(
            model_name="playerstatscache",
            index=models.Index(
                fields=["user", "fen", "color", "params_key"], name="explorer_ca_user_id_fen_idx"
            ),
        ),
    ]
