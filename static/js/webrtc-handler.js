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

    // Detect mobile device
    this.isMobile = this.detectMobileDevice()
    
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
  }

  detectMobileDevice() {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera
    const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase())
    console.log(`📱 Device detection: ${isMobile ? 'Mobile' : 'Desktop'}`)
    return isMobile
  }

  async initializeCall() {
    try {
      console.log("🚀 Initializing call...")
      await this.getUserMedia()
      console.log("✅ User media obtained, setting up WebSocket...")
      await this.setupWebSocket()
      this.startQualityMonitoring()
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

      case "request_video_refresh":
        // Handle request to refresh our video track
        console.log(`🔄 Handling video refresh request:`, data)
        await this.handleVideoRefreshRequest(data)
        break
    }
  }

  async getUserMedia() {
    // Mobile-friendly constraints
    const constraints = this.isMobile ? {
      video: {
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 24, max: 30 },
        facingMode: "user"
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    } : {
      video: {
        width: { ideal: this.qualitySettings.video.width },
        height: { ideal: this.qualitySettings.video.height },
        frameRate: { ideal: this.qualitySettings.video.frameRate },
      },
      audio: {
        sampleRate: this.qualitySettings.audio.sampleRate,
        channelCount: this.qualitySettings.audio.channelCount,
        echoCancellation: true,
        noiseSuppression: true
      },
    }

    try {
      console.log(`📱 Getting user media with ${this.isMobile ? 'mobile' : 'desktop'} constraints:`, constraints)
      
      // Mobile-specific debugging
      if (this.isMobile) {
        console.log(`📱 MOBILE DEBUG: Starting getUserMedia on mobile device`)
        console.log(`📱 MOBILE DEBUG: User agent:`, navigator.userAgent)
        console.log(`📱 MOBILE DEBUG: Screen dimensions:`, screen.width, 'x', screen.height)
        console.log(`📱 MOBILE DEBUG: Viewport:`, window.innerWidth, 'x', window.innerHeight)
        
        // Check for iOS Safari specific issues
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)
        console.log(`📱 MOBILE DEBUG: iOS: ${isIOS}, Safari: ${isSafari}`)
        
        if (isIOS) {
          console.log(`🍎 iOS SPECIFIC: Applying iOS Safari video fixes`)
        }
      }
      
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints)
      document.getElementById("localVideo").srcObject = this.localStream
      console.log("📹 Local stream obtained:", this.localStream)
      
      // Detailed local track analysis
      const localTracks = this.localStream.getTracks()
      console.log("🎬 Local tracks:", localTracks.map(t => {
        const settings = t.kind === 'video' ? t.getSettings() : null
        return {
          kind: t.kind,
          label: t.label,
          enabled: t.enabled,
          readyState: t.readyState,
          settings: settings
        }
      }))
      
      // Mobile-specific track debugging
      if (this.isMobile) {
        console.log(`📱 MOBILE DEBUG: Local tracks analysis`)
        localTracks.forEach((track, index) => {
          if (track.kind === 'video') {
            const settings = track.getSettings()
            console.log(`📱 MOBILE VIDEO TRACK ${index}:`, {
              width: settings.width,
              height: settings.height,
              frameRate: settings.frameRate,
              facingMode: settings.facingMode,
              deviceId: settings.deviceId,
              groupId: settings.groupId
            })
            
            // Check for common mobile issues
            if (!settings.width || !settings.height) {
              console.error(`📱 MOBILE ERROR: Video track has no dimensions!`)
            }
            
            if (settings.width < 100 || settings.height < 100) {
              console.error(`📱 MOBILE ERROR: Video track dimensions too small: ${settings.width}x${settings.height}`)
            }
          }
        })
      }
      
      // Check local video tracks for issues
      const videoTracks = localTracks.filter(t => t.kind === 'video')
      videoTracks.forEach((track, index) => {
        const settings = track.getSettings()
        console.log(`📐 Local video track ${index} settings:`, settings)
        
        if (settings.width === 1 || settings.height === 1) {
          console.error(`❌ Local video track has 1x1 dimensions! This will cause issues.`)
        } else {
          console.log(`✅ Local video track has valid dimensions: ${settings.width}x${settings.height}`)
        }
        
        // Mobile-specific validation
        if (this.isMobile) {
          console.log(`📱 MOBILE DEBUG: Validating video track for mobile`)
          
          // Check if track is actually producing video
          if (track.readyState !== 'live') {
            console.error(`📱 MOBILE ERROR: Video track not live: ${track.readyState}`)
          }
          
          if (track.muted) {
            console.error(`📱 MOBILE ERROR: Video track is muted`)
          }
          
          if (!track.enabled) {
            console.error(`📱 MOBILE ERROR: Video track is disabled`)
          }
        }
        
        // Wait a moment and check again to see if dimensions change
        setTimeout(() => {
          const newSettings = track.getSettings()
          console.log(`🔄 Local video track settings after 1s:`, newSettings)
          
          if (this.isMobile) {
            console.log(`📱 MOBILE DEBUG: Track settings after 1s:`, newSettings)
          }
        }, 1000)
      })
      
      // Wait for video tracks to be properly initialized before adding to peer connections
      await this.waitForVideoTracksReady()
      
      // Add local stream to any existing peer connections
      this.addLocalStreamToExistingPeers()
    } catch (error) {
      console.error("Error accessing media devices:", error)
      
      // Mobile-specific error handling
      if (this.isMobile) {
        console.error(`📱 MOBILE ERROR: getUserMedia failed on mobile:`, error)
        console.log(`📱 MOBILE DEBUG: Error name: ${error.name}`)
        console.log(`📱 MOBILE DEBUG: Error message: ${error.message}`)
        
        // Common mobile errors
        if (error.name === 'NotAllowedError') {
          console.error(`📱 MOBILE ERROR: Permission denied - user needs to allow camera/microphone`)
        } else if (error.name === 'NotFoundError') {
          console.error(`📱 MOBILE ERROR: No camera/microphone found`)
        } else if (error.name === 'OverconstrainedError') {
          console.error(`📱 MOBILE ERROR: Constraints too restrictive for mobile device`)
        }
      }
      
      // Fallback to basic constraints on mobile
      if (this.isMobile) {
        console.log("📱 Trying fallback mobile constraints...")
        try {
          const fallbackConstraints = {
            video: { facingMode: "user" },
            audio: true
          }
          console.log(`📱 MOBILE DEBUG: Trying ultra-basic constraints:`, fallbackConstraints)
          
          this.localStream = await navigator.mediaDevices.getUserMedia(fallbackConstraints)
          document.getElementById("localVideo").srcObject = this.localStream
          console.log("✅ Fallback mobile constraints worked!")
          
          // Debug the fallback stream
          const fallbackTracks = this.localStream.getTracks()
          console.log(`📱 MOBILE DEBUG: Fallback stream tracks:`, fallbackTracks.map(t => ({
            kind: t.kind,
            settings: t.kind === 'video' ? t.getSettings() : null
          })))
          
          await this.waitForVideoTracksReady()
          this.addLocalStreamToExistingPeers()
          return
        } catch (fallbackError) {
          console.error("❌ Fallback constraints also failed:", fallbackError)
          console.error(`📱 MOBILE ERROR: Even basic constraints failed:`, fallbackError)
        }
      }
      
      throw error
    }
  }

  async waitForVideoTracksReady() {
    if (!this.localStream) return
    
    const videoTracks = this.localStream.getVideoTracks()
    if (videoTracks.length === 0) return
    
    console.log("⏳ Waiting for video tracks to be ready...")
    
    for (const track of videoTracks) {
      await this.waitForTrackReady(track)
    }
    
    console.log("✅ All video tracks are ready!")
  }
  
  async waitForTrackReady(track, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now()
      
      const checkTrack = () => {
        const settings = track.getSettings()
        
        // Check if track has valid dimensions
        if (settings.width && settings.height && settings.width > 1 && settings.height > 1) {
          console.log(`✅ Video track ready: ${settings.width}x${settings.height}`)
          resolve()
          return
        }
        
        // Check timeout
        if (Date.now() - startTime > timeout) {
          console.warn(`⚠️ Video track timeout after ${timeout}ms, proceeding anyway. Current settings:`, settings)
          resolve() // Don't reject, just proceed
          return
        }
        
        // Try again in 100ms
        setTimeout(checkTrack, 100)
      }
      
      checkTrack()
    })
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

  /**
   * Create peer connection for a user
   */
  async createPeerConnection(userId) {
    console.log(`🔗 Creating peer connection for user: ${userId}`)
    
    // Close existing connection if it exists
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
    
    // 🔧 CRITICAL FIX: Store userId directly on the connection object
    peerConnection._userId = userId
    
    // Add to connections map immediately
    this.peerConnections.set(userId, peerConnection)

    console.log(`📊 Peer connections after adding ${userId}:`, Array.from(this.peerConnections.keys()))

    // Add local stream tracks (wait for them to be ready first)
    if (this.localStream) {
      console.log(`📤 Adding local stream tracks to peer connection for user: ${userId}`)
      
      // Ensure video tracks are ready before adding
      await this.waitForVideoTracksReady()
      
      // Ensure peer connection is in stable state
      while (peerConnection.signalingState !== 'stable' && peerConnection.signalingState !== 'have-local-offer') {
        console.log(`⏳ Waiting for peer connection to be ready for tracks. Current state: ${peerConnection.signalingState}`)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      
      this.localStream.getTracks().forEach((track) => {
        const settings = track.kind === 'video' ? track.getSettings() : null
        console.log(`🎬 Adding ${track.kind} track:`, {
          id: track.id,
          label: track.label,
          enabled: track.enabled,
          readyState: track.readyState,
          muted: track.muted,
          settings: settings
        })
        
        // Check for problematic video tracks before adding
        if (track.kind === 'video' && settings) {
          if (settings.width === 1 || settings.height === 1 || settings.width === 0 || settings.height === 0) {
            console.error(`❌ Attempting to add invalid video track! Settings:`, settings)
            console.log(`🔄 Retrying track initialization...`)
            // Don't add this track, it's not ready
            return
          } else {
            console.log(`✅ Adding valid video track ${settings.width}x${settings.height}`)
          }
          
          // Additional video track validation
          if (!track.enabled) {
            console.warn(`⚠️ Video track is disabled for ${userId}`)
            track.enabled = true
            console.log(`🔄 Enabled video track for ${userId}`)
          }
          
          if (track.muted) {
            console.warn(`⚠️ Video track is muted for ${userId}`)
          }
          
          if (track.readyState !== 'live') {
            console.warn(`⚠️ Video track is not live for ${userId}, state: ${track.readyState}`)
          }
        }
        
        peerConnection.addTrack(track, this.localStream)
      })
    } else {
      console.warn(`⚠️ No local stream available when creating peer connection for user: ${userId}`)
    }

    // Handle remote stream
    peerConnection.ontrack = async (event) => {
      const stream = event.streams[0]
      
      // 🔧 CRITICAL FIX: Get userId from connection object first, then fallback to map lookup
      let userId = peerConnection._userId
      
              if (!userId) {
          // Fallback: search in peer connections map
          for (const [id, pc] of this.peerConnections.entries()) {
            if (pc === peerConnection) {
              userId = id
              break
            }
          }
        }
      
              if (!userId) {
          console.error(`❌ Could not determine userId for received stream!`)
          console.log(`🔍 Available peer connections:`, Array.from(this.peerConnections.keys()))
          console.log(`🔍 Connection _userId:`, peerConnection._userId)
          console.log(`🔍 Current peer connection:`, peerConnection)
          return
        }
      
      console.log(`📹 Received remote stream from user: ${userId}`, stream)
      
      // Log stream details
      const streamInfo = {
        streamId: stream.id,
        trackCount: stream.getTracks().length,
        tracks: stream.getTracks().map(track => ({
          kind: track.kind,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          settings: track.kind === 'video' ? track.getSettings() : null
        }))
      }
      console.log(`🔍 Stream details:`, streamInfo)
      
      // Enhanced track debugging for mobile
      const tracks = stream.getTracks()
      tracks.forEach((track, index) => {
        if (track.kind === 'video') {
          const settings = track.getSettings()
          console.log(`📐 Video track ${index} settings:`, settings)
          
          if (this.isMobile) {
            console.log(`📱 MOBILE DEBUG: Received video track with settings:`, settings)
            
            // Check for problematic dimensions
            const width = settings.width || 0
            const height = settings.height || 0
            
            if (width <= 1 || height <= 1) {
              console.error(`❌ Received remote video track with invalid dimensions: ${width}x${height}!`)
              
              // Request sender to reinitialize their video track
              console.log(`🔄 Requesting sender ${userId} to reinitialize video track`)
              this.requestSenderVideoRefresh(userId)
            } else {
              console.log(`✅ Remote video track has valid dimensions: ${width}x${height}`)
            }
          }
        }
        
        // Track state monitoring
        track.onmute = () => {
          console.log(` 🔇 Video track muted for ${userId}`)
        }
        
        track.onunmute = () => {
          console.log(`🔊 Video track unmuted for ${userId}`)
        }
        
        track.onended = () => {
          console.log(` ⚠️ Video track ended for ${userId}`)
        }
      })
      
      // 📱 MOBILE: Wait for remote video tracks to be ready before attaching
      let streamReady = true
      if (this.isMobile) {
        console.log(`📱 MOBILE DEBUG: Waiting for remote video tracks to initialize...`)
        
        streamReady = await this.waitForRemoteStreamReady(stream, 5000) // Reduced timeout to 5 seconds
        
        if (!streamReady) {
          console.warn(`⚠️ Remote stream not ready after 5 seconds, trying fallback attachment`)
          
          // Try to attach anyway with fallback handling
          await this.attachStreamWithFallback(userId, stream)
          return
        }
      }
      
      // Attach the stream to video element
      this.attachStreamToVideoElement(userId, stream)
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
      const state = peerConnection.connectionState
      console.log(`🔗 Connection state with ${userId}: ${state}`)
      
      if (state === 'failed') {
        console.error(`❌ Connection failed with ${userId}, attempting to restart...`)
        this.handleConnectionFailure(userId)
      } else if (state === 'connected') {
        console.log(`✅ Successfully connected to ${userId}`)
        // Reset retry counter on successful connection
        this.connectionRetries.delete(userId)
      } else if (state === 'disconnected') {
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
      
      // 🔧 CRITICAL FIX: Check signaling state before setting remote description
      if (peerConnection.signalingState === 'have-local-offer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
        console.log(`📊 Peer connection state after setRemoteDescription: ${peerConnection.signalingState}`)
        console.log(`✅ Successfully processed answer from: ${senderId}`)
      } else if (peerConnection.signalingState === 'stable') {
        console.warn(`⚠️ Ignoring duplicate answer from ${senderId} - connection already stable`)
      } else {
        console.error(`❌ Invalid signaling state for answer from ${senderId}: ${peerConnection.signalingState}`)
      }
      
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
        const videoConstraints = this.isMobile ? {
          width: { ideal: this.qualitySettings.video.width, max: 1280 },
          height: { ideal: this.qualitySettings.video.height, max: 720 },
          frameRate: { ideal: this.qualitySettings.video.frameRate, max: 30 },
          facingMode: "user"
        } : {
          width: { ideal: this.qualitySettings.video.width },
          height: { ideal: this.qualitySettings.video.height },
          frameRate: { ideal: this.qualitySettings.video.frameRate },
        }

        console.log(`📱 Changing video quality on ${this.isMobile ? 'mobile' : 'desktop'}:`, videoConstraints)

        const newStream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
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
        
        // Fallback for mobile
        if (this.isMobile) {
          console.log("📱 Trying fallback quality change for mobile...")
          try {
            const fallbackStream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: "user" },
              audio: false,
            })
            
            const fallbackTrack = fallbackStream.getVideoTracks()[0]
            this.localStream.removeTrack(videoTrack)
            this.localStream.addTrack(fallbackTrack)
            
            // Replace in peer connections
            this.peerConnections.forEach(async (peerConnection) => {
              const sender = peerConnection.getSenders().find((s) => s.track && s.track.kind === "video")
              if (sender) {
                await sender.replaceTrack(fallbackTrack)
              }
            })
            
            console.log("✅ Fallback quality change worked on mobile")
          } catch (fallbackError) {
            console.error("❌ Fallback quality change also failed:", fallbackError)
          }
        }
      }
    }
  }

  setQualityFromProfile(quality) {
    // Mobile-optimized quality profiles
    const mobileQualityProfiles = {
      low: { width: 480, height: 320, frameRate: 15 },
      medium: { width: 640, height: 480, frameRate: 24 },
      high: { width: 960, height: 720, frameRate: 30 },
      ultra: { width: 1280, height: 720, frameRate: 30 }, // Cap at 720p for mobile
    }
    
    const desktopQualityProfiles = {
      low: { width: 640, height: 360, frameRate: 15 },
      medium: { width: 1280, height: 720, frameRate: 30 },
      high: { width: 1920, height: 1080, frameRate: 30 },
      ultra: { width: 3840, height: 2160, frameRate: 30 },
    }

    const profiles = this.isMobile ? mobileQualityProfiles : desktopQualityProfiles
    this.qualitySettings.video = profiles[quality] || profiles["medium"]
    
    console.log(`📱 Quality set for ${this.isMobile ? 'mobile' : 'desktop'}:`, this.qualitySettings.video)
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
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0]

      // Replace screen share with camera
      this.peerConnections.forEach(async (peerConnection) => {
        const sender = peerConnection.getSenders().find((s) => s.track && s.track.kind === "video")
        if (sender) {
          await sender.replaceTrack(videoTrack)
        }
      })

      // Update local video
      document.getElementById("localVideo").srcObject = this.localStream
    }

    this.isScreenSharing = false
    this.updateScreenShareButton()

    // Notify other participants
    this.sendWebSocketMessage({
      type: "screen_share_stop",
    })
  }

  toggleMute() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        this.isMuted = !audioTrack.enabled
        this.updateMuteButton()
      }
    }
  }

  toggleVideo() {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled
        this.isVideoOff = !videoTrack.enabled
        this.updateVideoButton()
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

  createVideoElement(userId, username) {
    console.log(`🖼️ Creating video element for ${username} (${userId}) - Mobile: ${this.isMobile}`)
    
    // Mobile-specific debugging
    if (this.isMobile) {
      console.log(`📱 MOBILE DEBUG: Creating video element on mobile for ${username}`)
      console.log(`📱 MOBILE DEBUG: Current device orientation:`, screen.orientation ? screen.orientation.angle : 'unknown')
      console.log(`📱 MOBILE DEBUG: Viewport size:`, window.innerWidth, 'x', window.innerHeight)
    }
    
    const videoContainer = document.querySelector('.video-container')
    if (!videoContainer) {
      console.error("❌ Video container not found!")
      return
    }
    
    const videoElement = document.createElement('video')
    videoElement.id = `video-${userId}`
    videoElement.className = 'video-element remote-video'
    videoElement.autoplay = true
    videoElement.playsinline = true
    videoElement.muted = false // Allow audio for remote videos
    
    // Critical attributes for video display
    videoElement.setAttribute('playsinline', true)
    videoElement.setAttribute('autoplay', true)
    
    // Mobile-specific attributes
    if (this.isMobile) {
      console.log(`📱 MOBILE DEBUG: Applying mobile-specific video attributes`)
      
      // iOS Safari specific attributes
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      if (isIOS) {
        console.log(`🍎 iOS SPECIFIC: Setting iOS Safari video attributes`)
        videoElement.setAttribute('webkit-playsinline', 'true')
        videoElement.setAttribute('playsinline', 'true') 
        videoElement.setAttribute('muted', 'true') // iOS requires muted for autoplay
        videoElement.setAttribute('autoplay', 'true')
        videoElement.playsInline = true
        videoElement.webkitPlaysInline = true
      } else {
        // Android specific
        console.log(`🤖 ANDROID SPECIFIC: Setting Android video attributes`)
        videoElement.setAttribute('webkit-playsinline', true)
        videoElement.setAttribute('x-webkit-airplay', 'allow')
      }
      
      videoElement.controls = false
      // Start muted on mobile and unmute after play starts (helps with autoplay)
      videoElement.muted = true
      
      // Additional mobile attributes
      videoElement.setAttribute('preload', 'metadata')
      videoElement.setAttribute('crossorigin', 'anonymous')
      
    } else {
      // Desktop-specific optimizations
      videoElement.setAttribute('disablePictureInPicture', false)
      videoElement.preload = 'metadata'
    }
    
    // Additional attributes that might help with black video
    videoElement.setAttribute('poster', '') // Prevent default poster
    videoElement.style.objectFit = 'cover' // Ensure video fills the element
    
    // Responsive sizing for mobile
    const videoSize = this.isMobile ? 
      { width: 250, height: 180 } : 
      { width: 300, height: 200 }
    
    videoElement.style.cssText = `
      position: absolute;
      width: ${videoSize.width}px;
      height: ${videoSize.height}px;
      top: 20px;
      left: ${20 + (Object.keys(this.peerConnections).length * (videoSize.width + 20))}px;
      border: 2px solid #007bff;
      border-radius: 8px;
      z-index: 5;
      background: #1a1a1a;
      object-fit: cover;
      transform: translateZ(0);
      will-change: transform;
    `
    
    // Add participant label
    const label = document.createElement('div')
    label.className = 'participant-label'
    label.textContent = username
    label.style.cssText = `
      position: absolute;
      bottom: 5px;
      left: 5px;
      background: rgba(0,0,0,0.7);
      color: white;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 6;
    `
    
    // Add loading indicator
    const loadingDiv = document.createElement('div')
    loadingDiv.className = 'video-loading'
    loadingDiv.textContent = 'Connecting...'
    loadingDiv.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: white;
      font-size: 14px;
      z-index: 7;
    `
    
    videoElement.appendChild(label)
    videoElement.appendChild(loadingDiv)
    videoContainer.appendChild(videoElement)
    
    // Store pending stream if we have one
    if (this.pendingStreams && this.pendingStreams.has(userId)) {
      console.log(`🔄 Attaching pending stream for ${username}`)
      this.attachStreamToVideoElement(userId, this.pendingStreams.get(userId))
      this.pendingStreams.delete(userId)
    }
    
    console.log(`✅ Video element created for ${username}: #video-${userId}`)
  }

  /**
   * Attach a stream to a video element
   */
  attachStreamToVideoElement(userId, stream) {
    console.log(`🔗 Attempting to attach stream for user: ${userId} (Mobile: ${this.isMobile})`)
    
    // Enhanced mobile debugging
    if (this.isMobile) {
      console.log(`📱 MOBILE DEBUG: Attaching stream to video element on mobile`)
      console.log(`📱 MOBILE DEBUG: Stream details:`, {
        id: stream.id,
        active: stream.active,
        trackCount: stream.getTracks().length
      })
      
      // Analyze each track
      stream.getTracks().forEach((track, index) => {
        const trackInfo = {
          kind: track.kind,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          settings: track.kind === 'video' ? track.getSettings() : null
        }
        console.log(`📱 MOBILE TRACK ${index}:`, trackInfo)
        
        // Check for 0 dimensions on video tracks
        if (track.kind === 'video') {
          const settings = track.getSettings()
          const width = settings.width || 0
          const height = settings.height || 0
          console.log(`📱 MOBILE DEBUG: Video track dimensions: ${width}x${height}`)
          
          if (width === 0 || height === 0) {
            console.warn(`⚠️ Mobile video track has 0 dimensions - this may cause display issues`)
            
            // Try to force track re-initialization
            if (this.isMobile) {
              console.log(`🔄 Attempting to force mobile video track refresh...`)
              // Set up a listener for when the track gets proper dimensions
              this.monitorTrackDimensions(track, userId)
            }
          }
        }
      })
    }
    
    const videoElement = document.getElementById(`video-${userId}`)
    if (!videoElement) {
      console.error(`❌ Video element not found for user: ${userId}`)
      return
    }
    
    try {
      // Set the stream as the video source
      videoElement.srcObject = stream
      console.log(`✅ Remote stream attached to video element for user ${userId}`)
      
      // Enhanced mobile debugging after attachment
      if (this.isMobile) {
        console.log(`📱 MOBILE DEBUG: Stream attached, checking video element state`)
        console.log(`📱 MOBILE DEBUG: Video element properties:`, {
          autoplay: videoElement.autoplay,
          playsinline: videoElement.playsInline,
          muted: videoElement.muted,
          controls: videoElement.controls,
          readyState: videoElement.readyState,
          networkState: videoElement.networkState,
          paused: videoElement.paused,
          ended: videoElement.ended
        })
      }
      
      // Force play after a short delay to ensure stream is attached
      setTimeout(async () => {
        try {
          if (videoElement.paused) {
            console.log(`🎬 Force playing video for ${userId}`)
            
            if (this.isMobile) {
              console.log(`📱 MOBILE DEBUG: Attempting to force play on mobile`)
              
              // Multiple attempts for mobile
              await this.tryAlternativeMobilePlay(videoElement, userId)
            } else {
              await videoElement.play()
            }
            
            console.log(`✅ Video force play successful for ${userId}`)
            
            if (this.isMobile) {
              console.log(`📱 MOBILE DEBUG: Video play successful on mobile`)
            }
          }
          
          // Debug video element after play attempt
          this.debugVideoElement(videoElement, userId)
          
        } catch (error) {
          console.error(`❌ Error forcing video play for ${userId}:`, error)
          
          if (this.isMobile) {
            console.log(`📱 MOBILE DEBUG: Force play failed, trying alternative mobile play`)
            await this.tryAlternativeMobilePlay(videoElement, userId)
          }
        }
      }, 500)
      
    } catch (error) {
      console.error(`❌ Error attaching stream to video element for ${userId}:`, error)
      
      if (this.isMobile) {
        console.error(`📱 MOBILE DEBUG: Stream attachment failed:`, error)
        
        // Try alternative attachment method for mobile
        setTimeout(() => {
          this.tryAlternativeMobileAttachment(videoElement, stream, userId)
        }, 1000)
      }
    }
    
    // Set up video element event listeners with mobile-specific handling
    this.setupVideoElementEvents(videoElement, userId, stream)
  }

  /**
   * Monitor video track dimensions and refresh when they become available
   */
  monitorTrackDimensions(track, userId, maxAttempts = 50) {
    let attempts = 0
    
    const checkDimensions = () => {
      attempts++
      const settings = track.getSettings()
      const width = settings.width || 0
      const height = settings.height || 0
      
      console.log(`📱 MOBILE DEBUG: Track dimension check ${attempts}/${maxAttempts}: ${width}x${height}`)
      
      if (width > 0 && height > 0) {
        console.log(`✅ Track dimensions available: ${width}x${height}`)
        
        // Try to refresh the video element
        const videoElement = document.getElementById(`video-${userId}`)
        if (videoElement && videoElement.srcObject) {
          console.log(`🔄 Refreshing video element with proper dimensions`)
          this.debugVideoElement(videoElement, userId)
        }
        return
      }
      
      if (attempts < maxAttempts) {
        setTimeout(checkDimensions, 200)
      } else {
        console.warn(`⚠️ Track dimensions never became available for ${userId}`)
      }
    }
    
    checkDimensions()
  }

  /**
   * Alternative stream attachment method for mobile
   */
  async tryAlternativeMobileAttachment(videoElement, stream, userId) {
    console.log(`📱 MOBILE DEBUG: Trying alternative stream attachment for ${userId}`)
    
    try {
      // Method 1: Clear and re-attach
      videoElement.srcObject = null
      await new Promise(resolve => setTimeout(resolve, 100))
      videoElement.srcObject = stream
      
      console.log(`📱 MOBILE DEBUG: Alternative attachment method 1 completed`)
      
      // Try to play after re-attachment
      setTimeout(async () => {
        try {
          await videoElement.play()
          console.log(`✅ Alternative attachment successful for ${userId}`)
        } catch (error) {
          console.warn(`⚠️ Alternative attachment play failed:`, error)
          
          // Method 2: Create a new video element
          this.recreateMobileVideoElement(userId, stream)
        }
      }, 500)
      
    } catch (error) {
      console.error(`❌ Alternative attachment failed:`, error)
    }
  }

  /**
   * Recreate video element for mobile if all else fails
   */
  recreateMobileVideoElement(userId, stream) {
    console.log(`📱 MOBILE DEBUG: Recreating video element for ${userId}`)
    
    const oldElement = document.getElementById(`video-${userId}`)
    if (oldElement && oldElement.parentNode) {
      // Create new video element
      const newElement = this.createVideoElement(userId, this.participants.get(userId) || 'Unknown')
      
      // Replace old element
      oldElement.parentNode.replaceChild(newElement, oldElement)
      
      // Attach stream to new element
      setTimeout(() => {
        newElement.srcObject = stream
        newElement.play().catch(console.error)
        console.log(`📱 MOBILE DEBUG: Video element recreated for ${userId}`)
      }, 100)
    }
  }

  debugVideoElement(videoElement, userId) {
    console.log(`🔍 DEBUGGING VIDEO ELEMENT FOR ${userId}:`)
    console.log(`📐 Dimensions: ${videoElement.videoWidth}x${videoElement.videoHeight}`)
    console.log(`🎵 Audio tracks: ${videoElement.srcObject ? videoElement.srcObject.getAudioTracks().length : 0}`)
    console.log(`📹 Video tracks: ${videoElement.srcObject ? videoElement.srcObject.getVideoTracks().length : 0}`)
    
    // Mobile-specific debugging
    if (this.isMobile) {
      console.log(`📱 MOBILE DEBUG: Detailed video element analysis for ${userId}`)
      console.log(`📱 MOBILE DEBUG: Video element dimensions: ${videoElement.videoWidth}x${videoElement.videoHeight}`)
      console.log(`📱 MOBILE DEBUG: CSS dimensions: ${videoElement.offsetWidth}x${videoElement.offsetHeight}`)
      console.log(`📱 MOBILE DEBUG: Display style:`, window.getComputedStyle(videoElement).display)
      console.log(`📱 MOBILE DEBUG: Visibility:`, window.getComputedStyle(videoElement).visibility)
      
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      if (isIOS) {
        console.log(`🍎 iOS SPECIFIC: Checking iOS-specific video properties`)
        console.log(`🍎 iOS playsInline:`, videoElement.playsInline)
        console.log(`🍎 iOS webkitPlaysInline:`, videoElement.webkitPlaysInline)
      }
    }
    
    if (videoElement.srcObject) {
      const tracks = videoElement.srcObject.getTracks()
      console.log(`🎬 Stream tracks for ${userId}:`)
      tracks.forEach((track, index) => {
        const settings = track.kind === 'video' ? track.getSettings() : null
        console.log(`  Track ${index}:`, {
          kind: track.kind,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          settings: settings
        })
        
        if (track.kind === 'video' && settings) {
          console.log(`  📐 Video track settings:`, settings)
          
          if (settings.width === 0 || settings.height === 0) {
            console.error(`❌ Video track has 0 dimensions!`)
            
            if (this.isMobile) {
              console.error(`📱 MOBILE ERROR: Zero dimensions detected on mobile - this is likely the cause of black video`)
            }
          }
        }
      })
    } else {
      console.error(`❌ No srcObject attached to video element!`)
      
      if (this.isMobile) {
        console.error(`📱 MOBILE ERROR: No stream attached to video element on mobile`)
      }
    }
    
    console.log(`🎮 Video element state:`, {
      readyState: videoElement.readyState,
      networkState: videoElement.networkState,
      paused: videoElement.paused,
      ended: videoElement.ended,
      muted: videoElement.muted,
      volume: videoElement.volume,
      currentTime: videoElement.currentTime,
      duration: videoElement.duration
    })
    
    // Mobile-specific state logging
    if (this.isMobile) {
      console.log(`📱 MOBILE DEBUG: Mobile-specific video state:`, {
        autoplay: videoElement.autoplay,
        playsInline: videoElement.playsInline,
        controls: videoElement.controls,
        preload: videoElement.preload,
        crossOrigin: videoElement.crossOrigin
      })
    }
  }

  async ensureMobileVideoPlays(videoElement, userId) {
    try {
      console.log(`📱 Ensuring mobile video plays for ${userId}`)
      
      if (videoElement.paused) {
        const playPromise = videoElement.play()
        if (playPromise !== undefined) {
          await playPromise
          console.log(`✅ Mobile video started playing for ${userId}`)
        }
      }
    } catch (error) {
      console.warn(`⚠️ Mobile video autoplay failed for ${userId}:`, error.message)
      
      // Create play button overlay for manual start if autoplay fails
      if (error.name === 'NotAllowedError') {
        this.createPlayButton(videoElement, userId)
      }
    }
  }

  createPlayButton(videoElement, userId) {
    const playButton = document.createElement('div')
    playButton.className = 'mobile-play-button'
    playButton.innerHTML = '▶️ Tap to play'
    playButton.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0,0,0,0.8);
      color: white;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
      z-index: 10;
      font-size: 14px;
    `
    
    playButton.onclick = async () => {
      try {
        await videoElement.play()
        playButton.remove()
        console.log(`✅ Manual play started for ${userId}`)
      } catch (error) {
        console.error(`❌ Manual play failed for ${userId}:`, error)
      }
    }
    
    videoElement.parentElement.appendChild(playButton)
    console.log(`🎮 Created play button for ${userId}`)
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
    
    // Clean up pending streams
    if (this.pendingStreams && this.pendingStreams.has(userId)) {
      console.log(`🗑️ Cleaning up pending stream for ${userId}`)
      this.pendingStreams.delete(userId)
    }
    
    // Update "no participants" message
    this.updateNoParticipantsMessage()
    
    console.log(`✅ Participant ${userId} removed successfully`)
  }

  updateNoParticipantsMessage() {
    const noParticipantsMessage = document.getElementById("noParticipantsMessage")
    const hasParticipants = this.peerConnections.size > 0
    
    if (noParticipantsMessage) {
      noParticipantsMessage.style.display = hasParticipants ? 'none' : 'block'
    }
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

  async requestFreshVideoStream(userId) {
    try {
      console.log(`🔄 Requesting fresh video stream from ${userId}`)
      
      const peerConnection = this.peerConnections.get(userId)
      if (!peerConnection) return
      
      // Close and recreate the peer connection
      this.closePeerConnection(userId)
      
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Recreate the connection
      await this.createPeerConnection(userId)
      
      // Restart negotiation if we're the initiator
      if (this.shouldInitiateCall(userId)) {
        console.log(`🔄 Creating fresh offer for ${userId}`)
        await this.createOffer(userId)
      }
      
    } catch (error) {
      console.error(`❌ Failed to request fresh video stream from ${userId}:`, error)
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
      console.error(`❌ Cannot send WebSocket message - connection not open:`, {
        readyState: this.websocket?.readyState,
        messageType: message.type
      })
    }
  }

  endCall() {
    // Stop all tracks
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

  /**
   * Wait for a remote video track to have valid dimensions
   */
  async waitForRemoteVideoTrackReady(track, timeout = 10000) {
    const startTime = Date.now()
    
    while (Date.now() - startTime < timeout) {
      const settings = track.getSettings()
      const width = settings.width || 0
      const height = settings.height || 0
      
      console.log(`📱 MOBILE DEBUG: Checking remote track readiness: ${width}x${height}`)
      
      if (width > 1 && height > 1) {
        console.log(`✅ Remote video track ready: ${width}x${height}`)
        return true
      }
      
      // Wait 100ms before checking again
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    console.warn(`⚠️ Remote video track timeout after ${timeout}ms`)
    return false
  }

  /**
   * Wait for all remote video tracks in a stream to be ready
   */
  async waitForRemoteStreamReady(stream, timeout = 10000) {
    console.log(`📱 MOBILE DEBUG: Waiting for remote stream tracks to be ready...`)
    
    const videoTracks = stream.getVideoTracks()
    if (videoTracks.length === 0) {
      console.log(`ℹ️ No video tracks in remote stream`)
      return true
    }
    
    const promises = videoTracks.map(track => this.waitForRemoteVideoTrackReady(track, timeout))
    const results = await Promise.all(promises)
    
    const allReady = results.every(ready => ready)
    
    if (allReady) {
      console.log(`✅ All remote video tracks are ready!`)
    } else {
      console.warn(`⚠️ Some remote video tracks are not ready`)
    }
    
    return allReady
  }

  /**
   * Request sender to refresh their video track if we receive invalid dimensions
   */
  requestSenderVideoRefresh(userId) {
      console.log(`🔄 Requesting ${userId} to refresh their video track due to invalid dimensions`)
      
      // Send a custom message to request video refresh
      const message = {
          type: 'request_video_refresh',
          target_id: userId,
          reason: 'invalid_dimensions'
      }
      
      this.sendWebSocketMessage(message)
  }

  /**
   * Attach stream with fallback handling for problematic tracks
   */
  async attachStreamWithFallback(userId, stream) {
      console.log(`📱 MOBILE FALLBACK: Attempting to attach stream with 0x0 dimensions for ${userId}`)
      
      const videoElement = document.getElementById(`video-${userId}`)
      if (!videoElement) {
          console.error(`❌ Video element not found for fallback attachment: ${userId}`)
          return
      }
      
      try {
          // Attach the stream anyway
          videoElement.srcObject = stream
          console.log(`⚠️ Fallback: Stream attached despite 0x0 dimensions for ${userId}`)
          
          // Set up a monitor to check if dimensions appear later
          let attempts = 0
          const maxAttempts = 30 // 15 seconds
          
          const dimensionMonitor = setInterval(() => {
              attempts++
              
              if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
                  console.log(`✅ Fallback success: Video dimensions appeared: ${videoElement.videoWidth}x${videoElement.videoHeight}`)
                  clearInterval(dimensionMonitor)
                  
                  // Try to play the video now that it has dimensions
                  videoElement.play().catch(error => {
                      console.warn(`⚠️ Could not play video after dimensions appeared:`, error)
                  })
                  
                  return
              }
              
              if (attempts >= maxAttempts) {
                  console.warn(`⚠️ Fallback timeout: Video dimensions never appeared for ${userId}`)
                  clearInterval(dimensionMonitor)
                  
                  // Last resort: request sender to restart their video
                  this.requestSenderVideoRefresh(userId)
              }
              
              console.log(`📱 FALLBACK MONITOR ${attempts}/${maxAttempts}: Still waiting for dimensions (${videoElement.videoWidth}x${videoElement.videoHeight})`)
          }, 500)
          
      } catch (error) {
          console.error(`❌ Fallback attachment failed for ${userId}:`, error)
      }
  }

  /**
   * Handle request to refresh our local video track
   */
  async handleVideoRefreshRequest(data) {
      console.log(`🔄 Handling video refresh request:`, data)
      
      try {
          // Get fresh video stream
          const newStream = await this.getUserMedia()
          
          if (newStream) {
              console.log(`✅ Got fresh video stream, updating peer connections`)
              
              // Update local video element
              const localVideo = document.getElementById('localVideo')
              if (localVideo) {
                  localVideo.srcObject = newStream
              }
              
              // Update all peer connections with new video track
              const videoTrack = newStream.getVideoTracks()[0]
              for (const [userId, peerConnection] of this.peerConnections.entries()) {
                  try {
                      const sender = peerConnection.getSenders().find(s => 
                          s.track && s.track.kind === 'video'
                      )
                      
                      if (sender) {
                          await sender.replaceTrack(videoTrack)
                          console.log(`✅ Replaced video track for ${userId}`)
                      }
                  } catch (error) {
                      console.error(`❌ Failed to replace video track for ${userId}:`, error)
                  }
              }
              
              // Update local stream reference
              this.localStream = newStream
          }
      } catch (error) {
          console.error(`❌ Failed to refresh video track:`, error)
      }
  }
}

