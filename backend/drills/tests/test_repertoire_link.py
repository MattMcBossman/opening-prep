"""
Tests for drills/repertoire_link.py.

The interesting cases are the authorization ones: a `repertoireId` arrives in a
request body, so nothing stops a client naming an id it doesn't own.
"""

import pytest
from rest_framework.exceptions import ValidationError

from accounts.models import User
from drills.repertoire_link import resolve_repertoire_id
from repertoire.models import Repertoire


@pytest.fixture
def user(db):
    return User.objects.create_user(username="alice", password="x")


@pytest.fixture
def other_user(db):
    return User.objects.create_user(username="bob", password="x")


@pytest.fixture
def repertoire(user):
    return Repertoire.objects.create(owner=user, name="Default", color=Repertoire.WHITE)


def test_own_repertoire_is_accepted(user, repertoire):
    assert resolve_repertoire_id(repertoire.id, user) == repertoire.id


def test_numeric_string_is_coerced(user, repertoire):
    assert resolve_repertoire_id(str(repertoire.id), user) == repertoire.id


def test_another_users_repertoire_is_rejected(other_user, repertoire):
    """The whole point of this module: ids are not capabilities."""
    with pytest.raises(ValidationError):
        resolve_repertoire_id(repertoire.id, other_user)


def test_nonexistent_repertoire_is_rejected(user):
    with pytest.raises(ValidationError):
        resolve_repertoire_id(999999, user)


def test_rejection_does_not_reveal_whether_the_id_exists(other_user, repertoire):
    """
    A caller must not be able to tell "someone else owns this" apart from
    "nothing here", or the endpoint becomes an existence oracle for ids.
    """
    with pytest.raises(ValidationError) as taken:
        resolve_repertoire_id(repertoire.id, other_user)
    with pytest.raises(ValidationError) as absent:
        resolve_repertoire_id(999999, other_user)
    assert taken.value.detail == absent.value.detail


def test_non_integer_is_rejected(user):
    with pytest.raises(ValidationError):
        resolve_repertoire_id("not-a-number", user)


def test_zero_is_rejected(user):
    with pytest.raises(ValidationError):
        resolve_repertoire_id(0, user)


def test_negative_is_rejected(user):
    with pytest.raises(ValidationError):
        resolve_repertoire_id(-1, user)
