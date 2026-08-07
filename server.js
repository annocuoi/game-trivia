const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const questions = require('./questions');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {}; 

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {

    // 1. Tạo phòng
    socket.on('create_room', (data) => {
        const { name, roomPassword } = data;
        const roomCode = generateRoomCode();

        rooms[roomCode] = {
            hostSocketId: socket.id,
            password: roomPassword || '',
            players: [{ socketId: socket.id, name, ready: true, score: 0 }],
            currentQuestion: 0,
            correctCount: 0,
            answeredPlayers: new Set(),
            timer: null,
            timeLeft: 10
        };

        socket.join(roomCode);
        socket.emit('room_created', { roomCode });
        updateRoomLeaderboard(roomCode);
    });

    // 2. Vào phòng
    socket.on('join_room', (data) => {
        const { roomCode, roomPassword, name } = data;
        const room = rooms[roomCode];

        if (!room) return socket.emit('room_error', 'Mã phòng không tồn tại!');
        if (room.password && room.password !== roomPassword) return socket.emit('room_error', 'Sai mật khẩu phòng!');

        const isHost = (socket.id === room.hostSocketId);
        let player = room.players.find(p => p.socketId === socket.id);
        
        if (!player) {
            player = { socketId: socket.id, name, ready: isHost, score: 0 };
            room.players.push(player);
        }

        socket.join(roomCode);
        socket.emit('join_success', { roomCode, isHost });
        updateRoomLeaderboard(roomCode);
    });

    // 3. Sẵn sàng
    socket.on('toggle_ready', (data) => {
        const { roomCode } = data;
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.socketId === socket.id);
            if (player && socket.id !== room.hostSocketId) {
                player.ready = !player.ready;
                updateRoomLeaderboard(roomCode);
            }
        }
    });

    // 4. Chat
    socket.on('send_chat', (data) => {
        const { roomCode, message } = data;
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.socketId === socket.id);
            if (player) {
                io.to(roomCode).emit('receive_chat', { name: player.name, message });
            }
        }
    });

    // 5. Bắt đầu game
    socket.on('start_game', (data) => {
        const { roomCode } = data;
        const room = rooms[roomCode];
        if (room) {
            if (socket.id !== room.hostSocketId) return;

            const unready = room.players.find(p => p.socketId !== room.hostSocketId && !p.ready);
            if (unready) {
                return socket.emit('start_error', `Chưa thể bắt đầu! (${unready.name} chưa sẵn sàng)`);
            }

            room.currentQuestion = 0;
            room.players.forEach(p => p.score = 0);
            sendNextQuestion(roomCode);
        }
    });

    // 6. Trả lời câu hỏi
    socket.on('submit_answer', (data) => {
        const { roomCode, answer } = data;
        const room = rooms[roomCode];
        if (!room || room.answeredPlayers.has(socket.id)) return;

        const currentQ = questions[room.currentQuestion];
        if (!currentQ) return;

        if (answer.trim().toLowerCase() === currentQ.a.toLowerCase()) {
            room.answeredPlayers.add(socket.id);
            room.correctCount++;

            let points = 0;
            if (room.correctCount === 1) points = 3;
            else if (room.correctCount === 2) points = 2;
            else if (room.correctCount === 3) points = 1;

            const player = room.players.find(p => p.socketId === socket.id);
            if (player) player.score += points;

            socket.emit('answer_result', { correct: true, rank: room.correctCount, points });
            updateRoomLeaderboard(roomCode);

            if (room.answeredPlayers.size >= room.players.length) {
                finishQuestion(roomCode);
            }
        } else {
            socket.emit('answer_result', { correct: false });
        }
    });

    function updateRoomLeaderboard(roomCode) {
        const room = rooms[roomCode];
        if (room) {
            const playerList = room.players.map(p => ({
                name: p.name,
                ready: p.ready,
                score: p.score,
                isHost: p.socketId === room.hostSocketId
            }));
            io.to(roomCode).emit('update_leaderboard', playerList);
        }
    }

    function sendNextQuestion(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.timer) clearInterval(room.timer);

        room.correctCount = 0;
        room.answeredPlayers.clear();
        room.timeLeft = 10;

        const q = questions[room.currentQuestion];
        io.to(roomCode).emit('new_question', {
            questionNumber: room.currentQuestion + 1,
            question: q.q
        });

        io.to(roomCode).emit('timer_update', room.timeLeft);

        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(roomCode).emit('timer_update', room.timeLeft);

            if (room.timeLeft <= 0) {
                finishQuestion(roomCode);
            }
        }, 1000);
    }

    function finishQuestion(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.timer) clearInterval(room.timer);

        const q = questions[room.currentQuestion];
        io.to(roomCode).emit('show_answer', { answer: q.a });

        setTimeout(() => {
            room.currentQuestion++;
            if (room.currentQuestion < questions.length) {
                sendNextQuestion(roomCode);
            } else {
                io.to(roomCode).emit('game_over', room.players);
            }
        }, 3000);
    }

    socket.on('disconnect', () => {
        for (let code in rooms) {
            const room = rooms[code];
            const idx = room.players.findIndex(p => p.socketId === socket.id);
            if (idx !== -1) {
                const wasHost = (socket.id === room.hostSocketId);
                room.players.splice(idx, 1);

                if (room.players.length === 0) {
                    if (room.timer) clearInterval(room.timer);
                    delete rooms[code];
                } else {
                    if (wasHost) {
                        room.hostSocketId = room.players[0].socketId;
                        room.players[0].ready = true;
                    }
                    updateRoomLeaderboard(code);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));