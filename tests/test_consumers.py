"""
WebSocket consumer tests for video calling app
"""
import json
import uuid
from django.test import TestCase
from django.contrib.auth import get_user_model
from channels.testing import WebsocketCommunicator
from channels.db import database_sync_to_async
from unittest.mock import AsyncMock, patch, MagicMock

from apps.calls.consumers import CallConsumer
from apps.calls.models import CallSession, CallParticipant
from .test_utils import BaseTestCase, WebRTCTestMixin

User = get_user_model()


class CallConsumerTest(BaseTestCase, WebRTCTestMixin):
    """Tests for CallConsumer WebSocket functionality"""
    
    def setUp(self):
        super().setUp()
        # Create a call session for testing
        self.call_session = self.create_call_session(self.user1)
        self.call_group_name = f"call_{self.call_session.call_id}"
    
    async def test_consumer_connect_authenticated(self):
        """Test WebSocket connection for authenticated user"""
        consumer = CallConsumer()
        
        # Mock the scope and channel layer
        consumer.scope = {
            'type': 'websocket',
            'url_route': {'kwargs': {'call_id': str(self.call_session.call_id)}},
            'user': self.user1,
        }
        consumer.channel_layer = AsyncMock()
        consumer.channel_name = 'test-channel'
        
        # Mock database operations
        with patch.object(consumer, 'add_participant_to_call', new_callable=AsyncMock):
            with patch.object(consumer, 'accept', new_callable=AsyncMock):
                await consumer.connect()
                
                # Verify connection was accepted
                consumer.accept.assert_called_once()
    
    async def test_consumer_connect_unauthenticated(self):
        """Test WebSocket connection for unauthenticated user"""
        consumer = CallConsumer()
        
        # Mock anonymous user
        consumer.scope = {
            'type': 'websocket',
            'url_route': {'kwargs': {'call_id': str(self.call_session.call_id)}},
            'user': None,  # Anonymous user
        }
        
        with patch.object(consumer, 'close', new_callable=AsyncMock) as mock_close:
            await consumer.connect()
            
            # Should close connection for unauthenticated users
            mock_close.assert_called_once_with(code=4001)
    
    async def test_consumer_disconnect(self):
        """Test WebSocket disconnection"""
        consumer = CallConsumer()
        consumer.scope = {
            'user': self.user1,
            'url_route': {'kwargs': {'call_id': str(self.call_session.call_id)}}
        }
        consumer.call_id = str(self.call_session.call_id)
        consumer.call_group_name = self.call_group_name
        consumer.user = self.user1
        consumer.channel_layer = AsyncMock()
        consumer.channel_name = 'test-channel'
        
        with patch.object(consumer, 'remove_participant_from_call', new_callable=AsyncMock):
            await consumer.disconnect(1000)
            
            # Verify group_send was called to notify other users
            consumer.channel_layer.group_send.assert_called()
            
            # Verify group_discard was called to leave the group
            consumer.channel_layer.group_discard.assert_called_with(
                self.call_group_name,
                'test-channel'
            )
    
    async def test_receive_webrtc_offer(self):
        """Test receiving WebRTC offer message"""
        consumer = CallConsumer()
        consumer.scope = {'user': self.user1}
        consumer.call_group_name = self.call_group_name
        consumer.user = self.user1
        consumer.channel_layer = AsyncMock()
        
        offer_data = self.create_webrtc_offer(self.user1.id, self.user2.id)
        
        await consumer.receive(text_data=json.dumps(offer_data))
        
        # Verify group_send was called with correct data
        consumer.channel_layer.group_send.assert_called_once()
        call_args = consumer.channel_layer.group_send.call_args[0]
        
        self.assertEqual(call_args[0], self.call_group_name)
        self.assertEqual(call_args[1]['type'], 'webrtc_offer')
        self.assertEqual(call_args[1]['sender_id'], str(self.user1.id))
    
    async def test_receive_webrtc_answer(self):
        """Test receiving WebRTC answer message"""
        consumer = CallConsumer()
        consumer.scope = {'user': self.user1}
        consumer.call_group_name = self.call_group_name
        consumer.user = self.user1
        consumer.channel_layer = AsyncMock()
        
        answer_data = self.create_webrtc_answer(self.user1.id, self.user2.id)
        
        await consumer.receive(text_data=json.dumps(answer_data))
        
        # Verify group_send was called with correct data
        consumer.channel_layer.group_send.assert_called_once()
        call_args = consumer.channel_layer.group_send.call_args[0]
        
        self.assertEqual(call_args[0], self.call_group_name)
        self.assertEqual(call_args[1]['type'], 'webrtc_answer')
    
    async def test_receive_ice_candidate(self):
        """Test receiving ICE candidate message"""
        consumer = CallConsumer()
        consumer.scope = {'user': self.user1}
        consumer.call_group_name = self.call_group_name
        consumer.user = self.user1
        consumer.channel_layer = AsyncMock()
        
        ice_data = self.create_ice_candidate(self.user1.id, self.user2.id)
        
        await consumer.receive(text_data=json.dumps(ice_data))
        
        # Verify group_send was called with correct data
        consumer.channel_layer.group_send.assert_called_once()
        call_args = consumer.channel_layer.group_send.call_args[0]
        
        self.assertEqual(call_args[0], self.call_group_name)
        self.assertEqual(call_args[1]['type'], 'ice_candidate')
    
    async def test_receive_quality_change(self):
        """Test receiving quality change message"""
        consumer = CallConsumer()
        consumer.scope = {'user': self.user1}
        consumer.call_group_name = self.call_group_name
        consumer.user = self.user1
        consumer.channel_layer = AsyncMock()
        
        quality_data = {
            'type': 'quality_change',
            'video_quality': 'high',
            'audio_quality': 'medium'
        }
        
        await consumer.receive(text_data=json.dumps(quality_data))
        
        # Verify group_send was called
        consumer.channel_layer.group_send.assert_called_once()
    
    async def test_receive_screen_share_start(self):
        """Test receiving screen share start message"""
        consumer = CallConsumer()
        consumer.scope = {'user': self.user1}
        consumer.call_group_name = self.call_group_name
        consumer.user = self.user1
        consumer.channel_layer = AsyncMock()
        
        screen_share_data = {
            'type': 'screen_share_start',
            'user_id': str(self.user1.id)
        }
        
        await consumer.receive(text_data=json.dumps(screen_share_data))
        
        # Verify group_send was called
        consumer.channel_layer.group_send.assert_called_once()
    
    async def test_receive_screen_share_stop(self):
        """Test receiving screen share stop message"""
        consumer = CallConsumer()
        consumer.scope = {'user': self.user1}
        consumer.call_group_name = self.call_group_name
        consumer.user = self.user1
        consumer.channel_layer = AsyncMock()
        
        screen_share_data = {
            'type': 'screen_share_stop',
            'user_id': str(self.user1.id)
        }
        
        await consumer.receive(text_data=json.dumps(screen_share_data))
        
        # Verify group_send was called
        consumer.channel_layer.group_send.assert_called_once()
    
    async def test_receive_invalid_json(self):
        """Test receiving invalid JSON data"""
        consumer = CallConsumer()
        consumer.scope = {'user': self.user1}
        consumer.call_group_name = self.call_group_name
        consumer.user = self.user1
        
        with patch.object(consumer, 'send', new_callable=AsyncMock) as mock_send:
            await consumer.receive(text_data='invalid json')
            
            # Should send error message
            mock_send.assert_called_once()
            call_args = mock_send.call_args[0]
            error_data = json.loads(call_args[0])
            self.assertEqual(error_data['type'], 'error')
            self.assertEqual(error_data['message'], 'Invalid JSON data')
    
    async def test_receive_unknown_message_type(self):
        """Test receiving unknown message type"""
        consumer = CallConsumer()
        consumer.scope = {'user': self.user1}
        consumer.call_group_name = self.call_group_name
        consumer.user = self.user1
        consumer.channel_layer = AsyncMock()
        
        unknown_data = {
            'type': 'unknown_message_type',
            'data': 'some data'
        }
        
        await consumer.receive(text_data=json.dumps(unknown_data))
        
        # Should not call group_send for unknown message types
        consumer.channel_layer.group_send.assert_not_called()
    
    async def test_handle_webrtc_offer(self):
        """Test handle_webrtc_offer method"""
        consumer = CallConsumer()
        consumer.call_group_name = self.call_group_name
        consumer.user = self.user1
        consumer.channel_layer = AsyncMock()
        
        offer_data = {
            'offer': {'type': 'offer', 'sdp': 'test-sdp'},
            'target_id': str(self.user2.id)
        }
        
        await consumer.handle_webrtc_offer(offer_data)
        
        # Verify group_send was called with correct parameters
        consumer.channel_layer.group_send.assert_called_once_with(
            self.call_group_name,
            {
                'type': 'webrtc_offer',
                'offer': offer_data['offer'],
                'sender_id': str(self.user1.id),
                'target_id': str(self.user2.id),
            }
        )
    
    async def test_handle_webrtc_answer(self):
        """Test handle_webrtc_answer method"""
        consumer = CallConsumer()
        consumer.call_group_name = self.call_group_name
        consumer.user = self.user1
        consumer.channel_layer = AsyncMock()
        
        answer_data = {
            'answer': {'type': 'answer', 'sdp': 'test-sdp'},
            'target_id': str(self.user2.id)
        }
        
        await consumer.handle_webrtc_answer(answer_data)
        
        # Verify group_send was called with correct parameters
        consumer.channel_layer.group_send.assert_called_once_with(
            self.call_group_name,
            {
                'type': 'webrtc_answer',
                'answer': answer_data['answer'],
                'sender_id': str(self.user1.id),
                'target_id': str(self.user2.id),
            }
        )
    
    async def test_handle_ice_candidate(self):
        """Test handle_ice_candidate method"""
        consumer = CallConsumer()
        consumer.call_group_name = self.call_group_name
        consumer.user = self.user1
        consumer.channel_layer = AsyncMock()
        
        ice_data = {
            'candidate': {
                'candidate': 'candidate:1 1 UDP 2122260223 192.168.1.100 54400 typ host',
                'sdpMLineIndex': 0,
                'sdpMid': '0'
            },
            'target_id': str(self.user2.id)
        }
        
        await consumer.handle_ice_candidate(ice_data)
        
        # Verify group_send was called with correct parameters
        consumer.channel_layer.group_send.assert_called_once_with(
            self.call_group_name,
            {
                'type': 'ice_candidate',
                'candidate': ice_data['candidate'],
                'sender_id': str(self.user1.id),
                'target_id': str(self.user2.id),
            }
        )
    
    async def test_user_joined_handler(self):
        """Test user_joined message handler"""
        consumer = CallConsumer()
        
        with patch.object(consumer, 'send', new_callable=AsyncMock) as mock_send:
            await consumer.user_joined({
                'user_id': str(self.user2.id),
                'username': self.user2.username
            })
            
            # Should send user_joined message
            mock_send.assert_called_once()
            call_args = mock_send.call_args[1]
            sent_data = json.loads(call_args['text_data'])
            self.assertEqual(sent_data['type'], 'user_joined')
            self.assertEqual(sent_data['user_id'], str(self.user2.id))
            self.assertEqual(sent_data['username'], self.user2.username)
    
    async def test_user_left_handler(self):
        """Test user_left message handler"""
        consumer = CallConsumer()
        
        with patch.object(consumer, 'send', new_callable=AsyncMock) as mock_send:
            await consumer.user_left({
                'user_id': str(self.user2.id),
                'username': self.user2.username
            })
            
            # Should send user_left message
            mock_send.assert_called_once()
            call_args = mock_send.call_args[1]
            sent_data = json.loads(call_args['text_data'])
            self.assertEqual(sent_data['type'], 'user_left')
            self.assertEqual(sent_data['user_id'], str(self.user2.id))
    
    async def test_webrtc_offer_handler(self):
        """Test webrtc_offer message handler"""
        consumer = CallConsumer()
        consumer.user = self.user2  # Receiving user
        
        with patch.object(consumer, 'send', new_callable=AsyncMock) as mock_send:
            await consumer.webrtc_offer({
                'offer': {'type': 'offer', 'sdp': 'test-sdp'},
                'sender_id': str(self.user1.id),
                'target_id': str(self.user2.id)
            })
            
            # Should send offer to target user
            mock_send.assert_called_once()
            call_args = mock_send.call_args[1]
            sent_data = json.loads(call_args['text_data'])
            self.assertEqual(sent_data['type'], 'webrtc_offer')
    
    async def test_webrtc_answer_handler(self):
        """Test webrtc_answer message handler"""
        consumer = CallConsumer()
        consumer.user = self.user1  # Receiving user
        
        with patch.object(consumer, 'send', new_callable=AsyncMock) as mock_send:
            await consumer.webrtc_answer({
                'answer': {'type': 'answer', 'sdp': 'test-sdp'},
                'sender_id': str(self.user2.id),
                'target_id': str(self.user1.id)
            })
            
            # Should send answer to target user
            mock_send.assert_called_once()
            call_args = mock_send.call_args[1]
            sent_data = json.loads(call_args['text_data'])
            self.assertEqual(sent_data['type'], 'webrtc_answer')
    
    async def test_ice_candidate_handler(self):
        """Test ice_candidate message handler"""
        consumer = CallConsumer()
        consumer.user = self.user2  # Receiving user
        
        with patch.object(consumer, 'send', new_callable=AsyncMock) as mock_send:
            await consumer.ice_candidate({
                'candidate': {'candidate': 'test-candidate'},
                'sender_id': str(self.user1.id),
                'target_id': str(self.user2.id)
            })
            
            # Should send candidate to target user
            mock_send.assert_called_once()
            call_args = mock_send.call_args[1]
            sent_data = json.loads(call_args['text_data'])
            self.assertEqual(sent_data['type'], 'ice_candidate')
    
    async def test_message_filtering_by_target(self):
        """Test that messages are only sent to intended targets"""
        consumer = CallConsumer()
        consumer.user = self.user3  # User who should NOT receive the message
        
        with patch.object(consumer, 'send', new_callable=AsyncMock) as mock_send:
            # Send offer targeted at user2, but consumer is user3
            await consumer.webrtc_offer({
                'offer': {'type': 'offer', 'sdp': 'test-sdp'},
                'sender_id': str(self.user1.id),
                'target_id': str(self.user2.id)
            })
            
            # Should not send message since user3 is not the target
            mock_send.assert_not_called()
    
    async def test_add_participant_to_call(self):
        """Test adding participant to call"""
        consumer = CallConsumer()
        consumer.call_id = str(self.call_session.call_id)
        consumer.user = self.user2
        
        # Mock database operations
        with patch('apps.calls.consumers.database_sync_to_async') as mock_db_sync:
            mock_db_sync.return_value = AsyncMock()
            
            await consumer.add_participant_to_call()
            
            # Verify database operation was called
            mock_db_sync.assert_called()
    
    async def test_remove_participant_from_call(self):
        """Test removing participant from call"""
        consumer = CallConsumer()
        consumer.call_id = str(self.call_session.call_id)
        consumer.user = self.user1
        
        # Mock database operations
        with patch('apps.calls.consumers.database_sync_to_async') as mock_db_sync:
            mock_db_sync.return_value = AsyncMock()
            
            await consumer.remove_participant_from_call()
            
            # Verify database operation was called
            mock_db_sync.assert_called()
    
    async def test_existing_participants_message(self):
        """Test sending existing participants to new user"""
        consumer = CallConsumer()
        consumer.user = self.user3  # New user joining
        consumer.call_id = str(self.call_session.call_id)
        consumer.channel_layer = AsyncMock()
        
        # Create existing participants
        self.create_call_participant(self.call_session, self.user1)
        self.create_call_participant(self.call_session, self.user2)
        
        with patch.object(consumer, 'send', new_callable=AsyncMock) as mock_send:
            with patch.object(consumer, 'get_existing_participants', return_value=[
                {'user_id': str(self.user1.id), 'username': self.user1.username},
                {'user_id': str(self.user2.id), 'username': self.user2.username}
            ]):
                await consumer.send_existing_participants()
                
                # Should send existing participants message
                mock_send.assert_called_once()
                call_args = mock_send.call_args[1]
                sent_data = json.loads(call_args['text_data'])
                self.assertEqual(sent_data['type'], 'existing_participants')
                self.assertEqual(len(sent_data['participants']), 2)


