from django.http import JsonResponse, HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404
from django.conf import settings
import json
import os
from .models import CallSession, CallQualityMetrics

def webrtc_js(request):
    """Serve the WebRTC JavaScript file"""
    js_path = os.path.join(settings.BASE_DIR, 'static', 'js', 'webrtc-handler.js')
    try:
        with open(js_path, 'r') as f:
            content = f.read()
        return HttpResponse(content, content_type='application/javascript')
    except FileNotFoundError:
        return HttpResponse('// WebRTC handler not found', content_type='application/javascript')

@csrf_exempt
@login_required
def save_quality_metrics(request):
    """Save quality metrics from the client"""
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            call_id = data.get('call_id')
            bandwidth = data.get('bandwidth', 0)
            latency = data.get('latency', 0)
            packet_loss = data.get('packet_loss', 0.0)
            video_quality = data.get('video_quality', 'medium')
            audio_quality = data.get('audio_quality', 'medium')
            
            call_session = get_object_or_404(CallSession, call_id=call_id)
            
            CallQualityMetrics.objects.create(
                call_session=call_session,
                user=request.user,
                bandwidth_kbps=bandwidth,
                latency_ms=latency,
                packet_loss_percent=packet_loss,
                video_quality=video_quality,
                audio_quality=audio_quality
            )
            
            return JsonResponse({'status': 'success'})
        except Exception as e:
            return JsonResponse({'status': 'error', 'message': str(e)})
    
    return JsonResponse({'status': 'error', 'message': 'Invalid request method'})

@login_required
def call_status(request, call_id):
    """Get call status and participant information"""
    try:
        call_session = get_object_or_404(CallSession, call_id=call_id)
        participants = call_session.participants.all()
        
        data = {
            'call_id': str(call_session.call_id),
            'status': call_session.status,
            'call_type': call_session.call_type,
            'started_at': call_session.started_at.isoformat(),
            'participants': [
                {
                    'id': str(p.id),
                    'username': p.username,
                    'is_online': p.is_online
                } for p in participants
            ]
        }
        
        return JsonResponse(data)
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': str(e)})
