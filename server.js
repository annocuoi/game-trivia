const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const questions = require('./questions');

app.use(express.static(path.join(__dirname, 'public')));

const users = {}; 
const rooms = {}; 

const EXPIRE_TIME = 7 * 24 * 60 * 60 * 1000; 

setInterval(() => {
    const now = Date.now();
    for (let username in users) {
        if (now - users[username].lastActive > EXPIRE_TIME) {
            delete users[username];
        }
    }
}, 60 * 60 * 1000);

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {
    // Đăng ký / Đăng nhập
    socket.on('login', (data) => {
        const { username, password } = data;
        if (!username || !password) return socket.emit('login_error', 'Nhập đủ tên & mật khẩu!');

        if (!users[username]) {
            users[username] = { password, lastActive: Date.now() };
            socket.emit('login_success', { username });
        } else if (users[username].password === password) {
            users[username].lastActive = Date.now();
            socket.emit('login_success', { username });
        } else {
            socket.emit('login_error', 'Sai mật khẩu!');
        }
    });

    // Tạo phòng
    socket.on('create_room', (data) => {
        const { username, roomPassword } = data;
        const roomCode = generateRoomCode();

        rooms[roomCode] = {
            host: username,
            password: roomPassword || '',
            players: [{ name: username, ready: true, score: 0 }],
            currentQuestion: 0
        };

        socket.join(roomCode);
        socket.emit('room_created', { roomCode, isHost: true });
    });

    // Vào phòng
    socket.on('join_room', (data) => {
        const { roomCode, roomPassword, username } = data;
        const room = rooms[roomCode];

        if (!room) return socket.emit('join_error', 'Phòng không tồn tại!');
        if (room.password && room.password !== roomPassword) return socket.emit('join_error', 'Sai mật khẩu phòng!');

        if (!room.players.find(p => p.name === username)) {
            room.players.push({ name: username, ready: false, score: 0 });
        }

        socket.join(roomCode);
        socket.emit('join_success', { roomCode, isHost: username === room.host });
        io.to(roomCode).emit('update_players', room.players);
    });

    // Bấm Sẵn Sàng
    socket.on('toggle_ready', (data) => {
        const { roomCode, username } = data;
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.name === username);
            if (player) {
                player.ready = !player.ready;
                io.to(roomCode).emit('update_players', room.players);
            }
        }
    });

    // Gửi Chat
    socket.on('send_chat', (data) => {
        const { roomCode, username, message } = data;
        io.to(roomCode).emit('receive_chat', { username, message });
    });

    // Bắt đầu game
    socket.on('start_game', (data) => {
        const { roomCode } = data;
        const room = rooms[roomCode];
        if (room) {
            room.currentQuestion = 0;
            io.to(roomCode).emit('game_started');
            sendNextQuestion(roomCode);
        }
    });

    // Trả lời câu hỏi
    socket.on('submit_answer', (data) => {
        const { roomCode, username, answer } = data;
        const room = rooms[roomCode];
        if (room) {
            const currentQ = questions[room.currentQuestion];
            if (currentQ && answer.trim().toLowerCase() === currentQ.a.toLowerCase()) {
                const player = room.players.find(p => p.name === username);
                if (player) player.score += 10;

                io.to(roomCode).emit('correct_answer', { username, correctAnswer: currentQ.a });

                // Qua câu tiếp theo
                room.currentQuestion++;
                setTimeout(() => {
                    if (room.currentQuestion < questions.length) {
                        sendNextQuestion(roomCode);
                    } else {
                        io.to(roomCode).emit('game_over', room.players);
                    }
                }, 2000);
            }
        }
    });

    function sendNextQuestion(roomCode) {
        const room = rooms[roomCode];
        if (room) {
            const q = questions[room.currentQuestion];
            io.to(roomCode).emit('next_question', {
                number: room.currentQuestion + 1,
                total: questions.length,
                question: q.q
            });
        }
    }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));