"""
Edge case and error handling tests for video calling app
"""
import json
import uuid
import threading
import time
from django.test import TestCase, TransactionTestCase, Client
from django.urls import reverse
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.cache import cache
from unittest.mock import patch, MagicMock, Mock
from concurrent.futures import ThreadPoolExecutor, as_completed

from apps.calls.models import CallSession, CallParticipant, CallQualityMetrics
from apps.messaging.models import Message
from apps.media.models import FileUpload, ProcessedMedia
from apps.quality_settings.models import QualityProfile
from apps.calls.services import QualityAdaptationService, CallService
from .test_utils import BaseTestCase

User = get_user_model()


class DatabaseConstraintEdgeCasesTest(BaseTestCase):
    """Test database constraints and edge cases"""
    
    def test_duplicate_call_participant(self):
        """Test duplicate call participant constraint"""
        call_session = self.create_call_session(self.user1)
        self.create_call_participant(call_session, self.user1)
        
        # Attempting to add same user to same call should fail
        with self.assertRaises(IntegrityError):
            self.create_call_participant(call_session, self.user1)
    
    def test_duplicate_quality_profile(self):
        """Test duplicate quality profile constraint"""
        self.create_quality_profile(self.user1)
        
        # Attempting to create another profile for same user should fail
        with self.assertRaises(IntegrityError):
            self.create_quality_profile(self.user1)
    
    def test_call_id_uniqueness(self):
        """Test call_id uniqueness constraint"""
        call1 = self.create_call_session(self.user1)
        call2 = self.create_call_session(self.user2)
        
        # Each call should have unique call_id
        self.assertNotEqual(call1.call_id, call2.call_id)
        
        # Manually trying to create duplicate call_id should fail
        with self.assertRaises(IntegrityError):
            CallSession.objects.create(
                initiator=self.user1,
                call_id=call1.call_id  # Duplicate call_id
            )
    
    def test_cascade_delete_behavior(self):
        """Test cascade delete behavior"""
        call_session = self.create_call_session(self.user1)
        participant = self.create_call_participant(call_session, self.user2)
        metrics = self.create_quality_metrics(call_session, self.user2)
        
        participant_id = participant.id
        metrics_id = metrics.id
        
        # Delete call session
        call_session.delete()
        
        # Participants and metrics should be deleted too
        with self.assertRaises(CallParticipant.DoesNotExist):
            CallParticipant.objects.get(id=participant_id)
        
        with self.assertRaises(CallQualityMetrics.DoesNotExist):
            CallQualityMetrics.objects.get(id=metrics_id)
    
    def test_user_deletion_impact(self):
        """Test impact of user deletion on related objects"""
        call_session = self.create_call_session(self.user1)
        participant = self.create_call_participant(call_session, self.user1)
        message = self.create_message(self.user1, self.user2)
        file_upload = self.create_file_upload(self.user1)
        
        participant_id = participant.id
        message_id = message.id
        file_id = file_upload.id
        
        # Delete user
        self.user1.delete()
        
        # Related objects should be deleted
        with self.assertRaises(CallParticipant.DoesNotExist):
            CallParticipant.objects.get(id=participant_id)
        
        with self.assertRaises(Message.DoesNotExist):
            Message.objects.get(id=message_id)
        
        with self.assertRaises(FileUpload.DoesNotExist):
            FileUpload.objects.get(id=file_id)


