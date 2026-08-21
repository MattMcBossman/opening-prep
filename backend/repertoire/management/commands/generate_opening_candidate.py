import os
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from repertoire.opening_generator import (
    GenerationError,
    GeneratorConfig,
    LichessPositionSource,
    StockfishEvaluator,
    generate_candidate,
)


class Command(BaseCommand):
    help = "Generate a reviewable opening-module PGN candidate from Lichess explorer data."

    def add_arguments(self, parser):
        parser.add_argument("--name", required=True)
        parser.add_argument("--color", required=True, choices=("white", "black"))
        parser.add_argument(
            "--prefix",
            nargs="+",
            required=True,
            help="Opening move prefix from the initial position, in SAN and/or UCI.",
        )
        parser.add_argument("--output", required=True, type=Path)
        parser.add_argument("--report", type=Path)
        parser.add_argument("--ratings", help="Comma-separated Lichess rating buckets.")
        parser.add_argument("--speeds", help="Comma-separated Lichess speed filters.")
        parser.add_argument("--coverage", type=float, default=0.60)
        parser.add_argument("--max-lines", type=int, default=50)
        parser.add_argument("--max-ply", type=int, default=24)
        parser.add_argument("--min-games", type=int, default=20)
        parser.add_argument("--min-frequency", type=float, default=0.01)
        parser.add_argument("--max-opponent-replies", type=int, default=8)
        parser.add_argument("--stockfish", help="Optional path to a Stockfish executable.")
        parser.add_argument("--engine-depth", type=int, default=16)
        parser.add_argument("--max-engine-loss-cp", type=int, default=35)
        parser.add_argument("--engine-candidates", type=int, default=5)

    def handle(self, *args, **options):
        token = os.environ.get("LICHESS_SERVER_TOKEN", "").strip()
        if not token:
            raise CommandError("Set LICHESS_SERVER_TOKEN before generating a candidate.")

        config = GeneratorConfig(
            name=options["name"],
            color=options["color"],
            coverage=options["coverage"],
            max_lines=options["max_lines"],
            max_ply=options["max_ply"],
            min_games=options["min_games"],
            min_frequency=options["min_frequency"],
            max_opponent_replies=options["max_opponent_replies"],
            max_engine_loss_cp=options["max_engine_loss_cp"],
            engine_candidates=options["engine_candidates"],
        )
        source = LichessPositionSource(
            settings.LICHESS_EXPLORER_URL,
            token,
            ratings=options["ratings"],
            speeds=options["speeds"],
        )
        evaluator = None
        try:
            if options["stockfish"]:
                evaluator = StockfishEvaluator(
                    options["stockfish"],
                    options["color"] == "white",
                    depth=options["engine_depth"],
                )
            result = generate_candidate(options["prefix"], config, source, evaluator)
            output, report = result.write(options["output"], options["report"])
        except (GenerationError, OSError) as exc:
            raise CommandError(str(exc)) from exc
        finally:
            if evaluator:
                evaluator.close()

        self.stdout.write(
            self.style.SUCCESS(
                f"Generated {len(result.lines)} leaf lines in {output}; review report written to {report}."
            )
        )
