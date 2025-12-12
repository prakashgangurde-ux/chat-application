/* public/code.js */
(() => {
    "use strict";

    const socket = io();

    // --- State ---
    const state = {
        username: "",
        room: null,
        pendingRoom: null,
        typingTimer: null,
        typingUsers: new Set(),
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
            modalPass: document.getElementById("new-room-pass"),
            modalSubmit: document.getElementById("modal-create-room"),
            modalCancel: document.getElementById("modal-cancel-room"),
            joinModal: document.getElementById("join-room-modal"),
            joinPass: document.getElementById("join-room-pass"),
            joinTitle: document.getElementById("join-room-title"),
            joinCancel: document.getElementById("modal-cancel-join"),
            joinConfirm: document.getElementById("modal-confirm-join"),
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
            emojiBtn: document.getElementById("emoji-btn"),
            emojiPicker: document.getElementById("emoji-picker"),
            sound: document.getElementById("notif-sound"),
            // NEW ELEMENTS
            attachBtn: document.getElementById("attach-btn"),
            fileInput: document.getElementById("file-input")
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
            const card = document.createElement("div");
            card.className = "room-card";
            const lockIcon = r.isLocked ? `<span class="room-lock">🔒 Private</span>` : "";
            card.innerHTML = `
                <div>
                    <div class="room-name" style="font-weight:bold">${r.name}</div>
                    <div class="room-info">${r.userCount} users</div>
                </div>
                ${lockIcon}
            `;
            card.onclick = () => handleJoinClick(r.name, r.isLocked);
            DOM.lobby.roomList.appendChild(card);

            const item = document.createElement("div");
            item.className = `room-item ${state.room === r.name ? 'active' : ''}`;
            item.innerHTML = `<span>${r.isLocked ? '🔒' : '#'} ${r.name}</span> <span>${r.userCount}</span>`;
            if (state.room !== r.name) item.onclick = () => handleJoinClick(r.name, r.isLocked);
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

        // NEW: Check if it's an image or text
        const contentDiv = document.createElement("div");
        contentDiv.className = "msg-text";

        if (msg.image) {
            // Render Image
            const img = document.createElement("img");
            img.src = msg.image;
            img.style.maxWidth = "200px";
            img.style.borderRadius = "8px";
            img.style.cursor = "pointer";
            img.onclick = () => window.open(msg.image, "_blank"); // Open full size on click
            contentDiv.appendChild(img);
        } else {
            // Render Text
            contentDiv.appendChild(createMessageContent(msg.text));
        }

        bubble.append(meta, contentDiv);
        wrapper.appendChild(bubble);
        DOM.chat.messages.appendChild(wrapper);
        DOM.chat.messages.scrollTop = DOM.chat.messages.scrollHeight;

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
        if (state.typingUsers.size === 0) { DOM.chat.typing.textContent = ""; return; }
        const users = Array.from(state.typingUsers);
        if (users.length === 1) DOM.chat.typing.textContent = `${users[0]} is typing...`;
        else DOM.chat.typing.textContent = `Multiple people are typing...`;
    }

    // --- Actions ---
    function handleJoinClick(roomName, isLocked) {
        if (isLocked) {
            state.pendingRoom = roomName;
            DOM.lobby.joinTitle.textContent = `Enter password for "${roomName}"`;
            DOM.lobby.joinPass.value = "";
            DOM.lobby.joinModal.classList.remove("hidden");
            DOM.lobby.joinPass.focus();
        } else {
            joinRoom(roomName, null);
        }
    }

    function joinRoom(roomName, password) {
        const username = DOM.lobby.input.value.trim();
        if (!username) return showToast("Enter a username", "error");

        state.username = username;
        socket.emit("room:join", { roomName, username, password }, (res) => {
            if (res.error) return showToast(res.error, "error");
            
            DOM.lobby.joinModal.classList.add("hidden");
            state.room = roomName;
            DOM.chat.roomName.textContent = (password ? "🔒 " : "# ") + roomName;
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
        // Send as text
        socket.emit("chat:message", { text }, () => {
             DOM.chat.input.value = "";
             socket.emit("chat:typing", false);
        });
    }

    // NEW: Handle Image Selection
    function sendImage(file) {
        // Limit: 2MB
        if (file.size > 2 * 1024 * 1024) return showToast("File too large (Max 2MB)", "error");

        const reader = new FileReader();
        reader.onload = (e) => {
            const imageData = e.target.result; // Base64 string
            
            // We reuse the same chat:message event but pass 'text' as null and 'image' data
            // Note: In server.js we are currently validating "text". We need to make sure server accepts it.
            // *Correction*: Our server checks `if (!text) return`. We need to update that logic OR just send a placeholder text.
            
            // Let's send a placeholder text so we don't have to rewrite server logic completely right now.
            // Or better, we send the image as the "text" payload if we want a quick hack, but that's messy.
            // PROPER WAY: Update server to accept { text, image }
            
            socket.emit("chat:message", { text: "📷 Image", image: imageData }, (res) => {
                if(res && res.error) showToast(res.error, "error");
            });
        };
        reader.readAsDataURL(file);
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

    // --- Events ---
    socket.on("rooms:list", renderRooms);
    socket.on("chat:message", renderMessage);
    socket.on("room:user-joined", ({ username }) => renderSystemMessage(`${username} joined`));
    socket.on("room:user-left", ({ username }) => renderSystemMessage(`${username} left`));
    socket.on("chat:typing", ({ username, isTyping }) => {
        if (isTyping) state.typingUsers.add(username); else state.typingUsers.delete(username);
        renderTyping();
    });

    // --- DOM Bindings ---
    DOM.lobby.createBtn.onclick = () => DOM.lobby.modal.classList.remove("hidden");
    DOM.lobby.modalCancel.onclick = () => DOM.lobby.modal.classList.add("hidden");
    DOM.lobby.modalSubmit.onclick = () => {
        const name = DOM.lobby.modalInput.value.trim();
        const pass = DOM.lobby.modalPass.value.trim();
        if (!name) return showToast("Enter room name", "error");
        socket.emit("room:create", { roomName: name, password: pass }, (res) => {
            if (res.error) return showToast(res.error, "error");
            DOM.lobby.modal.classList.add("hidden");
            DOM.lobby.modalInput.value = "";
            DOM.lobby.modalPass.value = "";
            joinRoom(res.roomName, pass);
        });
    };

    DOM.chat.sendBtn.onclick = sendMessage;
    DOM.chat.input.onkeydown = (e) => {
        if (e.key === "Enter") sendMessage();
        socket.emit("chat:typing", true);
        clearTimeout(state.typingTimer);
        state.typingTimer = setTimeout(() => socket.emit("chat:typing", false), 1000);
    };
    DOM.chat.leaveBtn.onclick = () => {
        socket.emit("room:leave");
        state.room = null;
        setScreen("lobby");
    };

    // Emoji
    DOM.chat.emojiBtn.onclick = () => DOM.chat.emojiPicker.classList.toggle("hidden");
    DOM.chat.emojiPicker.onclick = (e) => {
        if (e.target.tagName === "SPAN") {
            DOM.chat.input.value += e.target.textContent;
            DOM.chat.emojiPicker.classList.add("hidden");
            DOM.chat.input.focus();
        }
    };
    document.addEventListener("click", (e) => {
        if (!DOM.chat.emojiPicker.contains(e.target) && e.target !== DOM.chat.emojiBtn) {
            DOM.chat.emojiPicker.classList.add("hidden");
        }
    });

    // NEW: Attachment Bindings
    DOM.chat.attachBtn.onclick = () => DOM.chat.fileInput.click();
    
    DOM.chat.fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            sendImage(file);
            DOM.chat.fileInput.value = "";
        }
    };

    // NEW: Join Modal Bindings
    DOM.lobby.joinCancel.onclick = () => DOM.lobby.joinModal.classList.add("hidden");
    DOM.lobby.joinConfirm.onclick = () => {
        const pass = DOM.lobby.joinPass.value.trim();
        if (state.pendingRoom) {
            joinRoom(state.pendingRoom, pass);
        }
    };
    DOM.lobby.joinPass.onkeydown = (e) => {
        if (e.key === "Enter") DOM.lobby.joinConfirm.click();
    };

})();