class ConcurrencyEdgeCasesTest(TransactionTestCase):
    """Test concurrent operations and race conditions"""
    
    def setUp(self):
        self.user1 = User.objects.create_user(username='user1', password='test123')
        self.user2 = User.objects.create_user(username='user2', password='test123')
        self.user3 = User.objects.create_user(username='user3', password='test123')
    
    def test_concurrent_call_creation(self):
        """Test concurrent call creation by same user"""
        results = []
        errors = []
        
        def create_call():
            try:
                call = CallSession.objects.create(
                    initiator=self.user1,
                    call_type='video'
                )
                results.append(call)
            except Exception as e:
                errors.append(e)
        
        # Create multiple threads to create calls concurrently
        threads = []
        for _ in range(5):
            thread = threading.Thread(target=create_call)
            threads.append(thread)
        
        # Start all threads
        for thread in threads:
            thread.start()
        
        # Wait for all threads to complete
        for thread in threads:
            thread.join()
        
        # All calls should be created successfully (no uniqueness constraint on call creation)
        self.assertEqual(len(results), 5)
        self.assertEqual(len(errors), 0)
        
        # All calls should have unique call_ids
        call_ids = [call.call_id for call in results]
        self.assertEqual(len(call_ids), len(set(call_ids)))
    
    def test_concurrent_participant_addition(self):
        """Test concurrent participant addition to same call"""
        call_session = CallSession.objects.create(
            initiator=self.user1,
            call_type='video'
        )
        
        results = []
        errors = []
        
        def add_participant(user):
            try:
                participant = CallParticipant.objects.create(
                    call_session=call_session,
                    user=user
                )
                results.append(participant)
            except Exception as e:
                errors.append(e)
        
        # Add participants concurrently
        users = [self.user1, self.user2, self.user3]
        threads = []
        
        for user in users:
            thread = threading.Thread(target=add_participant, args=(user,))
            threads.append(thread)
        
        for thread in threads:
            thread.start()
        
        for thread in threads:
            thread.join()
        
        # All participants should be added successfully
        self.assertEqual(len(results), 3)
        self.assertEqual(len(errors), 0)
    
    def test_concurrent_quality_metrics_submission(self):
        """Test concurrent quality metrics submission"""
        call_session = CallSession.objects.create(
            initiator=self.user1,
            call_type='video'
        )
        
        results = []
        errors = []
        
        def submit_metrics(user, bandwidth):
            try:
                metrics = CallQualityMetrics.objects.create(
                    call_session=call_session,
                    user=user,
                    bandwidth_kbps=bandwidth,
                    latency_ms=25,
                    packet_loss_percent=0.05
                )
                results.append(metrics)
            except Exception as e:
                errors.append(e)
        
        # Submit metrics from multiple users concurrently
        threads = []
        for i, user in enumerate([self.user1, self.user2, self.user3]):
            thread = threading.Thread(target=submit_metrics, args=(user, 1000 + i * 100))
            threads.append(thread)
        
        for thread in threads:
            thread.start()
        
        for thread in threads:
            thread.join()
        
        # All metrics should be submitted successfully
        self.assertEqual(len(results), 3)
        self.assertEqual(len(errors), 0)
    
    def test_concurrent_cache_access(self):
        """Test concurrent cache access in CallService"""
        call_session = CallSession.objects.create(
            initiator=self.user1,
            call_type='video'
        )
        CallParticipant.objects.create(call_session=call_session, user=self.user1)
        
        results = []
        
        def get_active_calls():
            calls = CallService.get_active_calls(self.user1.id)
            results.append(len(calls))
        
        # Access cache concurrently
        threads = []
        for _ in range(10):
            thread = threading.Thread(target=get_active_calls)
            threads.append(thread)
        
        for thread in threads:
            thread.start()
        
        for thread in threads:
            thread.join()
        
        # All should return the same result
        self.assertTrue(all(count == 1 for count in results))
        self.assertEqual(len(results), 10)


class BoundaryValueEdgeCasesTest(BaseTestCase):
    """Test boundary values and extreme inputs"""
    
    def test_extremely_long_usernames(self):
        """Test handling of extremely long usernames"""
        # Django default max_length for username is 150
        long_username = 'a' * 150  # Max length
        very_long_username = 'a' * 151  # Over max length
        
        # Max length should work
        user = User.objects.create_user(username=long_username, password='test123')
        self.assertEqual(len(user.username), 150)
        
        # Over max length should be truncated or fail validation
        with self.assertRaises((ValidationError, ValueError)):
            User.objects.create_user(username=very_long_username, password='test123')
    
    def test_extremely_large_file_sizes(self):
        """Test handling of extremely large file sizes"""
        # Test with very large file size
        large_file = self.create_file_upload(
            self.user1,
            'huge_video.mp4',
            size=999999999999,  # Nearly 1TB
            content_type='video/mp4'
        )
        
        self.assertEqual(large_file.file_size, 999999999999)
    
    def test_extreme_quality_metrics_values(self):
        """Test extreme values in quality metrics"""
        call_session = self.create_call_session(self.user1)
        
        # Test with extreme values
        extreme_metrics = CallQualityMetrics.objects.create(
            call_session=call_session,
            user=self.user1,
            bandwidth_kbps=999999999,  # Very high bandwidth
            latency_ms=999999,         # Very high latency
            packet_loss_percent=100.0   # Maximum packet loss
        )
        
        self.assertEqual(extreme_metrics.bandwidth_kbps, 999999999)
        self.assertEqual(extreme_metrics.packet_loss_percent, 100.0)
        
        # Test with zero/negative values
        zero_metrics = CallQualityMetrics.objects.create(
            call_session=call_session,
            user=self.user2,
            bandwidth_kbps=0,
            latency_ms=0,
            packet_loss_percent=0.0
        )
        
        self.assertEqual(zero_metrics.bandwidth_kbps, 0)
        self.assertEqual(zero_metrics.packet_loss_percent, 0.0)
    
    def test_unicode_and_special_characters(self):
        """Test handling of unicode and special characters"""
        # Unicode usernames (if allowed by your system)
        unicode_user = User.objects.create_user(
            username='тест用户🎉',
            password='test123'
        )
        
        # Messages with special characters
        special_message = self.create_message(
            self.user1,
            self.user2,
            'Hello! 🎉 Testing unicode: тест 用户 Arabic: مرحبا Emoji: 😀🎮🚀'
        )
        
        self.assertIsNotNone(special_message)
        self.assertIn('🎉', special_message.content)
    
    def test_empty_and_whitespace_inputs(self):
        """Test handling of empty and whitespace-only inputs"""
        # Empty content message
        empty_message = Message.objects.create(
            sender=self.user1,
            recipient=self.user2,
            content='',  # Empty content
            message_type='text'
        )
        
        self.assertEqual(empty_message.content, '')
        
        # Whitespace-only content
        whitespace_message = Message.objects.create(
            sender=self.user1,
            recipient=self.user2,
            content='   \n\t   ',  # Only whitespace
            message_type='text'
        )
        
        self.assertEqual(whitespace_message.content, '   \n\t   ')
    
    def test_maximum_participants_in_call(self):
        """Test call with maximum number of participants"""
        call_session = self.create_call_session(self.user1)
        
        # Create many users and add them as participants
        users = [self.user1, self.user2, self.user3]
        for i in range(10):  # Add more users
            user = User.objects.create_user(f'user_{i}', password='test123')
            users.append(user)
        
        # Add all users as participants
        for user in users:
            CallParticipant.objects.create(call_session=call_session, user=user)
        
        # Verify all participants were added
        participants = call_session.participants.all()
        self.assertEqual(participants.count(), len(users))


