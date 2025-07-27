import uuid
from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()

MESSAGE_TYPE_CHOICES = [
    ('text', 'Text Message'),
    ('file', 'File Attachment'),
    ('image', 'Image'),
    ('video', 'Video'),
    ('audio', 'Audio'),
]

class Message(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_messages')
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='received_messages')
    content = models.TextField(blank=True)
    file_attachment = models.FileField(upload_to='messages/', null=True, blank=True)
    message_type = models.CharField(max_length=20, choices=MESSAGE_TYPE_CHOICES, default='text')
    timestamp = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)
    
    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['sender', 'recipient', 'timestamp']),
            models.Index(fields=['timestamp']),
        ]
    
    def __str__(self):
        return f"Message from {self.sender.username} to {self.recipient.username}"
