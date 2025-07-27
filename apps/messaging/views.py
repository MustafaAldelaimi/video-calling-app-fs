from django.shortcuts import render
from django.contrib.auth.decorators import login_required

@login_required
def message_list(request):
    return render(request, 'messaging/message_list.html')

@login_required
def send_message(request):
    return render(request, 'messaging/send_message.html')