class ErrorHandlingEdgeCasesTest(BaseTestCase):
    """Test error handling in various scenarios"""
    
    def setUp(self):
        super().setUp()
        self.client = Client()
    
    def test_invalid_uuid_handling(self):
        """Test handling of invalid UUIDs in URLs"""
        self.client.force_login(self.user1)
        
        # Test various invalid UUID formats
        invalid_uuids = [
            'not-a-uuid',
            '12345',
            'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',  # Invalid characters
            'too-short',
            '',
        ]
        
        for invalid_uuid in invalid_uuids:
            # These should result in 404 or 400 errors
            response = self.client.get(f'/calls/room/{invalid_uuid}/')
            self.assertIn(response.status_code, [404, 400])
    
    def test_malformed_json_in_api_requests(self):
        """Test handling of malformed JSON in API requests"""
        self.client.force_login(self.user1)
        
        malformed_json_samples = [
            'not json at all',
            '{"incomplete": json',
            '{"null_value": null, "undefined": undefined}',
            '{trailing_comma: true,}',
            '{"unicode": "\u00invalid"}',
        ]
        
        for malformed_json in malformed_json_samples:
            response = self.client.post(
                reverse('save_quality_metrics'),
                data=malformed_json,
                content_type='application/json'
            )
            
            # Should return error response, not crash
            self.assertEqual(response.status_code, 200)
            response_data = json.loads(response.content)
            self.assertEqual(response_data['status'], 'error')
    
    def test_missing_required_fields_in_api(self):
        """Test API behavior with missing required fields"""
        self.client.force_login(self.user1)
        
        incomplete_data_samples = [
            {},  # Completely empty
            {'call_id': 'missing-other-fields'},
            {'bandwidth': 1500},  # Missing call_id
            {'call_id': str(uuid.uuid4()), 'bandwidth': 'invalid-type'},
        ]
        
        for incomplete_data in incomplete_data_samples:
            response = self.client.post(
                reverse('save_quality_metrics'),
                data=json.dumps(incomplete_data),
                content_type='application/json'
            )
            
            # Should handle gracefully
            self.assertIn(response.status_code, [200, 400, 404])
    
    def test_database_connection_error_simulation(self):
        """Test behavior when database operations fail"""
        call_session = self.create_call_session(self.user1)
        
        # Mock database error
        with patch('django.db.models.QuerySet.get', side_effect=Exception("Database error")):
            self.client.force_login(self.user1)
            
            response = self.client.get(
                reverse('call_status', kwargs={'call_id': call_session.call_id})
            )
            
            # Should return error response
            self.assertEqual(response.status_code, 200)
            response_data = json.loads(response.content)
            self.assertEqual(response_data['status'], 'error')
    
    def test_cache_failure_handling(self):
        """Test behavior when cache operations fail"""
        call_session = self.create_call_session(self.user1)
        self.create_call_participant(call_session, self.user1)
        
        # Mock cache failure
        with patch('django.core.cache.cache.get', side_effect=Exception("Cache error")):
            with patch('django.core.cache.cache.set', side_effect=Exception("Cache error")):
                # Should fall back to database
                active_calls = CallService.get_active_calls(self.user1.id)
                self.assertEqual(len(active_calls), 1)
    
    def test_file_system_error_handling(self):
        """Test handling of file system errors"""
        with patch('builtins.open', side_effect=IOError("Disk full")):
            response = self.client.get(reverse('webrtc_js'))
            
            # Should return fallback content
            self.assertEqual(response.status_code, 200)
            self.assertContains(response, '// WebRTC handler not found')
    
    def test_memory_limit_simulation(self):
        """Test behavior under memory constraints"""
        # Simulate memory error during large object creation
        with patch('apps.calls.models.CallSession.objects.create', side_effect=MemoryError("Out of memory")):
            self.client.force_login(self.user1)
            
            call_data = {
                'call_type': 'video',
                'target_username': self.user2.username
            }
            
            response = self.client.post(reverse('calls:start_call'), data=call_data)
            
            # Should handle gracefully (exact behavior depends on implementation)
            self.assertIn(response.status_code, [200, 500])


