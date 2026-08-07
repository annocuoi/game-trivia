const socket = io();

let isHost = false;
let isReady = false;
let lastChatTime = 0; // Lưu thời điểm gửi chat lần trước để chặn 2 giây

socket.on('set_as_host', () => {
    isHost = true;
    document.getElementById('host-controls').style.display = 'block';
    document.getElementById('player-controls').style.display = 'none';
});

function joinGame() {
    const name = document.getElementById('username').value.trim();
    if (!name) {
        alert('Vui lòng nhập tên!');
        return;
    }

    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'block';

    if (!isHost) {
        document.getElementById('player-controls').style.display = 'block';
    }

    socket.emit('join_game', name);
}

function toggleReady() {
    isReady = !isReady;
    const readyBtn = document.getElementById('ready-btn');
    
    if (isReady) {
        readyBtn.innerText = "Bỏ Sẵn Sàng";
        readyBtn.style.backgroundColor = "#dc3545"; // Đỏ
        readyBtn.style.color = "white";
    } else {
        readyBtn.innerText = "Sẵn Sàng";
        readyBtn.style.backgroundColor = "#ffc107"; // Vàng
        readyBtn.style.color = "black";
    }

    socket.emit('toggle_ready');
}

// Chức năng chat tổng có giới hạn 2 giây
function sendChat() {
    const now = Date.now();
    const cooldownMsg = document.getElementById('chat-cooldown');

    if (now - lastChatTime < 2000) {
        cooldownMsg.innerText = "Vui lòng đợi 2 giây trước khi gửi tiếp!";
        return;
    }

    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    socket.emit('send_chat', message);
    input.value = '';
    lastChatTime = now;
    cooldownMsg.innerText = "";
}

socket.on('receive_chat', (data) => {
    const chatMessages = document.getElementById('chat-messages');
    const p = document.createElement('p');
    p.style.margin = "4px 0";
    p.innerHTML = `<strong>${data.name}:</strong> ${data.message}`;
    chatMessages.appendChild(p);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Tự động cuộn xuống tin nhắn mới nhất
});

function startGame() {
    socket.emit('start_game');
}

socket.on('new_question', (data) => {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';

    document.getElementById('q-number').innerText = `Câu hỏi ${data.questionNumber}/10`;
    document.getElementById('q-text').innerText = data.question;
    document.getElementById('feedback').innerText = '';
    document.getElementById('answer-input').disabled = false;
});

function submitAnswer() {
    const input = document.getElementById('answer-input');
    const answer = input.value;
    if (!answer) return;

    socket.emit('submit_answer', answer);
    input.value = '';
}

socket.on('timer_update', (timeLeft) => {
    document.getElementById('time').innerText = timeLeft;
});

socket.on('answer_result', (res) => {
    const feedback = document.getElementById('feedback');
    if (res.correct) {
        feedback.style.color = 'green';
        feedback.innerText = `Chính xác! Bạn đứng thứ ${res.rank} (+${res.points} điểm)`;
        document.getElementById('answer-input').disabled = true;
    } else {
        feedback.style.color = 'red';
        feedback.innerText = 'Sai rồi, thử lại xem!';
    }
});

socket.on('show_answer', (data) => {
    document.getElementById('feedback').style.color = 'blue';
    document.getElementById('feedback').innerText = `Hết giờ! Đáp án là: ${data.answer.toUpperCase()}`;
    document.getElementById('answer-input').disabled = true;
});

socket.on('update_leaderboard', (scores) => {
    const playerListLobby = document.getElementById('player-list-lobby');
    playerListLobby.innerHTML = '';

    const scoreList = document.getElementById('score-list');
    scoreList.innerHTML = '';

    let playerCount = 0;
    const playersArray = Object.entries(scores);

    playersArray.forEach(([id, player], index) => {
        playerCount++;
        
        const liLobby = document.createElement('li');
        
        // Người đầu tiên trong danh sách (index === 0) luôn là Chủ Phòng
        if (index === 0) {
            liLobby.innerHTML = `${player.name} 👑 <strong>(Chủ phòng)</strong>`;
        } else {
            const statusText = player.ready ? " ✅ (Đã sẵn sàng)" : " ⏳ (Chưa sẵn sàng)";
            liLobby.innerText = player.name + statusText;
        }
        
        playerListLobby.appendChild(liLobby);

        const liGame = document.createElement('li');
        liGame.innerText = `${player.name}: ${player.score} điểm`;
        scoreList.appendChild(liGame);
    });

    document.getElementById('player-count-lobby').innerText = playerCount;
});

socket.on('game_over', (scores) => {
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('game-over').style.display = 'block';

    const sortedPlayers = Object.values(scores).sort((a, b) => b.score - a.score);
    if (sortedPlayers.length > 0) {
        document.getElementById('winner-text').innerText = 
            `🏆 Chúc mừng ${sortedPlayers[0].name} đã đạt ${sortedPlayers[0].score} điểm!`;
    }
});