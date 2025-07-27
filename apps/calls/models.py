import uuid
from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()

CALL_TYPE_CHOICES = [
    ('audio', 'Audio Only'),
    ('video', 'Video Call'),
    ('screen_share', 'Screen Share'),
]

CALL_STATUS_CHOICES = [
    ('waiting', 'Waiting'),
    ('ringing', 'Ringing'),
    ('active', 'Active'),
    ('ended', 'Ended'),
    ('missed', 'Missed'),
]

class CallSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    call_id = models.UUIDField(default=uuid.uuid4, unique=True)
    initiator = models.ForeignKey(User, on_delete=models.CASCADE, related_name='initiated_calls')
    participants = models.ManyToManyField(User, through='CallParticipant')
    call_type = models.CharField(max_length=20, choices=CALL_TYPE_CHOICES, default='video')
    status = models.CharField(max_length=20, choices=CALL_STATUS_CHOICES, default='waiting')
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    recording_enabled = models.BooleanField(default=False)
    
    class Meta:
        indexes = [
            models.Index(fields=['started_at']),
            models.Index(fields=['call_type', 'started_at']),
        ]
    
    def __str__(self):
        return f"Call {self.call_id} - {self.status}"

class CallParticipant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    call_session = models.ForeignKey(CallSession, on_delete=models.CASCADE)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(auto_now_add=True)
    left_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    
    class Meta:
        unique_together = ['call_session', 'user']

class CallQualityMetrics(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    call_session = models.ForeignKey(CallSession, on_delete=models.CASCADE)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    timestamp = models.DateTimeField(auto_now_add=True)
    bandwidth_kbps = models.IntegerField(default=0)
    latency_ms = models.IntegerField(default=0)
    packet_loss_percent = models.FloatField(default=0.0)
    video_quality = models.CharField(max_length=20, default='medium')
    audio_quality = models.CharField(max_length=20, default='medium')
