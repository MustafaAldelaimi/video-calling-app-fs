import json
import asyncio
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from .models import CallSession, CallParticipant

User = get_user_model()

class CallConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.call_id = self.scope['url_route']['kwargs']['call_id']
        self.call_group_name = f'call_{self.call_id}'
        self.user = self.scope['user']
        
        if self.user.is_anonymous:
            await self.close()
            return
        
        # Join call group
        await self.channel_layer.group_add(
            self.call_group_name,
            self.channel_name
        )
        
        await self.accept()
        
        # Add user to call participants
        await self.add_participant_to_call()
        
        # Notify others that user joined
        await self.channel_layer.group_send(
            self.call_group_name,
            {
                'type': 'user_joined',
                'user_id': str(self.user.id),
                'username': self.user.username,
            }
        )

    async def disconnect(self, close_code):
        # Remove user from call participants
        await self.remove_participant_from_call()
        
        # Notify others that user left
        await self.channel_layer.group_send(
            self.call_group_name,
            {
                'type': 'user_left',
                'user_id': str(self.user.id),
                'username': self.user.username,
            }
        )
        
        # Leave call group
        await self.channel_layer.group_discard(
            self.call_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            message_type = data.get('type')
            
            if message_type == 'offer':
                await self.handle_webrtc_offer(data)
            elif message_type == 'answer':
                await self.handle_webrtc_answer(data)
            elif message_type == 'ice_candidate':
                await self.handle_ice_candidate(data)
            elif message_type == 'quality_change':
                await self.handle_quality_change(data)
            elif message_type == 'screen_share_start':
                await self.handle_screen_share_start(data)
            elif message_type == 'screen_share_stop':
                await self.handle_screen_share_stop(data)
                
        except json.JSONDecodeError:
            await self.send(text_data=json.dumps({
                'type': 'error',
                'message': 'Invalid JSON data'
            }))

    async def handle_webrtc_offer(self, data):
        await self.channel_layer.group_send(
            self.call_group_name,
            {
                'type': 'webrtc_offer',
                'offer': data.get('offer'),
                'sender_id': str(self.user.id),
                'target_id': data.get('target_id'),
            }
        )

    async def handle_webrtc_answer(self, data):
        await self.channel_layer.group_send(
            self.call_group_name,
            {
                'type': 'webrtc_answer',
                'answer': data.get('answer'),
                'sender_id': str(self.user.id),
                'target_id': data.get('target_id'),
            }
        )

    async def handle_ice_candidate(self, data):
        await self.channel_layer.group_send(
            self.call_group_name,
            {
                'type': 'ice_candidate',
                'candidate': data.get('candidate'),
                'sender_id': str(self.user.id),
                'target_id': data.get('target_id'),
            }
        )

    async def handle_quality_change(self, data):
        await self.channel_layer.group_send(
            self.call_group_name,
            {
                'type': 'quality_change',
                'quality': data.get('quality'),
                'sender_id': str(self.user.id),
            }
        )

    async def handle_screen_share_start(self, data):
        await self.channel_layer.group_send(
            self.call_group_name,
            {
                'type': 'screen_share_start',
                'sender_id': str(self.user.id),
                'username': self.user.username,
            }
        )

    async def handle_screen_share_stop(self, data):
        await self.channel_layer.group_send(
            self.call_group_name,
            {
                'type': 'screen_share_stop',
                'sender_id': str(self.user.id),
                'username': self.user.username,
            }
        )

    # Group message handlers
    async def user_joined(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_joined',
            'user_id': event['user_id'],
            'username': event['username'],
        }))

    async def user_left(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_left',
            'user_id': event['user_id'],
            'username': event['username'],
        }))

    async def webrtc_offer(self, event):
        if event['target_id'] == str(self.user.id) or not event.get('target_id'):
            await self.send(text_data=json.dumps({
                'type': 'webrtc_offer',
                'offer': event['offer'],
                'sender_id': event['sender_id'],
            }))

    async def webrtc_answer(self, event):
        if event['target_id'] == str(self.user.id):
            await self.send(text_data=json.dumps({
                'type': 'webrtc_answer',
                'answer': event['answer'],
                'sender_id': event['sender_id'],
            }))

    async def ice_candidate(self, event):
        if event['target_id'] == str(self.user.id) or not event.get('target_id'):
            await self.send(text_data=json.dumps({
                'type': 'ice_candidate',
                'candidate': event['candidate'],
                'sender_id': event['sender_id'],
            }))

    async def quality_change(self, event):
        await self.send(text_data=json.dumps({
            'type': 'quality_change',
            'quality': event['quality'],
            'sender_id': event['sender_id'],
        }))

    async def screen_share_start(self, event):
        await self.send(text_data=json.dumps({
            'type': 'screen_share_start',
            'sender_id': event['sender_id'],
            'username': event['username'],
        }))

    async def screen_share_stop(self, event):
        await self.send(text_data=json.dumps({
            'type': 'screen_share_stop',
            'sender_id': event['sender_id'],
            'username': event['username'],
        }))

    @database_sync_to_async
    def add_participant_to_call(self):
        try:
            call_session = CallSession.objects.get(call_id=self.call_id)
            participant, created = CallParticipant.objects.get_or_create(
                call_session=call_session,
                user=self.user,
                defaults={'is_active': True}
            )
            if not created:
                participant.is_active = True
                participant.save()
        except CallSession.DoesNotExist:
            pass

    @database_sync_to_async
    def remove_participant_from_call(self):
        try:
            participant = CallParticipant.objects.get(
                call_session__call_id=self.call_id,
                user=self.user
            )
            participant.is_active = False
            participant.save()
        except CallParticipant.DoesNotExist:
            pass
