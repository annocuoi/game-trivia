const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const questions = require('./questions');

app.use(express.static(path.join(__dirname, 'public')));

let players = {}; 
let hostSocketId = null;
let currentQuestionIndex = 0;
let timer = null;
let timeLeft = 10;
let correctCount = 0;
let answeredPlayers = new Set();

io.on('connection', (socket) => {

    // Tham gia game
    socket.on('join_game', (name) => {
        // Người đầu tiên vào sẽ làm Host
        if (!hostSocketId) {
            hostSocketId = socket.id;
            socket.emit('set_as_host');
        }

        players[socket.id] = {
            id: socket.id,
            name: name,
            ready: socket.id === hostSocketId, // Host luôn ready
            score: 0
        };

        io.emit('update_leaderboard', players);
    });

    // Đổi trạng thái Sẵn Sàng
    socket.on('toggle_ready', () => {
        if (players[socket.id] && socket.id !== hostSocketId) {
            players[socket.id].ready = !players[socket.id].ready;
            io.emit('update_leaderboard', players);
        }
    });

    // Chat chung
    socket.on('send_chat', (message) => {
        if (players[socket.id]) {
            io.emit('receive_chat', {
                name: players[socket.id].name,
                message: message
            });
        }
    });

    // Bắt đầu game (Chỉ Host mới gọi được)
    socket.on('start_game', () => {
        if (socket.id !== hostSocketId) return;

        // Kiểm tra xem có ai chưa sẵn sàng không
        const unready = Object.values(players).find(p => p.id !== hostSocketId && !p.ready);
        if (unready) {
            return socket.emit('receive_chat', { name: 'Hệ thống', message: `❌ Chưa thể bắt đầu! ${unready.name} chưa sẵn sàng.` });
        }

        currentQuestionIndex = 0;
        Object.values(players).forEach(p => p.score = 0);
        sendNextQuestion();
    });

    // Gửi đáp án
    socket.on('submit_answer', (answer) => {
        if (!players[socket.id] || answeredPlayers.has(socket.id)) return;

        const currentQ = questions[currentQuestionIndex];
        if (!currentQ) return;

        if (answer.trim().toLowerCase() === currentQ.a.toLowerCase()) {
            answeredPlayers.add(socket.id);
            correctCount++;

            let points = 0;
            if (correctCount === 1) points = 3;
            else if (correctCount === 2) points = 2;
            else if (correctCount === 3) points = 1;

            players[socket.id].score += points;

            socket.emit('answer_result', {
                correct: true,
                rank: correctCount,
                points: points
            });

            io.emit('update_leaderboard', players);

            // Tất cả mọi người trả lời xong thì chuyển câu
            if (answeredPlayers.size >= Object.keys(players).length) {
                finishQuestion();
            }
        } else {
            socket.emit('answer_result', { correct: false });
        }
    });

    function sendNextQuestion() {
        if (timer) clearInterval(timer);

        correctCount = 0;
        answeredPlayers.clear();
        timeLeft = 10;

        const q = questions[currentQuestionIndex];
        io.emit('new_question', {
            questionNumber: currentQuestionIndex + 1,
            question: q.q
        });

        io.emit('timer_update', timeLeft);

        timer = setInterval(() => {
            timeLeft--;
            io.emit('timer_update', timeLeft);

            if (timeLeft <= 0) {
                finishQuestion();
            }
        }, 1000);
    }

    function finishQuestion() {
        if (timer) clearInterval(timer);

        const q = questions[currentQuestionIndex];
        io.emit('show_answer', { answer: q.a });

        setTimeout(() => {
            currentQuestionIndex++;
            if (currentQuestionIndex < questions.length) {
                sendNextQuestion();
            } else {
                io.emit('game_over', players);
            }
        }, 3000);
    }

    // Ngắt kết nối
    socket.on('disconnect', () => {
        delete players[socket.id];

        if (socket.id === hostSocketId) {
            const remainingIds = Object.keys(players);
            if (remainingIds.length > 0) {
                hostSocketId = remainingIds[0];
                players[hostSocketId].ready = true;
                io.to(hostSocketId).emit('set_as_host');
            } else {
                hostSocketId = null;
            }
        }

        io.emit('update_leaderboard', players);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));