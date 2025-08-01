"""
Service tests for video calling app
"""
from django.test import TestCase
from django.core.cache import cache
from unittest.mock import patch, MagicMock

from apps.calls.services import QualityAdaptationService, CallService
from apps.calls.models import CallSession, CallParticipant
from .test_utils import BaseTestCase, QualityTestMixin


class QualityAdaptationServiceTest(BaseTestCase, QualityTestMixin):
    """Tests for QualityAdaptationService"""
    
    def test_get_optimal_quality_low_bandwidth(self):
        """Test optimal quality calculation with low bandwidth"""
        quality = QualityAdaptationService.get_optimal_quality(
            bandwidth_kbps=300,
            cpu_usage_percent=50
        )
        self.assertEqual(quality, 'low')
    
    def test_get_optimal_quality_high_cpu(self):
        """Test optimal quality calculation with high CPU usage"""
        quality = QualityAdaptationService.get_optimal_quality(
            bandwidth_kbps=5000,
            cpu_usage_percent=85
        )
        self.assertEqual(quality, 'low')
    
    def test_get_optimal_quality_medium_conditions(self):
        """Test optimal quality calculation with medium conditions"""
        quality = QualityAdaptationService.get_optimal_quality(
            bandwidth_kbps=1500,
            cpu_usage_percent=65
        )
        self.assertEqual(quality, 'medium')
    
    def test_get_optimal_quality_high_conditions(self):
        """Test optimal quality calculation with high conditions"""
        quality = QualityAdaptationService.get_optimal_quality(
            bandwidth_kbps=3000,
            cpu_usage_percent=45
        )
        self.assertEqual(quality, 'high')
    
    def test_get_optimal_quality_ultra_conditions(self):
        """Test optimal quality calculation with ultra conditions"""
        quality = QualityAdaptationService.get_optimal_quality(
            bandwidth_kbps=8000,
            cpu_usage_percent=30
        )
        self.assertEqual(quality, 'ultra')
    
    def test_get_optimal_quality_boundary_conditions(self):
        """Test optimal quality calculation at boundary conditions"""
        # Test exact boundary values
        test_cases = [
            (500, 50, 'medium'),  # Bandwidth boundary
            (499, 50, 'low'),     # Just below bandwidth boundary
            (2000, 50, 'high'),   # Bandwidth boundary
            (1999, 50, 'medium'), # Just below bandwidth boundary
            (5000, 50, 'ultra'),  # Bandwidth boundary
            (4999, 50, 'high'),   # Just below bandwidth boundary
            (1000, 81, 'low'),    # CPU boundary (81 > 80)
            (1000, 80, 'medium'), # CPU boundary (80 not > 80)
            (1000, 61, 'medium'), # CPU boundary (61 > 60)
            (1000, 60, 'medium'), # CPU boundary (60 not > 60)
        ]
        
        for bandwidth, cpu, expected in test_cases:
            with self.subTest(bandwidth=bandwidth, cpu=cpu):
                quality = QualityAdaptationService.get_optimal_quality(
                    bandwidth_kbps=bandwidth,
                    cpu_usage_percent=cpu
                )
                self.assertEqual(quality, expected)
    
    def test_get_optimal_quality_default_cpu(self):
        """Test optimal quality calculation with default CPU usage"""
        quality = QualityAdaptationService.get_optimal_quality(
            bandwidth_kbps=1500
        )
        # Default CPU is 50%, so with 1500kbps bandwidth should be medium
        self.assertEqual(quality, 'medium')
    
    def test_get_optimal_quality_extreme_values(self):
        """Test optimal quality calculation with extreme values"""
        # Very low bandwidth
        quality = QualityAdaptationService.get_optimal_quality(
            bandwidth_kbps=10,
            cpu_usage_percent=10
        )
        self.assertEqual(quality, 'low')
        
        # Very high bandwidth
        quality = QualityAdaptationService.get_optimal_quality(
            bandwidth_kbps=100000,
            cpu_usage_percent=10
        )
        self.assertEqual(quality, 'ultra')
        
        # Very high CPU
        quality = QualityAdaptationService.get_optimal_quality(
            bandwidth_kbps=10000,
            cpu_usage_percent=100
        )
        self.assertEqual(quality, 'low')
    
    def test_get_quality_constraints_low(self):
        """Test quality constraints for low quality"""
        constraints = QualityAdaptationService.get_quality_constraints('low')
        expected = {
            'video': {'width': 640, 'height': 360, 'frameRate': 15, 'bitrate': 300},
            'audio': {'bitrate': 32}
        }
        self.assertEqual(constraints, expected)
    
    def test_get_quality_constraints_medium(self):
        """Test quality constraints for medium quality"""
        constraints = QualityAdaptationService.get_quality_constraints('medium')
        expected = {
            'video': {'width': 1280, 'height': 720, 'frameRate': 30, 'bitrate': 1000},
            'audio': {'bitrate': 64}
        }
        self.assertEqual(constraints, expected)
    
    def test_get_quality_constraints_high(self):
        """Test quality constraints for high quality"""
        constraints = QualityAdaptationService.get_quality_constraints('high')
        expected = {
            'video': {'width': 1920, 'height': 1080, 'frameRate': 30, 'bitrate': 2500},
            'audio': {'bitrate': 128}
        }
        self.assertEqual(constraints, expected)
    
    def test_get_quality_constraints_ultra(self):
        """Test quality constraints for ultra quality"""
        constraints = QualityAdaptationService.get_quality_constraints('ultra')
        expected = {
            'video': {'width': 3840, 'height': 2160, 'frameRate': 30, 'bitrate': 8000},
            'audio': {'bitrate': 256}
        }
        self.assertEqual(constraints, expected)
    
    def test_get_quality_constraints_invalid(self):
        """Test quality constraints for invalid quality level"""
        constraints = QualityAdaptationService.get_quality_constraints('invalid')
        # Should return medium as default
        expected = {
            'video': {'width': 1280, 'height': 720, 'frameRate': 30, 'bitrate': 1000},
            'audio': {'bitrate': 64}
        }
        self.assertEqual(constraints, expected)
    
    def test_get_quality_constraints_none(self):
        """Test quality constraints for None quality level"""
        constraints = QualityAdaptationService.get_quality_constraints(None)
        # Should return medium as default
        expected = {
            'video': {'width': 1280, 'height': 720, 'frameRate': 30, 'bitrate': 1000},
            'audio': {'bitrate': 64}
        }
        self.assertEqual(constraints, expected)
    
    def test_get_quality_constraints_empty_string(self):
        """Test quality constraints for empty string quality level"""
        constraints = QualityAdaptationService.get_quality_constraints('')
        # Should return medium as default
        expected = {
            'video': {'width': 1280, 'height': 720, 'frameRate': 30, 'bitrate': 1000},
            'audio': {'bitrate': 64}
        }
        self.assertEqual(constraints, expected)
    
    def test_quality_progression(self):
        """Test that quality levels progress logically"""
        qualities = ['low', 'medium', 'high', 'ultra']
        
        for i in range(len(qualities) - 1):
            current_constraints = QualityAdaptationService.get_quality_constraints(qualities[i])
            next_constraints = QualityAdaptationService.get_quality_constraints(qualities[i + 1])
            
            # Video resolution should increase
            self.assertLess(
                current_constraints['video']['width'] * current_constraints['video']['height'],
                next_constraints['video']['width'] * next_constraints['video']['height']
            )
            
            # Video bitrate should increase
            self.assertLess(
                current_constraints['video']['bitrate'],
                next_constraints['video']['bitrate']
            )
            
            # Audio bitrate should increase
            self.assertLess(
                current_constraints['audio']['bitrate'],
                next_constraints['audio']['bitrate']
            )


