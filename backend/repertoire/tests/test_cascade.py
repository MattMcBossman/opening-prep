"""
Parity tests for `repertoire/cascade.py` against
`frontend/src/hooks/useRepertoire.ts (18-56)`'s cascade-delete rules. Every
case here should have an equivalent scenario the TS implementation handles the
same way - a behavioural difference is a defect (see API_CONTRACT.md).

FENs below are illustrative placeholders, not real chess positions - the
cascade functions only care about tree structure and `side_to_move` parity, so
this matches the style of the existing `repertoireDrills.test.ts` fixtures.
"""

from common.fen import normalize_fen
from repertoire.cascade import (
    add_move,
    delete_orphaned_subtree,
    prune_responseless_incoming_edges,
    remove_move,
)

ROOT = normalize_fen("start w KQkq -")
AFTER_E4 = normalize_fen("after-e4 b - -")
AFTER_E4_E5 = normalize_fen("after-e4-e5 w - -")
AFTER_NF3 = normalize_fen("after-nf3 b - -")
AFTER_NC6 = normalize_fen("after-nc6 w - -")
AFTER_D4 = normalize_fen("after-d4 b - -")


def edge(san: str, uci: str, resulting_fen: str) -> dict:
    return {"san": san, "uci": uci, "resultingFen": resulting_fen}


class TestAddMove:
    def test_adds_a_new_edge(self):
        tree = {}
        added = add_move(tree, ROOT, edge("e4", "e2e4", AFTER_E4))
        assert added is True
        assert tree == {ROOT: [edge("e4", "e2e4", AFTER_E4)]}

    def test_duplicate_edge_is_a_no_op(self):
        tree = {ROOT: [edge("e4", "e2e4", AFTER_E4)]}
        added = add_move(tree, ROOT, edge("e4", "e2e4", AFTER_E4))
        assert added is False
        assert tree == {ROOT: [edge("e4", "e2e4", AFTER_E4)]}

    def test_second_distinct_edge_is_appended(self):
        tree = {ROOT: [edge("e4", "e2e4", AFTER_E4)]}
        added = add_move(tree, ROOT, edge("d4", "d2d4", AFTER_D4))
        assert added is True
        assert tree[ROOT] == [edge("e4", "e2e4", AFTER_E4), edge("d4", "d2d4", AFTER_D4)]


class TestDeleteOrphanedSubtree:
    def test_deletes_subtree_with_no_other_path_in(self):
        tree = {AFTER_E4: [edge("e5", "e7e5", AFTER_E4_E5)]}
        delete_orphaned_subtree(tree, AFTER_E4)
        assert tree == {}

    def test_recurses_through_multiple_levels(self):
        tree = {
            AFTER_E4: [edge("e5", "e7e5", AFTER_E4_E5)],
            AFTER_E4_E5: [edge("Nf3", "g1f3", AFTER_NF3)],
        }
        delete_orphaned_subtree(tree, AFTER_E4)
        assert tree == {}

    def test_keeps_subtree_still_reachable_via_transposition(self):
        # AFTER_E4_E5 is reachable both from AFTER_E4 (being deleted) and from
        # AFTER_D4 (a different, surviving line) - a transposition.
        tree = {
            AFTER_E4: [edge("e5", "e7e5", AFTER_E4_E5)],
            AFTER_D4: [edge("e5-transposed", "e7e5", AFTER_E4_E5)],
            AFTER_E4_E5: [edge("Nf3", "g1f3", AFTER_NF3)],
        }
        delete_orphaned_subtree(tree, AFTER_E4_E5)
        # AFTER_E4_E5's own subtree survives because AFTER_D4 still points to it.
        assert AFTER_E4_E5 in tree
        assert tree[AFTER_E4_E5] == [edge("Nf3", "g1f3", AFTER_NF3)]

    def test_noop_for_a_leaf_with_no_recorded_children(self):
        tree = {ROOT: [edge("e4", "e2e4", AFTER_E4)]}
        delete_orphaned_subtree(tree, AFTER_E4)
        # AFTER_E4 was never a key (it has no saved continuations), so there's
        # nothing to prune - the edge into it (from ROOT) is untouched here;
        # that's removeMove's job, not deleteOrphanedSubtree's.
        assert tree == {ROOT: [edge("e4", "e2e4", AFTER_E4)]}


