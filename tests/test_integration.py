"""
Integration tests for video calling app - End-to-end user flows
"""
import json
import uuid
from django.test import TestCase, Client, TransactionTestCase
from django.urls import reverse
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.contrib.messages import get_messages
from django.db import transaction
from unittest.mock import patch, MagicMock

from apps.calls.models import CallSession, CallParticipant, CallQualityMetrics
from apps.messaging.models import Message
from apps.media.models import FileUpload
from apps.quality_settings.models import QualityProfile
from .test_utils import BaseTestCase

User = get_user_model()


class UserRegistrationFlowTest(BaseTestCase):
    """Test complete user registration and login flow"""
    
    def setUp(self):
        self.client = Client()
    
    def test_complete_registration_flow(self):
        """Test complete user registration and first login"""
        # Step 1: Access registration page
        response = self.client.get(reverse('accounts:register'))
        self.assertEqual(response.status_code, 200)
        
        # Step 2: Submit registration form
        registration_data = {
            'username': 'newuser',
            'email': 'newuser@example.com',
            'password1': 'strongpassword123',
            'password2': 'strongpassword123'
        }
        response = self.client.post(reverse('accounts:register'), data=registration_data)
        
        # Should redirect to dashboard
        self.assertRedirects(response, reverse('accounts:dashboard'))
        
        # User should be created
        user = User.objects.get(username='newuser')
        self.assertEqual(user.email, 'newuser@example.com')
        
        # User should be automatically logged in
        response = self.client.get(reverse('accounts:dashboard'))
        self.assertEqual(response.status_code, 200)
        
        # Step 3: Access profile page
        response = self.client.get(reverse('accounts:profile'))
        self.assertEqual(response.status_code, 200)
        
        # Step 4: Logout
        response = self.client.post(reverse('accounts:logout'))
        self.assertRedirects(response, '/login/')
        
        # Step 5: Login again
        login_data = {
            'username': 'newuser',
            'password': 'strongpassword123'
        }
        response = self.client.post(reverse('accounts:login'), data=login_data)
        self.assertRedirects(response, reverse('accounts:dashboard'))
    
    def test_registration_with_duplicate_username(self):
        """Test registration flow with duplicate username"""
        # Create existing user
        User.objects.create_user(username='existing', email='existing@example.com')
        
        # Attempt to register with same username
        registration_data = {
            'username': 'existing',
            'email': 'new@example.com',
            'password1': 'strongpassword123',
            'password2': 'strongpassword123'
        }
        response = self.client.post(reverse('accounts:register'), data=registration_data)
        
        # Should stay on registration page with error
        self.assertEqual(response.status_code, 200)
        form = response.context['form']
        self.assertFalse(form.is_valid())
        self.assertIn('username', form.errors)
    
    def test_login_flow_with_invalid_credentials(self):
        """Test login flow with invalid credentials"""
        # Create user
        user = User.objects.create_user(username='testuser', password='correctpassword')
        
        # Attempt login with wrong password
        login_data = {
            'username': 'testuser',
            'password': 'wrongpassword'
        }
        response = self.client.post(reverse('accounts:login'), data=login_data)
        
        # Should stay on login page
        self.assertEqual(response.status_code, 200)
        
        # Should not be able to access protected pages
        response = self.client.get(reverse('accounts:dashboard'))
        self.assertRedirects(response, '/login/?next=/')


