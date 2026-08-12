from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("explorer_cache", "0005_chesscomarchivecache")]

    operations = [
        migrations.AddField(
            model_name="chesscomarchivecache",
            name="indexed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="ChessComGamePosition",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("username", models.CharField(max_length=64)),
                ("archive_key", models.CharField(max_length=7)),
                ("game_key", models.CharField(max_length=255)),
                ("ply", models.PositiveSmallIntegerField()),
                ("player_color", models.CharField(max_length=5)),
                ("time_class", models.CharField(max_length=16)),
                ("played_at", models.DateTimeField()),
                ("origin_fen", models.CharField(max_length=100)),
                ("san", models.CharField(max_length=16)),
                ("uci", models.CharField(max_length=8)),
                ("white", models.PositiveSmallIntegerField(default=0)),
                ("draws", models.PositiveSmallIntegerField(default=0)),
                ("black", models.PositiveSmallIntegerField(default=0)),
            ],
        ),
        migrations.AddConstraint(
            model_name="chesscomgameposition",
            constraint=models.UniqueConstraint(
                fields=("username", "archive_key", "game_key", "ply"),
                name="unique_chesscom_game_position",
            ),
        ),
        migrations.AddIndex(
            model_name="chesscomgameposition",
            index=models.Index(
                fields=["username", "player_color", "origin_fen"],
                name="chesscom_user_color_fen_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="chesscomgameposition",
            index=models.Index(fields=["username", "played_at"], name="chesscom_user_date_idx"),
        ),
    ]
