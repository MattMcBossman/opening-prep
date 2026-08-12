from repertoire.release_metadata import release_summary


def test_release_summary_finds_common_numbered_start_and_line_count():
    lines = [
        {
            "steps": [
                {"uci": "e2e4", "san": "e4"},
                {"uci": "e7e5", "san": "e5"},
                {"uci": "b1c3", "san": "Nc3"},
                {"uci": "g8f6", "san": "Nf6"},
            ]
        },
        {
            "steps": [
                {"uci": "e2e4", "san": "e4"},
                {"uci": "e7e5", "san": "e5"},
                {"uci": "b1c3", "san": "Nc3"},
                {"uci": "f8c5", "san": "Bc5"},
            ]
        },
    ]

    assert release_summary(lines, "white") == ("1. e4 e5 2. Nc3", 2)


def test_release_summary_handles_empty_release():
    assert release_summary([]) == ("", 0)