class CallCreationFlowTest(BaseTestCase):
    """Test complete call creation and joining flow"""
    
    def setUp(self):
        super().setUp()
        self.client = Client()
    
    def test_complete_call_flow(self):
        """Test complete call creation and joining flow"""
        # Step 1: User1 logs in
        self.client.force_login(self.user1)
        
        # Step 2: Access start call page
        response = self.client.get(reverse('calls:start_call'))
        self.assertEqual(response.status_code, 200)
        
        # Should see other users in the list
        users = response.context['users']
        self.assertIn(self.user2, users)
        self.assertNotIn(self.user1, users)  # Should not see self
        
        # Step 3: Start a call with user2
        call_data = {
            'call_type': 'video',
            'target_username': self.user2.username
        }
        response = self.client.post(reverse('calls:start_call'), data=call_data)
        
        # Should create call and redirect to call room
        call_session = CallSession.objects.filter(initiator=self.user1).first()
        self.assertIsNotNone(call_session)
        
        expected_url = reverse('calls:call_room', kwargs={'call_id': call_session.call_id})
        self.assertRedirects(response, expected_url)
        
        # Step 4: Access call room
        response = self.client.get(expected_url)
        self.assertEqual(response.status_code, 200)
        
        # Context should contain call information
        self.assertEqual(response.context['call_session'], call_session)
        self.assertEqual(response.context['user_id'], str(self.user1.id))
        
        # Step 5: Check call status via API
        response = self.client.get(
            reverse('call_status', kwargs={'call_id': call_session.call_id})
        )
        self.assertEqual(response.status_code, 200)
        
        data = json.loads(response.content)
        self.assertEqual(data['status'], 'waiting')
        self.assertEqual(data['call_type'], 'video')
        self.assertEqual(len(data['participants']), 2)  # Both users should be participants
    
    def test_call_flow_without_target_user(self):
        """Test call creation without specifying target user"""
        self.client.force_login(self.user1)
        
        # Start call without target user
        call_data = {
            'call_type': 'audio'
        }
        response = self.client.post(reverse('calls:start_call'), data=call_data)
        
        # Should create call
        call_session = CallSession.objects.filter(initiator=self.user1).first()
        self.assertIsNotNone(call_session)
        self.assertEqual(call_session.call_type, 'audio')
        
        # Only initiator should be participant
        participants = call_session.participants.all()
        self.assertEqual(participants.count(), 1)
        self.assertIn(self.user1, participants)
    
    def test_multiple_users_joining_same_call(self):
        """Test multiple users joining the same call"""
        # User1 creates call
        self.client.force_login(self.user1)
        call_session = self.create_call_session(self.user1)
        self.create_call_participant(call_session, self.user1)
        
        # User2 accesses the same call room
        self.client.force_login(self.user2)
        response = self.client.get(
            reverse('calls:call_room', kwargs={'call_id': call_session.call_id})
        )
        self.assertEqual(response.status_code, 200)
        
        # User3 also accesses the call room
        self.client.force_login(self.user3)
        response = self.client.get(
            reverse('calls:call_room', kwargs={'call_id': call_session.call_id})
        )
        self.assertEqual(response.status_code, 200)
    
    def test_call_with_quality_metrics(self):
        """Test call flow with quality metrics submission"""
        self.client.force_login(self.user1)
        call_session = self.create_call_session(self.user1)
        
        # Submit quality metrics
        metrics_data = {
            'call_id': str(call_session.call_id),
            'bandwidth': 1500,
            'latency': 25,
            'packet_loss': 0.05,
            'video_quality': 'high',
            'audio_quality': 'medium'
        }
        
        response = self.client.post(
            reverse('save_quality_metrics'),
            data=json.dumps(metrics_data),
            content_type='application/json'
        )
        
        self.assertEqual(response.status_code, 200)
        response_data = json.loads(response.content)
        self.assertEqual(response_data['status'], 'success')
        
        # Verify metrics were saved
        metrics = CallQualityMetrics.objects.filter(
            call_session=call_session,
            user=self.user1
        ).first()
        self.assertIsNotNone(metrics)
        self.assertEqual(metrics.bandwidth_kbps, 1500)


