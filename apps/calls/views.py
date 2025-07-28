import uuid
from django.shortcuts import render, get_object_or_404, redirect
from django.contrib.auth.decorators import login_required
from django.contrib.auth import get_user_model
from django.contrib import messages
from django.conf import settings
from .models import CallSession, CallParticipant
from apps.quality_settings.models import QualityProfile

User = get_user_model()

@login_required
def call_room(request, call_id):
    try:
        call_session = CallSession.objects.get(call_id=call_id)
    except CallSession.DoesNotExist:
        messages.error(request, 'Call session not found.')
        return redirect('accounts:dashboard')
    
    # Check if call is still active
    if call_session.status == 'ended':
        messages.error(request, 'This call has already ended.')
        return redirect('accounts:dashboard')
    
    # Add user as participant if not already joined (for direct URL access)
    participant, created = CallParticipant.objects.get_or_create(
        call_session=call_session,
        user=request.user,
        defaults={'is_active': True}
    )
    
    if not created and not participant.is_active:
        # Reactivate participant if they're rejoining
        participant.is_active = True
        participant.left_at = None
        participant.save()
        
    if created:
        messages.success(request, 'Joined call successfully!')
    
    # Get or create quality profile for user
    quality_profile = QualityProfile.get_or_create_for_user(request.user)
    
    context = {
        'call_session': call_session,
        'call_id': call_id,
        'user_id': str(request.user.id),
        'username': request.user.username,
        'quality_profile': quality_profile,
        'webrtc_servers': settings.WEBRTC_SERVERS,
    }
    return render(request, 'calls/call_room.html', context)

@login_required
def start_call(request):
    if request.method == 'POST':
        call_type = request.POST.get('call_type', 'video')
        target_username = request.POST.get('target_username')
        
        if target_username:
            try:
                target_user = User.objects.get(username=target_username)
                call_session = CallSession.objects.create(
                    initiator=request.user,
                    call_type=call_type
                )
                # Add both users as participants
                CallParticipant.objects.create(call_session=call_session, user=request.user)
                CallParticipant.objects.create(call_session=call_session, user=target_user)
                
                return redirect('calls:call_room', call_id=call_session.call_id)
            except User.DoesNotExist:
                messages.error(request, 'User not found.')
        else:
            # Create a new call session for anyone to join
            call_session = CallSession.objects.create(
                initiator=request.user,
                call_type=call_type
            )
            CallParticipant.objects.create(call_session=call_session, user=request.user)
            return redirect('calls:call_room', call_id=call_session.call_id)
    
    users = User.objects.exclude(id=request.user.id)
    return render(request, 'calls/start_call.html', {'users': users})

@login_required
def join_call(request):
    if request.method == 'POST':
        call_id = request.POST.get('call_id', '').strip()
        
        if not call_id:
            messages.error(request, 'Please enter a call ID.')
            return redirect('accounts:dashboard')
        
        try:
            # Try to parse as UUID and find the call session
            call_session = CallSession.objects.get(call_id=call_id)
            
            # Check if call is still active
            if call_session.status == 'ended':
                messages.error(request, 'This call has already ended.')
                return redirect('accounts:dashboard')
            
            # Add user as participant if not already joined
            participant, created = CallParticipant.objects.get_or_create(
                call_session=call_session,
                user=request.user,
                defaults={'is_active': True}
            )
            
            if not created and not participant.is_active:
                # Reactivate participant if they rejoining
                participant.is_active = True
                participant.left_at = None
                participant.save()
            
            messages.success(request, f'Joined call successfully!')
            return redirect('calls:call_room', call_id=call_session.call_id)
            
        except (ValueError, CallSession.DoesNotExist):
            messages.error(request, 'Invalid call ID. Please check and try again.')
            return redirect('accounts:dashboard')
    
    return redirect('accounts:dashboard')

@login_required
def quality_settings(request):
    quality_profile = QualityProfile.get_or_create_for_user(request.user)
    
    if request.method == 'POST':
        quality_profile.default_video_quality = request.POST.get('default_video_quality')
        quality_profile.default_audio_quality = request.POST.get('default_audio_quality')
        quality_profile.adaptive_quality = request.POST.get('adaptive_quality') == 'on'
        quality_profile.data_saver_mode = request.POST.get('data_saver_mode') == 'on'
        quality_profile.save()
        messages.success(request, 'Quality settings updated successfully!')
        return redirect('calls:quality_settings')
    
    return render(request, 'calls/quality_settings.html', {'quality_profile': quality_profile})
