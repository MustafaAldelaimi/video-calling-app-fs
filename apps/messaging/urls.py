from django.urls import path
from . import views

app_name = 'messaging'

urlpatterns = [
    path('', views.message_list, name='message_list'),
    path('send/', views.send_message, name='send_message'),
]
