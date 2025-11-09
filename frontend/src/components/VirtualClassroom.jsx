import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Send, Share2, MessageSquare, X } from 'lucide-react';
import Webcam from 'react-webcam';
import io from 'socket.io-client';

// CRITICAL FIX: Use environment variable, fallback to localhost for development
const SOCKET_SERVER = process.env.REACT_APP_API_URL || 'http://localhost:5000';

export default function VideoConferenceApp() {
  const [roomId, setRoomId] = useState('');
  const [userName, setUserName] = useState('');
  const [inCall, setInCall] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [participants, setParticipants] = useState([]);

  const socketRef = useRef(null);
  const webcamRef = useRef(null);
  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const messagesEndRef = useRef(null);

  const ICE_SERVERS = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      Object.values(peersRef.current).forEach(peer => {
        peer.connection.close();
      });
    };
  }, []);

  const createPeerConnection = (participantId) => {
    const peerConnection = new RTCPeerConnection(ICE_SERVERS);

    // Add local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStreamRef.current);
      });
    }

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          to: participantId,
          candidate: event.candidate,
          from: socketRef.current.id
        });
      }
    };

    // Handle remote stream
    peerConnection.ontrack = (event) => {
      setParticipants(prev => prev.map(p => 
        p.id === participantId 
          ? { ...p, stream: event.streams[0] }
          : p
      ));
    };

    return peerConnection;
  };

  const startCall = async () => {
    if (!roomId.trim() || !userName.trim()) {
      alert('Please enter room ID and name');
      return;
    }

    try {
      // Get local media stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      localStreamRef.current = stream;

      // Connect to socket server
      socketRef.current = io(SOCKET_SERVER); // Uses the dynamic URL here

      // Add local participant
      setParticipants([{
        id: 'local',
        name: userName,
        isLocal: true,
        isCameraOn: true,
        isMicOn: true,
        stream: stream
      }]);

      setInCall(true);

      // Join room
      socketRef.current.emit('join-room', { roomId, userName });

      // Handle existing participants
      socketRef.current.on('existing-participants', (existingParticipants) => {
        existingParticipants.forEach(async (participant) => {
          // Create peer connection
          const peerConnection = createPeerConnection(participant.id);
          peersRef.current[participant.id] = { connection: peerConnection };

          // Add participant to list
          setParticipants(prev => [...prev, {
            ...participant,
            isLocal: false
          }]);

          // Create and send offer
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          socketRef.current.emit('offer', {
            to: participant.id,
            offer,
            from: socketRef.current.id
          });
        });
      });

      // Handle new user joining
      socketRef.current.on('user-joined', async (participant) => {
        addSystemMessage(`${participant.name} joined the room`);
        setParticipants(prev => [...prev, {
          ...participant,
          isLocal: false
        }]);
      });

      // Handle WebRTC offer
      socketRef.current.on('offer', async ({ from, offer }) => {
        const peerConnection = createPeerConnection(from);
        peersRef.current[from] = { connection: peerConnection };

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socketRef.current.emit('answer', {
          to: from,
          answer,
          from: socketRef.current.id
        });
      });

      // Handle WebRTC answer
      socketRef.current.on('answer', async ({ from, answer }) => {
        const peer = peersRef.current[from];
        if (peer) {
          await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
        }
      });

      // Handle ICE candidate
      socketRef.current.on('ice-candidate', async ({ from, candidate }) => {
        const peer = peersRef.current[from];
        if (peer) {
          await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
        }
      });

      // Handle user leaving
      socketRef.current.on('user-left', ({ id, name }) => {
        addSystemMessage(`${name} left the room`);
        setParticipants(prev => prev.filter(p => p.id !== id));
        
        if (peersRef.current[id]) {
          peersRef.current[id].connection.close();
          delete peersRef.current[id];
        }
      });

      // Handle chat messages
      socketRef.current.on('receive-message', (message) => {
        setMessages(prev => [...prev, message]);
      });

      // Handle camera/mic toggles
      socketRef.current.on('user-toggle-camera', ({ id, isCameraOn }) => {
        setParticipants(prev => prev.map(p => 
          p.id === id ? { ...p, isCameraOn } : p
        ));
      });

      socketRef.current.on('user-toggle-mic', ({ id, isMicOn }) => {
        setParticipants(prev => prev.map(p => 
          p.id === id ? { ...p, isMicOn } : p
        ));
      });

    } catch (error) {
      console.error('Error starting call:', error);
      alert('Failed to access camera/microphone. Please grant permissions and try again.');
    }
  };

  const endCall = () => {
    // Leave room
    if (socketRef.current) {
      socketRef.current.emit('leave-room', roomId);
      socketRef.current.disconnect();
    }

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }

    // Close peer connections
    Object.values(peersRef.current).forEach(peer => {
      peer.connection.close();
    });
    peersRef.current = {};

    setInCall(false);
    setParticipants([]);
    setMessages([]);
    setRoomId('');
    setUserName('');
  };

  const toggleCamera = () => {
    const newState = !isCameraOn;
    setIsCameraOn(newState);
    
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = newState;
      });
    }

    if (socketRef.current) {
      socketRef.current.emit('toggle-camera', { roomId, isCameraOn: newState });
    }
  };

  const toggleMic = () => {
    const newState = !isMicOn;
    setIsMicOn(newState);
    
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = newState;
      });
    }

    if (socketRef.current) {
      socketRef.current.emit('toggle-mic', { roomId, isMicOn: newState });
    }
  };

  const addSystemMessage = (text) => {
    setMessages(prev => [...prev, {
      id: Date.now(),
      sender: 'System',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isSystem: true
    }]);
  };

  const sendMessage = () => {
    if (!chatInput.trim()) return;
    
    const message = {
      id: Date.now(),
      sender: userName,
      text: chatInput,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isSystem: false
    };

    // Only send to server, don't add locally yet
    // It will come back through 'receive-message' event
    if (socketRef.current) {
      socketRef.current.emit('send-message', { roomId, message });
    }
    
    setChatInput('');
  };

  // Render remote participant video
  const RemoteVideo = ({ stream }) => {
    const videoRef = useRef(null);

    useEffect(() => {
      if (videoRef.current && stream) {
        videoRef.current.srcObject = stream;
      }
    }, [stream]);

    return (
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          borderRadius: '8px'
        }}
      />
    );
  };

  // Styles
  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: '#1a1a1a',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      fontFamily: 'Arial, sans-serif'
    },
    loginCard: {
      backgroundColor: '#ffffff',
      borderRadius: '12px',
      padding: '40px',
      boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
      maxWidth: '400px',
      width: '100%'
    },
    title: {
      fontSize: '28px',
      fontWeight: 'bold',
      color: '#333',
      marginBottom: '8px'
    },
    subtitle: {
      color: '#666',
      marginBottom: '24px'
    },
    input: {
      width: '100%',
      padding: '12px',
      border: '1px solid #ddd',
      borderRadius: '6px',
      marginBottom: '16px',
      fontSize: '14px'
    },
    button: {
      width: '100%',
      backgroundColor: '#2563eb',
      color: 'white',
      border: 'none',
      padding: '12px',
      borderRadius: '6px',
      fontSize: '16px',
      fontWeight: 'bold',
      cursor: 'pointer',
      marginTop: '8px'
    },
    callContainer: {
      display: 'flex',
      height: '100vh',
      backgroundColor: '#1a1a1a',
      color: 'white'
    },
    header: {
      backgroundColor: '#222',
      borderBottom: '1px solid #333',
      padding: '16px 24px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10
    },
    videoArea: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      padding: '24px',
      paddingTop: '80px'
    },
    gridContainer: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
      gap: '16px',
      flex: 1,
      marginBottom: '24px'
    },
    videoBox: {
      backgroundColor: '#333',
      borderRadius: '8px',
      overflow: 'hidden',
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      aspectRatio: '16/9'
    },
    videoLabel: {
      position: 'absolute',
      bottom: '16px',
      left: '16px',
      backgroundColor: 'rgba(0,0,0,0.6)',
      padding: '8px 12px',
      borderRadius: '4px',
      fontSize: '12px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    controls: {
      display: 'flex',
      justifyContent: 'center',
      gap: '16px',
      marginTop: '24px',
      flexWrap: 'wrap'
    },
    controlButton: {
      width: '48px',
      height: '48px',
      borderRadius: '50%',
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.2s'
    },
    chatSidebar: {
      width: '320px',
      backgroundColor: '#222',
      borderLeft: '1px solid #333',
      display: 'flex',
      flexDirection: 'column'
    },
    chatHeader: {
      borderBottom: '1px solid #333',
      padding: '16px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    chatMessages: {
      flex: 1,
      overflowY: 'auto',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    },
    chatInput: {
      borderTop: '1px solid #333',
      padding: '12px',
      display: 'flex',
      gap: '8px'
    }
  };

  if (!inCall) {
    return (
      <div style={styles.container}>
        <div style={styles.loginCard}>
          <h1 style={styles.title}>Virtual Classroom</h1>
          <p style={styles.subtitle}>Join a learning session</p>

          <input
            type="text"
            placeholder="Enter your name"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            style={styles.input}
            onKeyPress={(e) => e.key === 'Enter' && startCall()}
          />
          <input
            type="text"
            placeholder="Enter room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            style={styles.input}
            onKeyPress={(e) => e.key === 'Enter' && startCall()}
          />
          <button onClick={startCall} style={styles.button}>
            Join Meeting
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.callContainer}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={styles.header}>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 'bold' }}>Room: {roomId}</div>
            <div style={{ fontSize: '12px', color: '#aaa' }}>Virtual Classroom</div>
          </div>
          <div style={{ fontSize: '12px', color: '#aaa' }}>Participants: {participants.length}</div>
        </div>

        <div style={styles.videoArea}>
          <div style={styles.gridContainer}>
            {participants.map((participant) => (
              <div key={participant.id} style={styles.videoBox}>
                {participant.isLocal ? (
                  participant.isCameraOn ? (
                    <Webcam
                      ref={webcamRef}
                      audio={false}
                      mirrored
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        borderRadius: '8px'
                      }}
                      videoConstraints={{ width: 1280, height: 720, facingMode: 'user' }}
                    />
                  ) : (
                    <div style={{
                      width: '100%',
                      height: '100%',
                      backgroundColor: '#222',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#aaa',
                      fontSize: '14px'
                    }}>
                      Camera Off
                    </div>
                  )
                ) : (
                  participant.stream && participant.isCameraOn ? (
                    <RemoteVideo stream={participant.stream} />
                  ) : (
                    <div style={{
                      width: '100%',
                      height: '100%',
                      backgroundColor: '#222',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#aaa',
                      fontSize: '48px',
                      fontWeight: 'bold'
                    }}>
                      {participant.name.charAt(0).toUpperCase()}
                    </div>
                  )
                )}
                <div style={styles.videoLabel}>
                  <span>{participant.name} {participant.isLocal && '(You)'}</span>
                  {!participant.isMicOn && <MicOff size={12} />}
                </div>
              </div>
            ))}
          </div>

          <div style={styles.controls}>
            <button
              onClick={toggleMic}
              style={{
                ...styles.controlButton,
                backgroundColor: isMicOn ? '#555' : '#dc2626'
              }}
              title={isMicOn ? 'Mute' : 'Unmute'}
            >
              {isMicOn ? <Mic size={24} /> : <MicOff size={24} />}
            </button>

            <button
              onClick={toggleCamera}
              style={{
                ...styles.controlButton,
                backgroundColor: isCameraOn ? '#555' : '#dc2626'
              }}
              title={isCameraOn ? 'Stop Video' : 'Start Video'}
            >
              {isCameraOn ? <Video size={24} /> : <VideoOff size={24} />}
            </button>

            <button
              style={{ ...styles.controlButton, backgroundColor: '#555' }}
              title="Share Screen"
            >
              <Share2 size={24} />
            </button>

            <button
              onClick={() => setShowChat(!showChat)}
              style={{
                ...styles.controlButton,
                backgroundColor: '#555',
                position: 'relative'
              }}
              title="Chat"
            >
              <MessageSquare size={24} />
              {messages.length > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '4px',
                  right: '4px',
                  width: '12px',
                  height: '12px',
                  backgroundColor: '#dc2626',
                  borderRadius: '50%'
                }}></span>
              )}
            </button>

            <button
              onClick={endCall}
              style={{
                ...styles.controlButton,
                backgroundColor: '#dc2626'
              }}
              title="End Call"
            >
              <PhoneOff size={24} />
            </button>
          </div>
        </div>
      </div>

      {showChat && (
        <div style={styles.chatSidebar}>
          <div style={styles.chatHeader}>
            <h2 style={{ margin: 0, fontSize: '16px' }}>Chat</h2>
            <button
              onClick={() => setShowChat(false)}
              style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', padding: 0 }}
            >
              <X size={20} />
            </button>
          </div>

          <div style={styles.chatMessages}>
            {messages.length === 0 && (
              <p style={{ color: '#666', fontSize: '12px', textAlign: 'center', margin: 'auto' }}>No messages yet</p>
            )}
            {messages.map(msg => (
              <div key={msg.id} style={{ textAlign: msg.isSystem ? 'center' : 'left' }}>
                {msg.isSystem ? (
                  <p style={{ color: '#666', fontSize: '12px', margin: 0 }}>{msg.text}</p>
                ) : (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '4px' }}>
                      <span style={{ color: 'white', fontSize: '12px', fontWeight: 'bold' }}>{msg.sender}</span>
                      <span style={{ color: '#666', fontSize: '10px' }}>{msg.timestamp}</span>
                    </div>
                    <p style={{ color: '#ccc', fontSize: '12px', margin: 0, wordBreak: 'break-word' }}>{msg.text}</p>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div style={styles.chatInput}>
            <input
              type="text"
              placeholder="Type a message..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              style={{
                flex: 1,
                padding: '8px',
                backgroundColor: '#333',
                border: '1px solid #444',
                borderRadius: '4px',
                color: 'white',
                fontSize: '12px'
              }}
            />
            <button
              onClick={sendMessage}
              style={{
                backgroundColor: '#2563eb',
                border: 'none',
                color: 'white',
                padding: '8px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}