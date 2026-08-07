const express = require('express');
const app = require('express')();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const questions = require('./questions');

app.use(express.static(path.join(__dirname, 'public')));

// Cấu trúc lưu trữ tài khoản: { username: { password, lastActive } }
const users = {}; 
const rooms = {}; // { roomCode: { host, password, players: [] } }

// THỜI GIAN TỰ ĐỘNG XÓA: Ở đây để là 7 ngày (tính bằng mili-giây)
// Bạn có thể đổi thành 24 * 60 * 60 * 1000 nếu muốn xóa sau 1 ngày không hoạt động.
const EXPIRE_TIME = 2 * 24 * 60 * 60 * 1000; 

// Chạy hàm kiểm tra định kỳ mỗi 1 tiếng để xóa tài khoản offline lâu ngày
setInterval(() => {
    const now = Date.now();
    for (let username in users) {
        if (now - users[username].lastActive > EXPIRE_TIME) {
            delete users[username];
            console.log(`Đã tự động xóa tài khoản không hoạt động lâu ngày: ${username}`);
        }
    }
}, 60 * 60 * 1000);

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {
    console.log('Có người kết nối:', socket.id);

    // 1. Đăng ký / Đăng nhập & Cập nhật thời gian hoạt động
    socket.on('login', (data) => {
        const { username, password } = data;
        if (!username || !password) {
            return socket.emit('login_error', 'Vui lòng nhập đầy đủ tên và mật khẩu!');
        }

        if (!users[username]) {
            // Đăng ký mới
            users[username] = {
                password: password,
                lastActive: Date.now()
            };
            socket.emit('login_success', { username });
            console.log(`Tài khoản mới đăng ký: ${username}`);
        } else if (users[username].password === password) {
            // Đăng nhập đúng, cập nhật lại thời gian hoạt động mới nhất
            users[username].lastActive = Date.now();
            socket.emit('login_success', { username });
        } else {
            socket.emit('login_error', 'Sai mật khẩu tài khoản!');
        }
    });

    // 2. Tạo phòng mới
    socket.on('create_room', (data) => {
        const { username, roomPassword } = data;
        const roomCode = generateRoomCode();

        rooms[roomCode] = {
            host: username,
            password: roomPassword || '',
            players: [username],
            gameStarted: false
        };

        socket.join(roomCode);
        socket.emit('room_created', { roomCode });
    });

    // 3. Vào phòng
    socket.on('join_room', (data) => {
        const { roomCode, roomPassword, username } = data;
        const room = rooms[roomCode];

        if (!room) {
            return socket.emit('join_error', 'Mã phòng không tồn tại!');
        }

        if (room.password && room.password !== roomPassword) {
            return socket.emit('join_error', 'Sai mật khẩu phòng!');
        }

        if (!room.players.includes(username)) {
            room.players.push(username);
        }

        socket.join(roomCode);
        socket.emit('join_success', { roomCode });
        io.to(roomCode).emit('update_players', room.players);
    });

    socket.on('disconnect', () => {
        console.log('Ngắt kết nối:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server đang chạy trên cổng ${PORT}`);
});