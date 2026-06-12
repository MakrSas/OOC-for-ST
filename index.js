let isOOCMode = false;
let oocGenerating = false;

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function applyOOCStyles() {
    const { chat } = SillyTavern.getContext();
    if (!chat) return;

    const chatEl = document.getElementById('chat');
    if (!chatEl) return;

    chatEl.querySelectorAll('.mes').forEach(mesEl => {
        const mesId = parseInt(mesEl.getAttribute('mesid'));
        if (isNaN(mesId) || !chat[mesId]) return;

        if (chat[mesId].extra?.isOOC) {
            mesEl.classList.add('ooc-message');
        } else {
            mesEl.classList.remove('ooc-message');
        }
    });
}

function toggleOOC() {
    if (oocGenerating) return;
    isOOCMode = !isOOCMode;
    updateUI();
}

function updateUI() {
    const btn = document.getElementById('ooc_chat_button');
    if (btn) btn.classList.toggle('ooc-active', isOOCMode);

    const form = document.getElementById('send_form');
    if (form) form.classList.toggle('ooc-mode-active', isOOCMode);

    const textarea = document.getElementById('send_textarea');
    if (!textarea) return;

    if (isOOCMode) {
        textarea.setAttribute('placeholder', 'OOC: Напишите вопрос для ИИ напрямую...');
    } else {
        const original = textarea.getAttribute('connected_text') || 'Type a message, or /? for help';
        textarea.setAttribute('placeholder', original);
    }
}

function createButton() {
    if (document.getElementById('ooc_chat_button')) return;

    const leftForm = document.getElementById('leftSendForm');
    if (!leftForm) return;

    const btn = document.createElement('div');
    btn.id = 'ooc_chat_button';
    btn.className = 'fa-solid fa-robot interactable';
    btn.title = 'OOC: Обратиться к модели напрямую (в обход персонажа)';
    btn.tabIndex = 0;
    btn.addEventListener('click', toggleOOC);

    leftForm.appendChild(btn);
}

function appendMessageToDOM(text, name, index, isUser) {
    const chatEl = document.getElementById('chat');
    if (!chatEl) return;

    const timestamp = new Date().toLocaleString();
    const html = `
        <div class="mes ${isUser ? '' : 'char_mes'} ooc-message"
             mesid="${index}" ch_name="${escapeHtml(name)}"
             is_user="${isUser}" is_system="false">
            <div class="mes_block">
                <div class="ch_name flex-container">
                    <div class="ch_name_text">${escapeHtml(name)}</div>
                    <small class="timestamp">${timestamp}</small>
                </div>
                <div class="mes_text"><p>${escapeHtml(text)}</p></div>
                <div class="ooc-mes-buttons">
                    <div class="ooc-mes-delete fa-solid fa-trash-can" title="Удалить сообщение"></div>
                </div>
            </div>
        </div>`;

    chatEl.insertAdjacentHTML('beforeend', html);
    chatEl.scrollTop = chatEl.scrollHeight;
}

function deleteOOCMessage(mesEl) {
    const ctx = SillyTavern.getContext();
    const mesId = parseInt(mesEl.getAttribute('mesid'));
    if (isNaN(mesId) || !ctx.chat[mesId]) return;

    ctx.chat.splice(mesId, 1);
    mesEl.remove();

    // Re-index remaining messages in the DOM
    const chatEl = document.getElementById('chat');
    if (chatEl) {
        chatEl.querySelectorAll('.mes').forEach((el, i) => {
            el.setAttribute('mesid', i);
        });
    }

    trySaveChat();
}

// Delegate click on delete buttons (works for dynamically added messages)
document.addEventListener('click', function (e) {
    const deleteBtn = e.target.closest('.ooc-mes-delete');
    if (!deleteBtn) return;

    const mesEl = deleteBtn.closest('.mes');
    if (mesEl) deleteOOCMessage(mesEl);
});

function showTyping() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) return;

    const div = document.createElement('div');
    div.id = 'ooc-typing';
    div.className = 'mes char_mes ooc-message';
    div.innerHTML = `
        <div class="mes_block">
            <div class="ch_name flex-container">
                <div class="ch_name_text">OOC</div>
            </div>
            <div class="mes_text"><p><em>Генерация ответа...</em></p></div>
        </div>`;
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
}

function hideTyping() {
    document.getElementById('ooc-typing')?.remove();
}

async function trySaveChat() {
    const ctx = SillyTavern.getContext();
    for (const fn of [ctx.saveChat, ctx.saveChatDebounced, window.saveChatDebounced, ctx.saveChatConditional]) {
        if (typeof fn === 'function') {
            try { await fn(); } catch {}
            return;
        }
    }
}

