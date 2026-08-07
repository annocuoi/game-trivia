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

function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

io.on('connection', (socket) => {

    // 1. Tạo phòng
    socket.on('create_room', (data) => {
        const { name, roomPassword, playerId } = data;
        const roomCode = generateRoomCode();

        rooms[roomCode] = {
            hostPlayerId: playerId,
            password: roomPassword || '',
            selectedCategory: 'Tất cả',
            players: [{ socketId: socket.id, playerId, name, ready: true, score: 0, online: true }],
            questions: [],
            currentQuestion: 0,
            correctCount: 0,
            answeredPlayers: new Set(),
            timer: null,
            timeLeft: 10
        };

        socket.join(roomCode);
        socket.emit('room_created', { roomCode });
        updateRoomLeaderboard(roomCode);
        io.to(roomCode).emit('update_category', rooms[roomCode].selectedCategory);
    });

    // 2. Vào phòng
    socket.on('join_room', (data) => {
        const { roomCode, roomPassword, name, playerId } = data;
        const room = rooms[roomCode];

        if (!room) return socket.emit('room_error', 'Mã phòng không tồn tại!');
        if (room.password && room.password !== roomPassword) return socket.emit('room_error', 'Sai mật khẩu phòng!');

        const isHost = (playerId === room.hostPlayerId);
        let player = room.players.find(p => p.playerId === playerId);
        
        if (!player) {
            player = { socketId: socket.id, playerId, name, ready: isHost, score: 0, online: true };
            room.players.push(player);
        } else {
            player.socketId = socket.id;
            player.online = true;
            if (player.disconnectTimer) {
                clearTimeout(player.disconnectTimer);
                player.disconnectTimer = null;
            }
        }

        socket.join(roomCode);
        socket.emit('join_success', { roomCode, isHost });
        updateRoomLeaderboard(roomCode);
        socket.emit('update_category', room.selectedCategory);
    });

    // 3. Quay lại sảnh chờ khi bấm Chơi Lại
    socket.on('back_to_lobby', (data) => {
        const { roomCode } = data;
        const room = rooms[roomCode];
        if (room) {
            room.players.forEach(p => {
                if (p.playerId !== room.hostPlayerId) {
                    p.ready = false; // Reset trạng thái sẵn sàng của thành viên
                }
            });
            updateRoomLeaderboard(roomCode);
            io.to(roomCode).emit('return_to_lobby');
        }
    });

    // 4. Rời phòng
    socket.on('leave_room', (data) => {
        const { roomCode, playerId } = data;
        removePlayerFromRoom(socket, roomCode, playerId);
    });

    // 5. Đổi chủ đề
    socket.on('change_category', (data) => {
        const { roomCode, category } = data;
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.socketId === socket.id);
            if (player && player.playerId === room.hostPlayerId) {
                room.selectedCategory = category;
                io.to(roomCode).emit('update_category', category);
            }
        }
    });

    // 6. Rejoin
    socket.on('rejoin_room', (data) => {
        const { roomCode, playerId } = data;
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.playerId === playerId);
            if (player) {
                player.socketId = socket.id;
                player.online = true;
                if (player.disconnectTimer) {
                    clearTimeout(player.disconnectTimer);
                    player.disconnectTimer = null;
                }
                socket.join(roomCode);
                socket.emit('rejoin_success', { roomCode, isHost: playerId === room.hostPlayerId });
                updateRoomLeaderboard(roomCode);
                socket.emit('update_category', room.selectedCategory);
            }
        }
    });

    // 7. Sẵn sàng
    socket.on('toggle_ready', (data) => {
        const { roomCode, playerId } = data;
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.playerId === playerId);
            if (player && playerId !== room.hostPlayerId) {
                player.ready = !player.ready;
                updateRoomLeaderboard(roomCode);
            }
        }
    });

    // 8. Chat
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

    // 9. Bắt đầu game
    socket.on('start_game', (data) => {
        const { roomCode, playerId } = data;
        const room = rooms[roomCode];
        if (room) {
            if (playerId !== room.hostPlayerId) return;

            const unready = room.players.find(p => p.playerId !== room.hostPlayerId && !p.ready);
            if (unready) {
                return socket.emit('start_error', `Chưa thể bắt đầu! (${unready.name} chưa sẵn sàng)`);
            }

            room.currentQuestion = 0;
            room.players.forEach(p => p.score = 0);
            
            let filteredQuestions = questions;
            if (room.selectedCategory !== 'Tất cả') {
                filteredQuestions = questions.filter(q => q.category === room.selectedCategory);
            }

            if (filteredQuestions.length === 0) {
                return socket.emit('start_error', 'Chủ đề này hiện chưa có câu hỏi!');
            }

            room.questions = shuffleArray(filteredQuestions);
            sendNextQuestion(roomCode);
        }
    });

    // 10. Trả lời câu hỏi
    socket.on('submit_answer', (data) => {
        const { roomCode, answer } = data;
        const room = rooms[roomCode];
        if (!room || room.answeredPlayers.has(socket.id)) return;

        const currentQ = room.questions[room.currentQuestion];
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
                name: p.name + (!p.online ? ' (Đang kết nối lại...)' : ''),
                ready: p.ready,
                score: p.score,
                isHost: p.playerId === room.hostPlayerId
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
        room.timeLeft = 25;

        const q = room.questions[room.currentQuestion];
        io.to(roomCode).emit('new_question', {
            questionNumber: room.currentQuestion + 1,
            question: q.q,
            category: q.category
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

        const q = room.questions[room.currentQuestion];
        io.to(roomCode).emit('show_answer', { answer: q.a });

        setTimeout(() => {
            room.currentQuestion++;
            if (room.currentQuestion < Math.min(10, room.questions.length)) {
                sendNextQuestion(roomCode);
            } else {
                io.to(roomCode).emit('game_over', room.players);
            }
        }, 3000);
    }

    function removePlayerFromRoom(socket, code, playerId) {
        const room = rooms[code];
        if (!room) return;

        const idx = room.players.findIndex(p => p.playerId === playerId || p.socketId === socket.id);
        if (idx !== -1) {
            const wasHost = (room.players[idx].playerId === room.hostPlayerId);
            room.players.splice(idx, 1);

            socket.leave(code);

            if (room.players.length === 0) {
                if (room.timer) clearInterval(room.timer);
                delete rooms[code];
            } else {
                if (wasHost) {
                    room.hostPlayerId = room.players[0].playerId;
                    room.players[0].ready = true;
                }
                updateRoomLeaderboard(code);
            }
        }
    }

    socket.on('disconnect', () => {
        for (let code in rooms) {
            const room = rooms[code];
            const player = room.players.find(p => p.socketId === socket.id);
            if (player) {
                player.online = false;
                updateRoomLeaderboard(code);

                player.disconnectTimer = setTimeout(() => {
                    const idx = room.players.findIndex(p => p.playerId === player.playerId);
                    if (idx !== -1 && !room.players[idx].online) {
                        removePlayerFromRoom(socket, code, player.playerId);
                    }
                }, 60000);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));