class CallServiceTest(BaseTestCase):
    """Tests for CallService"""
    
    def setUp(self):
        super().setUp()
        # Clear cache before each test
        cache.clear()
    
    def tearDown(self):
        super().tearDown()
        # Clear cache after each test
        cache.clear()
    
    def test_get_active_calls_no_cache(self):
        """Test getting active calls when not cached"""
        # Create some calls
        active_call = self.create_call_session(self.user1, status='active')
        ended_call = self.create_call_session(self.user1, status='ended')
        
        # Add user1 as participant to both calls
        self.create_call_participant(active_call, self.user1)
        self.create_call_participant(ended_call, self.user1)
        
        # Set ended_at for ended call
        from django.utils import timezone
        ended_call.ended_at = timezone.now()
        ended_call.save()
        
        # Get active calls
        active_calls = CallService.get_active_calls(self.user1.id)
        
        # Should only return active call (ended_at is null)
        self.assertEqual(len(active_calls), 1)
        self.assertEqual(active_calls[0].id, active_call.id)
    
    def test_get_active_calls_with_cache(self):
        """Test getting active calls when cached"""
        # Create a call
        call = self.create_call_session(self.user1, status='active')
        self.create_call_participant(call, self.user1)
        
        # First call should cache the result
        active_calls_1 = CallService.get_active_calls(self.user1.id)
        self.assertEqual(len(active_calls_1), 1)
        
        # Create another call (should not appear due to cache)
        new_call = self.create_call_session(self.user1, status='active')
        self.create_call_participant(new_call, self.user1)
        
        # Second call should return cached result
        active_calls_2 = CallService.get_active_calls(self.user1.id)
        self.assertEqual(len(active_calls_2), 1)
        # Compare the actual objects, not QuerySets
        self.assertEqual(list(active_calls_1), list(active_calls_2))
    
    def test_get_active_calls_cache_expiry(self):
        """Test cache expiry for active calls"""
        call = self.create_call_session(self.user1, status='active')
        self.create_call_participant(call, self.user1)
        
        # Get calls (should cache)
        active_calls_1 = CallService.get_active_calls(self.user1.id)
        self.assertEqual(len(active_calls_1), 1)
        
        # Manually clear cache to simulate expiry
        cache_key = f"active_calls_{self.user1.id}"
        cache.delete(cache_key)
        
        # Create another call
        new_call = self.create_call_session(self.user1, status='active')
        self.create_call_participant(new_call, self.user1)
        
        # Should now return both calls (cache was cleared)
        active_calls_2 = CallService.get_active_calls(self.user1.id)
        self.assertEqual(len(active_calls_2), 2)
    
    def test_get_active_calls_no_calls(self):
        """Test getting active calls when user has no calls"""
        active_calls = CallService.get_active_calls(self.user1.id)
        self.assertEqual(len(active_calls), 0)
    
    def test_get_active_calls_only_ended_calls(self):
        """Test getting active calls when user only has ended calls"""
        # Create ended call
        ended_call = self.create_call_session(self.user1, status='ended')
        self.create_call_participant(ended_call, self.user1)
        
        from django.utils import timezone
        ended_call.ended_at = timezone.now()
        ended_call.save()
        
        active_calls = CallService.get_active_calls(self.user1.id)
        self.assertEqual(len(active_calls), 0)
    
    def test_get_active_calls_multiple_users(self):
        """Test getting active calls for different users"""
        # Create calls for different users
        call1 = self.create_call_session(self.user1, status='active')
        call2 = self.create_call_session(self.user2, status='active')
        
        self.create_call_participant(call1, self.user1)
        self.create_call_participant(call2, self.user2)
        
        # Each user should only see their own calls
        user1_calls = CallService.get_active_calls(self.user1.id)
        user2_calls = CallService.get_active_calls(self.user2.id)
        
        self.assertEqual(len(user1_calls), 1)
        self.assertEqual(len(user2_calls), 1)
        self.assertEqual(user1_calls[0].id, call1.id)
        self.assertEqual(user2_calls[0].id, call2.id)
    
    def test_get_active_calls_participant_in_multiple_calls(self):
        """Test getting active calls when user is participant in multiple calls"""
        # Create multiple calls with user1 as participant
        call1 = self.create_call_session(self.user2, status='active')  # user2 initiates
        call2 = self.create_call_session(self.user3, status='active')  # user3 initiates
        
        # Add user1 as participant to both
        self.create_call_participant(call1, self.user1)
        self.create_call_participant(call2, self.user1)
        
        active_calls = CallService.get_active_calls(self.user1.id)
        self.assertEqual(len(active_calls), 2)
        
        call_ids = [call.id for call in active_calls]
        self.assertIn(call1.id, call_ids)
        self.assertIn(call2.id, call_ids)
    
    def test_get_active_calls_prefetch_related(self):
        """Test that get_active_calls uses proper prefetch_related"""
        call = self.create_call_session(self.user1, status='active')
        self.create_call_participant(call, self.user1)
        self.create_call_participant(call, self.user2)
        
        with self.assertNumQueries(2):  # 1 for calls with select_related initiator, 1 for prefetch participants
            active_calls = CallService.get_active_calls(self.user1.id)
            
            # Access related objects (should not trigger additional queries)
            for call in active_calls:
                _ = call.initiator.username
                _ = list(call.participants.all())
    
    def test_get_active_calls_cache_key_uniqueness(self):
        """Test that cache keys are unique per user"""
        call1 = self.create_call_session(self.user1, status='active')
        call2 = self.create_call_session(self.user2, status='active')
        
        self.create_call_participant(call1, self.user1)
        self.create_call_participant(call2, self.user2)
        
        # Get calls for both users
        user1_calls = CallService.get_active_calls(self.user1.id)
        user2_calls = CallService.get_active_calls(self.user2.id)
        
        # Each should have their own cached result
        self.assertEqual(len(user1_calls), 1)
        self.assertEqual(len(user2_calls), 1)
        self.assertNotEqual(user1_calls[0].id, user2_calls[0].id)
    
    @patch('django.core.cache.cache.get')
    @patch('django.core.cache.cache.set')
    def test_get_active_calls_cache_operations(self, mock_cache_set, mock_cache_get):
        """Test cache operations in get_active_calls"""
        # Mock cache miss
        mock_cache_get.return_value = None
        
        call = self.create_call_session(self.user1, status='active')
        self.create_call_participant(call, self.user1)
        
        active_calls = CallService.get_active_calls(self.user1.id)
        
        # Verify cache operations
        cache_key = f"active_calls_{self.user1.id}"
        mock_cache_get.assert_called_once_with(cache_key)
        mock_cache_set.assert_called_once_with(cache_key, active_calls, 300)
    
    def test_get_active_calls_with_different_statuses(self):
        """Test active calls filtering with different call statuses"""
        # Create calls with different statuses
        waiting_call = self.create_call_session(self.user1, status='waiting')
        ringing_call = self.create_call_session(self.user1, status='ringing')
        active_call = self.create_call_session(self.user1, status='active')
        ended_call = self.create_call_session(self.user1, status='ended')
        missed_call = self.create_call_session(self.user1, status='missed')
        
        # Add user as participant to all calls
        for call in [waiting_call, ringing_call, active_call, ended_call, missed_call]:
            self.create_call_participant(call, self.user1)
        
        # Set ended_at for ended and missed calls
        from django.utils import timezone
        ended_call.ended_at = timezone.now()
        missed_call.ended_at = timezone.now()
        ended_call.save()
        missed_call.save()
        
        active_calls = CallService.get_active_calls(self.user1.id)
        
        # Should only return calls where ended_at is null
        expected_statuses = {'waiting', 'ringing', 'active'}
        actual_statuses = {call.status for call in active_calls}
        
        self.assertEqual(len(active_calls), 3)
        self.assertEqual(actual_statuses, expected_statuses)


