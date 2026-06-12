let isOOCMode = false;
let pendingOOCResponse = false;

function setMessageOOC(index) {
    const { chat } = SillyTavern.getContext();
    const msg = chat[index];
    if (!msg) return;
    if (!msg.extra) msg.extra = {};
    msg.extra.isOOC = true;
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

// Generate interceptor — injected into the prompt right before the API call
globalThis.oocChatInterceptor = async function (chat) {
    if (!isOOCMode) return;

    const ctx = SillyTavern.getContext();
    const charName = ctx.characters?.[ctx.characterId]?.name || 'the character';

    // Mark the last user message as OOC
    setMessageOOC(ctx.chat.length - 1);

    pendingOOCResponse = true;
    isOOCMode = false;
    updateUI();

    // Only works for Chat Completion format (array of {role, content} objects)
    if (chat.length > 0 && typeof chat[0] === 'object' && 'role' in chat[0]) {
        // Strip ALL system messages (character persona, preset, jailbreak, author's note, etc.)
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i].role === 'system') {
                chat.splice(i, 1);
            }
        }

        // Insert a single clean OOC system prompt at the start
        chat.unshift({
            role: 'system',
            content: [
                'You are a helpful AI assistant. The user is speaking to you directly, out of character (OOC).',
                `The conversation history below is from a roleplay with a character named "${charName}".`,
                'Use the conversation as context if relevant, but do NOT continue the roleplay.',
                `Do NOT write as "${charName}", do NOT use their persona, speech patterns, or mannerisms.`,
                'Do NOT write actions, roleplay elements, or use asterisks for actions.',
                'Simply answer the user\'s question directly and helpfully as an AI assistant.',
            ].join(' '),
        });
    }
};

// Extension initialization
(function init() {
    const { eventSource, event_types } = SillyTavern.getContext();

    createButton();

    // Mark AI response as OOC when generation completes
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        if (!pendingOOCResponse) return;

        const { chat } = SillyTavern.getContext();
        if (chat.length > 0) {
            setMessageOOC(chat.length - 1);
        }
        pendingOOCResponse = false;
    });

    // Safety reset if generation ends without MESSAGE_RECEIVED (e.g. error/abort)
    if (event_types.GENERATION_ENDED) {
        eventSource.on(event_types.GENERATION_ENDED, () => {
            pendingOOCResponse = false;
        });
    }

    // Apply visual styles when messages render
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
        setTimeout(applyOOCStyles, 50);
    });

    if (event_types.USER_MESSAGE_RENDERED) {
        eventSource.on(event_types.USER_MESSAGE_RENDERED, () => {
            setTimeout(applyOOCStyles, 50);
        });
    }

    // Re-apply styles and reset mode on chat switch
    eventSource.on(event_types.CHAT_CHANGED, () => {
        isOOCMode = false;
        pendingOOCResponse = false;
        updateUI();
        setTimeout(applyOOCStyles, 150);
    });

    setTimeout(applyOOCStyles, 300);
})();

// Cleanup when extension is disabled via ST UI
export function onDisable() {
    isOOCMode = false;
    pendingOOCResponse = false;

    const btn = document.getElementById('ooc_chat_button');
    if (btn) btn.remove();

    document.querySelectorAll('.ooc-message').forEach(el => el.classList.remove('ooc-message'));
    document.getElementById('send_form')?.classList.remove('ooc-mode-active');

    const textarea = document.getElementById('send_textarea');
    if (textarea) {
        const original = textarea.getAttribute('connected_text') || 'Type a message, or /? for help';
        textarea.setAttribute('placeholder', original);
    }
}
