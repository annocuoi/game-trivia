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
    socket.on('login', (data) => {
        const { username, password } = data;
        if (!username || !password) return socket.emit('login_error', 'Nhập đủ tài khoản & mật khẩu!');

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

    socket.on('create_room', (data) => {
        const { username, displayName, roomPassword } = data;
        const roomCode = generateRoomCode();

        rooms[roomCode] = {
            host: username,
            password: roomPassword || '',
            players: [{ username, displayName, ready: true, isHost: true, score: 0 }],
            currentQuestion: 0,
            correctCount: 0,
            answeredPlayers: new Set(),
            timer: null,
            timeLeft: 10
        };

        socket.join(roomCode);
        socket.emit('room_created', { roomCode, isHost: true });
    });

    socket.on('join_room', (data) => {
        const { roomCode, roomPassword, username, displayName } = data;
        const room = rooms[roomCode];

        if (!room) return socket.emit('join_error', 'Phòng không tồn tại!');
        if (room.password && room.password !== roomPassword) return socket.emit('join_error', 'Sai mật khẩu phòng!');

        let player = room.players.find(p => p.username === username);
        const isHost = (username === room.host);
        
        if (!player) {
            player = { username, displayName, ready: isHost, isHost, score: 0 };
            room.players.push(player);
        } else {
            player.displayName = displayName;
        }

        socket.join(roomCode);
        socket.emit('join_success', { roomCode, isHost });
        io.to(roomCode).emit('update_players', room.players);
    });

    socket.on('toggle_ready', (data) => {
        const { roomCode, username } = data;
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.username === username);
            if (player && !player.isHost) {
                player.ready = !player.ready;
                io.to(roomCode).emit('update_players', room.players);
            }
        }
    });

    socket.on('send_chat', (data) => {
        const { roomCode, displayName, message } = data;
        io.to(roomCode).emit('receive_chat', { displayName, message });
    });

    socket.on('start_game', (data) => {
        const { roomCode } = data;
        const room = rooms[roomCode];
        if (room) {
            const unreadyPlayer = room.players.find(p => !p.isHost && !p.ready);
            if (unreadyPlayer) {
                return socket.emit('start_error', `Chưa thể bắt đầu! (${unreadyPlayer.displayName} chưa sẵn sàng)`);
            }

            room.currentQuestion = 0;
            room.players.forEach(p => p.score = 0);
            io.to(roomCode).emit('game_started');
            sendNextQuestion(roomCode);
        }
    });

    socket.on('submit_answer', (data) => {
        const { roomCode, username, displayName, answer } = data;
        const room = rooms[roomCode];
        if (!room) return;

        const currentQ = questions[room.currentQuestion];
        if (!currentQ) return;

        if (room.answeredPlayers.has(username)) return;

        if (answer.trim().toLowerCase() === currentQ.a.toLowerCase()) {
            room.answeredPlayers.add(username);
            room.correctCount++;

            let points = 0;
            if (room.correctCount === 1) points = 3;
            else if (room.correctCount === 2) points = 2;
            else if (room.correctCount === 3) points = 1;

            const player = room.players.find(p => p.username === username);
            if (player) player.score += points;

            socket.emit('answer_result', { correct: true, points });
            
            // Cập nhật điểm và bảng xếp hạng realtime
            io.to(roomCode).emit('correct_answer', { 
                displayName, 
                points, 
                correctAnswer: currentQ.a,
                players: room.players 
            });

            if (room.answeredPlayers.size >= room.players.length) {
                finishQuestion(roomCode);
            }
        } else {
            socket.emit('answer_result', { correct: false });
        }
    });

    function sendNextQuestion(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.timer) clearInterval(room.timer);

        room.correctCount = 0;
        room.answeredPlayers.clear();
        room.timeLeft = 10;

        const q = questions[room.currentQuestion];
        io.to(roomCode).emit('next_question', {
            number: room.currentQuestion + 1,
            total: questions.length,
            question: q.q,
            players: room.players,
            timeLeft: room.timeLeft
        });

        // Bắt đầu đếm ngược 10 giây
        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(roomCode).emit('timer_tick', { timeLeft: room.timeLeft });

            if (room.timeLeft <= 0) {
                finishQuestion(roomCode);
            }
        }, 1000);
    }

    function finishQuestion(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.timer) clearInterval(room.timer);

        const currentQ = questions[room.currentQuestion];
        // Thông báo hết giờ và hiển thị đáp án đúng trong 3 giây
        io.to(roomCode).emit('show_answer', { correctAnswer: currentQ.a });

        setTimeout(() => {
            room.currentQuestion++;
            if (room.currentQuestion < questions.length) {
                sendNextQuestion(roomCode);
            } else {
                io.to(roomCode).emit('game_over', room.players);
            }
        }, 3000);
    }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));