import os
from django.core.wsgi import get_wsgi_application

# Use production settings if in production environment, otherwise base
if os.environ.get('RAILWAY_ENVIRONMENT') == 'production':
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.production')
else:
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.base')

application = get_wsgi_application() 