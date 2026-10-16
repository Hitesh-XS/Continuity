from django.urls import path

from . import views

urlpatterns = [
    path("auth/register/", views.RegisterView.as_view(), name="auth-register"),
    path("auth/token/", views.LoginView.as_view(), name="auth-login"),
    path("auth/token/refresh/", views.RefreshView.as_view(), name="auth-refresh"),
    path("auth/logout/", views.LogoutView.as_view(), name="auth-logout"),
    path("account/me/", views.MeView.as_view(), name="account-me"),
]
