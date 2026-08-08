"""DRF serializers for the accounts app. See backend/API_CONTRACT.md for the shapes."""

from rest_framework import serializers

from .models import User


class UserSerializer(serializers.ModelSerializer):
    """
    Shape of `user` in the `GET /auth/session/` response. Deliberately has no
    knowledge of `LichessAccount` beyond its username - the access token has no
    serializer at all, anywhere, so it can never be accidentally wired up.
    """

    lichessUsername = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "lichessUsername"]

    def get_lichessUsername(self, obj: User) -> str | None:
        account = getattr(obj, "lichess_account", None)
        return account.lichess_username if account else None


class SessionSerializer(serializers.Serializer):
    """
    Documentation-only: `SessionView.get` builds this shape by hand rather than
    via a serializer (there's no model instance to serialize - `user` is `None`
    when signed out), so this exists purely so drf-spectacular can describe
    `GET /auth/session/`'s response.
    """

    authenticated = serializers.BooleanField()
    user = UserSerializer(allow_null=True)
