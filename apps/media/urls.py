from django.urls import path
from . import views

app_name = 'media'

urlpatterns = [
    path('upload/', views.file_upload, name='file_upload'),
    path('files/', views.file_list, name='file_list'),
]
