from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("explorer_cache", "0006_chesscom_position_index")]

    operations = [
        migrations.DeleteModel(name="ChessComGamePosition"),
        migrations.DeleteModel(name="ChessComArchiveCache"),
        migrations.DeleteModel(name="PlayerStatsCache"),
    ]
