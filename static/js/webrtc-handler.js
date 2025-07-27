class WebRTCHandler {
  constructor(callId, userId, username) {
    this.callId = callId
    this.userId = userId
    this.username = username
    this.localStream = null
    this.remoteStream = null
    this.peerConnections = new Map()
    this.websocket = null
    this.isScreenSharing = false
    this.isMuted = false
    this.isVideoOff = false

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

  async initializeCall() {
    try {
      await this.setupWebSocket()
      await this.getUserMedia()
      this.startQualityMonitoring()
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

    this.websocket = new WebSocket(wsUrl)

    this.websocket.onopen = () => {
      console.log("WebSocket connected")
    }

    this.websocket.onmessage = async (event) => {
      const data = JSON.parse(event.data)
      await this.handleWebSocketMessage(data)
    }

    this.websocket.onclose = () => {
      console.log("WebSocket disconnected")
    }

    this.websocket.onerror = (error) => {
      console.error("WebSocket error:", error)
    }
  }

  async handleWebSocketMessage(data) {
    switch (data.type) {
      case "user_joined":
        if (data.user_id !== this.userId) {
          this.addParticipant(data.user_id, data.username)
          await this.createPeerConnection(data.user_id)
          await this.createOffer(data.user_id)
        }
        break

      case "user_left":
        this.removeParticipant(data.user_id)
        this.closePeerConnection(data.user_id)
        break

      case "webrtc_offer":
        if (data.sender_id !== this.userId) {
          await this.handleOffer(data.sender_id, data.offer)
        }
        break

      case "webrtc_answer":
        if (data.sender_id !== this.userId) {
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

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints)
      document.getElementById("localVideo").srcObject = this.localStream
    } catch (error) {
      console.error("Error accessing media devices:", error)
      throw error
    }
  }

  async createPeerConnection(userId) {
    const WEBRTC_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }]
    const peerConnection = new RTCPeerConnection(WEBRTC_SERVERS)
    this.peerConnections.set(userId, peerConnection)

    // Add local stream tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, this.localStream)
      })
    }

    // Handle remote stream
    peerConnection.ontrack = (event) => {
      const remoteVideo = document.getElementById("remoteVideo")
      if (remoteVideo.srcObject !== event.streams[0]) {
        remoteVideo.srcObject = event.streams[0]
        this.remoteStream = event.streams[0]
      }
    }

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendWebSocketMessage({
          type: "ice_candidate",
          candidate: event.candidate,
          target_id: userId,
        })
      }
    }

    // Monitor connection state
    peerConnection.onconnectionstatechange = () => {
      console.log(`Connection state with ${userId}:`, peerConnection.connectionState)
    }

    return peerConnection
  }

  async createOffer(userId) {
    const peerConnection = this.peerConnections.get(userId)
    if (!peerConnection) return

    try {
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)

      this.sendWebSocketMessage({
        type: "offer",
        offer: offer,
        target_id: userId,
      })
    } catch (error) {
      console.error("Error creating offer:", error)
    }
  }

  async handleOffer(senderId, offer) {
    let peerConnection = this.peerConnections.get(senderId)
    if (!peerConnection) {
      peerConnection = await this.createPeerConnection(senderId)
    }

    try {
      await peerConnection.setRemoteDescription(offer)
      const answer = await peerConnection.createAnswer()
      await peerConnection.setLocalDescription(answer)

      this.sendWebSocketMessage({
        type: "answer",
        answer: answer,
        target_id: senderId,
      })
    } catch (error) {
      console.error("Error handling offer:", error)
    }
  }

  async handleAnswer(senderId, answer) {
    const peerConnection = this.peerConnections.get(senderId)
    if (!peerConnection) return

    try {
      await peerConnection.setRemoteDescription(answer)
    } catch (error) {
      console.error("Error handling answer:", error)
    }
  }

  async handleIceCandidate(senderId, candidate) {
    const peerConnection = this.peerConnections.get(senderId)
    if (!peerConnection) return

    try {
      await peerConnection.addIceCandidate(candidate)
    } catch (error) {
      console.error("Error handling ICE candidate:", error)
    }
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
    const participantsList = document.getElementById("participantsList")
    const participantDiv = document.createElement("div")
    participantDiv.className = "participant-item"
    participantDiv.id = `participant-${userId}`
    participantDiv.innerHTML = `
            <span class="online-indicator"></span>
            ${username}
        `
    participantsList.appendChild(participantDiv)
  }

  removeParticipant(userId) {
    const participantElement = document.getElementById(`participant-${userId}`)
    if (participantElement) {
      participantElement.remove()
    }
  }

  closePeerConnection(userId) {
    const peerConnection = this.peerConnections.get(userId)
    if (peerConnection) {
      peerConnection.close()
      this.peerConnections.delete(userId)
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
      this.websocket.send(JSON.stringify(message))
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
}
