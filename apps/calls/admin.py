from django.contrib import admin
from .models import CallSession, CallParticipant, CallQualityMetrics

@admin.register(CallSession)
class CallSessionAdmin(admin.ModelAdmin):
    list_display = ('call_id', 'initiator', 'call_type', 'status', 'started_at', 'ended_at')
    list_filter = ('call_type', 'status', 'started_at')
    search_fields = ('call_id', 'initiator__username')
    readonly_fields = ('call_id', 'started_at')

@admin.register(CallParticipant)
class CallParticipantAdmin(admin.ModelAdmin):
    list_display = ('call_session', 'user', 'joined_at', 'is_active')
    list_filter = ('is_active', 'joined_at')
    search_fields = ('user__username', 'call_session__call_id')

@admin.register(CallQualityMetrics)
class CallQualityMetricsAdmin(admin.ModelAdmin):
    list_display = ('call_session', 'user', 'bandwidth_kbps', 'latency_ms', 'packet_loss_percent', 'timestamp')
    list_filter = ('video_quality', 'audio_quality', 'timestamp')
    search_fields = ('user__username', 'call_session__call_id')
