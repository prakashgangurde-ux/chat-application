/* public/code.js */
(() => {
    "use strict";

    const socket = io();

    // --- 1. State Management ---
    const state = {
        username: "",
        room: null,
        typingTimer: null,
        isFocused: true
    };

    // --- 2. DOM Elements (Cache them for performance) ---
    const DOM = {
        screens: {
            lobby: document.getElementById("lobby-screen"),
            chat: document.getElementById("chat-screen"),
        },
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
        },
        toastBox: document.getElementById("toast-box")
    };

    // --- 3. UI Helpers ---

    // Toast Notification System
    function showToast(msg, type = "info") {
        const el = document.createElement("div");
        el.className = `toast toast-${type}`;
        el.textContent = msg;
        DOM.toastBox.appendChild(el);
        // Remove after 3 seconds
        setTimeout(() => el.remove(), 3000);
    }

    // Switch between Lobby and Chat screens
    function setScreen(screenName) {
        Object.values(DOM.screens).forEach(el => el.classList.remove("active"));
        DOM.screens[screenName].classList.add("active");
    }

    // Generate a consistent color for a user avatar
    function generateAvatarColor(name) {
        const colors = ["#EF4444", "#F97316", "#F59E0B", "#10B981", "#3B82F6", "#6366F1", "#EC4899"];
        let hash = 0;
        for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
        return colors[Math.abs(hash) % colors.length];
    }

    // Format timestamp (e.g. "10:30 AM")
    function formatTime(iso) {
        return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Securely creates text nodes (prevents XSS) and auto-links URLs
    function createMessageContent(text) {
        const fragment = document.createDocumentFragment();
        // Split text by URLs
        const parts = text.split(/((?:https?:\/\/|www\.)[^\s]+)/g);
        
        parts.forEach(part => {
            if (part.match(/^(https?:\/\/|www\.)/)) {
                const a = document.createElement("a");
                a.href = part.startsWith("www.") ? "https://" + part : part;
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = part;
                fragment.appendChild(a);
            } else {
                fragment.appendChild(document.createTextNode(part));
            }
        });
        return fragment;
    }

    // --- 4. Render Logic ---

    // Render list of rooms in Lobby and Sidebar
    function renderRooms(rooms) {
        // Helper HTML generator
        const generateHTML = (r) => `
            <div class="room-name" style="font-weight:bold">${r.name}</div>
            <div class="room-info" style="font-size:0.85rem; color:#666">${r.userCount} user${r.userCount !== 1 ? 's' : ''}</div>
        `;

        // 1. Lobby List
        DOM.lobby.roomList.innerHTML = "";
        if (rooms.length === 0) DOM.lobby.roomList.innerHTML = "<div class='empty-msg'>No active rooms. Create one!</div>";
        
        rooms.forEach(r => {
            const card = document.createElement("div");
            card.className = "room-card";
            card.innerHTML = generateHTML(r);
            card.onclick = () => joinRoom(r.name); // Click to join
            DOM.lobby.roomList.appendChild(card);
        });

        // 2. Sidebar List (Chat Screen)
        DOM.chat.sidebarRooms.innerHTML = "";
        rooms.forEach(r => {
            const item = document.createElement("div");
            item.className = `room-item ${state.room === r.name ? 'active' : ''}`;
            item.innerHTML = `<span># ${r.name}</span> <span style="font-size:0.8em; opacity:0.7">${r.userCount}</span>`;
            if (state.room !== r.name) item.onclick = () => joinRoom(r.name);
            DOM.chat.sidebarRooms.appendChild(item);
        });
    }

    // Render a single chat message
    function renderMessage(msg) {
        const isMe = msg.username === state.username;
        
        const wrapper = document.createElement("div");
        wrapper.className = `message ${isMe ? "my" : "other"}`;

        // Avatar
        const avatar = document.createElement("div");
        avatar.className = "msg-avatar"; // You can add CSS for this if missing
        // avatar.style.background = generateAvatarColor(msg.username);
        // avatar.textContent = msg.username[0].toUpperCase();

        // Bubble
        const bubble = document.createElement("div");
        bubble.className = "bubble";

        // Meta (Name + Time)
        const meta = document.createElement("div");
        meta.className = "msg-meta";
        meta.innerHTML = `<span class="name" style="font-weight:bold">${isMe ? "You" : msg.username}</span> <span class="time">${formatTime(msg.time)}</span>`;

        // Text Content
        const textDiv = document.createElement("div");
        textDiv.className = "msg-text";
        textDiv.appendChild(createMessageContent(msg.text));

        bubble.append(meta, textDiv);
        wrapper.appendChild(bubble);

        DOM.chat.messages.appendChild(wrapper);
        
        // Auto-scroll to bottom
        DOM.chat.messages.scrollTop = DOM.chat.messages.scrollHeight;
    }

    // --- 5. Core Actions ---

    function joinRoom(roomName) {
        const username = DOM.lobby.input.value.trim();
        if (!username) return showToast("Please enter a username", "error");

        state.username = username;

        // Emit 'join' event to server
        socket.emit("room:join", { roomName, username }, (res) => {
            if (res.error) return showToast(res.error, "error");

            // Success! Update UI
            state.room = roomName;
            DOM.chat.roomName.textContent = "# " + roomName;
            DOM.chat.userInfo.textContent = `Logged in as ${username}`;
            
            // Clear old messages and render history
            DOM.chat.messages.innerHTML = "";
            if (res.history) res.history.forEach(renderMessage);
            
            // Render Users
            updateUserList(res.users);

            setScreen("chat");
        });
    }

    function sendMessage() {
        const text = DOM.chat.input.value.trim();
        if (!text) return;

        socket.emit("chat:message", { text }, (res) => {
            if (res && res.error) showToast(res.error, "error");
            else DOM.chat.input.value = ""; // Clear input on success
        });
    }

    function updateUserList(users) {
        DOM.chat.usersList.innerHTML = "";
        users.forEach(u => {
            const div = document.createElement("div");
            div.className = "user-item";
            div.innerHTML = `
                <div class="user-avatar" style="background:${generateAvatarColor(u)}">${u[0].toUpperCase()}</div>
                <div>${u}</div>
            `;
            DOM.chat.usersList.appendChild(div);
        });
    }

    // --- 6. Socket Event Listeners ---

    // Update room list whenever someone creates a room or joins/leaves
    socket.on("rooms:list", renderRooms);

    // Receive a new message
    socket.on("chat:message", (msg) => {
        renderMessage(msg);
    });

    // User Joined Notification
    socket.on("room:user-joined", ({ username, userCount }) => {
        showToast(`${username} joined!`);
        // We could also re-fetch the user list here if we wanted strictly accurate sidebar data
        // For now, let's just append a system message? 
        // Or better, let's ask the server for the user list again or handle it via a separate event.
        // For simplicity in this version, we will just rely on the toast.
    });

    // User Left Notification
    socket.on("room:user-left", ({ username }) => {
        showToast(`${username} left.`);
    });

    // --- 7. DOM Event Bindings ---

    // Toggle Modal
    DOM.lobby.createBtn.onclick = () => DOM.lobby.modal.classList.remove("hidden");
    DOM.lobby.modalCancel.onclick = () => DOM.lobby.modal.classList.add("hidden");

    // Create Room Submit
    DOM.lobby.modalSubmit.onclick = () => {
        const name = DOM.lobby.modalInput.value.trim();
        if (!name) return showToast("Enter a room name", "error");
        
        socket.emit("room:create", { roomName: name }, (res) => {
            if (res.error) return showToast(res.error, "error");
            
            DOM.lobby.modal.classList.add("hidden");
            DOM.lobby.modalInput.value = "";
            // Auto-join the new room
            joinRoom(res.roomName);
        });
    };

    // Send Message
    DOM.chat.sendBtn.onclick = sendMessage;
    DOM.chat.input.onkeydown = (e) => {
        if (e.key === "Enter") sendMessage();
    };

    // Leave Room
    DOM.chat.leaveBtn.onclick = () => {
        socket.emit("room:leave");
        state.room = null;
        setScreen("lobby");
    };

})();