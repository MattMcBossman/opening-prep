"""
Routes for the accounts app, mounted under `/api/v1/` by `opening_prep/urls.py`.

The include already exists, so adding an endpoint means editing only this file.
"""

from django.urls import path

from . import views

urlpatterns = [
    path("session/", views.SessionView.as_view(), name="auth-session"),
    path("lichess/start/", views.lichess_start, name="auth-lichess-start"),
    path("lichess/callback/", views.lichess_callback, name="auth-lichess-callback"),
    path("chess-com/", views.ChessComAccountView.as_view(), name="auth-chess-com"),
    path("logout/", views.LogoutView.as_view(), name="auth-logout"),
]
