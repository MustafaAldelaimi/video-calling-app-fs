"""
Comprehensive model tests for video calling app
"""
import uuid
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db.utils import IntegrityError
from django.utils import timezone
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.calls.models import CallSession, CallParticipant, CallQualityMetrics
from apps.messaging.models import Message
from apps.media.models import FileUpload, ProcessedMedia
from apps.quality_settings.models import QualityProfile
from .test_utils import BaseTestCase

User = get_user_model()


class CustomUserModelTest(BaseTestCase):
    """Tests for CustomUser model"""
    
    def test_user_creation(self):
        """Test basic user creation"""
        user = self.create_test_user('testuser', 'test@example.com')
        self.assertEqual(user.username, 'testuser')
        self.assertEqual(user.email, 'test@example.com')
        self.assertTrue(user.is_online)
        self.assertIsNotNone(user.id)
        self.assertIsInstance(user.id, uuid.UUID)
    
    def test_user_str_representation(self):
        """Test user string representation"""
        user = self.create_test_user('testuser', 'test@example.com')
        self.assertEqual(str(user), 'testuser')
    
    def test_user_default_values(self):
        """Test user model default values"""
        user = User.objects.create_user(username='testuser', email='test@example.com')
        self.assertFalse(user.is_online)  # Default should be False
        self.assertIsNotNone(user.last_seen)
        self.assertIsNotNone(user.created_at)
        self.assertFalse(user.avatar)  # Empty ImageField evaluates to False
    
    def test_user_with_avatar(self):
        """Test user with avatar upload"""
        avatar = SimpleUploadedFile("avatar.jpg", b"file_content", content_type="image/jpeg")
        user = User.objects.create_user(
            username='testuser',
            email='test@example.com',
            avatar=avatar
        )
        self.assertIsNotNone(user.avatar)
        self.assertTrue(user.avatar.name.startswith('avatars/'))
    
    def test_unique_username(self):
        """Test username uniqueness constraint"""
        self.create_test_user('testuser', 'test1@example.com')
        with self.assertRaises(IntegrityError):
            self.create_test_user('testuser', 'test2@example.com')


class CallSessionModelTest(BaseTestCase):
    """Tests for CallSession model"""
    
    def test_call_session_creation(self):
        """Test basic call session creation"""
        call = self.create_call_session(self.user1, 'video', 'waiting')
        self.assertEqual(call.initiator, self.user1)
        self.assertEqual(call.call_type, 'video')
        self.assertEqual(call.status, 'waiting')
        self.assertIsNotNone(call.call_id)
        self.assertIsInstance(call.call_id, uuid.UUID)
        self.assertFalse(call.recording_enabled)
        self.assertIsNone(call.ended_at)
    
    def test_call_session_defaults(self):
        """Test call session default values"""
        call = CallSession.objects.create(initiator=self.user1)
        self.assertEqual(call.call_type, 'video')
        self.assertEqual(call.status, 'waiting')
        self.assertFalse(call.recording_enabled)
    
    def test_call_session_str_representation(self):
        """Test call session string representation"""
        call = self.create_call_session(self.user1, 'video', 'active')
        expected = f"Call {call.call_id} - active"
        self.assertEqual(str(call), expected)
    
    def test_call_type_choices(self):
        """Test valid call type choices"""
        valid_types = ['audio', 'video', 'screen_share']
        for call_type in valid_types:
            call = self.create_call_session(self.user1, call_type, 'waiting')
            self.assertEqual(call.call_type, call_type)
    
    def test_call_status_choices(self):
        """Test valid call status choices"""
        valid_statuses = ['waiting', 'ringing', 'active', 'ended', 'missed']
        for status in valid_statuses:
            call = self.create_call_session(self.user1, 'video', status)
            self.assertEqual(call.status, status)
    
    def test_call_id_uniqueness(self):
        """Test call_id uniqueness constraint"""
        call1 = self.create_call_session(self.user1)
        call2 = self.create_call_session(self.user2)
        self.assertNotEqual(call1.call_id, call2.call_id)
    
    def test_call_with_participants(self):
        """Test call session with participants"""
        call = self.create_call_session(self.user1)
        self.create_call_participant(call, self.user1)
        self.create_call_participant(call, self.user2)
        
        participants = call.participants.all()
        self.assertEqual(participants.count(), 2)
        self.assertIn(self.user1, participants)
        self.assertIn(self.user2, participants)
    
    def test_call_session_ended_at(self):
        """Test setting ended_at timestamp"""
        call = self.create_call_session(self.user1, status='ended')
        call.ended_at = timezone.now()
        call.save()
        self.assertIsNotNone(call.ended_at)


