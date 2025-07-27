from django.urls import path
from . import views

app_name = 'calls'

urlpatterns = [
    path('start/', views.start_call, name='start_call'),
    path('room/<uuid:call_id>/', views.call_room, name='call_room'),
    path('quality-settings/', views.quality_settings, name='quality_settings'),
]
