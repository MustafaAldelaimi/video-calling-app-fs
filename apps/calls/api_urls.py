from django.urls import path
from . import api_views

urlpatterns = [
    path('webrtc-js/', api_views.webrtc_js, name='webrtc_js'),
    path('quality-metrics/', api_views.save_quality_metrics, name='save_quality_metrics'),
    path('call-status/<uuid:call_id>/', api_views.call_status, name='call_status'),
]
