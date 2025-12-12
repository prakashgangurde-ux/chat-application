/* public/code.js */
(() => {
    "use strict";
    const socket = io();

    // --- State ---
    const state = {
        username: "",
        room: null,
        pendingRoom: null,
        replyingTo: null,
        typingTimer: null,
    };

    // --- DOM Elements ---
    const DOM = {
        screens: {
            login: document.getElementById("login-screen"),
            app: document.getElementById("app-dashboard"),
        },
        login: {
            input: document.getElementById("lobby-username"),
            btn: document.getElementById("btn-enter-app"),
        },
        sidebar: {
            left: document.getElementById("sidebar-left"),
            menuBtn: document.getElementById("menu-btn"),
            tabs: {
                public: document.getElementById("tab-public"),
                private: document.getElementById("tab-private"),
            },
            panels: {
                rooms: document.getElementById("rooms-panel"),
                users: document.getElementById("users-panel"),
            },
            lists: {
                rooms: document.getElementById("room-list"),
                users: document.getElementById("user-list-dm"),
            },
            createBtn: document.getElementById("btn-create-room"),
            logoutBtn: document.getElementById("btn-logout"),
        },
        chat: {
            headerName: document.getElementById("chat-header-name"),
            headerStatus: document.getElementById("chat-header-desc"),
            messages: document.getElementById("messages"),
            input: document.getElementById("message-input"),
            sendBtn: document.getElementById("send-message"),
            replyBar: document.getElementById("replying-bar"),
            replyText: document.getElementById("reply-text"),
            replyCancel: document.getElementById("cancel-reply"),
            emojiBtn: document.getElementById("emoji-btn"),
            emojiPicker: document.getElementById("emoji-picker"),
            attachBtn: document.getElementById("attach-btn"),
            fileInput: document.getElementById("file-input"),
            typing: document.getElementById("typing-indicator"),
            leaveBtn: document.getElementById("leave-room"),
        },
        profile: {
            name: document.getElementById("my-username"),
            pic: document.getElementById("my-profile-pic"),
        },
        modals: {
            create: document.getElementById("create-room-modal"),
            join: document.getElementById("join-room-modal"),
            inputs: {
                createName: document.getElementById("new-room-name"),
                createPass: document.getElementById("new-room-pass"),
                joinPass: document.getElementById("join-room-pass"),
            },
            btns: {
                createConfirm: document.getElementById("modal-create-room"),
                createCancel: document.getElementById("modal-cancel-room"),
                joinConfirm: document.getElementById("modal-confirm-join"),
                joinCancel: document.getElementById("modal-cancel-join"),
            }
        },
        toastBox: document.getElementById("toast-box"),
        sound: document.getElementById("notif-sound")
    };

    // --- Helpers ---
    function showToast(msg, type = "info") {
        const el = document.createElement("div");
        el.className = `toast toast-${type}`;
        el.textContent = msg;
        DOM.toastBox.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }

    function formatTime(iso) {
        return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function generateAvatarColor(name) {
        const colors = ["#ef4444", "#f97316", "#f59e0b", "#10b981", "#3b82f6", "#6366f1", "#ec4899"];
        let hash = 0;
        for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
        return colors[Math.abs(hash) % colors.length];
    }

    // FIX: DM room generator
    function getDMRoomName(user1, user2) {
        const sorted = [user1, user2].sort();
        return `DM_${sorted[0]}_${sorted[1]}`;
    }

    // --- Logic ---
    function enterApp() {
        const username = DOM.login.input.value.trim();
        if (!username) return showToast("Please choose a username", "error");

        state.username = username;
        localStorage.setItem("uc_username", username);

        DOM.profile.name.textContent = username;
        DOM.profile.pic.textContent = username[0].toUpperCase();
        DOM.profile.pic.style.background = generateAvatarColor(username);

        DOM.screens.login.classList.add("hidden");
        DOM.screens.app.classList.remove("hidden");

        socket.emit("rooms:get");
    }

    function logoutApp() {
        window.location.reload();
    }

    function sendImage(file) {
        if (!file.type.startsWith("image/")) return showToast("Only image files allowed", "error");
        if (file.size > 2 * 1024 * 1024) return showToast("File too large (Max 2MB)", "error");

        const reader = new FileReader();
        reader.onload = (e) => {
            socket.emit("chat:message", { text: null, image: e.target.result }, (res) => {
                if (res && res.error) showToast(res.error, "error");
            });
        };
        reader.readAsDataURL(file);
    }

    function startReply(msg) {
        state.replyingTo = msg;
        DOM.chat.replyBar.classList.remove("hidden");
        DOM.chat.replyText.textContent = `Replying to ${msg.username}...`;
        DOM.chat.input.focus();
    }

    function cancelReply() {
        state.replyingTo = null;
        DOM.chat.replyBar.classList.add("hidden");
    }

    // --- Rendering ---
    function renderRooms(rooms) {
        DOM.sidebar.lists.rooms.innerHTML = "";

        rooms.forEach(r => {
            if (r.name.startsWith("DM_")) return; // hide DM rooms

            const el = document.createElement("div");
            el.className = `room-item ${state.room === r.name ? 'active' : ''}`;
            el.innerHTML = `
                <div class="room-icon">#</div>
                <div style="flex:1;">
                    <div style="font-weight:600; font-size:0.9rem;">${r.name}</div>
                    <div style="font-size:0.75rem; color:#949ba4;">${r.userCount} online</div>
                </div>
                ${r.isLocked ? '🔒' : ''}
            `;
            el.onclick = () => handleJoinClick(r.name, r.isLocked);
            DOM.sidebar.lists.rooms.appendChild(el);
        });
    }

    // FIX: DM click support
    function renderUserList(users) {
        DOM.sidebar.lists.users.innerHTML = "";

        if (!users || users.length === 0) {
            DOM.sidebar.lists.users.innerHTML =
                "<div style='padding:10px; color:#666; font-size:0.8rem;'>No users in this room</div>";
            return;
        }

        users.forEach(u => {
            if (u === state.username) return;

            const el = document.createElement("div");
            el.className = "user-item";
            el.innerHTML = `
                <div class="user-avatar" style="background:${generateAvatarColor(u)}">${u[0].toUpperCase()}</div>
                <div>${u}</div>
            `;
            el.onclick = () => {
                if (confirm(`Start private chat with ${u}?`)) {
                    const dmRoom = getDMRoomName(state.username, u);
                    joinRoom(dmRoom, null);
                    DOM.chat.headerName.textContent = `@ ${u}`;
                }
            };
            DOM.sidebar.lists.users.appendChild(el);
        });

        DOM.chat.headerStatus.textContent = `${users.length} Online`;
    }

    function renderMessage(msg) {
        const isMe = msg.username === state.username;

        const div = document.createElement("div");
        div.className = `message ${isMe ? 'my' : 'other'}`;
        div.id = `msg-${msg.id}`;

        if (!isMe) {
            const avatar = document.createElement("div");
            avatar.className = "msg-avatar";
            avatar.textContent = msg.username[0].toUpperCase();
            avatar.style.background = generateAvatarColor(msg.username);
            avatar.style.color = "white";
            avatar.style.display = "flex";
            avatar.style.alignItems = "center";
            avatar.style.justifyContent = "center";
            div.appendChild(avatar);
        }

        const bubble = document.createElement("div");
        bubble.className = "bubble";

        if (msg.replyTo) {
            const quote = document.createElement("div");
            quote.className = "reply-quote";
            quote.textContent = `${msg.replyTo.username}: ${msg.replyTo.text}`;
            bubble.appendChild(quote);
        }

        const meta = document.createElement("div");
        meta.className = "msg-meta";
        meta.innerHTML = `<span>${isMe ? 'You' : msg.username}</span> <span>${formatTime(msg.time)}</span>`;

        const content = document.createElement("div");
        if (msg.image) {
            const img = document.createElement("img");
            img.src = msg.image;
            img.style.maxWidth = "100%";
            img.style.borderRadius = "8px";
            img.style.cursor = "pointer";
            img.onclick = () => window.open(msg.image);
            img.onload = () => DOM.chat.messages.scrollTop = DOM.chat.messages.scrollHeight;
            content.appendChild(img);
        } else {
            content.textContent = msg.text;
        }

        // FIX: render stored reactions
        const reactionsList = document.createElement("div");
        reactionsList.className = "reactions-list";
        reactionsList.id = `reacts-${msg.id}`;

        if (msg.reactions) {
            Object.entries(msg.reactions).forEach(([emoji, count]) => {
                const badge = document.createElement("span");
                badge.className = "reaction-badge";
                badge.textContent = `${emoji} ${count}`;
                reactionsList.appendChild(badge);
            });
        }

        const actions = document.createElement("div");
        actions.className = "msg-actions";
        actions.innerHTML = `
            <span class="action-btn" title="Reply">↩️</span> 
            <span class="action-btn" title="Like">❤️</span>
            <span class="action-btn" title="Laugh">😂</span>
        `;

        actions.children[0].onclick = () => startReply(msg);
        actions.children[1].onclick = () => socket.emit("chat:reaction", { messageId: msg.id, reaction: "❤️" });
        actions.children[2].onclick = () => socket.emit("chat:reaction", { messageId: msg.id, reaction: "😂" });

        bubble.append(meta, content, reactionsList, actions);
        div.appendChild(bubble);

        DOM.chat.messages.appendChild(div);
        DOM.chat.messages.scrollTop = DOM.chat.messages.scrollHeight;

        if (!isMe) {
            try { DOM.sound.currentTime = 0; DOM.sound.play(); } catch (e) { }
        }
    }

    // --- Events ---
    function handleJoinClick(roomName, isLocked) {
        DOM.sidebar.left.classList.remove("active");
        if (isLocked) {
            state.pendingRoom = roomName;
            DOM.modals.join.classList.remove("hidden");
            DOM.modals.inputs.joinPass.value = "";
            DOM.modals.inputs.joinPass.focus();
        } else {
            joinRoom(roomName, null);
        }
    }

    function joinRoom(roomName, password) {
        socket.emit("room:join", { roomName, username: state.username, password }, (res) => {
            if (res.error) return showToast(res.error, "error");

            DOM.modals.join.classList.add("hidden");
            state.room = roomName;

            if (roomName.startsWith("DM_")) {
                DOM.chat.headerName.textContent = "🔒 Private Chat";
            } else {
                DOM.chat.headerName.textContent = "# " + roomName;
            }

            DOM.chat.messages.innerHTML = "";
            if (res.history) res.history.forEach(renderMessage);
            if (res.users) renderUserList(res.users);

            socket.emit("rooms:get");
        });
    }

    function sendMessage() {
        const text = DOM.chat.input.value.trim();
        if (!text) return;

        const payload = { text };
        if (state.replyingTo) {
            payload.replyTo = {
                id: state.replyingTo.id,
                username: state.replyingTo.username,
                text: state.replyingTo.text || "[Image]"
            };
        }

        socket.emit("chat:message", payload, () => {
            DOM.chat.input.value = "";
            socket.emit("chat:typing", false);
            cancelReply();
        });
    }

    // Bindings
    DOM.login.btn.onclick = enterApp;
    DOM.login.input.onkeydown = (e) => { if (e.key === "Enter") enterApp(); };
    DOM.sidebar.logoutBtn.onclick = logoutApp;
    DOM.sidebar.menuBtn.onclick = () => DOM.sidebar.left.classList.toggle("active");

    DOM.sidebar.tabs.public.onclick = () => {
        DOM.sidebar.tabs.public.classList.add("active");
        DOM.sidebar.tabs.private.classList.remove("active");
        DOM.sidebar.panels.rooms.classList.remove("hidden");
        DOM.sidebar.panels.users.classList.add("hidden");
    };
    DOM.sidebar.tabs.private.onclick = () => {
        DOM.sidebar.tabs.private.classList.add("active");
        DOM.sidebar.tabs.public.classList.remove("active");
        DOM.sidebar.panels.rooms.classList.add("hidden");
        DOM.sidebar.panels.users.classList.remove("hidden");
    };

    DOM.chat.sendBtn.onclick = sendMessage;
    DOM.chat.input.onkeydown = (e) => {
        if (e.key === "Enter") sendMessage();
        socket.emit("chat:typing", true);
        clearTimeout(state.typingTimer);
        state.typingTimer = setTimeout(() => socket.emit("chat:typing", false), 1000);
    };

    DOM.chat.replyCancel.onclick = cancelReply;
    DOM.chat.leaveBtn.onclick = () => {
        socket.emit("room:leave");
        state.room = null;
        DOM.chat.headerName.textContent = "Select Room";
        DOM.chat.messages.innerHTML = "";
        DOM.sidebar.lists.users.innerHTML = "";
    };

    DOM.chat.attachBtn.onclick = () => DOM.chat.fileInput.click();
    DOM.chat.fileInput.onchange = (e) => {
        if (e.target.files[0]) sendImage(e.target.files[0]);
        DOM.chat.fileInput.value = "";
    };

    document.addEventListener("click", (e) => {
        if (!DOM.chat.emojiPicker.contains(e.target) &&
            e.target !== DOM.chat.emojiBtn) {
            DOM.chat.emojiPicker.classList.add("hidden");
        }
    });

    DOM.chat.emojiBtn.onclick = () => DOM.chat.emojiPicker.classList.toggle("hidden");
    DOM.chat.emojiPicker.onclick = (e) => {
        if (e.target.tagName === "SPAN") {
            DOM.chat.input.value += e.target.textContent;
            DOM.chat.input.focus();
        }
    };

    DOM.sidebar.createBtn.onclick = () => DOM.modals.create.classList.remove("hidden");
    DOM.modals.btns.createCancel.onclick = () => DOM.modals.create.classList.add("hidden");
    DOM.modals.btns.createConfirm.onclick = () => {
        const name = DOM.modals.inputs.createName.value.trim();
        const pass = DOM.modals.inputs.createPass.value.trim();
        if (!name) return;

        socket.emit("room:create", { roomName: name, password: pass }, (res) => {
            if (res.error) showToast(res.error, "error");
            else {
                DOM.modals.create.classList.add("hidden");
                DOM.modals.inputs.createName.value = "";
                joinRoom(res.roomName, pass);
            }
        });
    };
    DOM.modals.btns.joinCancel.onclick = () => DOM.modals.join.classList.add("hidden");
    DOM.modals.btns.joinConfirm.onclick = () => joinRoom(state.pendingRoom, DOM.modals.inputs.joinPass.value.trim());

    // Socket Events
    socket.on("rooms:list", renderRooms);
    socket.on("chat:message", renderMessage);

    socket.on("chat:reaction", ({ messageId, reaction }) => {
        const msgEl = document.getElementById(`msg-${messageId}`);
        if (!msgEl) return;

        let reactsContainer = msgEl.querySelector(".reactions-list");
        let badge = Array.from(reactsContainer.children).find(el => el.textContent.includes(reaction));

        if (badge) {
            const count = parseInt(badge.textContent.split(" ")[1]) || 1;
            badge.textContent = `${reaction} ${count + 1}`;
        } else {
            const b = document.createElement("span");
            b.className = "reaction-badge";
            b.textContent = `${reaction} 1`;
            reactsContainer.appendChild(b);
        }
    });

    socket.on("chat:typing", ({ username, isTyping }) => {
        DOM.chat.typing.textContent = isTyping ? `${username} is typing...` : "";
    });

    socket.on("room:user-joined", ({ username }) => showToast(`${username} joined`));
    socket.on("room:user-left", ({ username }) => showToast(`${username} left`));

    DOM.login.input.focus();
})();
