"""
Test utilities and fixtures for video calling app tests
"""
import uuid
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from apps.calls.models import CallSession, CallParticipant, CallQualityMetrics
from apps.messaging.models import Message
from apps.media.models import FileUpload, ProcessedMedia
from apps.quality_settings.models import QualityProfile

User = get_user_model()


class BaseTestCase(TestCase):
    """Base test case with common setup and utilities"""
    
    def setUp(self):
        """Set up test data"""
        self.user1 = self.create_test_user('user1', 'user1@test.com')
        self.user2 = self.create_test_user('user2', 'user2@test.com')
        self.user3 = self.create_test_user('user3', 'user3@test.com')
    
    def create_test_user(self, username, email, password='testpass123'):
        """Create a test user with standard attributes"""
        user = User.objects.create_user(
            username=username,
            email=email,
            password=password,
            is_online=True
        )
        return user
    
    def create_call_session(self, initiator=None, call_type='video', status='waiting'):
        """Create a test call session"""
        if initiator is None:
            initiator = self.user1
        
        call_session = CallSession.objects.create(
            initiator=initiator,
            call_type=call_type,
            status=status
        )
        return call_session
    
    def create_call_participant(self, call_session, user, is_active=True):
        """Create a call participant"""
        participant = CallParticipant.objects.create(
            call_session=call_session,
            user=user,
            is_active=is_active
        )
        return participant
    
    def create_quality_metrics(self, call_session, user, bandwidth=1000, latency=50, packet_loss=0.1):
        """Create quality metrics for a call"""
        metrics = CallQualityMetrics.objects.create(
            call_session=call_session,
            user=user,
            bandwidth_kbps=bandwidth,
            latency_ms=latency,
            packet_loss_percent=packet_loss,
            video_quality='medium',
            audio_quality='medium'
        )
        return metrics
    
    def create_message(self, sender=None, recipient=None, content='Test message', message_type='text'):
        """Create a test message"""
        if sender is None:
            sender = self.user1
        if recipient is None:
            recipient = self.user2
        
        message = Message.objects.create(
            sender=sender,
            recipient=recipient,
            content=content,
            message_type=message_type
        )
        return message
    
    def create_file_upload(self, user=None, filename='test.jpg', size=1024, content_type='image/jpeg'):
        """Create a test file upload"""
        if user is None:
            user = self.user1
        
        file_upload = FileUpload.objects.create(
            user=user,
            original_filename=filename,
            file_path=f'/uploads/{filename}',
            file_size=size,
            content_type=content_type,
            upload_status='completed'
        )
        return file_upload
    
    def create_quality_profile(self, user=None, video_quality='medium', audio_quality='medium'):
        """Create a quality profile for a user"""
        if user is None:
            user = self.user1
        
        profile = QualityProfile.objects.create(
            user=user,
            default_video_quality=video_quality,
            default_audio_quality=audio_quality,
            adaptive_quality=True,
            data_saver_mode=False
        )
        return profile
    
    def create_uploaded_file(self, name='test.txt', content=b'test content', content_type='text/plain'):
        """Create a Django uploaded file for testing"""
        return SimpleUploadedFile(name, content, content_type)
    
    def assert_call_participants(self, call_session, expected_users):
        """Assert that call has the expected participants"""
        participants = call_session.participants.all()
        self.assertEqual(set(participants), set(expected_users))
    
    def assert_user_in_call(self, user, call_session, is_active=True):
        """Assert that user is a participant in the call"""
        participant = CallParticipant.objects.filter(
            call_session=call_session,
            user=user
        ).first()
        self.assertIsNotNone(participant)
        self.assertEqual(participant.is_active, is_active)


class MockWebSocketMessage:
    """Mock WebSocket message for testing consumers"""
    
    def __init__(self, message_type, data=None):
        self.type = message_type
        self.data = data or {}
    
    def json(self):
        return {
            'type': self.type,
            **self.data
        }


class WebRTCTestMixin:
    """Mixin for WebRTC-related test utilities"""
    
    def create_webrtc_offer(self, sender_id, target_id):
        """Create a mock WebRTC offer"""
        return {
            'type': 'webrtc_offer',
            'offer': {
                'type': 'offer',
                'sdp': 'mock-sdp-offer-data'
            },
            'sender_id': str(sender_id),
            'target_id': str(target_id)
        }
    
    def create_webrtc_answer(self, sender_id, target_id):
        """Create a mock WebRTC answer"""
        return {
            'type': 'webrtc_answer',
            'answer': {
                'type': 'answer',
                'sdp': 'mock-sdp-answer-data'
            },
            'sender_id': str(sender_id),
            'target_id': str(target_id)
        }
    
    def create_ice_candidate(self, sender_id, target_id):
        """Create a mock ICE candidate"""
        return {
            'type': 'ice_candidate',
            'candidate': {
                'candidate': 'candidate:1 1 UDP 2122260223 192.168.1.100 54400 typ host',
                'sdpMLineIndex': 0,
                'sdpMid': '0'
            },
            'sender_id': str(sender_id),
            'target_id': str(target_id)
        }


class QualityTestMixin:
    """Mixin for quality-related test utilities"""
    
    def get_quality_scenarios(self):
        """Get different quality scenarios for testing"""
        return [
            {'bandwidth': 100, 'cpu': 90, 'expected': 'low'},
            {'bandwidth': 800, 'cpu': 70, 'expected': 'medium'},
            {'bandwidth': 3000, 'cpu': 40, 'expected': 'high'},
            {'bandwidth': 8000, 'cpu': 30, 'expected': 'ultra'},
        ]
    
    def get_quality_constraints_test_data(self):
        """Get test data for quality constraints"""
        return {
            'low': {
                'video': {'width': 640, 'height': 360, 'frameRate': 15, 'bitrate': 300},
                'audio': {'bitrate': 32}
            },
            'medium': {
                'video': {'width': 1280, 'height': 720, 'frameRate': 30, 'bitrate': 1000},
                'audio': {'bitrate': 64}
            },
            'high': {
                'video': {'width': 1920, 'height': 1080, 'frameRate': 30, 'bitrate': 2500},
                'audio': {'bitrate': 128}
            },
            'ultra': {
                'video': {'width': 3840, 'height': 2160, 'frameRate': 30, 'bitrate': 8000},
                'audio': {'bitrate': 256}
            }
        }