class TestPruneResponselessIncomingEdges:
    def test_prunes_opponent_reply_left_with_no_response(self):
        # White's repertoire: after 1.e4 e5, White has no saved reply left.
        # AFTER_E4_E5 is White-to-move, so the now-response-less 1...e5 edge
        # (from AFTER_E4) must be pruned too.
        tree = {ROOT: [edge("e4", "e2e4", AFTER_E4)], AFTER_E4: [edge("e5", "e7e5", AFTER_E4_E5)]}
        prune_responseless_incoming_edges(tree, "white", AFTER_E4_E5)
        assert AFTER_E4 not in tree

    def test_does_not_prune_owners_own_move_with_nothing_prepped_yet(self):
        # AFTER_E4 is Black-to-move (the opponent's turn) - an owner's own
        # move (1.e4) with no opponent reply prepped yet is a normal state.
        tree = {ROOT: [edge("e4", "e2e4", AFTER_E4)]}
        prune_responseless_incoming_edges(tree, "white", AFTER_E4)
        assert tree == {ROOT: [edge("e4", "e2e4", AFTER_E4)]}

    def test_does_not_recurse_past_one_step(self):
        # Removing the response-less 1...e5 edge must not also delete 1.e4
        # (an opponent reply's own parent, one of the owner's moves, is never
        # pruned this way).
        tree = {ROOT: [edge("e4", "e2e4", AFTER_E4)], AFTER_E4: [edge("e5", "e7e5", AFTER_E4_E5)]}
        prune_responseless_incoming_edges(tree, "white", AFTER_E4_E5)
        assert ROOT in tree
        assert tree[ROOT] == [edge("e4", "e2e4", AFTER_E4)]

    def test_leaves_other_incoming_edges_to_the_same_origin_untouched(self):
        # AFTER_NC6 has two edges in (Bb5, Bc4); only the one actually
        # targeting the now-childless position should be removed if others
        # remain, and the origin key is only dropped once it has zero edges.
        tree = {
            AFTER_NF3: [
                edge("Bb5", "f1b5", AFTER_NC6),
                edge("Nc3", "b1c3", AFTER_D4),
            ]
        }
        prune_responseless_incoming_edges(tree, "white", AFTER_NC6)
        assert tree[AFTER_NF3] == [edge("Nc3", "b1c3", AFTER_D4)]


class TestRemoveMove:
    def test_removing_the_only_edge_from_a_position_drops_the_key(self):
        tree = {ROOT: [edge("e4", "e2e4", AFTER_E4)]}
        remove_move(tree, "white", ROOT, "e2e4")
        assert ROOT not in tree

    def test_removing_one_of_several_edges_keeps_the_rest(self):
        tree = {ROOT: [edge("e4", "e2e4", AFTER_E4), edge("d4", "d2d4", AFTER_D4)]}
        remove_move(tree, "white", ROOT, "e2e4")
        assert tree[ROOT] == [edge("d4", "d2d4", AFTER_D4)]

    def test_removing_a_move_deletes_its_now_unreachable_subtree(self):
        tree = {
            ROOT: [edge("e4", "e2e4", AFTER_E4)],
            AFTER_E4: [edge("e5", "e7e5", AFTER_E4_E5)],
            AFTER_E4_E5: [edge("Nf3", "g1f3", AFTER_NF3)],
        }
        remove_move(tree, "white", ROOT, "e2e4")
        assert tree == {}

    def test_transposition_survives_removal_of_one_parent_edge(self):
        # AFTER_NC6 is reachable via two different move orders; removing one
        # of White's moves that leads there must not delete AFTER_NC6 while
        # the other path (via AFTER_D4) still saves a move into it.
        tree = {
            ROOT: [edge("e4", "e2e4", AFTER_E4), edge("d4", "d2d4", AFTER_D4)],
            AFTER_E4: [edge("transposes", "x1x1", AFTER_NC6)],
            AFTER_D4: [edge("transposes", "x2x2", AFTER_NC6)],
            AFTER_NC6: [edge("Bb5", "f1b5", AFTER_NF3)],
        }
        remove_move(tree, "white", ROOT, "e2e4")
        assert AFTER_E4 not in tree
        assert AFTER_NC6 in tree
        assert tree[AFTER_NC6] == [edge("Bb5", "f1b5", AFTER_NF3)]

    def test_removing_owners_move_prunes_now_responseless_opponent_reply(self):
        # White removes 2.Nf3 (their only response to 1...e5); 1...e5 was
        # Black's only saved reply to 1.e4, so it's pruned too, in one step.
        tree = {
            ROOT: [edge("e4", "e2e4", AFTER_E4)],
            AFTER_E4: [edge("e5", "e7e5", AFTER_E4_E5)],
            AFTER_E4_E5: [edge("Nf3", "g1f3", AFTER_NF3)],
        }
        remove_move(tree, "white", AFTER_E4_E5, "g1f3")
        assert AFTER_E4_E5 not in tree
        assert AFTER_E4 not in tree  # pruned: 1...e5 had no response left
        assert ROOT in tree  # but the recursion stops there - 1.e4 survives

    def test_removing_edge_that_does_not_exist_is_a_noop(self):
        tree = {ROOT: [edge("e4", "e2e4", AFTER_E4)]}
        remove_move(tree, "white", ROOT, "d2d4")
        assert tree == {ROOT: [edge("e4", "e2e4", AFTER_E4)]}

    def test_removing_from_a_position_with_no_saved_moves_is_a_noop(self):
        tree = {}
        remove_move(tree, "white", ROOT, "e2e4")
        assert tree == {}
