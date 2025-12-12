/* public/code.js */
(() => {
    "use strict";

    const socket = io();

    // --- State ---
    const state = {
        username: "",
        room: null,
        typingTimer: null,
        typingUsers: new Set(), // Track who is typing
        isFocused: true
    };

    // --- DOM Elements ---
    const DOM = {
        screens: { lobby: document.getElementById("lobby-screen"), chat: document.getElementById("chat-screen") },
        lobby: {
            input: document.getElementById("lobby-username"),
            roomList: document.getElementById("room-list"),
            createBtn: document.getElementById("btn-create-room"),
            modal: document.getElementById("create-room-modal"),
            modalInput: document.getElementById("new-room-name"),
            modalSubmit: document.getElementById("modal-create-room"),
            modalCancel: document.getElementById("modal-cancel-room"),
        },
        chat: {
            roomName: document.getElementById("chat-room-name"),
            userInfo: document.getElementById("chat-user-info"),
            usersList: document.getElementById("sidebar-users"),
            messages: document.getElementById("messages"),
            input: document.getElementById("message-input"),
            sendBtn: document.getElementById("send-message"),
            typing: document.getElementById("typing-indicator"),
            leaveBtn: document.getElementById("leave-room"),
            sidebarRooms: document.getElementById("sidebar-rooms"),
            // New Elements
            emojiBtn: document.getElementById("emoji-btn"),
            emojiPicker: document.getElementById("emoji-picker"),
            sound: document.getElementById("notif-sound")
        },
        toastBox: document.getElementById("toast-box")
    };

    // --- Helpers ---
    function showToast(msg, type = "info") {
        const el = document.createElement("div");
        el.className = `toast toast-${type}`;
        el.textContent = msg;
        DOM.toastBox.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }

    function setScreen(screenName) {
        Object.values(DOM.screens).forEach(el => el.classList.remove("active"));
        DOM.screens[screenName].classList.add("active");
    }

    function formatTime(iso) {
        return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function generateAvatarColor(name) {
        const colors = ["#EF4444", "#F97316", "#F59E0B", "#10B981", "#3B82F6", "#6366F1", "#EC4899"];
        let hash = 0;
        for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
        return colors[Math.abs(hash) % colors.length];
    }

    function createMessageContent(text) {
        const span = document.createElement("span");
        const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|(?:https?:\/\/|www\.)[^\s]+)/g);
        parts.forEach(part => {
            if (part.match(/^(https?:\/\/|www\.)/)) {
                const a = document.createElement("a");
                a.href = part.startsWith("www.") ? "https://" + part : part;
                a.target = "_blank";
                a.textContent = part;
                span.appendChild(a);
            } 
            else if (part.startsWith("**") && part.length > 4) {
                const b = document.createElement("b");
                b.textContent = part.slice(2, -2);
                span.appendChild(b);
            }
            else if (part.startsWith("*") && part.length > 2) {
                const i = document.createElement("i");
                i.textContent = part.slice(1, -1);
                span.appendChild(i);
            }
            else if (part.trim()) {
                span.appendChild(document.createTextNode(part));
            }
        });
        return span;
    }

    // --- Rendering ---
    function renderRooms(rooms) {
        DOM.lobby.roomList.innerHTML = "";
        DOM.chat.sidebarRooms.innerHTML = "";
        
        if (rooms.length === 0) DOM.lobby.roomList.innerHTML = "<div class='empty-msg'>No active rooms. Create one!</div>";

        rooms.forEach(r => {
            // Lobby
            const card = document.createElement("div");
            card.className = "room-card";
            card.innerHTML = `<div class="room-name" style="font-weight:bold">${r.name}</div><div class="room-info">${r.userCount} users</div>`;
            card.onclick = () => joinRoom(r.name);
            DOM.lobby.roomList.appendChild(card);

            // Sidebar
            const item = document.createElement("div");
            item.className = `room-item ${state.room === r.name ? 'active' : ''}`;
            item.innerHTML = `<span># ${r.name}</span> <span>${r.userCount}</span>`;
            if (state.room !== r.name) item.onclick = () => joinRoom(r.name);
            DOM.chat.sidebarRooms.appendChild(item);
        });
    }

    function renderMessage(msg) {
        const isMe = msg.username === state.username;
        const wrapper = document.createElement("div");
        wrapper.className = `message ${isMe ? "my" : "other"}`;

        const bubble = document.createElement("div");
        bubble.className = "bubble";
        
        const meta = document.createElement("div");
        meta.className = "msg-meta";
        meta.innerHTML = `<span class="name" style="font-weight:bold">${isMe ? "You" : msg.username}</span> <span class="time">${formatTime(msg.time)}</span>`;

        const textDiv = document.createElement("div");
        textDiv.className = "msg-text";
        textDiv.appendChild(createMessageContent(msg.text));

        bubble.append(meta, textDiv);
        wrapper.appendChild(bubble);
        DOM.chat.messages.appendChild(wrapper);
        DOM.chat.messages.scrollTop = DOM.chat.messages.scrollHeight;

        // Play Sound (if not me)
        if (!isMe) {
            try { DOM.chat.sound.currentTime = 0; DOM.chat.sound.play(); } catch(e){}
        }
    }

    function renderSystemMessage(text) {
        const div = document.createElement("div");
        div.className = "system-message";
        div.textContent = text;
        DOM.chat.messages.appendChild(div);
        DOM.chat.messages.scrollTop = DOM.chat.messages.scrollHeight;
    }

    function renderTyping() {
        if (state.typingUsers.size === 0) {
            DOM.chat.typing.textContent = "";
            return;
        }
        const users = Array.from(state.typingUsers);
        if (users.length === 1) DOM.chat.typing.textContent = `${users[0]} is typing...`;
        else if (users.length === 2) DOM.chat.typing.textContent = `${users[0]} and ${users[1]} are typing...`;
        else DOM.chat.typing.textContent = `Multiple people are typing...`;
    }

    // --- Actions ---
    function joinRoom(roomName) {
        const username = DOM.lobby.input.value.trim();
        if (!username) return showToast("Enter a username", "error");

        state.username = username;
        socket.emit("room:join", { roomName, username }, (res) => {
            if (res.error) return showToast(res.error, "error");
            
            state.room = roomName;
            DOM.chat.roomName.textContent = "# " + roomName;
            DOM.chat.userInfo.textContent = username;
            
            DOM.chat.messages.innerHTML = "";
            if (res.history) res.history.forEach(renderMessage);
            updateUserList(res.users);
            setScreen("chat");
        });
    }

    function sendMessage() {
        const text = DOM.chat.input.value.trim();
        if (!text) return;
        socket.emit("chat:message", { text }, () => {
             DOM.chat.input.value = "";
             socket.emit("chat:typing", false); // Stop typing instantly on send
        });
    }

    function updateUserList(users) {
        DOM.chat.usersList.innerHTML = "";
        users.forEach(u => {
            const div = document.createElement("div");
            div.className = "user-item";
            div.innerHTML = `<div class="user-avatar" style="background:${generateAvatarColor(u)}">${u[0].toUpperCase()}</div><div>${u}</div>`;
            DOM.chat.usersList.appendChild(div);
        });
    }

    // --- Socket Events ---
    socket.on("rooms:list", renderRooms);
    socket.on("chat:message", renderMessage);

    // 1. Join/Left with System Message
    socket.on("room:user-joined", ({ username }) => {
        renderSystemMessage(`${username} joined the room`);
        // Note: For simplicity, user list updates when we get "rooms:list" or manual fetch. 
        // Ideally we should push this user to sidebar directly, but this works for now.
    });

    socket.on("room:user-left", ({ username }) => {
        renderSystemMessage(`${username} left the room`);
    });

    // 2. Typing Indicator
    socket.on("chat:typing", ({ username, isTyping }) => {
        if (isTyping) state.typingUsers.add(username);
        else state.typingUsers.delete(username);
        renderTyping();
    });

    // --- DOM Events ---
    DOM.lobby.createBtn.onclick = () => DOM.lobby.modal.classList.remove("hidden");
    DOM.lobby.modalCancel.onclick = () => DOM.lobby.modal.classList.add("hidden");
    
    DOM.lobby.modalSubmit.onclick = () => {
        const name = DOM.lobby.modalInput.value.trim();
        if (!name) return showToast("Enter room name", "error");
        socket.emit("room:create", { roomName: name }, (res) => {
            if (res.error) return showToast(res.error, "error");
            DOM.lobby.modal.classList.add("hidden");
            joinRoom(res.roomName);
        });
    };

    DOM.chat.sendBtn.onclick = sendMessage;
    DOM.chat.input.onkeydown = (e) => {
        if (e.key === "Enter") sendMessage();
        // Typing Emit
        socket.emit("chat:typing", true);
        clearTimeout(state.typingTimer);
        state.typingTimer = setTimeout(() => socket.emit("chat:typing", false), 1000);
    };

    DOM.chat.leaveBtn.onclick = () => {
        socket.emit("room:leave");
        state.room = null;
        setScreen("lobby");
    };

    // 3. Emoji Logic
    DOM.chat.emojiBtn.onclick = () => DOM.chat.emojiPicker.classList.toggle("hidden");
    
    // Add emoji to input when clicked
    DOM.chat.emojiPicker.addEventListener("click", (e) => {
        if (e.target.tagName === "SPAN") {
            DOM.chat.input.value += e.target.textContent;
            DOM.chat.input.focus();
            DOM.chat.emojiPicker.classList.add("hidden"); // Close after pick
        }
    });

    // Close emoji picker if clicking outside
    document.addEventListener("click", (e) => {
        if (!DOM.chat.emojiPicker.contains(e.target) && e.target !== DOM.chat.emojiBtn) {
            DOM.chat.emojiPicker.classList.add("hidden");
        }
    });

})();