class CallParticipantModelTest(BaseTestCase):
    """Tests for CallParticipant model"""
    
    def test_call_participant_creation(self):
        """Test basic call participant creation"""
        call = self.create_call_session(self.user1)
        participant = self.create_call_participant(call, self.user2)
        
        self.assertEqual(participant.call_session, call)
        self.assertEqual(participant.user, self.user2)
        self.assertTrue(participant.is_active)
        self.assertIsNotNone(participant.joined_at)
        self.assertIsNone(participant.left_at)
    
    def test_participant_unique_constraint(self):
        """Test unique constraint for call_session and user"""
        call = self.create_call_session(self.user1)
        self.create_call_participant(call, self.user2)
        
        # Trying to add same user to same call should raise IntegrityError
        with self.assertRaises(IntegrityError):
            self.create_call_participant(call, self.user2)
    
    def test_participant_left_at(self):
        """Test setting left_at timestamp"""
        call = self.create_call_session(self.user1)
        participant = self.create_call_participant(call, self.user2)
        
        # Simulate user leaving
        participant.left_at = timezone.now()
        participant.is_active = False
        participant.save()
        
        self.assertIsNotNone(participant.left_at)
        self.assertFalse(participant.is_active)
    
    def test_multiple_participants_same_call(self):
        """Test multiple participants in same call"""
        call = self.create_call_session(self.user1)
        p1 = self.create_call_participant(call, self.user1)
        p2 = self.create_call_participant(call, self.user2)
        p3 = self.create_call_participant(call, self.user3)
        
        participants = CallParticipant.objects.filter(call_session=call)
        self.assertEqual(participants.count(), 3)
    
    def test_participant_cascade_delete(self):
        """Test cascade delete when call session is deleted"""
        call = self.create_call_session(self.user1)
        participant = self.create_call_participant(call, self.user2)
        participant_id = participant.id
        
        call.delete()
        
        with self.assertRaises(CallParticipant.DoesNotExist):
            CallParticipant.objects.get(id=participant_id)


class CallQualityMetricsModelTest(BaseTestCase):
    """Tests for CallQualityMetrics model"""
    
    def test_quality_metrics_creation(self):
        """Test basic quality metrics creation"""
        call = self.create_call_session(self.user1)
        metrics = self.create_quality_metrics(call, self.user1, 1500, 25, 0.05)
        
        self.assertEqual(metrics.call_session, call)
        self.assertEqual(metrics.user, self.user1)
        self.assertEqual(metrics.bandwidth_kbps, 1500)
        self.assertEqual(metrics.latency_ms, 25)
        self.assertEqual(metrics.packet_loss_percent, 0.05)
        self.assertEqual(metrics.video_quality, 'medium')
        self.assertEqual(metrics.audio_quality, 'medium')
        self.assertIsNotNone(metrics.timestamp)
    
    def test_quality_metrics_defaults(self):
        """Test quality metrics default values"""
        call = self.create_call_session(self.user1)
        metrics = CallQualityMetrics.objects.create(
            call_session=call,
            user=self.user1
        )
        
        self.assertEqual(metrics.bandwidth_kbps, 0)
        self.assertEqual(metrics.latency_ms, 0)
        self.assertEqual(metrics.packet_loss_percent, 0.0)
        self.assertEqual(metrics.video_quality, 'medium')
        self.assertEqual(metrics.audio_quality, 'medium')
    
    def test_multiple_metrics_same_call(self):
        """Test multiple quality metrics for same call"""
        call = self.create_call_session(self.user1)
        metrics1 = self.create_quality_metrics(call, self.user1, 1000, 50, 0.1)
        metrics2 = self.create_quality_metrics(call, self.user2, 2000, 30, 0.05)
        
        call_metrics = CallQualityMetrics.objects.filter(call_session=call)
        self.assertEqual(call_metrics.count(), 2)
    
    def test_quality_metrics_cascade_delete(self):
        """Test cascade delete when call session is deleted"""
        call = self.create_call_session(self.user1)
        metrics = self.create_quality_metrics(call, self.user1)
        metrics_id = metrics.id
        
        call.delete()
        
        with self.assertRaises(CallQualityMetrics.DoesNotExist):
            CallQualityMetrics.objects.get(id=metrics_id)


