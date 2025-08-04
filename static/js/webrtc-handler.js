class WebRTCHandler {
  constructor(callId, userId, username) {
    this.callId = callId
    this.userId = userId
    this.username = username
    this.localStream = null
    this.remoteStream = null
    this.peerConnections = new Map()
    this.pendingIceCandidates = new Map()
    this.connectionRetries = new Map()
    this.websocket = null
    this.isScreenSharing = false
    this.isMuted = false
    this.isVideoOff = false
    this.currentCameraId = null
    this.availableCameras = []
    this.screenStream = null
    this.deviceChangeListener = null
    
    // Audio monitoring
    this.audioContext = null
    this.localAnalyser = null
    this.remoteAnalysers = new Map()
    this.audioMonitoringInterval = null
    this.speakingThreshold = 0.01 // Lowered threshold for better voice detection

    // Quality settings
    this.qualitySettings = {
      video: { width: 1280, height: 720, frameRate: 30 },
      audio: { sampleRate: 48000, channelCount: 2 },
    }

    // Initialize quality from profile
    const QUALITY_PROFILE = {
      defaultVideoQuality: "medium",
    }
    if (typeof QUALITY_PROFILE !== "undefined") {
      this.setQualityFromProfile(QUALITY_PROFILE.defaultVideoQuality)
    }

    this.setupEventListeners()
    
    // Set initial button states
    this.updateMuteButton()
    this.updateVideoButton()
    this.updateScreenShareButton()
  }

  async initializeCall() {
    try {
      console.log("🚀 Initializing call...")
      
      // Clean up any leftover elements from previous sessions
      this.cleanupOrphanedElementsStrict()
      
      await this.getUserMedia()
      console.log("✅ User media obtained, now enumerating cameras with full permissions...")
      await this.enumerateCameras()
      console.log("📷 Camera enumeration complete, setting up device monitoring...")
      this.setupDeviceChangeListener()
      console.log("🔌 Device change monitoring active, setting up WebSocket...")
      await this.setupWebSocket()
      this.startQualityMonitoring()
      
      // Re-enumerate cameras after a short delay to catch any that might have been missed
      setTimeout(async () => {
        console.log("🔄 Re-enumerating cameras after initialization...")
        const initialCount = this.availableCameras.length
        await this.enumerateCameras()
        if (this.availableCameras.length > initialCount) {
          console.log(`📷 Found ${this.availableCameras.length - initialCount} additional camera(s) on re-enumeration`)
        }
      }, 2000)
      
      console.log("🎉 Call initialization complete!")
    } catch (error) {
      console.error("Failed to initialize call:", error)
      this.showError("Failed to initialize call. Please check your camera and microphone permissions.")
    }
  }

  setupEventListeners() {
    // Control buttons
    document.getElementById("muteBtn").addEventListener("click", () => this.toggleMute())
    document.getElementById("videoBtn").addEventListener("click", () => this.toggleVideo())
    document.getElementById("screenShareBtn").addEventListener("click", () => this.toggleScreenShare())
    document.getElementById("endCallBtn").addEventListener("click", () => this.endCall())

    // Quality controls
    document.getElementById("videoQuality").addEventListener("change", (e) => {
      this.changeVideoQuality(e.target.value)
    })

    document.getElementById("adaptiveQuality").addEventListener("change", (e) => {
      this.adaptiveQuality = e.target.checked
    })

    // Camera selection
    const cameraSelect = document.getElementById("cameraSelect")
    if (cameraSelect) {
      cameraSelect.addEventListener("change", (e) => {
        this.changeCamera(e.target.value)
      })
    }

    // Add global click listener to resume AudioContext on user interaction
    document.addEventListener('click', () => this.resumeAudioContextIfNeeded(), { once: true })
    document.addEventListener('keydown', () => this.resumeAudioContextIfNeeded(), { once: true })
  }

  async resumeAudioContextIfNeeded() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume()
        console.log("🎵 AudioContext resumed due to user interaction")
      } catch (error) {
        console.error("❌ Failed to resume AudioContext:", error)
      }
    }
  }

  async setupWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const wsUrl = `${protocol}//${window.location.host}/ws/call/${this.callId}/`
    
    console.log("🌐 Connecting to WebSocket:", wsUrl)
    console.log("🔒 Protocol:", window.location.protocol, "→", protocol)

    this.websocket = new WebSocket(wsUrl)

    this.websocket.onopen = () => {
      console.log("✅ WebSocket connected successfully to:", wsUrl)
      console.log("🔗 User ID:", this.userId)
      console.log("📞 Call ID:", this.callId)
    }

    this.websocket.onmessage = async (event) => {
      const data = JSON.parse(event.data)
      console.log("📨 WebSocket message received:", data.type, data)
      await this.handleWebSocketMessage(data)
    }

    this.websocket.onclose = (event) => {
      console.log("❌ WebSocket disconnected", event.code, event.reason)
    }

    this.websocket.onerror = (error) => {
      console.error("🚨 WebSocket error:", error)
      console.log("📡 Attempting to connect to:", wsUrl)
      
      // Show user-friendly error
      this.showError("Connection failed. Please refresh the page and try again.")
    }
  }

  async handleWebSocketMessage(data) {
    switch (data.type) {
      case "existing_participants":
        // Handle existing participants when joining a call
        console.log(`👥 Found ${data.participants.length} existing participants`)
        for (const participant of data.participants) {
          this.addParticipant(participant.user_id, participant.username)
          await this.createPeerConnection(participant.user_id)
          
          // Only create offer if our user ID is "smaller" to avoid race conditions
          if (this.localStream && this.shouldInitiateCall(participant.user_id)) {
            console.log(`📞 Creating offer for existing participant: ${participant.username} (I'm the initiator)`)
            await this.createOffer(participant.user_id)
          } else {
            console.log(`⏳ Waiting for offer from existing participant: ${participant.username} (They're the initiator)`)
          }
        }
        break

      case "user_joined":
        if (data.user_id !== this.userId) {
          this.addParticipant(data.user_id, data.username)
          await this.createPeerConnection(data.user_id)
          
          // Only create offer if our user ID is "smaller" to avoid race conditions
          if (this.shouldInitiateCall(data.user_id)) {
            console.log(`📞 Creating offer for new participant: ${data.username} (I'm the initiator)`)
          await this.createOffer(data.user_id)
          } else {
            console.log(`⏳ Waiting for offer from new participant: ${data.username} (They're the initiator)`)
          }
        }
        break

      case "user_left":
        this.removeParticipant(data.user_id)
        this.closePeerConnection(data.user_id)
        break

      case "webrtc_offer":
        if (data.sender_id !== this.userId) {
          console.log(`📨 Processing WebRTC offer from: ${data.sender_id}`)
          await this.handleOffer(data.sender_id, data.offer)
        }
        break

      case "webrtc_answer":
        if (data.sender_id !== this.userId) {
          console.log(`📨 Processing WebRTC answer from: ${data.sender_id}`)
          await this.handleAnswer(data.sender_id, data.answer)
        }
        break

      case "ice_candidate":
        if (data.sender_id !== this.userId) {
          await this.handleIceCandidate(data.sender_id, data.candidate)
        }
        break

      case "screen_share_start":
        this.showScreenShareNotification(data.username, true)
        break

      case "screen_share_stop":
        this.showScreenShareNotification(data.username, false)
        break

      case "camera_change":
        this.showCameraChangeNotification(data.username, data.cameraLabel)
        break

      case "mute_status":
        if (data.sender_id !== this.userId) {
          this.updateMuteIndicator(`video-${data.sender_id}`, data.is_muted)
        }
        break
    }
  }

  async getUserMedia() {
    const constraints = {
      video: {
        width: { ideal: this.qualitySettings.video.width },
        height: { ideal: this.qualitySettings.video.height },
        frameRate: { ideal: this.qualitySettings.video.frameRate },
      },
      audio: {
        sampleRate: this.qualitySettings.audio.sampleRate,
        channelCount: this.qualitySettings.audio.channelCount,
      },
    }

    // Add camera device ID if selected
    if (this.currentCameraId) {
      constraints.video.deviceId = { exact: this.currentCameraId }
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints)
      document.getElementById("localVideo").srcObject = this.localStream
      console.log("📹 Local stream obtained:", this.localStream)
      console.log("🎬 Local tracks:", this.localStream.getTracks().map(t => `${t.kind}: ${t.label}`))
      
      // Set up local video label and initial mute state
      this.setupLocalVideoElements()
      
      // Set up audio monitoring for local stream
      await this.setupLocalAudioMonitoring()
      
      // Add local stream to any existing peer connections
      this.addLocalStreamToExistingPeers()
    } catch (error) {
      console.error("Error accessing media devices:", error)
      throw error
    }
  }

  async enumerateCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      this.availableCameras = devices.filter(device => device.kind === 'videoinput')
      console.log("📷 Available cameras:", this.availableCameras.map(c => `${c.label || 'Unknown Camera'} (${c.deviceId})`))
      console.log(`📊 Total cameras found: ${this.availableCameras.length}`)
      
      // If we have an active video track, try to match it to a camera
      if (this.localStream && !this.currentCameraId) {
        const videoTrack = this.localStream.getVideoTracks()[0]
        if (videoTrack) {
          console.log(`🔍 Current video track: ${videoTrack.label}`)
          // Try to find matching camera by label
          const matchingCamera = this.availableCameras.find(camera => 
            camera.label === videoTrack.label || 
            videoTrack.label.includes(camera.label) ||
            camera.label.includes(videoTrack.label)
          )
          if (matchingCamera) {
            this.currentCameraId = matchingCamera.deviceId
            console.log(`✅ Matched current camera: ${matchingCamera.label}`)
          }
        }
      }
      
      // Populate camera dropdown
      this.populateCameraDropdown()
      
      // Set default camera (first one if none selected)
      if (!this.currentCameraId && this.availableCameras.length > 0) {
        this.currentCameraId = this.availableCameras[0].deviceId
        console.log(`📷 Set default camera: ${this.availableCameras[0].label || 'Camera 1'}`)
      }
    } catch (error) {
      console.error("Error enumerating cameras:", error)
    }
  }

  setupDeviceChangeListener() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.addEventListener) {
      console.warn("⚠️ Device change monitoring not supported")
      return
    }

    // Create the device change handler function
    this.deviceChangeListener = async () => {
      console.log("🔌 Device change detected, re-enumerating cameras...")
      
      const previousCount = this.availableCameras.length
      const previousCameras = [...this.availableCameras]
      
      // Re-enumerate devices
      await this.enumerateCameras()
      
      const newCount = this.availableCameras.length
      
      if (newCount !== previousCount) {
        console.log(`📷 Camera count changed: ${previousCount} → ${newCount}`)
        
        if (newCount > previousCount) {
          // New camera(s) added
          const newCameras = this.availableCameras.filter(camera => 
            !previousCameras.some(prev => prev.deviceId === camera.deviceId)
          )
          newCameras.forEach(camera => {
            console.log(`📷 ➕ New camera detected: ${camera.label || 'Unknown Camera'}`)
          })
          
          // Show notification about new camera
          this.showDeviceChangeNotification(`New camera available: ${newCameras[0]?.label || 'Unknown Camera'}`, 'success')
        } else {
          // Camera(s) removed
          const removedCameras = previousCameras.filter(prev => 
            !this.availableCameras.some(camera => camera.deviceId === prev.deviceId)
          )
          removedCameras.forEach(camera => {
            console.log(`📷 ➖ Camera disconnected: ${camera.label || 'Unknown Camera'}`)
          })
          
          // Check if the current camera was removed
          if (this.currentCameraId && !this.availableCameras.some(c => c.deviceId === this.currentCameraId)) {
            console.log("⚠️ Current camera was disconnected, switching to first available")
            if (this.availableCameras.length > 0) {
              await this.changeCamera(this.availableCameras[0].deviceId)
              this.showDeviceChangeNotification(`Switched to ${this.availableCameras[0].label || 'Camera 1'} (previous camera disconnected)`, 'warning')
            } else {
              this.showDeviceChangeNotification('All cameras disconnected', 'danger')
            }
          } else {
            this.showDeviceChangeNotification(`Camera disconnected: ${removedCameras[0]?.label || 'Unknown Camera'}`, 'warning')
          }
        }
              } else {
          console.log("📷 Device change detected but camera count unchanged")
        }
      }

      // Add the event listener
      navigator.mediaDevices.addEventListener('devicechange', this.deviceChangeListener)
      
      console.log("✅ Device change listener set up successfully")
    }

  showDeviceChangeNotification(message, type = 'info') {
    const alertClass = `alert-${type}`
    const icon = type === 'success' ? 'fa-check-circle' : 
                 type === 'warning' ? 'fa-exclamation-triangle' : 
                 type === 'danger' ? 'fa-times-circle' : 'fa-info-circle'

    const notification = document.createElement("div")
    notification.className = `alert ${alertClass} alert-dismissible fade show`
    notification.innerHTML = `
            <i class="fas ${icon}"></i> ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `

    const container = document.querySelector(".container")
    container.insertBefore(notification, container.firstChild)

    // Auto-remove after 4 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove()
      }
    }, 4000)
  }

  populateCameraDropdown() {
    const cameraSelect = document.getElementById("cameraSelect")
    if (!cameraSelect) {
      console.warn("⚠️ Camera select dropdown not found!")
      return
    }

    // Clear existing options
    cameraSelect.innerHTML = ""

    if (this.availableCameras.length === 0) {
      const option = document.createElement("option")
      option.value = ""
      option.textContent = "No cameras available"
      option.disabled = true
      cameraSelect.appendChild(option)
      return
    }

    // Add camera options
    this.availableCameras.forEach((camera, index) => {
      const option = document.createElement("option")
      option.value = camera.deviceId
      option.textContent = camera.label || `Camera ${index + 1}`
      
      // Select current camera
      if (camera.deviceId === this.currentCameraId) {
        option.selected = true
      }
      
      cameraSelect.appendChild(option)
    })
  }

  async changeCamera(deviceId) {
    if (!deviceId || deviceId === this.currentCameraId) return

    try {
      console.log(`📷 Switching to camera: ${deviceId}`)
      
      // Store old video track
      const oldVideoTrack = this.localStream ? this.localStream.getVideoTracks()[0] : null
      
      // Update current camera ID
      this.currentCameraId = deviceId
      
      // Get new video stream with selected camera
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: this.qualitySettings.video.width },
          height: { ideal: this.qualitySettings.video.height },
          frameRate: { ideal: this.qualitySettings.video.frameRate },
        },
        audio: false, // Only get video track
      })

      const newVideoTrack = newStream.getVideoTracks()[0]

      if (this.localStream && oldVideoTrack) {
        // Replace track in local stream
        this.localStream.removeTrack(oldVideoTrack)
        this.localStream.addTrack(newVideoTrack)

        // Replace track in all peer connections
        this.peerConnections.forEach(async (peerConnection) => {
          const sender = peerConnection.getSenders().find((s) => s.track && s.track.kind === "video")
          if (sender) {
            await sender.replaceTrack(newVideoTrack)
          }
        })

        // Stop old video track
        oldVideoTrack.stop()
      } else {
        // If no existing stream, create new one
        await this.getUserMedia()
        return
      }

      console.log(`✅ Camera switched successfully to: ${newVideoTrack.label}`)

      // Notify other participants about camera change
      this.sendWebSocketMessage({
        type: "camera_change",
        cameraLabel: newVideoTrack.label
      })

    } catch (error) {
      console.error("Error changing camera:", error)
      this.showError(`Failed to switch camera: ${error.message}`)
      
      // Revert camera selection in dropdown
      const cameraSelect = document.getElementById("cameraSelect")
      if (cameraSelect) {
        cameraSelect.value = this.currentCameraId
      }
    }
  }

  setupLocalVideoElements() {
    const localVideo = document.getElementById("localVideo")
    if (!localVideo) return

    // Create a wrapper around the video to properly contain absolutely positioned children
    if (!localVideo.parentElement.classList.contains('video-wrapper')) {
      const wrapper = document.createElement('div')
      wrapper.className = 'video-wrapper'
      wrapper.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        pointer-events: none;
      `
      
      // Copy the video's positioning classes to the wrapper
      wrapper.classList.add(...localVideo.classList)
      
      // Remove positioning classes from video and make it fill the wrapper
      localVideo.className = 'video-element'
      localVideo.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: auto;
      `
      
      // Insert wrapper and move video into it
      localVideo.parentNode.insertBefore(wrapper, localVideo)
      wrapper.appendChild(localVideo)
    }

    const wrapper = localVideo.parentElement

    // Add participant label to the wrapper (not the video)
    const existingLabel = wrapper.querySelector('.participant-label')
    if (!existingLabel) {
      const label = document.createElement('div')
      label.className = 'participant-label'
      label.textContent = 'You'
      label.style.cssText = `
        position: absolute;
        bottom: 8px;
        right: 8px;
        background: rgba(0,0,0,0.7);
        color: white;
        padding: 4px 10px;
        border-radius: 4px;
        font-size: 14px;
        z-index: 1000;
        font-weight: 500;
        pointer-events: none;
      `
      wrapper.appendChild(label)
    }

    // Set initial mute indicator state (should be unmuted initially)
    this.updateMuteIndicator('localVideo', this.isMuted)
  }

  addLocalStreamToExistingPeers() {
    if (!this.localStream) return
    
    this.peerConnections.forEach((peerConnection, userId) => {
      // Check if tracks are already added to avoid duplicates
      const senders = peerConnection.getSenders()
      const hasVideoTrack = senders.some(sender => sender.track && sender.track.kind === 'video')
      const hasAudioTrack = senders.some(sender => sender.track && sender.track.kind === 'audio')
      
      if (!hasVideoTrack || !hasAudioTrack) {
        console.log(`🔄 Adding local stream to existing peer connection for user: ${userId}`)
        this.localStream.getTracks().forEach((track) => {
          const existingSender = senders.find(sender => sender.track && sender.track.kind === track.kind)
          if (!existingSender) {
            console.log(`➕ Adding ${track.kind} track to existing peer:`, track)
            peerConnection.addTrack(track, this.localStream)
          }
        })
      }
    })
  }

  shouldInitiateCall(otherUserId) {
    // Use lexicographic comparison of user IDs to determine who initiates
    // This ensures only one person creates the offer, preventing race conditions
    const shouldInitiate = this.userId < otherUserId
    console.log(`🤔 Should I initiate call? My ID: ${this.userId}, Their ID: ${otherUserId}, Result: ${shouldInitiate}`)
    return shouldInitiate
  }

  async createPeerConnection(userId) {
    console.log(`🔗 Creating peer connection for user: ${userId}`)
    
    // Prevent creating duplicate connections
    if (this.peerConnections.has(userId)) {
      console.warn(`⚠️ Peer connection already exists for ${userId}, closing old one first`)
      this.closePeerConnection(userId)
    }
    
    const WEBRTC_SERVERS = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:openrelay.metered.ca:80" },
      { 
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject"
      },
      { 
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject", 
        credential: "openrelayproject"
      }
    ]
    
    const peerConnection = new RTCPeerConnection({ 
      iceServers: WEBRTC_SERVERS,
      iceCandidatePoolSize: 10
    })
    this.peerConnections.set(userId, peerConnection)

    // Add local stream tracks
    if (this.localStream) {
      console.log(`📤 Adding local stream tracks to peer connection for user: ${userId}`)
      this.localStream.getTracks().forEach((track) => {
        console.log(`🎬 Adding ${track.kind} track:`, track)
        peerConnection.addTrack(track, this.localStream)
      })
    } else {
      console.warn(`⚠️ No local stream available when creating peer connection for user: ${userId}`)
    }

    // Handle remote stream
    peerConnection.ontrack = (event) => {
      console.log(`📹 Received remote stream from user: ${userId}`, event.streams[0])
      console.log(`🔍 Stream details:`, {
        streamId: event.streams[0].id,
        tracks: event.streams[0].getTracks().map(t => `${t.kind}: ${t.readyState}`)
      })
      
      this.attachStreamToVideoElement(userId, event.streams[0])
    }

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`🧊 Sending ICE candidate to ${userId}:`, {
          type: event.candidate.type,
          protocol: event.candidate.protocol,
          address: event.candidate.address || 'hidden'
        })
        
        this.sendWebSocketMessage({
          type: "ice_candidate",
          candidate: event.candidate,
          target_id: userId,
        })
      } else {
        console.log(`🏁 ICE gathering complete for ${userId}`)
      }
    }

    // Monitor connection state
    peerConnection.onconnectionstatechange = () => {
      console.log(`🔗 Connection state with ${userId}:`, peerConnection.connectionState)
      
      if (peerConnection.connectionState === 'failed') {
        console.error(`❌ Connection failed with ${userId}, attempting to restart...`)
        this.handleConnectionFailure(userId)
      } else if (peerConnection.connectionState === 'connected') {
        console.log(`✅ Successfully connected to ${userId}`)
        // Reset retry counter on successful connection
        this.connectionRetries.delete(userId)
      } else if (peerConnection.connectionState === 'disconnected') {
        console.warn(`⚠️ Disconnected from ${userId}`)
      }
    }

    // Monitor ICE connection state
    peerConnection.oniceconnectionstatechange = () => {
      console.log(`🧊 ICE connection state with ${userId}:`, peerConnection.iceConnectionState)
      
      if (peerConnection.iceConnectionState === 'failed') {
        console.error(`❌ ICE connection failed with ${userId}`)
      } else if (peerConnection.iceConnectionState === 'connected') {
        console.log(`✅ ICE connected to ${userId}`)
      }
    }

    // Monitor ICE gathering state
    peerConnection.onicegatheringstatechange = () => {
      console.log(`🔍 ICE gathering state with ${userId}:`, peerConnection.iceGatheringState)
    }

    return peerConnection
  }

  async createOffer(userId) {
    console.log(`📤 Creating offer for user: ${userId}`)
    
    const peerConnection = this.peerConnections.get(userId)
    if (!peerConnection) {
      console.error(`❌ No peer connection found when creating offer for: ${userId}`)
      return
    }

    try {
      console.log(`📊 Peer connection state before creating offer: ${peerConnection.signalingState}`)
      
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)
      
      console.log(`📊 Peer connection state after setLocalDescription: ${peerConnection.signalingState}`)
      console.log(`📤 Sending offer to user: ${userId}`)

      this.sendWebSocketMessage({
        type: "webrtc_offer",
        offer: offer,
        target_id: userId,
      })
    } catch (error) {
      console.error(`❌ Error creating offer for ${userId}:`, error)
    }
  }

  async handleOffer(senderId, offer) {
    console.log(`📨 Received offer from user: ${senderId}`)
    
    let peerConnection = this.peerConnections.get(senderId)
    if (!peerConnection) {
      console.log(`🔗 Creating new peer connection for offer from: ${senderId}`)
      peerConnection = await this.createPeerConnection(senderId)
    }

    try {
      console.log(`🔄 Setting remote description (offer) from: ${senderId}`)
      console.log(`📊 Peer connection state before setRemoteDescription: ${peerConnection.signalingState}`)
      
      await peerConnection.setRemoteDescription(offer)
      
      console.log(`📊 Peer connection state after setRemoteDescription: ${peerConnection.signalingState}`)
      
      // Process any pending ICE candidates now that remote description is set
      await this.processPendingIceCandidates(senderId)
      
      console.log(`📞 Creating answer for: ${senderId}`)
      
      const answer = await peerConnection.createAnswer()
      await peerConnection.setLocalDescription(answer)
      
      console.log(`📊 Peer connection state after setLocalDescription: ${peerConnection.signalingState}`)

      this.sendWebSocketMessage({
        type: "webrtc_answer",
        answer: answer,
        target_id: senderId,
      })
    } catch (error) {
      console.error("Error handling offer:", error)
    }
  }

  async handleAnswer(senderId, answer) {
    console.log(`📨 Received answer from user: ${senderId}`)
    
    const peerConnection = this.peerConnections.get(senderId)
    if (!peerConnection) {
      console.error(`❌ No peer connection found for answer from: ${senderId}`)
      return
    }

    try {
      console.log(`🔄 Setting remote description (answer) from: ${senderId}`)
      console.log(`📊 Peer connection state before setRemoteDescription: ${peerConnection.signalingState}`)
      
      await peerConnection.setRemoteDescription(answer)
      
      console.log(`📊 Peer connection state after setRemoteDescription: ${peerConnection.signalingState}`)
      
      // Process any pending ICE candidates now that remote description is set
      await this.processPendingIceCandidates(senderId)
      
      console.log(`✅ Successfully processed answer from: ${senderId}`)
    } catch (error) {
      console.error(`❌ Error handling answer from ${senderId}:`, error)
      console.error(`📊 Peer connection state during error: ${peerConnection.signalingState}`)
    }
  }

  async handleIceCandidate(senderId, candidate) {
    console.log(`🧊 Received ICE candidate from ${senderId}:`, {
      type: candidate.type,
      protocol: candidate.protocol,
      address: candidate.address || 'hidden'
    })
    
    const peerConnection = this.peerConnections.get(senderId)
    if (!peerConnection) {
      console.error(`❌ No peer connection found for ICE candidate from: ${senderId}`)
      return
    }

    // Check if peer connection is in the right state for ICE candidates
    if (peerConnection.remoteDescription) {
      try {
        await peerConnection.addIceCandidate(candidate)
        console.log(`✅ ICE candidate added for ${senderId}`)
      } catch (error) {
        console.error(`❌ Error handling ICE candidate from ${senderId}:`, error)
        console.error(`📊 Peer connection state:`, {
          signalingState: peerConnection.signalingState,
          iceConnectionState: peerConnection.iceConnectionState,
          connectionState: peerConnection.connectionState,
          hasRemoteDescription: !!peerConnection.remoteDescription
        })
      }
    } else {
      // Queue ICE candidate for later processing
      if (!this.pendingIceCandidates.has(senderId)) {
        this.pendingIceCandidates.set(senderId, [])
      }
      this.pendingIceCandidates.get(senderId).push(candidate)
      console.log(`⏳ Queued ICE candidate from ${senderId} (waiting for remote description)`)
    }
  }

  async processPendingIceCandidates(senderId) {
    if (!this.pendingIceCandidates.has(senderId)) {
      return
    }

    const candidates = this.pendingIceCandidates.get(senderId)
    const peerConnection = this.peerConnections.get(senderId)
    
    if (!peerConnection || !peerConnection.remoteDescription) {
      console.warn(`⚠️ Cannot process pending ICE candidates for ${senderId} - peer connection not ready`)
      return
    }

    console.log(`🔄 Processing ${candidates.length} pending ICE candidates for ${senderId}`)
    
    for (const candidate of candidates) {
      try {
        await peerConnection.addIceCandidate(candidate)
        console.log(`✅ Pending ICE candidate added for ${senderId}`)
      } catch (error) {
        console.error(`❌ Error adding pending ICE candidate for ${senderId}:`, error)
      }
    }
    
    // Clear processed candidates
    this.pendingIceCandidates.delete(senderId)
  }

  async changeVideoQuality(quality) {
    this.setQualityFromProfile(quality)

    if (this.localStream) {
      // Stop current video track
      const videoTrack = this.localStream.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.stop()
      }

      // Get new video stream with updated constraints
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: this.qualitySettings.video.width },
            height: { ideal: this.qualitySettings.video.height },
            frameRate: { ideal: this.qualitySettings.video.frameRate },
          },
          audio: false,
        })

        const newVideoTrack = newStream.getVideoTracks()[0]

        // Replace track in local stream
        this.localStream.removeTrack(videoTrack)
        this.localStream.addTrack(newVideoTrack)

        // Replace track in all peer connections
        this.peerConnections.forEach(async (peerConnection) => {
          const sender = peerConnection.getSenders().find((s) => s.track && s.track.kind === "video")
          if (sender) {
            await sender.replaceTrack(newVideoTrack)
          }
        })

        // Notify other participants
        this.sendWebSocketMessage({
          type: "quality_change",
          quality: quality,
        })
      } catch (error) {
        console.error("Error changing video quality:", error)
      }
    }
  }

  setQualityFromProfile(quality) {
    const qualityProfiles = {
      low: { width: 640, height: 360, frameRate: 15 },
      medium: { width: 1280, height: 720, frameRate: 30 },
      high: { width: 1920, height: 1080, frameRate: 30 },
      ultra: { width: 3840, height: 2160, frameRate: 30 },
    }

    this.qualitySettings.video = qualityProfiles[quality] || qualityProfiles["medium"]
  }

  async toggleScreenShare() {
    if (!this.isScreenSharing) {
      await this.startScreenShare()
    } else {
      await this.stopScreenShare()
    }
  }

  async startScreenShare() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: true,
      })

      // Store screen stream for proper cleanup later
      this.screenStream = screenStream

      const videoTrack = screenStream.getVideoTracks()[0]

      // Replace video track in all peer connections
      this.peerConnections.forEach(async (peerConnection) => {
        const sender = peerConnection.getSenders().find((s) => s.track && s.track.kind === "video")
        if (sender) {
          await sender.replaceTrack(videoTrack)
        }
      })

      // Update local video
      document.getElementById("localVideo").srcObject = screenStream

      // Handle screen share end
      videoTrack.onended = () => {
        this.stopScreenShare()
      }

      this.isScreenSharing = true
      this.updateScreenShareButton()

      // Notify other participants
      this.sendWebSocketMessage({
        type: "screen_share_start",
      })
    } catch (error) {
      console.error("Error starting screen share:", error)
    }
  }

  async stopScreenShare() {
    // Stop all screen sharing tracks to properly release screen capture
    if (this.screenStream) {
      console.log("🛑 Stopping screen sharing tracks...")
      this.screenStream.getTracks().forEach(track => {
        console.log(`🛑 Stopping ${track.kind} track: ${track.label}`)
        track.stop()
      })
      this.screenStream = null
    }

    // Switch back to camera
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0]

      // Replace screen share with camera in all peer connections
      this.peerConnections.forEach(async (peerConnection) => {
        const sender = peerConnection.getSenders().find((s) => s.track && s.track.kind === "video")
        if (sender) {
          await sender.replaceTrack(videoTrack)
        }
      })

      // Update local video back to camera
      document.getElementById("localVideo").srcObject = this.localStream
    }

    this.isScreenSharing = false
    this.updateScreenShareButton()

    // Notify other participants
    this.sendWebSocketMessage({
      type: "screen_share_stop",
    })

    console.log("✅ Screen sharing stopped and cleaned up")
  }

  toggleMute() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        this.isMuted = !audioTrack.enabled
        this.updateMuteButton()
        this.updateMuteIndicator('localVideo', this.isMuted)
        
        // Remove speaking indicator when muted
        if (this.isMuted) {
          this.updateVideoHighlight('localVideo', false)
        }

        // Notify other participants about mute status change (if WebSocket is connected)
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
          this.sendWebSocketMessage({
            type: "mute_status",
            is_muted: this.isMuted
          })
        } else {
          console.log("🔇 Mute status updated locally (WebSocket not connected)")
        }
      }
    }
  }

  async toggleVideo() {
    if (this.isVideoOff) {
      // Re-enable video: create new video track
      await this.enableVideo()
    } else {
      // Disable video: stop and remove video track
      await this.disableVideo()
    }
  }

  async enableVideo() {
    try {
      console.log("📹 Enabling video...")
      
      // Get new video stream with current camera
      const videoConstraints = {
        width: { ideal: this.qualitySettings.video.width },
        height: { ideal: this.qualitySettings.video.height },
        frameRate: { ideal: this.qualitySettings.video.frameRate },
      }

      // Add camera device ID if selected
      if (this.currentCameraId) {
        videoConstraints.deviceId = { exact: this.currentCameraId }
      }

      const newVideoStream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false // Only get video track
      })

      const newVideoTrack = newVideoStream.getVideoTracks()[0]

      if (this.localStream && newVideoTrack) {
        // Add new video track to local stream
        this.localStream.addTrack(newVideoTrack)

        // Replace track in all peer connections
        this.peerConnections.forEach(async (peerConnection) => {
          const sender = peerConnection.getSenders().find((s) => s.track && s.track.kind === "video")
          if (sender) {
            await sender.replaceTrack(newVideoTrack)
          } else {
            // Add new sender if none exists
            peerConnection.addTrack(newVideoTrack, this.localStream)
          }
        })

        // Update local video display
        document.getElementById("localVideo").srcObject = this.localStream

        this.isVideoOff = false
        this.updateVideoButton()
        console.log("✅ Video enabled and camera light should turn on")
      }
    } catch (error) {
      console.error("Error enabling video:", error)
      this.showError("Failed to enable camera. Please check camera permissions.")
    }
  }

  async disableVideo() {
    console.log("📹 Disabling video...")
    
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0]
      if (videoTrack) {
        // Stop the video track to release camera hardware
        videoTrack.stop()
        console.log("🛑 Video track stopped - camera light should turn off")
        
        // Remove track from local stream
        this.localStream.removeTrack(videoTrack)

        // Replace track with null in all peer connections (stops transmission)
        this.peerConnections.forEach(async (peerConnection) => {
          const sender = peerConnection.getSenders().find((s) => s.track && s.track.kind === "video")
          if (sender) {
            await sender.replaceTrack(null)
          }
        })

        // Update local video display to show "video off" state
        const localVideo = document.getElementById("localVideo")
        if (localVideo) {
          localVideo.srcObject = this.localStream // Update with stream that no longer has video
        }

        this.isVideoOff = true
        this.updateVideoButton()
        console.log("✅ Video disabled and camera released")
      }
    }
  }

  updateMuteButton() {
    const btn = document.getElementById("muteBtn")
    const icon = btn.querySelector("i")
    if (this.isMuted) {
      icon.className = "fas fa-microphone-slash"
      btn.style.background = "#dc3545"
    } else {
      icon.className = "fas fa-microphone"
      btn.style.background = "#28a745"
    }
  }

  updateVideoButton() {
    const btn = document.getElementById("videoBtn")
    const icon = btn.querySelector("i")
    if (this.isVideoOff) {
      icon.className = "fas fa-video-slash"
      btn.style.background = "#dc3545"
    } else {
      icon.className = "fas fa-video"
      btn.style.background = "#28a745"
    }
  }

  updateScreenShareButton() {
    const btn = document.getElementById("screenShareBtn")
    const icon = btn.querySelector("i")
    if (this.isScreenSharing) {
      icon.className = "fas fa-stop"
      btn.style.background = "#dc3545"
      btn.title = "Stop Screen Share"
    } else {
      icon.className = "fas fa-desktop"
      btn.style.background = "#007bff"
      btn.title = "Share Screen"
    }
  }

  startQualityMonitoring() {
    setInterval(() => {
      this.peerConnections.forEach(async (peerConnection, userId) => {
        try {
          const stats = await peerConnection.getStats()
          this.processConnectionStats(stats)
        } catch (error) {
          console.error("Error getting stats:", error)
        }
      })
    }, 1000)
  }

  processConnectionStats(stats) {
    let bandwidth = 0
    let latency = 0
    let packetLoss = 0

    stats.forEach((report) => {
      if (report.type === "inbound-rtp" && report.kind === "video") {
        bandwidth = Math.round((report.bytesReceived * 8) / 1000) // kbps
        packetLoss = report.packetsLost || 0
      }
      if (report.type === "candidate-pair" && report.state === "succeeded") {
        latency = report.currentRoundTripTime ? Math.round(report.currentRoundTripTime * 1000) : 0
      }
    })

    // Update UI
    document.getElementById("bandwidth").textContent = bandwidth
    document.getElementById("latency").textContent = latency
    document.getElementById("packetLoss").textContent = packetLoss

    // Auto quality adjustment
    if (this.adaptiveQuality) {
      this.checkQualityAdaptation(bandwidth, latency, packetLoss)
    }
  }

  checkQualityAdaptation(bandwidth, latency, packetLoss) {
    const currentQuality = document.getElementById("videoQuality").value

    if ((bandwidth < 500 || latency > 200 || packetLoss > 5) && currentQuality !== "low") {
      this.suggestQualityChange("low")
    } else if (bandwidth > 2000 && latency < 100 && packetLoss < 2 && currentQuality === "low") {
      this.suggestQualityChange("medium")
    }
  }

  suggestQualityChange(newQuality) {
    // Auto-change quality or show notification
    document.getElementById("videoQuality").value = newQuality
    this.changeVideoQuality(newQuality)
  }

  addParticipant(userId, username) {
    console.log(`👤 Adding participant: ${username} (${userId})`)
    
    // Check if participant already exists to prevent duplicates
    const existingParticipant = document.getElementById(`participant-${userId}`)
    if (existingParticipant) {
      console.log(`⚠️ Participant ${username} (${userId}) already exists, skipping duplicate add`)
      return
    }
    
    // Check if video element already exists
    const existingVideo = document.getElementById(`video-${userId}`)
    if (existingVideo) {
      console.log(`⚠️ Video element for ${username} (${userId}) already exists, skipping duplicate add`)
      return
    }
    
    // Add to participants list
    const participantsList = document.getElementById("participantsList")
    const participantDiv = document.createElement("div")
    participantDiv.className = "participant-item"
    participantDiv.id = `participant-${userId}`
    participantDiv.innerHTML = `
            <span class="online-indicator"></span>
            ${username}
        `
    participantsList.appendChild(participantDiv)
    
    // Create video element for this participant
    this.createVideoElement(userId, username)
    
    // Hide "no participants" message
    this.updateNoParticipantsMessage()
    
    console.log(`✅ Participant ${username} added successfully`)
  }

  cleanupOrphanedElements() {
    // Only remove duplicates, not elements that might be waiting for peer connections
    console.log("🧹 Cleaning up duplicate elements only...")
    
    // Remove duplicate participant elements (same userId)
    const seenUserIds = new Set()
    const allParticipants = document.querySelectorAll('[id^="participant-"]')
    allParticipants.forEach(element => {
      const userId = element.id.replace('participant-', '')
      if (seenUserIds.has(userId)) {
        console.log(`🧹 Removing duplicate participant element: ${userId}`)
        element.remove()
      } else {
        seenUserIds.add(userId)
      }
    })
    
    // Remove duplicate video elements (same userId)
    const seenVideoIds = new Set()
    const allVideos = document.querySelectorAll('[id^="video-"]')
    allVideos.forEach(element => {
      const userId = element.id.replace('video-', '')
      // Skip local video
      if (userId !== 'localVideo') {
        if (seenVideoIds.has(userId)) {
          console.log(`🧹 Removing duplicate video element: ${userId}`)
          element.remove()
        } else {
          seenVideoIds.add(userId)
        }
      }
    })
  }

  cleanupOrphanedElementsStrict() {
    // More aggressive cleanup - only use when connections are fully closed
    console.log("🧹 Performing strict cleanup of orphaned elements...")
    
    const participantElements = document.querySelectorAll('[id^="participant-"]')
    const videoElements = document.querySelectorAll('[id^="video-"]')
    
    // Track which userIds actually have peer connections
    const activeUserIds = new Set(this.peerConnections.keys())
    
    // Remove participant elements that don't have active peer connections
    participantElements.forEach(element => {
      const userId = element.id.replace('participant-', '')
      if (!activeUserIds.has(userId)) {
        console.log(`🧹 Removing orphaned participant element: ${userId}`)
        element.remove()
      }
    })
    
    // Remove video elements that don't have active peer connections
    videoElements.forEach(element => {
      const userId = element.id.replace('video-', '')
      // Skip local video
      if (userId !== 'localVideo' && !activeUserIds.has(userId)) {
        console.log(`🧹 Removing orphaned video element: ${userId}`)
        element.remove()
      }
    })
    
    // Also clean up duplicates
    this.cleanupOrphanedElements()
  }

  createVideoElement(userId, username) {
    console.log(`🖼️ Creating video element for ${username} (${userId})`)
    
    const videoContainer = document.querySelector('.video-container')
    if (!videoContainer) {
      console.error("❌ Video container not found!")
      return
    }
    
    // Create wrapper for proper positioning context
    const wrapper = document.createElement('div')
    wrapper.className = 'video-wrapper video-element remote-video'
    wrapper.id = `wrapper-${userId}`
    wrapper.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      pointer-events: none;
    `
    
    const videoElement = document.createElement('video')
    videoElement.id = `video-${userId}`
    videoElement.className = 'video-element'
    videoElement.autoplay = true
    videoElement.playsinline = true
    videoElement.muted = false // Allow audio for remote videos
    videoElement.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: auto;
      object-fit: cover;
    `
    
    // Add participant label to wrapper
    const label = document.createElement('div')
    label.className = 'participant-label'
    label.textContent = username
    label.style.cssText = `
      position: absolute;
      bottom: 8px;
      right: 8px;
      background: rgba(0,0,0,0.7);
      color: white;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 14px;
      z-index: 1000;
      font-weight: 500;
      pointer-events: none;
    `
    
    wrapper.appendChild(videoElement)
    wrapper.appendChild(label)
    videoContainer.appendChild(wrapper)
    
    // Apply initial positioning
    this.updateVideoLayout()
    
    // Store pending stream if we have one
    if (this.pendingStreams && this.pendingStreams.has(userId)) {
      console.log(`🔄 Attaching pending stream for ${username}`)
      this.attachStreamToVideoElement(userId, this.pendingStreams.get(userId))
      this.pendingStreams.delete(userId)
    }
    
    console.log(`✅ Video element created for ${username}: #video-${userId}`)
  }

  updateVideoLayout() {
    // Clean up any orphaned elements first
    this.cleanupOrphanedElements()
    
    // Get remote video wrappers (or videos if no wrapper)
    const remoteVideoWrappers = document.querySelectorAll('.video-wrapper.remote-video, .remote-video:not(.video-wrapper .remote-video)')
    const localVideo = document.getElementById('localVideo')
    const localWrapper = localVideo?.parentElement?.classList.contains('video-wrapper') ? localVideo.parentElement : localVideo
    const participantCount = remoteVideoWrappers.length
    const noParticipantsMessage = document.getElementById("noParticipantsMessage")
    
    console.log(`🔄 Updating video layout for ${participantCount} participants`)

    // Reset video container to normal positioning for non-grid layouts
    const videoContainer = document.querySelector('.video-container')
    if (videoContainer && participantCount <= 1) {
      videoContainer.style.display = 'block'
      videoContainer.style.flexWrap = ''
      videoContainer.style.gap = ''
    }

    if (participantCount === 0) {
      // No remote participants - local video fills full container
      if (localVideo && localWrapper) {
        localWrapper.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 10;
          border: 2px solid transparent;
          border-radius: 8px;
          overflow: hidden;
          pointer-events: none;
        `
        localWrapper.className = 'video-wrapper video-element responsive-local-video local-video-waiting'
      }
      
      // Show waiting message if no local video either
      if (noParticipantsMessage) {
        noParticipantsMessage.style.display = localVideo ? 'none' : 'block'
      }
      return
    }

    // Hide waiting message when we have participants
    if (noParticipantsMessage) {
      noParticipantsMessage.style.display = 'none'
    }

    if (participantCount === 1) {
      // One remote participant - remote video fills container, local video in top-right corner
      const remoteWrapper = remoteVideoWrappers[0]
      remoteWrapper.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border: 2px solid transparent;
        border-radius: 8px;
        z-index: 2;
        background: #000;
        overflow: hidden;
        pointer-events: none;
      `

      // Move local video to top-right corner as picture-in-picture
      if (localVideo && localWrapper) {
        localWrapper.style.cssText = `
          position: absolute;
          top: 2vh;
          right: 2vw;
          width: min(18vw, 250px);
          height: min(13.5vh, 188px);
          z-index: 10;
          border: 2px solid transparent;
          border-radius: 8px;
          overflow: hidden;
          pointer-events: none;
        `
        localWrapper.className = 'video-wrapper video-element responsive-local-video local-video-pip'
      }
    } else {
      // Multiple participants (2+) - grid layout using flexbox approach
      const videoContainer = document.querySelector('.video-container')
      if (videoContainer) {
        // Convert container to flex for grid layout
        videoContainer.style.cssText += `
          display: flex;
          flex-wrap: wrap;
          gap: 2px;
        `
      }
      
      // Include local video in grid calculation
      const totalVideos = participantCount + (localVideo ? 1 : 0)
      const cols = Math.ceil(Math.sqrt(totalVideos))
      const rows = Math.ceil(totalVideos / cols)
      
      // Calculate dimensions for flex grid
      const itemWidth = `calc(${100 / cols}% - ${(cols - 1) * 2}px / ${cols})`
      const itemHeight = `calc(${100 / rows}% - ${(rows - 1) * 2}px / ${rows})`
      
      // Style all remote videos
      remoteVideoWrappers.forEach((wrapper, index) => {
        wrapper.style.cssText = `
          position: relative;
          width: ${itemWidth};
          height: ${itemHeight};
          border: 1px solid #333;
          border-radius: 4px;
          background: #000;
          overflow: hidden;
          pointer-events: none;
          flex-shrink: 0;
        `
      })

      // Style local video to fit in grid
      if (localVideo && localWrapper) {
        localWrapper.style.cssText = `
          position: relative;
          width: ${itemWidth};
          height: ${itemHeight};
          border: 2px solid transparent;
          border-radius: 4px;
          overflow: hidden;
          pointer-events: none;
          flex-shrink: 0;
          order: -1;
        `
        localWrapper.className = 'video-wrapper video-element responsive-local-video local-video-grid'
      }
    }
  }

  attachStreamToVideoElement(userId, stream) {
    console.log(`🔗 Attempting to attach stream for user: ${userId}`)
    
    const videoElement = document.getElementById(`video-${userId}`)
    
    if (!videoElement) {
      console.warn(`⏳ Video element not found for ${userId}, storing stream for later`)
      // Store stream for when video element is created
      if (!this.pendingStreams) {
        this.pendingStreams = new Map()
      }
      this.pendingStreams.set(userId, stream)
      return
    }

    try {
      videoElement.srcObject = stream
      console.log(`✅ Remote stream attached to video element for user ${userId}`)
      
      // Set up audio monitoring for remote stream
      this.setupRemoteAudioMonitoring(userId, stream)
      
      // Add event listeners for debugging
      videoElement.onloadedmetadata = () => {
        console.log(`📺 Video metadata loaded for ${userId}:`, {
          videoWidth: videoElement.videoWidth,
          videoHeight: videoElement.videoHeight,
          duration: videoElement.duration
        })
      }
      
      videoElement.onplay = () => {
        console.log(`▶️ Video started playing for ${userId}`)
      }
      
      videoElement.onerror = (error) => {
        console.error(`❌ Video error for ${userId}:`, error)
      }

    } catch (error) {
      console.error(`❌ Error attaching stream to video element for ${userId}:`, error)
    }
  }

  removeParticipant(userId) {
    console.log(`👤 Removing participant: ${userId}`)
    
    // Remove from participants list
    const participantElement = document.getElementById(`participant-${userId}`)
    if (participantElement) {
      participantElement.remove()
    }
    
    // Remove video element
    const videoElement = document.getElementById(`video-${userId}`)
    if (videoElement) {
      videoElement.remove()
    }
    
    // Remove audio monitoring for this participant
    this.removeParticipantAudioMonitoring(userId)
    
    // Clean up pending streams
    if (this.pendingStreams && this.pendingStreams.has(userId)) {
      console.log(`🗑️ Cleaning up pending stream for ${userId}`)
      this.pendingStreams.delete(userId)
    }
    
    // Update video layout for remaining participants
    this.updateVideoLayout()
    
    // Perform strict cleanup when participants actually leave
    this.cleanupOrphanedElementsStrict()
    
    // Update "no participants" message
    this.updateNoParticipantsMessage()
    
    console.log(`✅ Participant ${userId} removed successfully`)
  }

  updateNoParticipantsMessage() {
    // This logic is now handled in updateVideoLayout()
    // Keeping this function for compatibility but delegating to layout update
    this.updateVideoLayout()
  }

  closePeerConnection(userId) {
    const peerConnection = this.peerConnections.get(userId)
    if (peerConnection) {
      peerConnection.close()
      this.peerConnections.delete(userId)
    }
    
    // Clean up pending ICE candidates
    if (this.pendingIceCandidates.has(userId)) {
      this.pendingIceCandidates.delete(userId)
      console.log(`🧹 Cleaned up pending ICE candidates for ${userId}`)
    }
    
    // Clean up retry counters
    if (this.connectionRetries.has(userId)) {
      this.connectionRetries.delete(userId)
      console.log(`🧹 Cleaned up retry counter for ${userId}`)
    }
  }

  async handleConnectionFailure(userId) {
    const MAX_RETRIES = 3
    const currentRetries = this.connectionRetries.get(userId) || 0
    
    if (currentRetries >= MAX_RETRIES) {
      console.error(`🚫 Max retries (${MAX_RETRIES}) reached for ${userId}. Giving up.`)
      this.connectionRetries.delete(userId)
      return
    }
    
    this.connectionRetries.set(userId, currentRetries + 1)
    const backoffDelay = Math.pow(2, currentRetries) * 2000 // 2s, 4s, 8s
    
    console.log(`🔄 Connection retry ${currentRetries + 1}/${MAX_RETRIES} for ${userId} (waiting ${backoffDelay}ms)`)
    
    try {
      // Close existing connection
      this.closePeerConnection(userId)
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, backoffDelay))
      
      // Create new connection and restart negotiation
      await this.createPeerConnection(userId)
      
      if (this.shouldInitiateCall(userId)) {
        console.log(`🔄 Restarting offer for ${userId}`)
        await this.createOffer(userId)
      }
      
    } catch (error) {
      console.error(`❌ Failed to restart connection with ${userId}:`, error)
    }
  }

  showScreenShareNotification(username, isStarting) {
    const message = isStarting ? `${username} started screen sharing` : `${username} stopped screen sharing`

    // Create notification element
    const notification = document.createElement("div")
    notification.className = "alert alert-info alert-dismissible fade show"
    notification.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `

    // Add to page
    const container = document.querySelector(".container")
    container.insertBefore(notification, container.firstChild)

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove()
      }
    }, 5000)
  }

  showCameraChangeNotification(username, cameraLabel) {
    const message = `${username} switched to ${cameraLabel || 'a different camera'}`

    // Create notification element
    const notification = document.createElement("div")
    notification.className = "alert alert-success alert-dismissible fade show"
    notification.innerHTML = `
            <i class="fas fa-camera"></i> ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `

    // Add to page
    const container = document.querySelector(".container")
    container.insertBefore(notification, container.firstChild)

    // Auto-remove after 3 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove()
      }
    }, 3000)
  }

  showError(message) {
    const errorDiv = document.createElement("div")
    errorDiv.className = "alert alert-danger alert-dismissible fade show"
    errorDiv.innerHTML = `
            <strong>Error:</strong> ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `

    const container = document.querySelector(".container")
    container.insertBefore(errorDiv, container.firstChild)
  }

  sendWebSocketMessage(message) {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      console.log(`📤 Sending WebSocket message:`, {
        type: message.type,
        target_id: message.target_id || 'broadcast',
        hasOffer: !!message.offer,
        hasAnswer: !!message.answer,
        hasCandidate: !!message.candidate
      })
      this.websocket.send(JSON.stringify(message))
    } else {
      // For mute_status messages, don't show error since it's normal when alone
      if (message.type === 'mute_status') {
        console.log(`🔇 Mute status not sent - no other participants connected`)
      } else {
        console.warn(`⚠️ Cannot send WebSocket message - connection not open:`, {
          readyState: this.websocket?.readyState,
          messageType: message.type
        })
      }
    }
  }

  endCall() {
    // Remove device change listener
    if (this.deviceChangeListener && navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
      console.log("🔌 Removing device change listener...")
      navigator.mediaDevices.removeEventListener('devicechange', this.deviceChangeListener)
      this.deviceChangeListener = null
    }

    // Stop screen sharing if active
    if (this.screenStream) {
      console.log("🛑 Cleaning up screen sharing before ending call...")
      this.screenStream.getTracks().forEach((track) => track.stop())
      this.screenStream = null
    }

    // Stop all local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop())
    }

    // Close all peer connections
    this.peerConnections.forEach((peerConnection) => {
      peerConnection.close()
    })
    this.peerConnections.clear()

    // Close WebSocket
    if (this.websocket) {
      this.websocket.close()
    }

    // Redirect to dashboard
    window.location.href = "/"
  }

  async setupLocalAudioMonitoring() {
    try {
      if (!this.localStream) return

      const audioTrack = this.localStream.getAudioTracks()[0]
      if (!audioTrack) return

      // Create audio context if it doesn't exist
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
      }

      // Resume audio context if suspended (required by browser autoplay policies)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
        console.log("🎵 AudioContext resumed")
      }

      // Create analyser for local audio with better settings for voice detection
      this.localAnalyser = this.audioContext.createAnalyser()
      this.localAnalyser.fftSize = 512 // Increased for better frequency resolution
      this.localAnalyser.smoothingTimeConstant = 0.8
      this.localAnalyser.minDecibels = -90
      this.localAnalyser.maxDecibels = -10

      // Create media stream source
      const source = this.audioContext.createMediaStreamSource(this.localStream)
      source.connect(this.localAnalyser)

      // Start monitoring if not already running
      if (!this.audioMonitoringInterval) {
        this.startAudioMonitoring()
      }

      console.log("🎤 Local audio monitoring setup complete")
    } catch (error) {
      console.error("❌ Error setting up local audio monitoring:", error)
    }
  }

  async setupRemoteAudioMonitoring(userId, stream) {
    try {
      const audioTrack = stream.getAudioTracks()[0]
      if (!audioTrack) return

      // Create audio context if it doesn't exist
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
      }

      // Resume audio context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }

      // Create analyser for this remote user with better settings
      const analyser = this.audioContext.createAnalyser()
      analyser.fftSize = 512 // Increased for better frequency resolution
      analyser.smoothingTimeConstant = 0.8
      analyser.minDecibels = -90
      analyser.maxDecibels = -10

      // Create media stream source
      const source = this.audioContext.createMediaStreamSource(stream)
      source.connect(analyser)

      // Store analyser for this user
      this.remoteAnalysers.set(userId, analyser)

      // Start monitoring if not already running
      if (!this.audioMonitoringInterval) {
        this.startAudioMonitoring()
      }

      console.log(`🎤 Remote audio monitoring setup for user ${userId}`)
    } catch (error) {
      console.error(`❌ Error setting up remote audio monitoring for ${userId}:`, error)
    }
  }

  startAudioMonitoring() {
    if (this.audioMonitoringInterval) return

    this.audioMonitoringInterval = setInterval(() => {
      this.checkAudioLevels()
    }, 100) // Check every 100ms

    console.log("🎵 Audio monitoring started")
  }

  stopAudioMonitoring() {
    if (this.audioMonitoringInterval) {
      clearInterval(this.audioMonitoringInterval)
      this.audioMonitoringInterval = null
    }

    // Cleanup audio context
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }

    this.localAnalyser = null
    this.remoteAnalysers.clear()

    console.log("🔇 Audio monitoring stopped")
  }

  checkAudioLevels() {
    // Check local audio level
    if (this.localAnalyser && !this.isMuted) {
      const audioLevel = this.getAudioLevel(this.localAnalyser)
      const isSpeaking = audioLevel > this.speakingThreshold
      this.updateVideoHighlight('localVideo', isSpeaking)
    }

    // Check remote audio levels
    this.remoteAnalysers.forEach((analyser, userId) => {
      const audioLevel = this.getAudioLevel(analyser)
      const isSpeaking = audioLevel > this.speakingThreshold
      this.updateVideoHighlight(`video-${userId}`, isSpeaking)
    })
  }

  getAudioLevel(analyser) {
    const bufferLength = analyser.fftSize
    const dataArray = new Uint8Array(bufferLength)
    analyser.getByteTimeDomainData(dataArray)

    // Calculate RMS (Root Mean Square) for better voice detection
    let rms = 0
    for (let i = 0; i < bufferLength; i++) {
      const sample = (dataArray[i] - 128) / 128 // Convert to -1 to 1 range
      rms += sample * sample
    }
    rms = Math.sqrt(rms / bufferLength)
    
    return rms
  }

  updateVideoHighlight(elementId, isSpeaking) {
    const videoElement = document.getElementById(elementId)
    if (!videoElement) return

    // Check if video is wrapped, and apply speaking class to wrapper instead
    const targetElement = videoElement.parentElement && videoElement.parentElement.classList.contains('video-wrapper') 
      ? videoElement.parentElement 
      : videoElement

    if (isSpeaking) {
      targetElement.classList.add('speaking')
    } else {
      targetElement.classList.remove('speaking')
    }
  }

  updateMuteIndicator(elementId, isMuted) {
    console.log(`🔇 updateMuteIndicator called for ${elementId}, muted: ${isMuted}`)
    
    const videoElement = document.getElementById(elementId)
    if (!videoElement) {
      console.warn(`❌ Video element not found: ${elementId}`)
      return
    }

    // Find the wrapper element (for all videos with wrappers) or use the video element directly
    let targetElement = videoElement
    if (videoElement.parentElement && videoElement.parentElement.classList.contains('video-wrapper')) {
      targetElement = videoElement.parentElement
    }

    // Remove existing mute indicator if it exists
    const existingIndicator = targetElement.querySelector('.mute-indicator')
    if (existingIndicator) {
      console.log(`🗑️ Removing existing mute indicator for ${elementId}`)
      existingIndicator.remove()
    }

    // Add mute indicator if muted
    if (isMuted) {
      console.log(`➕ Adding mute indicator for ${elementId}`)
      
      const muteIndicator = document.createElement('div')
      muteIndicator.className = 'mute-indicator'
      muteIndicator.innerHTML = '<i class="fas fa-microphone-slash"></i>'
      muteIndicator.style.cssText = `
        position: absolute;
        bottom: 10px;
        left: 10px;
        background: rgba(220, 53, 69, 0.95);
        color: white;
        padding: 6px;
        border-radius: 50%;
        font-size: 14px;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: 2px solid rgba(255, 255, 255, 0.8);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        pointer-events: none;
        user-select: none;
      `
      
      targetElement.appendChild(muteIndicator)
      
      console.log(`✅ Mute indicator added for ${elementId} to ${targetElement.className}`)
    } else {
      console.log(`🔊 No mute indicator needed for ${elementId} (not muted)`)
    }
  }

  // Debug function - can be called from browser console
  debugAudioMonitoring() {
    console.log("🔍 Audio Monitoring Debug Info:")
    console.log("- Local stream:", !!this.localStream)
    console.log("- Audio context:", !!this.audioContext)
    console.log("- Audio context state:", this.audioContext?.state)
    console.log("- Local analyser:", !!this.localAnalyser)
    console.log("- Monitoring interval:", !!this.audioMonitoringInterval)
    console.log("- Is muted:", this.isMuted)
    console.log("- Speaking threshold:", this.speakingThreshold)
    console.log("- Remote analysers count:", this.remoteAnalysers.size)
    
    if (this.localStream) {
      const audioTracks = this.localStream.getAudioTracks()
      console.log("- Audio tracks:", audioTracks.length)
      audioTracks.forEach((track, i) => {
        console.log(`  Track ${i}:`, {
          label: track.label,
          enabled: track.enabled,
          readyState: track.readyState
        })
      })
    }
    
    // Test current audio level
    if (this.localAnalyser) {
      const currentLevel = this.getAudioLevel(this.localAnalyser)
      console.log("- Current audio level:", currentLevel)
      console.log("- Would be speaking:", currentLevel > this.speakingThreshold)
    }
  }

  // Debug function for testing mute indicators
  debugMuteIndicator() {
    console.log("🔍 Mute Indicator Debug Info:")
    console.log("- Current mute state:", this.isMuted)
    
    const localVideo = document.getElementById('localVideo')
    console.log("- Local video element found:", !!localVideo)
    
    if (localVideo) {
      const wrapper = localVideo.parentElement
      console.log("- Video wrapper found:", wrapper.classList.contains('video-wrapper'))
      console.log("- Wrapper position:", window.getComputedStyle(wrapper).position)
      
      const targetElement = wrapper.classList.contains('video-wrapper') ? wrapper : localVideo
      const muteIndicator = targetElement.querySelector('.mute-indicator')
      console.log("- Existing mute indicator:", !!muteIndicator)
      console.log("- Target element for indicator:", targetElement.className)
      
      if (muteIndicator) {
        console.log("- Mute indicator styles:", muteIndicator.style.cssText)
        console.log("- Mute indicator visible:", muteIndicator.offsetWidth > 0 && muteIndicator.offsetHeight > 0)
        const rect = muteIndicator.getBoundingClientRect()
        console.log("- Mute indicator position:", { x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      }
    }
    
    // Test adding a mute indicator
    console.log("🧪 Testing mute indicator...")
    this.updateMuteIndicator('localVideo', true)
    
    setTimeout(() => {
      console.log("🧪 Testing mute indicator removal...")
      this.updateMuteIndicator('localVideo', false)
    }, 3000)
  }

  // Debug function for positioning issues
  debugVideoPosition() {
    const localVideo = document.getElementById('localVideo')
    if (!localVideo) {
      console.log("❌ Local video element not found")
      return
    }

    const computedStyle = window.getComputedStyle(localVideo)
    const boundingRect = localVideo.getBoundingClientRect()

    console.log("🎥 Video Element Position Debug:")
    console.log("- Position:", computedStyle.position)
    console.log("- Top:", computedStyle.top)
    console.log("- Left:", computedStyle.left)
    console.log("- Right:", computedStyle.right)
    console.log("- Bottom:", computedStyle.bottom)
    console.log("- Width:", computedStyle.width)
    console.log("- Height:", computedStyle.height)
    console.log("- Transform:", computedStyle.transform)
    console.log("- Bounding Rect:", {
      x: boundingRect.x,
      y: boundingRect.y,
      width: boundingRect.width,
      height: boundingRect.height
    })

    const muteIndicator = localVideo.querySelector('.mute-indicator')
    if (muteIndicator) {
      const indicatorRect = muteIndicator.getBoundingClientRect()
      console.log("- Mute Indicator Rect:", {
        x: indicatorRect.x,
        y: indicatorRect.y,
        width: indicatorRect.width,
        height: indicatorRect.height
      })
    }
  }

  removeParticipantAudioMonitoring(userId) {
    // Remove analyser for this user
    if (this.remoteAnalysers.has(userId)) {
      this.remoteAnalysers.delete(userId)
      console.log(`🔇 Removed audio monitoring for user ${userId}`)
    }

    // Remove highlight
    this.updateVideoHighlight(`video-${userId}`, false)

    // Stop monitoring if no more participants
    if (this.remoteAnalysers.size === 0 && !this.localAnalyser) {
      this.stopAudioMonitoring()
    }
  }
}