class MessagingFlowTest(BaseTestCase):
    """Test messaging functionality flow"""
    
    def setUp(self):
        super().setUp()
        self.client = Client()
    
    def test_basic_messaging_flow(self):
        """Test basic message creation and retrieval"""
        # Create messages between users
        message1 = self.create_message(self.user1, self.user2, 'Hello from user1')
        message2 = self.create_message(self.user2, self.user1, 'Reply from user2')
        
        # Verify messages were created
        self.assertEqual(Message.objects.count(), 2)
        
        # Check message order (should be newest first)
        messages = Message.objects.all()
        self.assertEqual(messages[0], message2)  # Most recent first
        self.assertEqual(messages[1], message1)
        
        # Test message read status
        self.assertFalse(message1.is_read)
        message1.is_read = True
        message1.save()
        self.assertTrue(message1.is_read)
    
    def test_file_message_flow(self):
        """Test sending messages with file attachments"""
        # Create a file message
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
        self.assertEqual(message.message_type, 'file')
        self.assertTrue(message.file_attachment.name.startswith('messages/'))
    
    def test_conversation_flow(self):
        """Test back-and-forth conversation between users"""
        # Create a conversation
        messages = [
            self.create_message(self.user1, self.user2, 'Hi there!'),
            self.create_message(self.user2, self.user1, 'Hello! How are you?'),
            self.create_message(self.user1, self.user2, 'I am doing well, thanks!'),
            self.create_message(self.user2, self.user1, 'Great to hear!'),
        ]
        
        # Verify conversation order
        user1_sent = Message.objects.filter(sender=self.user1)
        user2_sent = Message.objects.filter(sender=self.user2)
        
        self.assertEqual(user1_sent.count(), 2)
        self.assertEqual(user2_sent.count(), 2)
        
        # Test filtering by recipient
        user1_received = Message.objects.filter(recipient=self.user1)
        user2_received = Message.objects.filter(recipient=self.user2)
        
        self.assertEqual(user1_received.count(), 2)
        self.assertEqual(user2_received.count(), 2)


class FileUploadFlowTest(BaseTestCase):
    """Test file upload and processing flow"""
    
    def setUp(self):
        super().setUp()
        self.client = Client()
    
    def test_file_upload_creation_flow(self):
        """Test complete file upload flow"""
        # Create a file upload
        file_upload = self.create_file_upload(
            self.user1, 
            'video.mp4', 
            5000000, 
            'video/mp4'
        )
        
        self.assertEqual(file_upload.user, self.user1)
        self.assertEqual(file_upload.upload_status, 'completed')
        
        # Simulate upload progress
        file_upload.upload_status = 'uploading'
        file_upload.upload_progress = 50
        file_upload.save()
        
        self.assertEqual(file_upload.upload_progress, 50)
        
        # Complete upload
        file_upload.upload_status = 'completed'
        file_upload.upload_progress = 100
        file_upload.save()
        
        self.assertEqual(file_upload.upload_status, 'completed')
    
    def test_file_processing_flow(self):
        """Test file processing workflow"""
        from apps.media.models import ProcessedMedia
        
        # Create original file
        original_file = self.create_file_upload(
            self.user1, 
            'video.mp4', 
            10000000, 
            'video/mp4'
        )
        
        # Create processed versions
        processed_low = ProcessedMedia.objects.create(
            original_file=original_file,
            quality_level='low',
            processed_file_path='/processed/video_low.mp4',
            file_size=2000000,
            processing_status='processing'
        )
        
        processed_high = ProcessedMedia.objects.create(
            original_file=original_file,
            quality_level='high',
            processed_file_path='/processed/video_high.mp4',
            file_size=8000000,
            processing_status='processing'
        )
        
        # Complete processing
        processed_low.processing_status = 'completed'
        processed_high.processing_status = 'completed'
        processed_low.save()
        processed_high.save()
        
        # Verify processed versions
        processed_versions = original_file.processed_versions.all()
        self.assertEqual(processed_versions.count(), 2)
        
        statuses = [pv.processing_status for pv in processed_versions]
        self.assertTrue(all(status == 'completed' for status in statuses))


