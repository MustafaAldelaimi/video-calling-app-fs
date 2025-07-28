from .base import *
import os

# Production settings for Railway deployment
DEBUG = False

# Allow Railway's domains
ALLOWED_HOSTS = [
    '.railway.app',
    'localhost',
    '127.0.0.1',
]

# Database configuration for Railway
import dj_database_url

# Railway provides different env var names, try them all
DATABASE_URL = (
    os.environ.get('DATABASE_URL') or
    os.environ.get('DATABASE_PRIVATE_URL') or  
    os.environ.get('POSTGRES_URL') or
    os.environ.get('POSTGRES_PRIVATE_URL')
)

if DATABASE_URL:
    DATABASES = {
        'default': dj_database_url.parse(DATABASE_URL)
    }
else:
    # Fallback for Railway if individual vars are provided
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.environ.get('PGDATABASE', 'railway'),
            'USER': os.environ.get('PGUSER', 'postgres'),
            'PASSWORD': os.environ.get('PGPASSWORD', ''),
            'HOST': os.environ.get('PGHOST', 'localhost'),
            'PORT': os.environ.get('PGPORT', '5432'),
        }
    }

# Redis configuration for Railway
REDIS_URL = (
    os.environ.get('REDIS_URL') or
    os.environ.get('REDIS_PRIVATE_URL') or
    'redis://localhost:6379'
)

# Update Redis configurations
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            'hosts': [REDIS_URL],
        },
    },
}

CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL

# Security settings for production
SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True 