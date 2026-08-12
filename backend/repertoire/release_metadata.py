def format_san_line(sans: list[str]) -> str:
    tokens: list[str] = []
    for ply, san in enumerate(sans):
        if ply % 2 == 0:
            tokens.extend([f"{ply // 2 + 1}.", san])
        else:
            tokens.append(san)
    return " ".join(tokens)


def release_summary(lines: list[dict], color: str | None = None) -> tuple[str, int]:
    if not lines:
        return "", 0
    step_lines = [line.get("steps", []) for line in lines]
    common: list[str] = []
    for steps in zip(*step_lines, strict=False):
        first = steps[0]
        if any(step.get("uci") != first.get("uci") for step in steps[1:]):
            break
        common.append(str(first.get("san", "")))
    entry_plies = 3 if color == "white" else 2 if color == "black" else len(common)
    return format_san_line(common[:entry_plies]), len(lines)


def repertoire_summary(repertoire) -> tuple[str, int]:
    lines = []
    for line in repertoire.lines.all():
        lines.append({"steps": [{"uci": step.move.uci, "san": step.move.san} for step in line.steps.all()]})
    return release_summary(lines, repertoire.color)
