const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    // Canlıda sadece kendi sitenize izin verin.
    origin: process.env.FRONTEND_URL || "https://localhost:3000",
    methods: ["GET", "POST"]
  }
});

let waitingUsers = []; // Bir partner bekleyen kullanıcıların olduğu kuyruk

io.on('connection', (socket) => {
  console.log(`Kullanıcı bağlandı: ${socket.id}`);

  // Kullanıcı bir partner bulmak istediğinde
  socket.on('join-room', () => {
    console.log(`Kullanıcı ${socket.id} bir partner arıyor.`);
    
    // Eğer bekleyen başka biri varsa, onları eşleştir
    if (waitingUsers.length > 0) {
      const peerSocket = waitingUsers.shift(); // Kuyruktan ilk kullanıcıyı al
      
      if (peerSocket && peerSocket.id !== socket.id) {
        const room = `${socket.id}#${peerSocket.id}`;
        console.log(`${socket.id} ve ${peerSocket.id} kullanıcıları ${room} odasında eşleştiriliyor`);
        
        // İki kullanıcıyı da aynı odaya al
        socket.join(room);
        peerSocket.join(room);

        // İki kullanıcıya da eşleştiklerini bildir
        io.to(room).emit('matched', { room });

        // Kuyruktaki ilk kullanıcı "arayan" olur
        io.to(peerSocket.id).emit('set-is-caller', true);

      } else {
        // Kuyruktaki kullanıcı bağlantıyı koparmışsa, mevcut kullanıcıyı kuyruğa ekle
        waitingUsers.push(socket);
        socket.emit('waiting');
      }
    } else {
      // Kimse beklemiyorsa, bu kullanıcıyı kuyruğa ekle
      waitingUsers.push(socket);
      socket.emit('waiting');
    }
  });

  // WebRTC 'offer' (teklif) mesajını ilet
  socket.on('offer', (payload) => {
    socket.to(payload.room).emit('offer', payload.offer);
  });

  // WebRTC 'answer' (cevap) mesajını ilet
  socket.on('answer', (payload) => {
    socket.to(payload.room).emit('answer', payload.answer);
  });

  // ICE candidate (ağ adayı) mesajlarını ilet
  socket.on('ice-candidate', (payload) => {
    socket.to(payload.room).emit('ice-candidate', payload.candidate);
  });

  // Kullanıcıdan gelen sohbet mesajını diğer kullanıcıya ilet
  socket.on('message', (payload) => {
    socket.to(payload.room).emit('message', payload.message);
  });

  // Kullanıcı ayrıldığında veya bağlantı koptuğunda
  const leaveRoom = () => {
    // Kullanıcının bulunduğu odayı bul
    const room = Array.from(socket.rooms).find(r => r !== socket.id);
    if (room) {
      console.log(`Kullanıcı ${socket.id}, ${room} odasından ayrıldı`);
      // Odadaki diğer kullanıcıya haber ver
      socket.to(room).emit('peer-disconnected');
      socket.leave(room);
    }
    // Kullanıcıyı bekleme kuyruğundan kaldır
    waitingUsers = waitingUsers.filter(user => user.id !== socket.id);
  };

  socket.on('leave-room', leaveRoom);
  socket.on('disconnect', () => {
    console.log(`Kullanıcı bağlantısı koptu: ${socket.id}`);
    leaveRoom();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Sinyal sunucusu ${PORT} portunda çalışıyor`));
