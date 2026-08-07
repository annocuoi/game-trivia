const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Nạp danh sách câu hỏi từ file questions.js riêng
const questions = require('./questions');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let currentQuestionIndex = 0;
let scores = {};
let answeredThisRound = new Set();
let timer = null;
let hostSocketId = null;
let isGameStarted = false;

io.on('connection', (socket) => {
    console.log('Có người kết nối:', socket.id);

    if (!hostSocketId) {
        hostSocketId = socket.id;
    }

    socket.on('join_game', (name) => {
        const isThisHost = (socket.id === hostSocketId);
        scores[socket.id] = { name: name, score: 0, ready: isThisHost };
        
        io.to(hostSocketId).emit('set_as_host');
        io.emit('update_leaderboard', scores);
    });

    socket.on('toggle_ready', () => {
        if (scores[socket.id] && socket.id !== hostSocketId) {
            scores[socket.id].ready = !scores[socket.id].ready;
            io.emit('update_leaderboard', scores);
        }
    });

    // Nhận tin nhắn chat tổng
    socket.on('send_chat', (message) => {
        if (scores[socket.id] && message.trim() !== '') {
            const chatData = {
                name: scores[socket.id].name,
                message: message.trim()
            };
            io.emit('receive_chat', chatData);
        }
    });

    socket.on('start_game', () => {
        if (socket.id === hostSocketId && !isGameStarted) {
            isGameStarted = true;
            startQuizLoop();
        }
    });

    socket.on('submit_answer', (answer) => {
        if (!scores[socket.id] || !isGameStarted) return;
        if (answeredThisRound.has(socket.id)) return;

        const currentQ = questions[currentQuestionIndex];
        
        // Chỉ xóa khoảng trắng thừa và đổi về chữ thường, GIỮ NGUYÊN DẤU TIẾNG VIỆT
        const userAns = answer.trim().toLowerCase();
        const correctAns = currentQ.a.toLowerCase();

        if (userAns === correctAns) {
            answeredThisRound.add(socket.id);
            const rank = answeredThisRound.size;
            
            let pointsToAdd = 0;
            if (rank === 1) pointsToAdd = 3;
            else if (rank === 2) pointsToAdd = 2;
            else if (rank === 3) pointsToAdd = 1;

            scores[socket.id].score += pointsToAdd;
            socket.emit('answer_result', { correct: true, rank, points: pointsToAdd });
            io.emit('update_leaderboard', scores);
        } else {
            socket.emit('answer_result', { correct: false });
        }
    });

    socket.on('disconnect', () => {
        delete scores[socket.id];
        io.emit('update_leaderboard', scores);
        
        if (socket.id === hostSocketId) {
            const remainingSockets = Array.from(io.sockets.sockets.keys());
            if (remainingSockets.length > 0) {
                hostSocketId = remainingSockets[0];
                if (scores[hostSocketId]) scores[hostSocketId].ready = true;
                io.to(hostSocketId).emit('set_as_host');
                io.emit('update_leaderboard', scores);
            } else {
                hostSocketId = null;
                isGameStarted = false;
                currentQuestionIndex = 0;
                clearInterval(timer);
            }
        }
        console.log('Ngắt kết nối:', socket.id);
    });
});

function startQuizLoop() {
    currentQuestionIndex = 0;
    
    function nextQuestion() {
        if (currentQuestionIndex < questions.length) {
            answeredThisRound.clear();
            const qData = { questionNumber: currentQuestionIndex + 1, question: questions[currentQuestionIndex].q };
            io.emit('new_question', qData);

            let timeLeft = 15;
            clearInterval(timer);
            timer = setInterval(() => {
                io.emit('timer_update', timeLeft);
                timeLeft--;

                if (timeLeft < 0) {
                    clearInterval(timer);
                    io.emit('show_answer', { answer: questions[currentQuestionIndex].a });
                    
                    setTimeout(() => {
                        currentQuestionIndex++;
                        nextQuestion();
                    }, 3000); 
                }
            }, 1000);
        } else {
            io.emit('game_over', scores);
            isGameStarted = false;
        }
    }

    nextQuestion();
}

server.listen(3000, () => {
    console.log('Server đang chạy tại: http://localhost:3000');
});