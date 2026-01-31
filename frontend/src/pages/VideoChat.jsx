import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { Video, Mic, MicOff, Camera, Heart, Flag, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Input } from '../components/ui/input';
import { toast } from '../hooks/use-toast';

// --- Yapılandırma ---
// Canlıda backend sunucunuzun adresi, geliştirme ortamında localhost.
const SIGNALING_SERVER_URL = process.env.REACT_APP_SIGNALING_SERVER_URL || 'https://localhost:3001';


// STUN sunucuları, farklı ağlardaki kullanıcıların birbirini bulmasına yardımcı olur.
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const VideoChat = () => {
  // Component State
  const [socket, setSocket] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  
  // DOM elemanları ve WebRTC nesneleri için Ref'ler
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const chatEndRef = useRef(null);
  const currentRoomRef = useRef(null);
  const isCallerRef = useRef(false);

  const interests = [
    'Music', 'Anime', 'Gaming', 'TikTok', 'K-pop', 'Movies', 'Girls', 'Chat',
    // ... diğer ilgi alanları
  ];

  // 1. Kamerayı Başlat
  const initializeCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setIsConnected(true);
    } catch (error) {
      console.error('Error accessing camera:', error);
      toast({
        title: 'Camera Access Denied',
        description: 'Please allow camera and microphone access to use video chat.',
        variant: 'destructive',
      });
    }
  }, []);

  // 2. Socket.IO bağlantısını ve olay dinleyicilerini başlat
  useEffect(() => {
    initializeCamera();

    const newSocket = io(SIGNALING_SERVER_URL, { secure: true });
    setSocket(newSocket);

    newSocket.on('waiting', () => setIsSearching(true));
    newSocket.on('matched', handleMatch);
    newSocket.on('set-is-caller', (isCaller) => isCallerRef.current = isCaller);
    newSocket.on('offer', handleOffer);
    newSocket.on('answer', handleAnswer);
    newSocket.on('ice-candidate', handleIceCandidate);
    newSocket.on('peer-disconnected', handlePeerDisconnect);
    newSocket.on('message', (message) => {
        setMessages(prev => [...prev, { text: message, sender: 'peer', timestamp: new Date() }]);
    });

    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      newSocket.disconnect();
    };
  }, [initializeCamera]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- WebRTC Yöneticileri ---

  const createPeerConnection = useCallback((room) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('ice-candidate', { room, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    peerConnectionRef.current = pc;
  }, [localStream, socket]);

  const handleMatch = useCallback(async ({ room }) => {
    currentRoomRef.current = room;
    setIsSearching(false);
    setIsChatting(true);
    setMessages([]);
    createPeerConnection(room);
    
    if (isCallerRef.current) {
      const pc = peerConnectionRef.current;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { room, offer });
    }
  }, [createPeerConnection, socket]);

  const handleOffer = useCallback(async (offer) => {
    if (!isCallerRef.current) {
      const pc = peerConnectionRef.current;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { room: currentRoomRef.current, answer });
    }
  }, [socket]);

  const handleAnswer = useCallback(async (answer) => {
    const pc = peerConnectionRef.current;
    if (pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }, []);

  const handleIceCandidate = useCallback(async (candidate) => {
    try {
      if (peerConnectionRef.current && candidate) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (e) {
      console.error('Error adding received ice candidate', e);
    }
  }, []);

  // --- UI Aksiyon Yöneticileri ---

  const startOrNextChat = () => {
    if (isChatting) { // "Next" butonu
      stopChat();
      setTimeout(() => {
        socket.emit('join-room');
        setIsSearching(true);
      }, 200);
    } else { // "Start" butonu
      if (!isConnected) {
        toast({ title: 'Camera Not Ready', description: 'Please allow camera access first.', variant: 'destructive' });
        return;
      }
      socket.emit('join-room');
      setIsSearching(true);
    }
  };

  const stopChat = useCallback(() => {
    if (currentRoomRef.current) {
      socket.emit('leave-room');
    }
    handlePeerDisconnect();
  }, [socket]);

  const handlePeerDisconnect = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    setRemoteStream(null);
    setIsChatting(false);
    setIsSearching(false);
    currentRoomRef.current = null;
    isCallerRef.current = false;
    if (isChatting) {
        toast({ title: 'Chat Ended', description: 'Your partner has disconnected.' });
    }
  }, [isChatting]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (!messageInput.trim() || !isChatting || !socket) return;

    const messageText = messageInput;
    setMessages(prev => [...prev, { text: messageText, sender: 'you', timestamp: new Date() }]);
    socket.emit('message', { room: currentRoomRef.current, message: messageText });
    setMessageInput('');
  };

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const toggleCamera = () => toast({ title: 'Camera Flip', description: 'Camera switching is not yet implemented.' });
  const handleLike = () => !isChatting || toast({ title: '❤️ Sent!', description: `You sent a heart!` });
  const handleReport = () => !isChatting || toast({ title: 'Report Sent', description: 'Thank you for keeping our community safe.', variant: 'destructive' });

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="bg-black text-white py-3 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-[#3B9FD8] p-2 rounded">
              <Video className="w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-wide">GeceCam Online</span>
          </div>
          <nav className="flex gap-6">
            <a href="#" className="hover:text-[#3B9FD8] transition-colors text-sm">Home</a>
          </nav>
        </div>
      </header>

      {/* Main Chat Interface */}
      <main className="flex-1 flex items-center justify-center py-8 px-4">
        <div className="w-full max-w-6xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Local Video */}
            <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute top-4 right-4 bg-black/50 text-white px-3 py-1 rounded-full text-sm">
                You
              </div>
              
              {/* Control Buttons */}
              <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-3">
                <button
                  onClick={handleLike}
                  disabled={!isChatting || isSearching}
                  className="bg-white/90 hover:bg-white p-3 rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Heart className="w-5 h-5 text-red-500" />
                </button>
                <button
                  onClick={handleReport}
                  disabled={!isChatting || isSearching}
                  className="bg-white/90 hover:bg-white p-3 rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Flag className="w-5 h-5 text-gray-700" />
                </button>
                <button
                  onClick={toggleMute}
                  disabled={!isConnected}
                  className="bg-white/90 hover:bg-white p-3 rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isMuted ? <MicOff className="w-5 h-5 text-gray-700" /> : <Mic className="w-5 h-5 text-gray-700" />}
                </button>
                <button
                  onClick={toggleCamera}
                  disabled={!isConnected}
                  className="bg-white/90 hover:bg-white p-3 rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className="w-5 h-5 text-gray-700" />
                </button>
              </div>
            </div>

            {/* Remote Video */}
            <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
              {isSearching ? (
                <div className="w-full h-full flex items-center justify-center text-white">
                  <div className="text-center">
                    <RefreshCw className="w-12 h-12 animate-spin mx-auto mb-4" />
                    <p className="text-lg">Finding someone for you...</p>
                  </div>
                </div>
              ) : isChatting && remoteStream ? (
                <>
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-4 right-4 bg-black/50 text-white px-3 py-1 rounded-full text-sm">
                    Stranger
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white">
                  <div className="text-center">
                    <Camera className="w-16 h-16 mx-auto mb-4 opacity-30" />
                    <p className="text-lg">
                      {isConnected ? "Click 'Start Chat' to begin" : "Connecting to camera..."}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="bg-gray-50 rounded-lg p-6 space-y-4">
            <div className="flex flex-wrap gap-3 items-center justify-center">
              <Button
                onClick={startOrNextChat}
                disabled={!isConnected || isSearching}
                className="bg-[#3B9FD8] hover:bg-[#2E8BC0] text-white px-8 py-2 text-lg"
              >
                {isChatting ? 'Next' : 'Start Chat'}
              </Button>
              <Button
                onClick={stopChat}
                disabled={!isChatting}
                variant="destructive"
                className="px-8 py-2 text-lg"
              >
                Stop
              </Button>
              <Button
                variant="outline"
                className="border-pink-500 text-pink-500 hover:bg-pink-50"
              >
                Girls
              </Button>
            </div>

            {/* Interest Selector */}
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 whitespace-nowrap">
                Optional: select interest
              </label>
              <Select>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="-- Optional: select interest --" />
                </SelectTrigger>
                <SelectContent>
                  {interests.map((interest) => (
                    <SelectItem key={interest} value={interest}>
                      {interest}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Chat Messages */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 h-48 overflow-y-auto">
              {messages.length === 0 ? (
                <p className="text-gray-400 text-center py-8">Chat messages will appear here...</p>
              ) : (
                <div className="space-y-2">
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex ${msg.sender === 'you' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[70%] px-4 py-2 rounded-lg ${
                          msg.sender === 'you'
                            ? 'bg-[#3B9FD8] text-white'
                            : 'bg-gray-200 text-gray-800'
                        }`}
                      >
                        <p className="text-sm">{msg.text}</p>
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>

            {/* Message Input */}
            <form onSubmit={sendMessage} className="flex gap-2">
              <Input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="Type your message..."
                disabled={!isChatting || isSearching}
                className="flex-1"
              />
              <Button
                type="submit"
                disabled={!isChatting || !messageInput.trim()}
                className="bg-[#3B9FD8] hover:bg-[#2E8BC0] text-white"
              >
                Send
              </Button>
            </form>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-black text-white py-8 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <h3 className="font-bold mb-4 text-base">Important Links</h3>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:underline">Rules</a></li>
                <li><a href="#" className="hover:underline">Privacy</a></li>
                <li><a href="#" className="hover:underline">Terms</a></li>
                <li><a href="#" className="hover:underline">Sitemap</a></li>
                <li><a href="#" className="hover:underline">Contact</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-bold mb-4 text-base">Alternatives</h3>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:underline">StrangerCam</a></li>
                <li><a href="#" className="hover:underline">Chatroulette</a></li>
                <li><a href="#" className="hover:underline">LuckyCrush</a></li>
                <li><a href="#" className="hover:underline">Emerald Chat</a></li>
                <li><a href="#" className="hover:underline">Coomeet</a></li>
                <li><a href="#" className="hover:underline">Tinychat</a></li>
                <li><a href="#" className="hover:underline">Camloo</a></li>
                <li><a href="#" className="hover:underline">Pink Video Chat</a></li>
                <li><a href="#" className="hover:underline">Thundr</a></li>
                <li><a href="#" className="hover:underline">Monkey App</a></li>
                <li><a href="#" className="hover:underline">Free Video Chat</a></li>
                <li><a href="#" className="hover:underline">Video Chat With Girls</a></li>
                <li><a href="#" className="hover:underline">Video Chat With Women</a></li>
                <li><a href="#" className="hover:underline">Cam to Cam</a></li>
                <li><a href="#" className="hover:underline">One on One Cam</a></li>
                <li><a href="#" className="hover:underline">American Random Video Call</a></li>
                <li><a href="#" className="hover:underline">1v1 Chat</a></li>
                <li><a href="#" className="hover:underline">Free Video Chat</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-bold mb-4 text-base">More</h3>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:underline">Vidizzy</a></li>
                <li><a href="#" className="hover:underline">InstaCams</a></li>
                <li><a href="#" className="hover:underline">CrushRoulette</a></li>
                <li><a href="#" className="hover:underline">CamMatch</a></li>
                <li><a href="#" className="hover:underline">Uhmegle</a></li>
                <li><a href="#" className="hover:underline">Camzey</a></li>
                <li><a href="#" className="hover:underline">Flirtify</a></li>
                <li><a href="#" className="hover:underline">Mirami Chat</a></li>
                <li><a href="#" className="hover:underline">Bazoocam</a></li>
                <li><a href="#" className="hover:underline">Rabbit Video Chat</a></li>
                <li><a href="#" className="hover:underline">Omegle Girl Chat</a></li>
                <li><a href="#" className="hover:underline">Single Girl Chat Video Call</a></li>
                <li><a href="#" className="hover:underline">Talk to Strangers</a></li>
                <li><a href="#" className="hover:underline">Random Video Call</a></li>
                <li><a href="#" className="hover:underline">Videochat Hot</a></li>
                <li><a href="#" className="hover:underline">Live Video Call App</a></li>
                <li><a href="#" className="hover:underline">Omegle Alternative</a></li>
              </ul>
            </div>
            <div>
              <p className="text-sm">Copyright © 2025 AnonCam. All rights reserved.</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default VideoChat;