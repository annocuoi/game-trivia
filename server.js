const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const questions = require('./questions');

app.use(express.static(path.join(__dirname, 'public')));

// Hàm chuẩn hóa chuỗi tiếng Việt (xử lý chữ hoa/thường, dấu cũ/mới, khoảng trắng thừa)
function cleanString(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')
        .normalize('NFC');
}

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
            players: [{ socketId: socket.id, playerId, name, ready: true, score: 0, online: true, isSpectator: false }],
            questions: [],
            currentQuestion: 0,
            correctCount: 0,
            answeredPlayers: new Set(),
            timer: null,
            timeLeft: 10,
            isPlaying: false
        };

        socket.join(roomCode);
        socket.emit('room_created', { roomCode });
        updateRoomLeaderboard(roomCode);
        io.to(roomCode).emit('update_category', rooms[roomCode].selectedCategory);
    });

    // 2. Vào phòng (Gán Chế độ Khán Giả nếu Game Đang Chơi)
    socket.on('join_room', (data) => {
        const { roomCode, roomPassword, name, playerId } = data;
        const room = rooms[roomCode];

        if (!room) return socket.emit('room_error', 'Mã phòng không tồn tại!');
        if (room.password && room.password !== roomPassword) return socket.emit('room_error', 'Sai mật khẩu phòng!');

        const isHost = (playerId === room.hostPlayerId);
        let player = room.players.find(p => p.playerId === playerId);
        
        if (!player) {
            // Nếu game đang diễn ra thì tự động chuyển thành KHÁN GIẢ
            const isSpectator = room.isPlaying;
            player = { socketId: socket.id, playerId, name, ready: isHost, score: 0, online: true, isSpectator };
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
        socket.emit('join_success', { roomCode, isHost, isSpectator: player.isSpectator });
        
        if (player.isSpectator) {
            socket.emit('receive_chat', { name: "Hệ thống ⚠️", message: "Trận đấu đang diễn ra. Bạn tham gia với tư cách Khán Giả!" });
        }

        updateRoomLeaderboard(roomCode);
        socket.emit('update_category', room.selectedCategory);
    });

    // 3. Chơi lại (Khán giả chuyển thành Người chơi chính ở ván mới)
    socket.on('back_to_lobby', (data) => {
        const { roomCode, playerId } = data;
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.playerId === playerId);
            if (player) {
                player.isSpectator = false; // Chuyển thành người chơi chính
                if (player.playerId !== room.hostPlayerId) {
                    player.ready = false; 
                }
            }
            updateRoomLeaderboard(roomCode);
            socket.emit('return_to_lobby');
        }
    });

    // 4. Chủ phòng đuổi người (Kick linh hoạt)
    socket.on('kick_player', (data) => {
        const { roomCode, targetPlayerId } = data;
        const room = rooms[roomCode];
        if (room) {
            const requester = room.players.find(p => p.socketId === socket.id);
            if (requester && requester.playerId === room.hostPlayerId) {
                const target = room.players.find(p => p.playerId === targetPlayerId);
                if (target && target.playerId !== room.hostPlayerId) {
                    // Nếu ĐANG CHƠI mà Target KHÔNG PHẢI KHÁN GIẢ -> Chặn kick
                    if (room.isPlaying && !target.isSpectator) {
                        return socket.emit('start_error', 'Không thể kick người chơi chính khi ván đấu đang diễn ra!');
                    }

                    io.to(target.socketId).emit('kicked_out');
                    removePlayerFromRoom(roomCode, targetPlayerId);
                }
            }
        }
    });

    // 5. Tự rời phòng
    socket.on('leave_room', (data) => {
        const { roomCode, playerId } = data;
        removePlayerFromRoom(roomCode, playerId);
    });

    // 6. Đổi chủ đề
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

    // 7. Rejoin kết nối lại
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
                socket.emit('rejoin_success', { roomCode, isHost: playerId === room.hostPlayerId, isSpectator: player.isSpectator });
                updateRoomLeaderboard(roomCode);
                socket.emit('update_category', room.selectedCategory);
            }
        }
    });

    // 8. Sẵn sàng
    socket.on('toggle_ready', (data) => {
        const { roomCode, playerId } = data;
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.playerId === playerId);
            if (player && playerId !== room.hostPlayerId && !player.isSpectator) {
                player.ready = !player.ready;
                updateRoomLeaderboard(roomCode);
            }
        }
    });

    // 9. Chat
    socket.on('send_chat', (data) => {
        const { roomCode, message } = data;
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.socketId === socket.id);
            if (player) {
                const prefix = player.isSpectator ? " [Khán Giả]" : "";
                io.to(roomCode).emit('receive_chat', { name: player.name + prefix, message });
            }
        }
    });

    // 10. Bắt đầu game
    socket.on('start_game', (data) => {
        const { roomCode, playerId } = data;
        const room = rooms[roomCode];
        if (room) {
            if (playerId !== room.hostPlayerId) return;

            const activePlayers = room.players.filter(p => !p.isSpectator);
            const unready = activePlayers.find(p => p.playerId !== room.hostPlayerId && !p.ready);
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
            room.isPlaying = true; // Đánh dấu ván đấu bắt đầu
            sendNextQuestion(roomCode);
        }
    });

    // 11. Trả lời câu hỏi (Chỉ cho phép Người chơi chính)
    socket.on('submit_answer', (data) => {
        const { roomCode, answer } = data;
        const room = rooms[roomCode];
        if (!room || room.answeredPlayers.has(socket.id)) return;

        const player = room.players.find(p => p.socketId === socket.id);
        if (!player || player.isSpectator) return; // Chặn khán giả gửi đáp án

        const currentQ = room.questions[room.currentQuestion];
        if (!currentQ) return;

        if (cleanString(answer) === cleanString(currentQ.a)) {
            room.answeredPlayers.add(socket.id);
            room.correctCount++;

            let points = 0;
            if (room.correctCount === 1) points = 3;
            else if (room.correctCount === 2) points = 2;
            else if (room.correctCount === 3) points = 1;

            player.score += points;

            socket.emit('answer_result', { correct: true, rank: room.correctCount, points });
            updateRoomLeaderboard(roomCode);

            const activePlayers = room.players.filter(p => !p.isSpectator && p.online);
            if (room.answeredPlayers.size >= activePlayers.length) {
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
                playerId: p.playerId,
                name: p.name + (!p.online ? ' (Đang nối lại...)' : ''),
                ready: p.ready,
                score: p.score,
                isHost: p.playerId === room.hostPlayerId,
                isSpectator: p.isSpectator
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
        room.timeLeft = 30;

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
                room.isPlaying = false; // Kết thúc ván đấu
                io.to(roomCode).emit('game_over', room.players);
            }
        }, 3000);
    }

    function removePlayerFromRoom(code, targetPlayerId) {
        const room = rooms[code];
        if (!room) return;

        const idx = room.players.findIndex(p => p.playerId === targetPlayerId);
        if (idx !== -1) {
            const wasHost = (room.players[idx].playerId === room.hostPlayerId);
            const targetSocketId = room.players[idx].socketId;
            room.players.splice(idx, 1);

            const targetSocket = io.sockets.sockets.get(targetSocketId);
            if (targetSocket) targetSocket.leave(code);

            if (room.players.length === 0) {
                if (room.timer) clearInterval(room.timer);
                delete rooms[code];
            } else {
                if (wasHost) {
                    room.hostPlayerId = room.players[0].playerId;
                    room.players[0].ready = true;
                    room.players[0].isSpectator = false;
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
                        removePlayerFromRoom(code, player.playerId);
                    }
                }, 120000); // Giữ kết nối trong 2 phút
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));