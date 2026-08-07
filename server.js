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
    // 1. Đăng ký / Đăng nhập
    socket.on('login', (data) => {
        const { username, password } = data;
        if (!username || !password) return socket.emit('login_error', 'Nhập đủ tên tài khoản & mật khẩu!');

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

    // 2. Tạo phòng
    socket.on('create_room', (data) => {
        const { username, displayName, roomPassword } = data;
        const roomCode = generateRoomCode();

        rooms[roomCode] = {
            host: username,
            password: roomPassword || '',
            players: [{ username, displayName, ready: true, score: 0 }],
            currentQuestion: 0,
            correctCount: 0, // Đếm số người trả lời đúng trong câu hiện tại
            answeredPlayers: new Set()
        };

        socket.join(roomCode);
        socket.emit('room_created', { roomCode, isHost: true });
    });

    // 3. Vào phòng
    socket.on('join_room', (data) => {
        const { roomCode, roomPassword, username, displayName } = data;
        const room = rooms[roomCode];

        if (!room) return socket.emit('join_error', 'Phòng không tồn tại!');
        if (room.password && room.password !== roomPassword) return socket.emit('join_error', 'Sai mật khẩu phòng!');

        let player = room.players.find(p => p.username === username);
        if (!player) {
            player = { username, displayName, ready: false, score: 0 };
            room.players.push(player);
        } else {
            player.displayName = displayName; // Cập nhật tên hiển thị
        }

        socket.join(roomCode);
        socket.emit('join_success', { roomCode, isHost: username === room.host });
        io.to(roomCode).emit('update_players', room.players);
    });

    // Sẵn sàng
    socket.on('toggle_ready', (data) => {
        const { roomCode, username } = data;
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.username === username);
            if (player) {
                player.ready = !player.ready;
                io.to(roomCode).emit('update_players', room.players);
            }
        }
    });

    // Chat
    socket.on('send_chat', (data) => {
        const { roomCode, displayName, message } = data;
        io.to(roomCode).emit('receive_chat', { displayName, message });
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
        const { roomCode, username, displayName, answer } = data;
        const room = rooms[roomCode];
        if (!room) return;

        const currentQ = questions[room.currentQuestion];
        if (!currentQ) return;

        // Tránh trả lời nhiều lần cùng 1 câu
        if (room.answeredPlayers.has(username)) return;

        if (answer.trim().toLowerCase() === currentQ.a.toLowerCase()) {
            room.answeredPlayers.add(username);
            room.correctCount++;

            // Tính điểm: Top 1 = 3 điểm, Top 2 = 2 điểm, Top 3 = 1 điểm
            let points = 0;
            if (room.correctCount === 1) points = 3;
            else if (room.correctCount === 2) points = 2;
            else if (room.correctCount === 3) points = 1;

            const player = room.players.find(p => p.username === username);
            if (player) player.score += points;

            socket.emit('answer_result', { correct: true, points });
            io.to(roomCode).emit('correct_answer', { displayName, points, correctAnswer: currentQ.a });

            // Tất cả hoặc đủ lượt thì chuyển câu sau 2 giây
            if (room.correctCount >= Math.min(3, room.players.length)) {
                setTimeout(() => {
                    nextQuestionOrEnd(roomCode);
                }, 2000);
            }
        } else {
            // Trả lời sai
            socket.emit('answer_result', { correct: false });
        }
    });

    function sendNextQuestion(roomCode) {
        const room = rooms[roomCode];
        if (room) {
            room.correctCount = 0;
            room.answeredPlayers.clear();
            const q = questions[room.currentQuestion];
            io.to(roomCode).emit('next_question', {
                number: room.currentQuestion + 1,
                total: questions.length,
                question: q.q
            });
        }
    }

    function nextQuestionOrEnd(roomCode) {
        const room = rooms[roomCode];
        if (room) {
            room.currentQuestion++;
            if (room.currentQuestion < questions.length) {
                sendNextQuestion(roomCode);
            } else {
                io.to(roomCode).emit('game_over', room.players);
            }
        }
    }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));