class NetworkAndTimeoutEdgeCasesTest(BaseTestCase):
    """Test network-related and timeout edge cases"""
    
    def test_quality_adaptation_extreme_conditions(self):
        """Test quality adaptation under extreme network conditions"""
        extreme_scenarios = [
            {'bandwidth': 0, 'cpu': 100, 'expected': 'low'},      # No bandwidth, max CPU
            {'bandwidth': 1, 'cpu': 99, 'expected': 'low'},       # Minimal bandwidth
            {'bandwidth': 999999, 'cpu': 1, 'expected': 'ultra'}, # Unlimited bandwidth
            {'bandwidth': 500, 'cpu': 80, 'expected': 'low'},     # Boundary condition
            {'bandwidth': 2000, 'cpu': 60, 'expected': 'medium'}, # Boundary condition
        ]
        
        for scenario in extreme_scenarios:
            quality = QualityAdaptationService.get_optimal_quality(
                scenario['bandwidth'], 
                scenario['cpu']
            )
            self.assertEqual(quality, scenario['expected'])
    
    def test_invalid_quality_settings(self):
        """Test handling of invalid quality settings"""
        # Test invalid quality levels
        invalid_qualities = ['invalid', None, '', 'ULTRA', 'super_high']
        
        for invalid_quality in invalid_qualities:
            constraints = QualityAdaptationService.get_quality_constraints(invalid_quality)
            
            # Should return default (medium) constraints
            expected_default = {
                'video': {'width': 1280, 'height': 720, 'frameRate': 30, 'bitrate': 1000},
                'audio': {'bitrate': 64}
            }
            self.assertEqual(constraints, expected_default)
    
    def test_negative_quality_metrics(self):
        """Test handling of negative quality metrics"""
        call_session = self.create_call_session(self.user1)
        
        # Create metrics with negative values
        negative_metrics = CallQualityMetrics.objects.create(
            call_session=call_session,
            user=self.user1,
            bandwidth_kbps=-1000,    # Negative bandwidth
            latency_ms=-50,          # Negative latency
            packet_loss_percent=-5.0  # Negative packet loss
        )
        
        # Should store values as provided (validation depends on model constraints)
        self.assertEqual(negative_metrics.bandwidth_kbps, -1000)
        self.assertEqual(negative_metrics.latency_ms, -50)
        self.assertEqual(negative_metrics.packet_loss_percent, -5.0)