class MessageModelTest(BaseTestCase):
    """Tests for Message model"""
    
    def test_message_creation(self):
        """Test basic message creation"""
        message = self.create_message(self.user1, self.user2, 'Hello World', 'text')
        
        self.assertEqual(message.sender, self.user1)
        self.assertEqual(message.recipient, self.user2)
        self.assertEqual(message.content, 'Hello World')
        self.assertEqual(message.message_type, 'text')
        self.assertFalse(message.is_read)
        self.assertIsNotNone(message.timestamp)
    
    def test_message_str_representation(self):
        """Test message string representation"""
        message = self.create_message(self.user1, self.user2)
        expected = f"Message from {self.user1.username} to {self.user2.username}"
        self.assertEqual(str(message), expected)
    
    def test_message_type_choices(self):
        """Test valid message type choices"""
        valid_types = ['text', 'file', 'image', 'video', 'audio']
        for msg_type in valid_types:
            message = self.create_message(self.user1, self.user2, 'Test', msg_type)
            self.assertEqual(message.message_type, msg_type)
    
    def test_message_with_file_attachment(self):
        """Test message with file attachment"""
        file_content = b"Test file content"
        uploaded_file = SimpleUploadedFile("test.txt", file_content, content_type="text/plain")
        
        message = Message.objects.create(
            sender=self.user1,
            recipient=self.user2,
            content='File attached',
            message_type='file',
            file_attachment=uploaded_file
        )
        
        self.assertIsNotNone(message.file_attachment)
        self.assertTrue(message.file_attachment.name.startswith('messages/'))
    
    def test_message_ordering(self):
        """Test message ordering by timestamp (descending)"""
        msg1 = self.create_message(self.user1, self.user2, 'First message')
        msg2 = self.create_message(self.user1, self.user2, 'Second message')
        
        messages = Message.objects.all()
        self.assertEqual(messages[0], msg2)  # Most recent first
        self.assertEqual(messages[1], msg1)
    
    def test_message_read_status(self):
        """Test message read status functionality"""
        message = self.create_message(self.user1, self.user2)
        self.assertFalse(message.is_read)
        
        message.is_read = True
        message.save()
        self.assertTrue(message.is_read)
    
    def test_message_cascade_delete(self):
        """Test cascade delete when user is deleted"""
        message = self.create_message(self.user1, self.user2)
        message_id = message.id
        
        self.user1.delete()
        
        with self.assertRaises(Message.DoesNotExist):
            Message.objects.get(id=message_id)


class FileUploadModelTest(BaseTestCase):
    """Tests for FileUpload model"""
    
    def test_file_upload_creation(self):
        """Test basic file upload creation"""
        file_upload = self.create_file_upload(
            self.user1, 'test.jpg', 2048, 'image/jpeg'
        )
        
        self.assertEqual(file_upload.user, self.user1)
        self.assertEqual(file_upload.original_filename, 'test.jpg')
        self.assertEqual(file_upload.file_size, 2048)
        self.assertEqual(file_upload.content_type, 'image/jpeg')
        self.assertEqual(file_upload.upload_status, 'completed')
        self.assertEqual(file_upload.upload_progress, 0)
    
    def test_file_upload_str_representation(self):
        """Test file upload string representation"""
        file_upload = self.create_file_upload(self.user1, 'test.jpg')
        expected = "test.jpg - completed"
        self.assertEqual(str(file_upload), expected)
    
    def test_upload_status_choices(self):
        """Test valid upload status choices"""
        valid_statuses = ['pending', 'uploading', 'processing', 'completed', 'failed']
        for status in valid_statuses:
            file_upload = FileUpload.objects.create(
                user=self.user1,
                original_filename='test.txt',
                file_path='/uploads/test.txt',
                file_size=1024,
                content_type='text/plain',
                upload_status=status
            )
            self.assertEqual(file_upload.upload_status, status)
    
    def test_file_upload_progress(self):
        """Test file upload progress tracking"""
        file_upload = self.create_file_upload(self.user1)
        file_upload.upload_progress = 50
        file_upload.save()
        
        self.assertEqual(file_upload.upload_progress, 50)
    
    def test_file_upload_cascade_delete(self):
        """Test cascade delete when user is deleted"""
        file_upload = self.create_file_upload(self.user1)
        file_id = file_upload.id
        
        self.user1.delete()
        
        with self.assertRaises(FileUpload.DoesNotExist):
            FileUpload.objects.get(id=file_id)


