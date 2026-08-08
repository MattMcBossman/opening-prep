"""
Tests for drills/repertoire_link.py. `repertoire.models.Repertoire` doesn't
exist on this branch yet (see the module docstring), so these cover the
interim shape-validation behaviour; the lead adds ownership-check coverage
once the real model lands.
"""

import pytest
from rest_framework.exceptions import ValidationError

from accounts.models import User
from drills.repertoire_link import resolve_repertoire_id


@pytest.fixture
def user(db):
    return User.objects.create_user(username="alice", password="x")


def test_valid_positive_int_is_accepted(user):
    assert resolve_repertoire_id(3, user) == 3


def test_numeric_string_is_coerced(user):
    assert resolve_repertoire_id("3", user) == 3


def test_non_integer_is_rejected(user):
    with pytest.raises(ValidationError):
        resolve_repertoire_id("not-a-number", user)


def test_zero_is_rejected(user):
    with pytest.raises(ValidationError):
        resolve_repertoire_id(0, user)


def test_negative_is_rejected(user):
    with pytest.raises(ValidationError):
        resolve_repertoire_id(-1, user)