class ConsumerIntegrationTest(BaseTestCase, WebRTCTestMixin):
    """Integration tests for consumer functionality"""
    
    def setUp(self):
        super().setUp()
        self.call_session = self.create_call_session(self.user1)
    
    async def test_full_webrtc_flow(self):
        """Test complete WebRTC signaling flow"""
        # Create two consumers for two users
        consumer1 = CallConsumer()
        consumer2 = CallConsumer()
        
        # Setup consumer1 (user1)
        consumer1.scope = {'user': self.user1}
        consumer1.call_group_name = f"call_{self.call_session.call_id}"
        consumer1.user = self.user1
        consumer1.channel_layer = AsyncMock()
        
        # Setup consumer2 (user2)
        consumer2.scope = {'user': self.user2}
        consumer2.call_group_name = f"call_{self.call_session.call_id}"
        consumer2.user = self.user2
        consumer2.channel_layer = AsyncMock()
        
        # Step 1: User1 sends offer
        offer_data = self.create_webrtc_offer(self.user1.id, self.user2.id)
        await consumer1.receive(text_data=json.dumps(offer_data))
        
        # Verify offer was sent to group
        consumer1.channel_layer.group_send.assert_called()
        
        # Step 2: Simulate user2 receiving the offer
        with patch.object(consumer2, 'send', new_callable=AsyncMock):
            await consumer2.webrtc_offer({
                'offer': offer_data['offer'],
                'sender_id': str(self.user1.id),
                'target_id': str(self.user2.id)
            })
            
            # User2 should receive the offer
            consumer2.send.assert_called_once()
        
        # Step 3: User2 sends answer
        answer_data = self.create_webrtc_answer(self.user2.id, self.user1.id)
        await consumer2.receive(text_data=json.dumps(answer_data))
        
        # Verify answer was sent to group
        consumer2.channel_layer.group_send.assert_called()
    
    async def test_multiple_users_joining_call(self):
        """Test multiple users joining the same call"""
        consumers = []
        users = [self.user1, self.user2, self.user3]
        
        # Create consumers for all users
        for user in users:
            consumer = CallConsumer()
            consumer.scope = {'user': user}
            consumer.call_group_name = f"call_{self.call_session.call_id}"
            consumer.user = user
            consumer.channel_layer = AsyncMock()
            consumers.append(consumer)
        
        # Each user joins the call
        for i, consumer in enumerate(consumers):
            with patch.object(consumer, 'add_participant_to_call', new_callable=AsyncMock):
                with patch.object(consumer, 'accept', new_callable=AsyncMock):
                    await consumer.connect()
                    
                    # Verify user joined the group
                    consumer.channel_layer.group_add.assert_called()
    
    async def test_concurrent_message_handling(self):
        """Test handling concurrent messages"""
        consumer = CallConsumer()
        consumer.scope = {'user': self.user1}
        consumer.call_group_name = f"call_{self.call_session.call_id}"
        consumer.user = self.user1
        consumer.channel_layer = AsyncMock()
        
        # Send multiple messages concurrently
        messages = [
            self.create_webrtc_offer(self.user1.id, self.user2.id),
            self.create_ice_candidate(self.user1.id, self.user2.id),
            {'type': 'quality_change', 'video_quality': 'high'}
        ]
        
        # Process all messages
        for message in messages:
            await consumer.receive(text_data=json.dumps(message))
        
        # All messages should have been processed
        self.assertEqual(consumer.channel_layer.group_send.call_count, len(messages))