class ProcessedMediaModelTest(BaseTestCase):
    """Tests for ProcessedMedia model"""
    
    def test_processed_media_creation(self):
        """Test basic processed media creation"""
        original_file = self.create_file_upload(self.user1, 'video.mp4', 5000000, 'video/mp4')
        
        processed = ProcessedMedia.objects.create(
            original_file=original_file,
            quality_level='high',
            processed_file_path='/processed/video_high.mp4',
            file_size=3000000,
            processing_status='completed'
        )
        
        self.assertEqual(processed.original_file, original_file)
        self.assertEqual(processed.quality_level, 'high')
        self.assertEqual(processed.file_size, 3000000)
        self.assertEqual(processed.processing_status, 'completed')
    
    def test_processed_media_str_representation(self):
        """Test processed media string representation"""
        original_file = self.create_file_upload(self.user1, 'video.mp4')
        processed = ProcessedMedia.objects.create(
            original_file=original_file,
            quality_level='medium',
            processed_file_path='/processed/video_medium.mp4',
            file_size=2000000
        )
        
        expected = "video.mp4 - medium"
        self.assertEqual(str(processed), expected)
    
    def test_processing_status_choices(self):
        """Test valid processing status choices"""
        original_file = self.create_file_upload(self.user1)
        valid_statuses = ['pending', 'processing', 'completed', 'failed']
        
        for status in valid_statuses:
            processed = ProcessedMedia.objects.create(
                original_file=original_file,
                quality_level='low',
                processed_file_path=f'/processed/test_{status}.mp4',
                file_size=1000000,
                processing_status=status
            )
            self.assertEqual(processed.processing_status, status)
    
    def test_processed_media_cascade_delete(self):
        """Test cascade delete when original file is deleted"""
        original_file = self.create_file_upload(self.user1)
        processed = ProcessedMedia.objects.create(
            original_file=original_file,
            quality_level='medium',
            processed_file_path='/processed/test.mp4',
            file_size=2000000
        )
        processed_id = processed.id
        
        original_file.delete()
        
        with self.assertRaises(ProcessedMedia.DoesNotExist):
            ProcessedMedia.objects.get(id=processed_id)


class QualityProfileModelTest(BaseTestCase):
    """Tests for QualityProfile model"""
    
    def test_quality_profile_creation(self):
        """Test basic quality profile creation"""
        profile = self.create_quality_profile(self.user1, 'high', 'medium')
        
        self.assertEqual(profile.user, self.user1)
        self.assertEqual(profile.default_video_quality, 'high')
        self.assertEqual(profile.default_audio_quality, 'medium')
        self.assertTrue(profile.adaptive_quality)
        self.assertFalse(profile.data_saver_mode)
    
    def test_quality_profile_str_representation(self):
        """Test quality profile string representation"""
        profile = self.create_quality_profile(self.user1)
        expected = f"Quality Profile for {self.user1.username}"
        self.assertEqual(str(profile), expected)
    
    def test_quality_profile_defaults(self):
        """Test quality profile default values"""
        profile = QualityProfile.objects.create(user=self.user1)
        
        self.assertEqual(profile.default_video_quality, 'medium')
        self.assertEqual(profile.default_audio_quality, 'medium')
        self.assertTrue(profile.adaptive_quality)
        self.assertFalse(profile.data_saver_mode)
    
    def test_quality_profile_get_or_create_for_user(self):
        """Test get_or_create_for_user class method"""
        # First call should create a new profile
        profile1 = QualityProfile.get_or_create_for_user(self.user1)
        self.assertEqual(profile1.user, self.user1)
        
        # Second call should return existing profile
        profile2 = QualityProfile.get_or_create_for_user(self.user1)
        self.assertEqual(profile1.id, profile2.id)
    
    def test_quality_profile_one_to_one_constraint(self):
        """Test one-to-one relationship constraint"""
        self.create_quality_profile(self.user1)
        
        # Trying to create another profile for same user should raise IntegrityError
        with self.assertRaises(IntegrityError):
            self.create_quality_profile(self.user1)
    
    def test_quality_profile_cascade_delete(self):
        """Test cascade delete when user is deleted"""
        profile = self.create_quality_profile(self.user1)
        profile_id = profile.id
        
        self.user1.delete()
        
        with self.assertRaises(QualityProfile.DoesNotExist):
            QualityProfile.objects.get(id=profile_id)
    
    def test_data_saver_mode(self):
        """Test data saver mode functionality"""
        profile = self.create_quality_profile(
            self.user1, 
            video_quality='low', 
            audio_quality='low'
        )
        profile.data_saver_mode = True
        profile.save()
        
        self.assertTrue(profile.data_saver_mode)
        self.assertEqual(profile.default_video_quality, 'low')
        self.assertEqual(profile.default_audio_quality, 'low')