class PerformanceEdgeCasesTest(BaseTestCase):
    """Test performance-related edge cases"""
    
    def test_large_number_of_participants(self):
        """Test call with large number of participants"""
        call_session = self.create_call_session(self.user1)
        
        # Add many participants
        users = [self.user1, self.user2, self.user3]
        for i in range(100):  # Create 100 additional users
            user = User.objects.create_user(f'perf_user_{i}', password='test123')
            users.append(user)
        
        # Add all as participants
        for user in users:
            CallParticipant.objects.create(call_session=call_session, user=user)
        
        # Test API performance with many participants
        self.client.force_login(self.user1)
        response = self.client.get(
            reverse('call_status', kwargs={'call_id': call_session.call_id})
        )
        
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertEqual(len(data['participants']), len(users))
    
    def test_many_quality_metrics_entries(self):
        """Test performance with many quality metrics entries"""
        call_session = self.create_call_session(self.user1)
        
        # Create many quality metrics entries
        for i in range(1000):
            CallQualityMetrics.objects.create(
                call_session=call_session,
                user=self.user1,
                bandwidth_kbps=1000 + (i % 100),
                latency_ms=20 + (i % 50),
                packet_loss_percent=(i % 10) / 10.0
            )
        
        # Query should still work efficiently
        metrics_count = CallQualityMetrics.objects.filter(
            call_session=call_session
        ).count()
        
        self.assertEqual(metrics_count, 1000)
    
    def test_rapid_successive_api_calls(self):
        """Test rapid successive API calls"""
        self.client.force_login(self.user1)
        call_session = self.create_call_session(self.user1)
        
        # Make many rapid API calls
        responses = []
        for i in range(50):
            metrics_data = {
                'call_id': str(call_session.call_id),
                'bandwidth': 1500 + i,
                'latency': 25,
                'packet_loss': 0.05
            }
            
            response = self.client.post(
                reverse('save_quality_metrics'),
                data=json.dumps(metrics_data),
                content_type='application/json'
            )
            responses.append(response)
        
        # All should succeed
        success_responses = [r for r in responses if r.status_code == 200]
        self.assertEqual(len(success_responses), 50)
        
        # Verify all metrics were saved
        saved_metrics = CallQualityMetrics.objects.filter(call_session=call_session)
        self.assertEqual(saved_metrics.count(), 50)


class SecurityEdgeCasesTest(BaseTestCase):
    """Test security-related edge cases"""
    
    def setUp(self):
        super().setUp()
        self.client = Client()
    
    def test_sql_injection_attempts(self):
        """Test protection against SQL injection attempts"""
        self.client.force_login(self.user1)
        
        # SQL injection attempts in various fields
        injection_attempts = [
            "'; DROP TABLE auth_user; --",
            "1' OR '1'='1",
            "UNION SELECT * FROM auth_user",
            "'; INSERT INTO calls_callsession VALUES (1,2,3); --"
        ]
        
        for injection in injection_attempts:
            # Try SQL injection in username field
            call_data = {
                'call_type': 'video',
                'target_username': injection
            }
            
            response = self.client.post(reverse('calls:start_call'), data=call_data)
            
            # Should handle safely (user not found error, not SQL error)
            self.assertEqual(response.status_code, 200)
            
            # Ensure no SQL injection occurred
            self.assertTrue(User.objects.filter(username=self.user1.username).exists())
    
    def test_xss_attempts_in_content(self):
        """Test protection against XSS attempts"""
        xss_attempts = [
            "<script>alert('xss')</script>",
            "javascript:alert('xss')",
            "<img src=x onerror=alert('xss')>",
            "';alert('xss');//"
        ]
        
        for xss in xss_attempts:
            # Create message with XSS attempt
            message = Message.objects.create(
                sender=self.user1,
                recipient=self.user2,
                content=xss,
                message_type='text'
            )
            
            # Content should be stored as-is (escaping happens at template level)
            self.assertEqual(message.content, xss)
    
    def test_unauthorized_access_attempts(self):
        """Test unauthorized access attempts"""
        # Create call as user1
        call_session = self.create_call_session(self.user1)
        
        # Try to access without authentication
        response = self.client.get(
            reverse('calls:call_room', kwargs={'call_id': call_session.call_id})
        )
        self.assertEqual(response.status_code, 302)  # Redirect to login
        
        # Try to submit metrics without authentication
        metrics_data = {
            'call_id': str(call_session.call_id),
            'bandwidth': 1500
        }
        response = self.client.post(
            reverse('save_quality_metrics'),
            data=json.dumps(metrics_data),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 302)  # Redirect to login
    
    def test_parameter_tampering(self):
        """Test parameter tampering attempts"""
        self.client.force_login(self.user1)
        call_session = self.create_call_session(self.user2)  # Created by user2
        
        # Try to access call status (should work - depends on business logic)
        response = self.client.get(
            reverse('call_status', kwargs={'call_id': call_session.call_id})
        )
        # Response depends on access control implementation
        self.assertIn(response.status_code, [200, 403, 404])
        
        # Try to submit metrics for call created by another user
        metrics_data = {
            'call_id': str(call_session.call_id),
            'bandwidth': 1500
        }
        response = self.client.post(
            reverse('save_quality_metrics'),
            data=json.dumps(metrics_data),
            content_type='application/json'
        )
        # Should work (users can submit metrics for any call they can access)
        self.assertEqual(response.status_code, 200)