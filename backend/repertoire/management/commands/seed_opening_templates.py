import chess
from django.core.management.base import BaseCommand

from common.fen import normalize_fen
from repertoire.models import OpeningTemplate, OpeningTemplateRelease

# The authoritative catalog is edited in Render and mirrored to development.
# Do not recreate obsolete toy releases during deploys.
TEMPLATES = []


def build_snapshot(slug: str, uci_lines: list[list[str]]) -> tuple[dict, list]:
    tree: dict[str, list[dict]] = {}
    lines = []
    for index, uci_line in enumerate(uci_lines):
        board = chess.Board()
        steps = []
        for uci in uci_line:
            move = chess.Move.from_uci(uci)
            if move not in board.legal_moves:
                raise ValueError(f"Seed line {slug} contains illegal move {uci}")
            origin = normalize_fen(board.fen(en_passant="legal"))
            san = board.san(move)
            board.push(move)
            resulting = normalize_fen(board.fen(en_passant="legal"))
            edge = {"san": san, "uci": uci, "resultingFen": resulting}
            if not any(existing["uci"] == uci for existing in tree.setdefault(origin, [])):
                tree[origin].append(edge)
            steps.append({"originFen": origin, **edge})
        lines.append(
            {
                "id": f"{slug}-{index + 1}",
                "label": f"Main line {index + 1}",
                "source": "manual",
                "sortOrder": index,
                "steps": steps,
            }
        )
    return tree, lines


class Command(BaseCommand):
    help = "Legacy no-op; the authoritative library is maintained in Render."

    def handle(self, *args, **options):
        created_count = 0
        for definition in TEMPLATES:
            template, _ = OpeningTemplate.objects.update_or_create(
                slug=definition["slug"],
                defaults={
                    "name": definition["name"],
                    "description": definition["description"],
                    "color": definition["color"],
                    "is_published": True,
                },
            )
            if template.releases.filter(version=1).exists():
                self.stdout.write(f"Kept {template.name} v1")
                continue
            tree, lines = build_snapshot(definition["slug"], definition["lines"])
            OpeningTemplateRelease.objects.create(
                template=template,
                version=1,
                changelog="Initial curated starter release.",
                tree=tree,
                lines=lines,
            )
            created_count += 1
            self.stdout.write(self.style.SUCCESS(f"Published {template.name} v1"))
        self.stdout.write(self.style.SUCCESS(f"Created {created_count} release(s)."))
