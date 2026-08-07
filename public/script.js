const socket = io();

let currentName = '';
let currentRoomCode = '';
let isHost = false;
let isReady = false;
let lastChatTime = 0;

// Bước 1 -> Bước 2
function goToRoomChoice() {
    const name = document.getElementById('username').value.trim();
    if (!name) {
        document.getElementById('name-error').innerText = 'Vui lòng nhập tên!';
        return;
    }

    currentName = name;
    document.getElementById('user-display-name').innerText = currentName;
    document.getElementById('step-name-screen').style.display = 'none';
    document.getElementById('step-room-screen').style.display = 'block';
}

// Tạo phòng
function createRoom() {
    const roomPassword = document.getElementById('create-pass').value.trim();
    socket.emit('create_room', { name: currentName, roomPassword });
}

// Vào phòng
function joinRoom() {
    const roomCode = document.getElementById('join-code').value.trim();
    const roomPassword = document.getElementById('join-pass').value.trim();
    if (!roomCode) {
        document.getElementById('room-error').innerText = 'Nhập mã phòng 4 số!';
        return;
    }
    socket.emit('join_room', { roomCode, roomPassword, name: currentName });
}

socket.on('room_created', (data) => enterLobby(data.roomCode, true));
socket.on('join_success', (data) => enterLobby(data.roomCode, data.isHost));
socket.on('room_error', (msg) => document.getElementById('room-error').innerText = msg);

function enterLobby(roomCode, hostStatus) {
    currentRoomCode = roomCode;
    isHost = hostStatus;

    document.getElementById('step-room-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'block';
    document.getElementById('room-code-display').innerText = roomCode;

    if (isHost) {
        document.getElementById('host-controls').style.display = 'block';
        document.getElementById('player-controls').style.display = 'none';
    } else {
        document.getElementById('host-controls').style.display = 'none';
        document.getElementById('player-controls').style.display = 'block';
    }
}

function toggleReady() {
    isReady = !isReady;
    const readyBtn = document.getElementById('ready-btn');
    
    if (isReady) {
        readyBtn.innerText = "Bỏ Sẵn Sàng";
        readyBtn.style.backgroundColor = "#dc3545";
        readyBtn.style.color = "white";
    } else {
        readyBtn.innerText = "Sẵn Sàng";
        readyBtn.style.backgroundColor = "#ffc107";
        readyBtn.style.color = "black";
    }

    socket.emit('toggle_ready', { roomCode: currentRoomCode });
}

function sendChat() {
    const now = Date.now();
    const cooldownMsg = document.getElementById('chat-cooldown');

    if (now - lastChatTime < 2000) {
        cooldownMsg.innerText = "Vui lòng đợi 2 giây!";
        return;
    }

    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    socket.emit('send_chat', { roomCode: currentRoomCode, message });
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
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

function startGame() {
    socket.emit('start_game', { roomCode: currentRoomCode });
}

socket.on('start_error', (msg) => {
    document.getElementById('lobby-error').innerText = msg;
});

socket.on('new_question', (data) => {
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';

    document.getElementById('q-number').innerText = `Câu hỏi ${data.questionNumber}/10`;
    document.getElementById('q-text').innerText = data.question;
    document.getElementById('feedback').innerText = '';
    document.getElementById('answer-input').value = '';
    document.getElementById('answer-input').disabled = false;
});

function submitAnswer() {
    const input = document.getElementById('answer-input');
    const answer = input.value;
    if (!answer) return;

    socket.emit('submit_answer', { roomCode: currentRoomCode, answer });
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

socket.on('update_leaderboard', (players) => {
    const playerListLobby = document.getElementById('player-list-lobby');
    playerListLobby.innerHTML = '';

    const scoreList = document.getElementById('score-list');
    scoreList.innerHTML = '';

    document.getElementById('player-count-lobby').innerText = players.length;

    players.forEach((player) => {
        const liLobby = document.createElement('li');
        if (player.isHost) {
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
});

socket.on('game_over', (players) => {
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('game-over').style.display = 'block';

    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
    if (sortedPlayers.length > 0) {
        document.getElementById('winner-text').innerText = 
            `🏆 Chúc mừng ${sortedPlayers[0].name} đã đạt ${sortedPlayers[0].score} điểm!`;
    }
});

function leaveRoom() { location.reload(); }