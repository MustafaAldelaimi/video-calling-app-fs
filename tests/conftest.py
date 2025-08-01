"""
Test configuration for video calling app tests
"""
import pytest
import django
from django.conf import settings
from django.test.utils import get_runner
from django.core.management import execute_from_command_line
import os
import sys

# Configure Django settings for testing
if not settings.configured:
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.base')
    django.setup()

@pytest.fixture(scope='session')
def django_db_setup():
    """Set up test database"""
    settings.DATABASES['default'] = {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }

@pytest.fixture(autouse=True)
def enable_db_access_for_all_tests(db):
    """Enable database access for all tests by default"""
    pass

@pytest.fixture
def api_client():
    """Provide Django test client for API testing"""
    from django.test import Client
    return Client()

@pytest.fixture
def sample_users():
    """Create sample users for testing"""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    
    users = []
    for i in range(1, 4):
        user = User.objects.create_user(
            username=f'testuser{i}',
            email=f'test{i}@example.com',
            password='testpass123'
        )
        users.append(user)
    return users

@pytest.fixture
def sample_call_session(sample_users):
    """Create a sample call session for testing"""
    from apps.calls.models import CallSession, CallParticipant
    
    call = CallSession.objects.create(
        initiator=sample_users[0],
        call_type='video',
        status='waiting'
    )
    
    # Add participants
    for user in sample_users[:2]:
        CallParticipant.objects.create(call_session=call, user=user)
    
    return call

@pytest.fixture(autouse=True)
def clear_cache():
    """Clear cache before each test"""
    from django.core.cache import cache
    cache.clear()
    yield
    cache.clear()