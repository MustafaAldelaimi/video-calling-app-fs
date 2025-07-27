import uuid
from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()

UPLOAD_STATUS_CHOICES = [
    ('pending', 'Pending'),
    ('uploading', 'Uploading'),
    ('processing', 'Processing'),
    ('completed', 'Completed'),
    ('failed', 'Failed'),
]

PROCESSING_STATUS_CHOICES = [
    ('pending', 'Pending'),
    ('processing', 'Processing'),
    ('completed', 'Completed'),
    ('failed', 'Failed'),
]

class FileUpload(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    original_filename = models.CharField(max_length=255)
    file_path = models.CharField(max_length=500)
    file_size = models.BigIntegerField()
    content_type = models.CharField(max_length=100)
    upload_status = models.CharField(max_length=20, choices=UPLOAD_STATUS_CHOICES, default='pending')
    upload_progress = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"{self.original_filename} - {self.upload_status}"

class ProcessedMedia(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    original_file = models.ForeignKey(FileUpload, on_delete=models.CASCADE, related_name='processed_versions')
    quality_level = models.CharField(max_length=20)
    processed_file_path = models.CharField(max_length=500)
    file_size = models.BigIntegerField()
    processing_status = models.CharField(max_length=20, choices=PROCESSING_STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"{self.original_file.original_filename} - {self.quality_level}"