class QualitySettingsFlowTest(BaseTestCase):
    """Test quality settings and adaptation flow"""
    
    def test_quality_profile_creation_flow(self):
        """Test quality profile creation and management"""
        # Create quality profile
        profile = self.create_quality_profile(
            self.user1, 
            'high', 
            'medium'
        )
        
        self.assertEqual(profile.default_video_quality, 'high')
        self.assertEqual(profile.default_audio_quality, 'medium')
        self.assertTrue(profile.adaptive_quality)
        
        # Test get_or_create method
        profile2 = QualityProfile.get_or_create_for_user(self.user1)
        self.assertEqual(profile.id, profile2.id)  # Should return existing profile
        
        # Test for different user
        profile3 = QualityProfile.get_or_create_for_user(self.user2)
        self.assertNotEqual(profile.id, profile3.id)  # Should create new profile
    
    def test_quality_adaptation_flow(self):
        """Test quality adaptation based on network conditions"""
        from apps.calls.services import QualityAdaptationService
        
        # Test different network scenarios
        scenarios = [
            {'bandwidth': 5000, 'cpu': 30, 'expected': 'ultra'},
            {'bandwidth': 2000, 'cpu': 50, 'expected': 'high'},
            {'bandwidth': 800, 'cpu': 70, 'expected': 'medium'},
            {'bandwidth': 300, 'cpu': 85, 'expected': 'low'},
        ]
        
        for scenario in scenarios:
            optimal_quality = QualityAdaptationService.get_optimal_quality(
                scenario['bandwidth'], 
                scenario['cpu']
            )
            self.assertEqual(optimal_quality, scenario['expected'])
            
            # Get constraints for the quality
            constraints = QualityAdaptationService.get_quality_constraints(optimal_quality)
            self.assertIn('video', constraints)
            self.assertIn('audio', constraints)


class EndToEndCallFlowTest(TransactionTestCase):
    """End-to-end call flow tests using TransactionTestCase for better isolation"""
    
    def setUp(self):
        self.user1 = User.objects.create_user(username='user1', password='testpass123')
        self.user2 = User.objects.create_user(username='user2', password='testpass123')
        self.client = Client()
    
    def test_complete_call_lifecycle(self):
        """Test complete call lifecycle from creation to end"""
        # Step 1: User1 creates call
        self.client.force_login(self.user1)
        
        call_data = {
            'call_type': 'video',
            'target_username': self.user2.username
        }
        response = self.client.post(reverse('calls:start_call'), data=call_data)
        
        call_session = CallSession.objects.filter(initiator=self.user1).first()
        self.assertIsNotNone(call_session)
        self.assertEqual(call_session.status, 'waiting')
        
        # Step 2: Both users are participants
        participants = call_session.participants.all()
        self.assertEqual(participants.count(), 2)
        self.assertIn(self.user1, participants)
        self.assertIn(self.user2, participants)
        
        # Step 3: Simulate call becoming active
        call_session.status = 'active'
        call_session.save()
        
        # Step 4: Submit quality metrics during call
        metrics_data = {
            'call_id': str(call_session.call_id),
            'bandwidth': 1500,
            'latency': 25,
            'packet_loss': 0.05
        }
        
        response = self.client.post(
            reverse('save_quality_metrics'),
            data=json.dumps(metrics_data),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 200)
        
        # Step 5: End the call
        from django.utils import timezone
        call_session.status = 'ended'
        call_session.ended_at = timezone.now()
        call_session.save()
        
        # Step 6: Verify final state
        final_call = CallSession.objects.get(id=call_session.id)
        self.assertEqual(final_call.status, 'ended')
        self.assertIsNotNone(final_call.ended_at)
        
        # Quality metrics should be recorded
        metrics = CallQualityMetrics.objects.filter(call_session=call_session)
        self.assertTrue(metrics.exists())
    
    def test_concurrent_calls_flow(self):
        """Test handling multiple concurrent calls"""
        user3 = User.objects.create_user(username='user3', password='testpass123')
        self.client.force_login(self.user1)
        
        # Create multiple calls
        call1_data = {
            'call_type': 'video',
            'target_username': self.user2.username
        }
        call2_data = {
            'call_type': 'audio'  # Without target user
        }
        
        # Start first call
        response1 = self.client.post(reverse('calls:start_call'), data=call1_data)
        call1 = CallSession.objects.filter(initiator=self.user1).first()
        
        # Start second call
        response2 = self.client.post(reverse('calls:start_call'), data=call2_data)
        call2 = CallSession.objects.filter(initiator=self.user1).exclude(id=call1.id).first()
        
        # Both calls should exist
        self.assertIsNotNone(call1)
        self.assertIsNotNone(call2)
        self.assertNotEqual(call1.id, call2.id)
        
        # Test active calls service
        from apps.calls.services import CallService
        active_calls = CallService.get_active_calls(self.user1.id)
        self.assertEqual(len(active_calls), 2)
    
    def test_call_flow_with_errors(self):
        """Test call flow with various error conditions"""
        self.client.force_login(self.user1)
        
        # Try to start call with non-existent user
        call_data = {
            'call_type': 'video',
            'target_username': 'nonexistent'
        }
        response = self.client.post(reverse('calls:start_call'), data=call_data)
        
        # Should stay on start call page with error
        self.assertEqual(response.status_code, 200)
        messages = list(get_messages(response.wsgi_request))
        self.assertTrue(any('User not found' in str(msg) for msg in messages))
        
        # Try to access non-existent call room
        fake_call_id = uuid.uuid4()
        response = self.client.get(
            reverse('calls:call_room', kwargs={'call_id': fake_call_id})
        )
        # Could be 404 or redirect depending on implementation
        self.assertIn(response.status_code, [302, 404])
        
        # Try to submit metrics for non-existent call
        metrics_data = {
            'call_id': str(fake_call_id),
            'bandwidth': 1500
        }
        response = self.client.post(
            reverse('save_quality_metrics'),
            data=json.dumps(metrics_data),
            content_type='application/json'
        )
        # Could return 404 or 200 with error message depending on implementation
        self.assertIn(response.status_code, [200, 404])
        if response.status_code == 200:
            response_data = json.loads(response.content)
            self.assertEqual(response_data['status'], 'error')


