import uuid
from django.db import models
from django.contrib.auth import get_user_model
from config.settings.base import VIDEO_QUALITY_CHOICES, AUDIO_QUALITY_CHOICES

User = get_user_model()

class QualityProfile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='quality_profile')
    default_video_quality = models.CharField(
        max_length=20, 
        choices=VIDEO_QUALITY_CHOICES, 
        default='medium'
    )
    default_audio_quality = models.CharField(
        max_length=20, 
        choices=AUDIO_QUALITY_CHOICES, 
        default='medium'
    )
    adaptive_quality = models.BooleanField(default=True)
    data_saver_mode = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"Quality Profile for {self.user.username}"
    
    @classmethod
    def get_or_create_for_user(cls, user):
        profile, created = cls.objects.get_or_create(user=user)
        return profile
