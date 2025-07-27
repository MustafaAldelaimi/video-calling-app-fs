from django.core.cache import cache
from .models import CallSession, CallQualityMetrics

class QualityAdaptationService:
    @staticmethod
    def get_optimal_quality(bandwidth_kbps, cpu_usage_percent=50):
        """Determine optimal quality based on system resources"""
        if bandwidth_kbps < 500 or cpu_usage_percent > 80:
            return 'low'
        elif bandwidth_kbps < 2000 or cpu_usage_percent > 60:
            return 'medium'
        elif bandwidth_kbps < 5000:
            return 'high'
        else:
            return 'ultra'
    
    @staticmethod
    def get_quality_constraints(quality_level):
        """Return WebRTC constraints for quality level"""
        profiles = {
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
        return profiles.get(quality_level, profiles['medium'])

class CallService:
    @staticmethod
    def get_active_calls(user_id):
        cache_key = f"active_calls_{user_id}"
        calls = cache.get(cache_key)
        
        if not calls:
            calls = CallSession.objects.filter(
                participants__id=user_id,
                ended_at__isnull=True
            ).select_related('initiator').prefetch_related('participants')
            cache.set(cache_key, calls, 300)  # 5 minutes
        
        return calls