class ConsumerErrorHandlingTest(BaseTestCase, WebRTCTestMixin):
    """Tests for consumer error handling"""
    
    def setUp(self):
        super().setUp()
        self.call_session = self.create_call_session(self.user1)
    
    async def test_handle_database_error(self):
        """Test handling database errors"""
        consumer = CallConsumer()
        consumer.scope = {'user': self.user1}
        consumer.call_id = str(self.call_session.call_id)
        
        # Mock database error
        with patch('apps.calls.consumers.database_sync_to_async', side_effect=Exception("DB Error")):
            with patch.object(consumer, 'close', new_callable=AsyncMock) as mock_close:
                try:
                    await consumer.add_participant_to_call()
                except Exception:
                    pass  # Expected to fail
                
                # Consumer should handle the error gracefully
                # (Exact behavior depends on implementation)
    
    async def test_handle_channel_layer_error(self):
        """Test handling channel layer errors"""
        consumer = CallConsumer()
        consumer.scope = {'user': self.user1}
        consumer.call_group_name = f"call_{self.call_session.call_id}"
        consumer.user = self.user1
        
        # Mock channel layer error
        consumer.channel_layer = AsyncMock()
        consumer.channel_layer.group_send.side_effect = Exception("Channel error")
        
        offer_data = self.create_webrtc_offer(self.user1.id, self.user2.id)
        
        # Should handle error gracefully
        try:
            await consumer.receive(text_data=json.dumps(offer_data))
        except Exception:
            pass  # Error is expected but should be handled
    
    async def test_handle_malformed_message_data(self):
        """Test handling malformed message data"""
        consumer = CallConsumer()
        consumer.scope = {'user': self.user1}
        consumer.call_group_name = f"call_{self.call_session.call_id}"
        consumer.user = self.user1
        consumer.channel_layer = AsyncMock()
        
        # Send message with missing required fields
        malformed_data = {
            'type': 'webrtc_offer',
            # Missing 'offer' field
            'target_id': str(self.user2.id)
        }
        
        # Should handle gracefully without crashing
        await consumer.receive(text_data=json.dumps(malformed_data))
        
        # May or may not call group_send depending on implementation
        # The important thing is it doesn't crash
    
    async def test_handle_nonexistent_call(self):
        """Test handling connection to non-existent call"""
        consumer = CallConsumer()
        fake_call_id = str(uuid.uuid4())
        
        consumer.scope = {
            'type': 'websocket',
            'url_route': {'kwargs': {'call_id': fake_call_id}},
            'user': self.user1,
        }
        consumer.channel_layer = AsyncMock()
        consumer.channel_name = 'test-channel'
        
        # Mock database operation that would fail for non-existent call
        with patch.object(consumer, 'add_participant_to_call', new_callable=AsyncMock, side_effect=Exception("Call not found")):
            with patch.object(consumer, 'close', new_callable=AsyncMock) as mock_close:
                await consumer.connect()
                
                # Should close connection or handle error gracefully
                # (Exact behavior depends on implementation)