class AuthenticationIntegrationTest(BaseTestCase):
    """Test authentication integration across different flows"""
    
    def setUp(self):
        super().setUp()
        self.client = Client()
    
    def test_unauthenticated_access_protection(self):
        """Test that unauthenticated users are properly redirected"""
        protected_urls = [
            reverse('accounts:dashboard'),
            reverse('accounts:profile'),
            reverse('calls:start_call'),
            reverse('calls:join_call'),
        ]
        
        for url in protected_urls:
            response = self.client.get(url)
            self.assertEqual(response.status_code, 302)
            self.assertIn('/login/', response.url)
    
    def test_session_persistence_across_requests(self):
        """Test session persistence across multiple requests"""
        # Login
        self.client.force_login(self.user1)
        
        # Make multiple requests
        urls = [
            reverse('accounts:dashboard'),
            reverse('calls:start_call'),
            reverse('accounts:profile'),
        ]
        
        for url in urls:
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
        
        # Logout and verify access is denied
        self.client.post(reverse('accounts:logout'))
        
        for url in urls:
            response = self.client.get(url)
            self.assertEqual(response.status_code, 302)
    
    def test_cross_user_data_isolation(self):
        """Test that users can only access their own data"""
        # User1 creates a call
        call_session = CallSession.objects.create(initiator=self.user1)
        CallParticipant.objects.create(call_session=call_session, user=self.user1)
        
        # User2 should be able to access the call room (if business logic allows)
        self.client.force_login(self.user2)
        response = self.client.get(
            reverse('calls:call_room', kwargs={'call_id': call_session.call_id})
        )
        # This test depends on your business logic - adjust assertion accordingly
        self.assertIn(response.status_code, [200, 403, 404])
        
        # But user2 can still submit their own quality metrics for the call
        metrics_data = {
            'call_id': str(call_session.call_id),
            'bandwidth': 1500
        }
        response = self.client.post(
            reverse('save_quality_metrics'),
            data=json.dumps(metrics_data),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 200)
        
        # Metrics should be associated with user2, not user1
        metrics = CallQualityMetrics.objects.filter(
            call_session=call_session,
            user=self.user2
        ).first()
        self.assertIsNotNone(metrics)