from django.shortcuts import render
from django.contrib.auth.decorators import login_required

@login_required
def file_upload(request):
    return render(request, 'media/file_upload.html')

@login_required
def file_list(request):
    return render(request, 'media/file_list.html')