class ServiceIntegrationTest(BaseTestCase):
    """Integration tests for services"""
    
    def test_quality_adaptation_service_integration(self):
        """Test QualityAdaptationService integration with real scenarios"""
        # Simulate a scenario where network conditions change
        scenarios = [
            {'bandwidth': 5000, 'cpu': 30, 'expected_quality': 'ultra'},
            {'bandwidth': 2000, 'cpu': 50, 'expected_quality': 'high'},
            {'bandwidth': 800, 'cpu': 70, 'expected_quality': 'medium'},
            {'bandwidth': 300, 'cpu': 85, 'expected_quality': 'low'},
        ]
        
        for scenario in scenarios:
            quality = QualityAdaptationService.get_optimal_quality(
                scenario['bandwidth'], scenario['cpu']
            )
            constraints = QualityAdaptationService.get_quality_constraints(quality)
            
            self.assertEqual(quality, scenario['expected_quality'])
            self.assertIn('video', constraints)
            self.assertIn('audio', constraints)
            self.assertIsInstance(constraints['video']['bitrate'], int)
            self.assertIsInstance(constraints['audio']['bitrate'], int)
    
    def test_call_service_with_quality_metrics(self):
        """Test CallService integration with quality metrics"""
        # Create a call and add quality metrics
        call = self.create_call_session(self.user1, status='active')
        self.create_call_participant(call, self.user1)
        self.create_quality_metrics(call, self.user1, 1500, 25, 0.05)
        
        active_calls = CallService.get_active_calls(self.user1.id)
        self.assertEqual(len(active_calls), 1)
        
        # Verify we can access quality metrics through the call
        quality_metrics = active_calls[0].callqualitymetrics_set.all()
        self.assertEqual(len(quality_metrics), 1)
        self.assertEqual(quality_metrics[0].bandwidth_kbps, 1500)