class ModelRelationshipTest(BaseTestCase):
    """Tests for model relationships and complex queries"""
    
    def test_user_initiated_calls_relationship(self):
        """Test user's initiated calls relationship"""
        call1 = self.create_call_session(self.user1)
        call2 = self.create_call_session(self.user1)
        call3 = self.create_call_session(self.user2)
        
        initiated_calls = self.user1.initiated_calls.all()
        self.assertEqual(initiated_calls.count(), 2)
        self.assertIn(call1, initiated_calls)
        self.assertIn(call2, initiated_calls)
        self.assertNotIn(call3, initiated_calls)
    
    def test_user_sent_messages_relationship(self):
        """Test user's sent messages relationship"""
        msg1 = self.create_message(self.user1, self.user2, 'Message 1')
        msg2 = self.create_message(self.user1, self.user3, 'Message 2')
        msg3 = self.create_message(self.user2, self.user1, 'Message 3')
        
        sent_messages = self.user1.sent_messages.all()
        self.assertEqual(sent_messages.count(), 2)
        self.assertIn(msg1, sent_messages)
        self.assertIn(msg2, sent_messages)
        self.assertNotIn(msg3, sent_messages)
    
    def test_user_received_messages_relationship(self):
        """Test user's received messages relationship"""
        msg1 = self.create_message(self.user2, self.user1, 'Message 1')
        msg2 = self.create_message(self.user3, self.user1, 'Message 2')
        msg3 = self.create_message(self.user1, self.user2, 'Message 3')
        
        received_messages = self.user1.received_messages.all()
        self.assertEqual(received_messages.count(), 2)
        self.assertIn(msg1, received_messages)
        self.assertIn(msg2, received_messages)
        self.assertNotIn(msg3, received_messages)
    
    def test_call_session_participants_through_relationship(self):
        """Test call session participants through CallParticipant"""
        call = self.create_call_session(self.user1)
        self.create_call_participant(call, self.user1)
        self.create_call_participant(call, self.user2)
        self.create_call_participant(call, self.user3)
        
        participants = call.participants.all()
        self.assertEqual(participants.count(), 3)
        
        # Test through model access
        call_participants = CallParticipant.objects.filter(call_session=call)
        self.assertEqual(call_participants.count(), 3)
    
    def test_processed_media_relationship(self):
        """Test processed media relationship with original file"""
        original_file = self.create_file_upload(self.user1, 'video.mp4', 10000000, 'video/mp4')
        
        # Create multiple processed versions
        processed_low = ProcessedMedia.objects.create(
            original_file=original_file,
            quality_level='low',
            processed_file_path='/processed/video_low.mp4',
            file_size=2000000
        )
        processed_high = ProcessedMedia.objects.create(
            original_file=original_file,
            quality_level='high',
            processed_file_path='/processed/video_high.mp4',
            file_size=8000000
        )
        
        processed_versions = original_file.processed_versions.all()
        self.assertEqual(processed_versions.count(), 2)
        self.assertIn(processed_low, processed_versions)
        self.assertIn(processed_high, processed_versions)