from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class ComposableRepertoireMigrationTests(TransactionTestCase):
    """Exercise the populated Phase 4 schema upgrade, not only fresh installs."""

    reset_sequences = True

    migrate_from = [("repertoire", "0001_initial"), ("drills", "0001_initial")]

    def setUp(self):
        super().setUp()
        executor = MigrationExecutor(connection)
        executor.migrate(self.migrate_from)
        old_apps = executor.loader.project_state(self.migrate_from).apps

        User = old_apps.get_model("accounts", "User")
        Repertoire = old_apps.get_model("repertoire", "Repertoire")
        Move = old_apps.get_model("repertoire", "RepertoireMove")
        Session = old_apps.get_model("drills", "DrillSession")

        user = User.objects.create(username="migration-user")
        white = Repertoire.objects.create(owner_id=user.pk, name="Default", color="white")
        black = Repertoire.objects.create(owner_id=user.pk, name="Default", color="black")

        start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
        after_e4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3"
        after_e5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6"
        after_d4 = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3"
        first = Move.objects.create(
            repertoire_id=white.pk,
            origin_fen=start,
            san="e4",
            uci="e2e4",
            resulting_fen=after_e4,
        )
        second = Move.objects.create(
            repertoire_id=white.pk,
            origin_fen=after_e4,
            san="e5",
            uci="e7e5",
            resulting_fen=after_e5,
        )
        third = Move.objects.create(
            repertoire_id=white.pk,
            origin_fen=start,
            san="d4",
            uci="d2d4",
            resulting_fen=after_d4,
        )
        session = Session.objects.create(user_id=user.pk, repertoire_id=white.pk)

        self.ids = {
            "user": user.pk,
            "white": white.pk,
            "black": black.pk,
            "first": first.pk,
            "second": second.pk,
            "third": third.pk,
            "session": session.pk,
        }

        executor = MigrationExecutor(connection)
        self.latest_targets = executor.loader.graph.leaf_nodes()
        executor.migrate(self.latest_targets)
        self.apps = executor.loader.project_state(self.latest_targets).apps

    def tearDown(self):
        # Leave the schema at the current migration leaves for following tests,
        # even when an assertion fails after the backwards migration in setUp.
        MigrationExecutor(connection).migrate(MigrationExecutor(connection).loader.graph.leaf_nodes())
        super().tearDown()

    def test_populated_graph_and_drill_session_are_backfilled(self):
        Profile = self.apps.get_model("repertoire", "RepertoireProfile")
        ProfileModule = self.apps.get_model("repertoire", "ProfileModule")
        Move = self.apps.get_model("repertoire", "RepertoireMove")
        Line = self.apps.get_model("repertoire", "RepertoireLine")
        LineStep = self.apps.get_model("repertoire", "RepertoireLineStep")
        Session = self.apps.get_model("drills", "DrillSession")
        SessionSource = self.apps.get_model("drills", "DrillSessionRepertoire")

        profile = Profile.objects.get(owner_id=self.ids["user"], name="Default")
        links = list(
            ProfileModule.objects.filter(profile_id=profile.pk)
            .order_by("sort_order")
            .values_list("module_id", "sort_order", "enabled")
        )
        self.assertEqual(
            links,
            [
                (self.ids["white"], 0, True),
                (self.ids["black"], 1, True),
            ],
        )

        # Existing ids survive, deterministic edge order is populated, and the
        # old branched graph becomes stable explicit root-to-leaf paths.
        migrated_moves = dict(
            Move.objects.filter(repertoire_id=self.ids["white"]).values_list("id", "sort_order")
        )
        self.assertEqual(
            migrated_moves,
            {self.ids["first"]: 0, self.ids["second"]: 0, self.ids["third"]: 1},
        )
        line = Line.objects.get(repertoire_id=self.ids["white"], uci_path="e2e4 e7e5")
        self.assertEqual(line.uci_path, "e2e4 e7e5")
        self.assertEqual(line.source, "migrated")
        self.assertEqual(
            list(LineStep.objects.filter(line_id=line.pk).values_list("ply", "move_id")),
            [(0, self.ids["first"]), (1, self.ids["second"])],
        )
        sibling = Line.objects.get(repertoire_id=self.ids["white"], uci_path="d2d4")
        self.assertEqual(sibling.sort_order, 1)
        self.assertEqual(
            list(LineStep.objects.filter(line_id=sibling.pk).values_list("ply", "move_id")),
            [(0, self.ids["third"])],
        )

        session = Session.objects.get(pk=self.ids["session"])
        self.assertEqual(session.repertoire_id, self.ids["white"])
        self.assertEqual(session.start_mode, "beginning")
        self.assertEqual(session.prefix_uci, [])
        self.assertIsNone(session.selected_fen)
        self.assertIsNone(session.selected_ply)
        self.assertTrue(
            SessionSource.objects.filter(session_id=session.pk, repertoire_id=self.ids["white"]).exists()
        )