async function handleOOCSend() {
    const textarea = document.getElementById('send_textarea');
    if (!textarea) return;

    const userText = textarea.value.trim();
    if (!userText || oocGenerating) return;

    textarea.value = '';
    textarea.style.height = '';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    isOOCMode = false;
    oocGenerating = true;
    updateUI();

    const ctx = SillyTavern.getContext();
    const charName = ctx.characters?.[ctx.characterId]?.name || 'Character';
    const userName = ctx.name1 || 'User';

    const userMsg = {
        name: userName,
        is_user: true,
        is_system: false,
        send_date: Date.now(),
        mes: userText,
        swipe_id: 0,
        swipes: [userText],
        extra: { isOOC: true },
    };
    ctx.chat.push(userMsg);
    appendMessageToDOM(userText, userName, ctx.chat.length - 1, true);

    showTyping();

    const maxHistory = 30;
    const historySlice = ctx.chat.slice(
        Math.max(0, ctx.chat.length - 1 - maxHistory),
        ctx.chat.length - 1,
    );
    const history = historySlice.map(m => {
        const role = m.is_user ? userName : (m.extra?.isOOC && !m.is_user ? 'OOC' : charName);
        return `${role}: ${m.mes}`;
    }).join('\n\n');

    const systemPrompt = [
        'You are a helpful AI assistant.',
        `The user is in a roleplay chat with a character named "${charName}".`,
        'The user is now speaking to you directly, out of character (OOC).',
        'Use the conversation history as context if relevant.',
        `Do NOT roleplay as "${charName}". Do NOT use their persona, speech patterns, or mannerisms.`,
        'Do NOT write actions, do NOT use asterisks for actions (*like this*), do NOT continue the roleplay.',
        'Respond plainly and helpfully as an AI assistant.',
    ].join(' ');

    const prompt = history
        ? `Conversation history:\n\n${history}\n\nUser (OOC): ${userText}`
        : userText;

    try {
        let response;

        if (typeof ctx.generateRaw === 'function') {
            response = await ctx.generateRaw({ prompt, systemPrompt });
        } else if (typeof ctx.generateQuietPrompt === 'function') {
            response = await ctx.generateQuietPrompt({
                quietPrompt: `${systemPrompt}\n\nUser: ${userText}\n\nRespond as an AI assistant, NOT as "${charName}":`,
            });
        } else {
            throw new Error('Generation API not available');
        }

        hideTyping();

        const trimmed = (response || '').trim();
        if (!trimmed) throw new Error('Empty response from model');

        const oocMsg = {
            name: 'OOC',
            is_user: false,
            is_system: false,
            send_date: Date.now(),
            mes: trimmed,
            swipe_id: 0,
            swipes: [trimmed],
            extra: { isOOC: true },
        };
        ctx.chat.push(oocMsg);
        appendMessageToDOM(trimmed, 'OOC', ctx.chat.length - 1, false);

        await trySaveChat();
    } catch (err) {
        hideTyping();
        console.error('[OOC Chat] Generation failed:', err);
        if (typeof toastr !== 'undefined') {
            toastr.error(`OOC: ошибка генерации — ${err.message}`);
        }
    } finally {
        oocGenerating = false;
    }
}

function setupSendInterception() {
    const sendBut = document.getElementById('send_but');
    const textarea = document.getElementById('send_textarea');

    if (sendBut) {
        sendBut.addEventListener('click', function (e) {
            if (!isOOCMode) return;
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            handleOOCSend();
        }, true);
    }

    if (textarea) {
        textarea.addEventListener('keydown', function (e) {
            if (!isOOCMode) return;
            if (e.key !== 'Enter' || e.shiftKey) return;
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            handleOOCSend();
        }, true);
    }
}

(function init() {
    const { eventSource, event_types } = SillyTavern.getContext();

    createButton();
    setupSendInterception();

    for (const evtName of ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'CHAT_CHANGED']) {
        if (event_types[evtName]) {
            eventSource.on(event_types[evtName], () => setTimeout(applyOOCStyles, 50));
        }
    }

    eventSource.on(event_types.CHAT_CHANGED, () => {
        isOOCMode = false;
        oocGenerating = false;
        updateUI();
    });

    setTimeout(applyOOCStyles, 300);
})();

export function onDisable() {
    isOOCMode = false;
    oocGenerating = false;

    document.getElementById('ooc_chat_button')?.remove();
    document.querySelectorAll('.ooc-message').forEach(el => el.classList.remove('ooc-message'));
    document.getElementById('send_form')?.classList.remove('ooc-mode-active');
    hideTyping();

    const textarea = document.getElementById('send_textarea');
    if (textarea) {
        const original = textarea.getAttribute('connected_text') || 'Type a message, or /? for help';
        textarea.setAttribute('placeholder', original);
    }
}
