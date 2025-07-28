import os
import django
from django.core.asgi import get_asgi_application

# Use production settings if in production environment, otherwise base
if os.environ.get('RAILWAY_ENVIRONMENT') == 'production':
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.production')
else:
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.base')

# Initialize Django BEFORE importing anything that uses models
django.setup()

# Now we can safely import channels and apps
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from apps.calls.routing import websocket_urlpatterns

application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": AuthMiddlewareStack(
        URLRouter(websocket_urlpatterns)
    ),
})
