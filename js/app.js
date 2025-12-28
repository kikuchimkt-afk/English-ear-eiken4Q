
// State Management
const STATE = {
    screen: 'title', // title, game, result
    currentQuestionIndex: 0, // プレイリスト内のパッセージ番号
    subQuestionIndex: 0, // 1パッセージ中の問題番号 (0-2)
    currentPassageTargets: [], // 現在のパッセージの出題対象3つ
    currentQuestion: null, // { passage, target }
    isAnswered: false,
    isReading: false,
    paused: false,
    history: [], // { target, selected, isCorrect }
    playlist: [], // パッセージのリスト (1ゲーム2つ)
    speechRate: 0.8,
    sessionGold: 0, // 今回獲得したゴールド
    totalGold: parseInt(localStorage.getItem('english_ear_total_gold')) || 0,
    isTutorialOpen: !localStorage.getItem('english_ear_tutorial_done'), // 初回はtrue
    googleApiKey: localStorage.getItem('english_ear_google_api_key') || '',
    isSettingsOpen: false
};

// Rank System
const RANKS = [
    { threshold: 0, title: "Beginner", icon: "🌱", color: "text-slate-400" },
    { threshold: 500, title: "Bronze Ear", icon: "🥉", color: "text-orange-400" },
    { threshold: 2000, title: "Silver Ear", icon: "🥈", color: "text-slate-200" },
    { threshold: 5000, title: "Gold Ear", icon: "🥇", color: "text-yellow-400" },
    { threshold: 10000, title: "Platinum Ear", icon: "💎", color: "text-cyan-400" },
    { threshold: 20000, title: "Legendary", icon: "👑", color: "text-purple-400" }
];

function getCurrentRank() {
    for (let i = RANKS.length - 1; i >= 0; i--) {
        if (STATE.totalGold >= RANKS[i].threshold) return RANKS[i];
    }
    return RANKS[0];
}

function saveGold() {
    localStorage.setItem('english_ear_total_gold', STATE.totalGold);
}

// DOM Elements
const app = document.getElementById('app');

// Audio Context (for SFX)
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playTone(freq, type, duration) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.stop(audioCtx.currentTime + duration);
}

function playCorrectSound() {
    playTone(660, 'sine', 0.1);
    setTimeout(() => playTone(880, 'sine', 0.2), 100);
}

function playWrongSound() {
    playTone(150, 'sawtooth', 0.3);
}

// Text-to-Speech
async function fetchGoogleTTS(text, rate) {
    if (!STATE.googleApiKey) return null;

    // レートの調整: Google APIは 0.25 〜 4.0。Web Speech APIの 0.5~1.2 と合わせる
    // Web Speechのrate=1.0はGoogleの1.0とだいたい同じだが、微調整が必要かも。そのまま渡す。

    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${STATE.googleApiKey}`;
    const body = {
        input: { text: text },
        voice: { languageCode: "en-US", name: "en-US-Neural2-F" }, // 日本人にも聞き取りやすいクリアな女性の声
        audioConfig: { audioEncoding: "MP3", speakingRate: rate }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        if (data.error) {
            console.error("Google TTS Error:", data.error);
            return null; // エラー時はフォールバック
        }
        return data.audioContent;
    } catch (e) {
        console.error("Fetch Error:", e);
        return null;
    }
}

function speakOne(item, onEnd) {
    // APIキーがあればGoogle TTSを試みる
    if (STATE.googleApiKey) {
        fetchGoogleTTS(item.text, item.rate)
            .then(audioContent => {
                if (audioContent) {
                    const audio = new Audio("data:audio/mp3;base64," + audioContent);

                    // 正常終了時
                    audio.onended = onEnd;

                    // ロードエラー時
                    audio.onerror = (e) => {
                        console.error("Audio Load Error:", e);
                        fallbackSpeak(item, onEnd);
                    };

                    // 再生試行
                    const playPromise = audio.play();
                    if (playPromise !== undefined) {
                        playPromise.catch(e => {
                            console.error("Audio Playback Error:", e);
                            // 自動再生ブロックなどで再生できない場合はWeb Speech APIにフォールバック
                            fallbackSpeak(item, onEnd);
                        });
                    }
                } else {
                    // API失敗時はフォールバック
                    fallbackSpeak(item, onEnd);
                }
            })
            .catch(e => {
                console.error("Critical Error in speakOne async:", e);
                fallbackSpeak(item, onEnd);
            });
    } else {
        fallbackSpeak(item, onEnd);
    }
}

function fallbackSpeak(item, onEnd) {
    if (!window.speechSynthesis) {
        onEnd();
        return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(item.text);
    u.lang = 'en-US';
    u.rate = item.rate;
    u.onend = onEnd;
    window.speechSynthesis.speak(u);
}

function updateSpeechRate(val) {
    STATE.speechRate = parseFloat(val);
    document.getElementById('rate-label').innerText = `Speed: ${STATE.speechRate.toFixed(1)}x`;
}

// Game Logic
// Game Logic
async function initGame() {
    try {
        if (!window.PASSAGES || window.PASSAGES.length === 0) {
            alert("Error: Vocabulary data not loaded. Please reload the page.");
            return;
        }

        // StartボタンをLoading表示
        const startBtn = document.querySelector('button[onclick="initGame()"]');
        if (startBtn) {
            startBtn.innerHTML = '<i data-lucide="loader" class="w-8 h-8 animate-spin"></i> Loading...';
            lucide.createIcons();
        }

        // UI更新待ち
        await new Promise(r => setTimeout(r, 100));

        STATE.sessionGold = 0;
        STATE.currentQuestionIndex = 0;
        STATE.history = [];
        STATE.isAnswered = false;
        STATE.paused = false;

        // シャッフルして2問だけ選ぶ（1ゲーム2パッセージ = 6問）
        const pool = window.PASSAGES;
        const shuffled = [...pool].sort(() => 0.5 - Math.random());
        STATE.playlist = shuffled.slice(0, 2);

        loadPassage();
    } catch (e) {
        console.error("Game Init Error:", e);
        alert("Game start failed: " + e.message);
        showTitleScreen();
    }
}

function goToTitle() {
    window.speechSynthesis.cancel();
    STATE.isTutorialOpen = false;
    STATE.isSettingsOpen = false;
    showTitleScreen();
}

function toggleTutorial() {
    STATE.isTutorialOpen = !STATE.isTutorialOpen;
    if (STATE.isTutorialOpen) STATE.isSettingsOpen = false; // 排他制御
    if (!STATE.isTutorialOpen && !localStorage.getItem('english_ear_tutorial_done')) {
        localStorage.setItem('english_ear_tutorial_done', 'true');
    }
    showTitleScreen();
}

function toggleSettings() {
    STATE.isSettingsOpen = !STATE.isSettingsOpen;
    if (STATE.isSettingsOpen) STATE.isTutorialOpen = false; // 排他制御
    showTitleScreen();
}

function saveSettings() {
    const input = document.getElementById('apiKeyInput');
    if (input) {
        const key = input.value.trim();
        STATE.googleApiKey = key;
        localStorage.setItem('english_ear_google_api_key', key);
    }
    toggleSettings();
}

function togglePause() {
    STATE.paused = !STATE.paused;
    if (STATE.paused) {
        window.speechSynthesis.cancel();
        renderGameContent();
    } else {
        renderGameContent();
        playPassageSequence(STATE.currentQuestion.passage, STATE.currentQuestion.target);
    }
}

function loadPassage() {
    if (STATE.currentQuestionIndex >= STATE.playlist.length) {
        finishGame();
        return;
    }

    const passage = STATE.playlist[STATE.currentQuestionIndex];
    // 3つの異なる文をターゲットとして選ぶ
    const shuffled = [...passage.sentences].sort(() => 0.5 - Math.random());
    STATE.currentPassageTargets = shuffled.slice(0, 3);
    STATE.subQuestionIndex = 0;

    nextQuestion();
}

function nextQuestion() {
    if (STATE.subQuestionIndex >= 3) {
        STATE.currentQuestionIndex++;
        loadPassage();
        return;
    }

    const passage = STATE.playlist[STATE.currentQuestionIndex];
    const target = STATE.currentPassageTargets[STATE.subQuestionIndex];

    STATE.currentQuestion = {
        passage: passage,
        target: target
    };
    STATE.isAnswered = false;
    STATE.isReading = true;

    showGameScreen();
    playPassageSequence(passage, target);
}

function playPassageSequence(passage, target) {
    if (STATE.paused) return;
    window.speechSynthesis.cancel();

    let sequence = [];

    // 全文読み上げは各パッセージの最初の問題のみ
    if (STATE.subQuestionIndex === 0) {
        passage.sentences.forEach(s => {
            sequence.push({ text: s.text, rate: STATE.speechRate });
        });
    }

    sequence.push({ text: `Question Number ${STATE.subQuestionIndex + 1}.`, rate: 1.0, delay: 1000 });
    sequence.push({ text: target.text, rate: STATE.speechRate, delay: 500, isTarget: true });

    speakRecursive(sequence, 0);
}

function speakRecursive(sequence, index) {
    if (STATE.paused) return;
    if (index >= sequence.length) {
        STATE.isReading = false;
        renderGameContent();
        return;
    }
    const item = sequence[index];
    const nextStep = () => speakRecursive(sequence, index + 1);

    if (item.delay) {
        setTimeout(() => { if (!STATE.paused) speakOne(item, nextStep); }, item.delay);
    } else {
        speakOne(item, nextStep);
    }
}

function handleAnswer(sentenceId) {
    if (STATE.isAnswered || STATE.isReading || STATE.paused) return;

    STATE.isAnswered = true;
    const correct = STATE.currentQuestion.target.id === sentenceId;

    if (correct) {
        playCorrectSound();
        STATE.sessionGold += 100; // 1問正解で100G
    } else {
        playWrongSound();
    }

    STATE.history.push({
        target: STATE.currentQuestion.target,
        selectedId: sentenceId,
        isCorrect: correct
    });

    renderGameContent();

    setTimeout(() => {
        STATE.subQuestionIndex++;
        nextQuestion();
    }, 2500);
}

function replayVoice() {
    if (STATE.isReading || STATE.paused) return;
    const u = new SpeechSynthesisUtterance(STATE.currentQuestion.target.text);
    u.lang = 'en-US';
    u.rate = STATE.speechRate;
    window.speechSynthesis.speak(u);
}

function finishGame() {
    STATE.totalGold += STATE.sessionGold;
    saveGold();
    showResult();
}

// Rendering
function render() {
    lucide.createIcons();
}

function showTitleScreen() {
    STATE.screen = 'title';
    const rank = getCurrentRank();

    app.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full p-8 bg-gradient-to-br from-indigo-900 to-slate-900 text-white text-center relative overflow-hidden">
            <!-- Rank Background -->
            <div class="absolute top-10 right-0 left-0 text-center opacity-10 pointer-events-none">
                <i data-lucide="crown" class="w-64 h-64 mx-auto text-white"></i>
            </div>

            <!-- Settings Button -->
            <button onclick="toggleSettings()" class="absolute top-4 left-4 p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors z-20">
                <i data-lucide="settings" class="w-6 h-6 text-slate-300"></i>
            </button>

            <!-- Help Button -->
            <button onclick="toggleTutorial()" class="absolute top-4 right-4 p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors z-20">
                <i data-lucide="help-circle" class="w-6 h-6 text-slate-300"></i>
            </button>

            <div class="mb-6 p-6 bg-white/10 rounded-full animate-bounce z-10">
                <i data-lucide="headphones" class="w-16 h-16 text-cyan-400"></i>
            </div>
            <h1 class="text-4xl font-black mb-2 tracking-tight z-10 drop-shadow-lg">英検4級<br>Basic Listening</h1>
            <p class="text-slate-400 mb-8 text-lg z-10">Hearing & Reading Quest</p>
            
            <!-- API Status Badge -->
            ${STATE.googleApiKey ? `
                <div class="mb-4 z-10 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
                    <i data-lucide="check-circle" class="w-3 h-3"></i> Google Cloud Voice Active
                </div>
            ` : ''}
            
            <!-- Rank Card -->
            <div class="w-full max-w-xs bg-slate-800/80 backdrop-blur border border-slate-600 rounded-2xl p-4 mb-8 z-10 shadow-xl">
                 <div class="text-xs text-slate-400 font-bold uppercase tracking-widest mb-1">Current Rank</div>
                 <div class="flex items-center justify-center gap-2 mb-2">
                    <span class="text-3xl">${rank.icon}</span>
                    <span class="text-2xl font-bold ${rank.color}">${rank.title}</span>
                 </div>
                 <div class="flex items-center justify-center gap-2 bg-slate-900/50 rounded-lg py-2">
                    <i data-lucide="coins" class="w-5 h-5 text-yellow-400"></i>
                    <span class="text-xl font-mono text-yellow-400 font-bold">${STATE.totalGold.toLocaleString()} G</span>
                 </div>
            </div>

            <button onclick="initGame()" class="w-full max-w-xs bg-cyan-500 hover:bg-cyan-400 text-white font-bold py-4 rounded-xl shadow-lg shadow-cyan-500/30 transition-all active:scale-95 flex items-center justify-center gap-3 z-10 text-xl">
                <i data-lucide="play" class="w-8 h-8"></i>
                Start Mission
            </button>
            <p class="mt-4 text-xs text-slate-500">2 Passages • 6 Questions</p>

            <!-- Settings Modal -->
            ${STATE.isSettingsOpen ? `
            <div class="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                <div class="bg-slate-800 border border-slate-600 rounded-3xl p-6 w-full max-w-sm shadow-2xl relative overflow-hidden">
                    <div class="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-purple-500 to-pink-500"></div>
                    
                    <h2 class="text-xl font-bold mb-4 flex items-center gap-2 text-white">
                        <i data-lucide="settings" class="w-5 h-5 text-purple-400"></i>
                        Voice Settings
                    </h2>

                    <div class="mb-6">
                        <label class="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Google Cloud API Key</label>
                        <input type="text" id="apiKeyInput" value="${STATE.googleApiKey}" placeholder="Paste API Key here..." 
                            class="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-purple-500 transition-colors font-mono">
                        <div class="text-[10px] text-slate-400 mt-3 bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                            <div class="font-bold text-slate-300 mb-1">APIキーの入手手順:</div>
                            <ol class="list-decimal list-inside space-y-1 ml-1 text-slate-500">
                                <li>
                                    <a href="https://aistudio.google.com/app/api-keys" target="_blank" class="text-purple-400 hover:text-purple-300 underline inline-flex items-center gap-1 font-bold">
                                        Google AI Studio <i data-lucide="external-link" class="w-3 h-3"></i>
                                    </a>
                                    へアクセス
                                </li>
                                <li>「Create API key」をクリック</li>
                                <li>作成されたキーをコピーしてここに入力</li>
                            </ol>
                            <div class="mt-2 pt-2 border-t border-slate-700/50 text-[10px] text-emerald-400/80 flex items-center gap-1">
                                <i data-lucide="check-circle-2" class="w-3 h-3"></i>
                                <span>高品質な音声読み上げが有効になります</span>
                            </div>
                        </div>
                    </div>

                    <div class="flex gap-3">
                        <button onclick="toggleSettings()" class="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold py-3 rounded-xl transition-colors">
                            Cancel
                        </button>
                        <button onclick="saveSettings()" class="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-purple-600/20">
                            Save
                        </button>
                    </div>
                </div>
            </div>
            ` : ''}

            <!-- Tutorial Modal -->
            ${STATE.isTutorialOpen ? `
            <div class="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                <div class="bg-slate-800 border border-slate-600 rounded-3xl p-6 w-full max-w-sm shadow-2xl relative overflow-hidden">
                    <div class="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-cyan-400 to-emerald-400"></div>
                    
                    <h2 class="text-2xl font-black mb-6 flex items-center justify-center gap-2">
                        <i data-lucide="info" class="w-6 h-6 text-cyan-400"></i>
                        How to Play
                    </h2>

                    <div class="space-y-6 text-left relative z-10">
                        <div class="flex items-start gap-4">
                            <div class="bg-slate-700 p-3 rounded-xl shrink-0">
                                <i data-lucide="ear" class="w-6 h-6 text-emerald-400"></i>
                            </div>
                            <div>
                                <h3 class="font-bold text-white mb-1">Listen</h3>
                                <p class="text-sm text-slate-400 leading-relaxed">英文が読み上げられます。<br>集中して聞き取りましょう。</p>
                            </div>
                        </div>

                        <div class="flex items-start gap-4">
                            <div class="bg-slate-700 p-3 rounded-xl shrink-0">
                                <i data-lucide="mouse-pointer-2" class="w-6 h-6 text-cyan-400"></i>
                            </div>
                            <div>
                                <h3 class="font-bold text-white mb-1">Choose</h3>
                                <p class="text-sm text-slate-400 leading-relaxed">3つの文が表示されます。<br>読み上げられた文をタップ！</p>
                            </div>
                        </div>

                        <div class="flex items-start gap-4">
                            <div class="bg-slate-700 p-3 rounded-xl shrink-0">
                                <i data-lucide="trophy" class="w-6 h-6 text-yellow-400"></i>
                            </div>
                            <div>
                                <h3 class="font-bold text-white mb-1">Rank Up</h3>
                                <p class="text-sm text-slate-400 leading-relaxed">ゴールドを貯めて、<br>ランクアップを目指そう！</p>
                            </div>
                        </div>
                    </div>

                    <button onclick="toggleTutorial()" class="w-full mt-8 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-xl transition-colors border border-slate-600">
                        Got it!
                    </button>
                    
                    <!-- Decorative Circle -->
                    <div class="absolute -bottom-10 -right-10 w-40 h-40 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none"></div>
                </div>
            </div>
            ` : ''}
        </div>
    `;
    render();
}

function showGameScreen() {
    STATE.screen = 'game';
    renderGameContent();
}

function renderGameContent() {
    const q = STATE.currentQuestion;
    // 全6問中の現在の進捗
    const currentGlobalIndex = (STATE.currentQuestionIndex * 3) + STATE.subQuestionIndex;
    const totalQuestions = 6;
    const progress = Math.round((currentGlobalIndex / totalQuestions) * 100);

    // パッセージ構築
    const sentencesHtml = q.passage.sentences.map((sent) => {
        let spanClass = "inline px-1 rounded cursor-pointer transition-colors duration-200 box-decoration-clone leading-loose text-lg";

        if (STATE.isAnswered) {
            if (sent.id === q.target.id) {
                spanClass += " bg-emerald-600/60 text-emerald-100 font-bold ring-2 ring-emerald-500";
            } else if (sent.id !== q.target.id && STATE.history[STATE.history.length - 1].selectedId === sent.id) {
                spanClass += " bg-red-900/50 text-red-300 line-through opacity-70";
            } else {
                spanClass += " text-slate-600 opacity-40";
            }
        } else {
            spanClass += " hover:bg-slate-700 hover:text-slate-100 text-slate-300 border-b border-transparent hover:border-slate-500";
        }

        return `<span onclick="handleAnswer('${sent.id}')" class="${spanClass}">${sent.text}</span>`;
    }).join(' ');

    app.innerHTML = `
        <div class="flex flex-col h-full bg-slate-900 relative">
             ${STATE.paused ? `
            <div class="absolute inset-0 z-50 bg-black/90 flex flex-col items-center justify-center backdrop-blur-sm animate-fade-in">
                <div class="text-4xl font-black text-white mb-8 tracking-widest">PAUSED</div>
                <button onclick="togglePause()" class="w-24 h-24 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg hover:scale-105 transition-transform mb-8">
                    <i data-lucide="play" class="w-12 h-12 text-white fill-white ml-2"></i>
                </button>
                <button onclick="goToTitle()" class="px-8 py-3 border-2 border-slate-600 text-slate-400 rounded-full hover:bg-slate-800 hover:text-white transition-colors font-bold">
                    Exit Mission
                </button>
            </div>
            ` : ''}

            <!-- Header -->
            <div class="p-4 bg-slate-800 shadow-lg z-10 flex items-center justify-between gap-3">
                <button onclick="goToTitle()" class="p-2 bg-slate-700 rounded-full hover:bg-slate-600 text-slate-300 transition-colors">
                    <i data-lucide="home" class="w-5 h-5"></i>
                </button>

                <div class="flex-1">
                    <div class="flex justify-between items-center mb-1 px-1">
                        <span class="text-emerald-400 font-bold text-xs uppercase tracking-wider">Mission Progress</span>
                        <div class="flex items-center gap-1">
                            <i data-lucide="coins" class="w-3 h-3 text-yellow-400"></i>
                            <span class="text-yellow-400 text-xs font-mono font-bold">${STATE.sessionGold}G</span>
                        </div>
                    </div>
                    <div class="w-full bg-slate-700 h-2 rounded-full overflow-hidden">
                        <div class="bg-emerald-500 h-full transition-all duration-300 relative" style="width: ${progress}%">
                            <div class="absolute right-0 top-0 bottom-0 w-1 bg-white/50 animate-pulse"></div>
                        </div>
                    </div>
                </div>
                
                <button onclick="togglePause()" class="p-2 bg-slate-700 rounded-full hover:bg-slate-600 text-slate-300 transition-colors">
                    <i data-lucide="pause" class="w-5 h-5"></i>
                </button>
            </div>

            <!-- Listening Area -->
            <div class="p-6 bg-gradient-to-b from-slate-800 to-slate-900 flex flex-col items-center border-b border-slate-700 shadow-md">
                <button onclick="replayVoice()" class="relative group mb-3 outline-none">
                    <div class="absolute inset-0 bg-emerald-500 rounded-full blur opacity-20 group-hover:opacity-40 transition-opacity animate-pulse"></div>
                    <div class="relative w-20 h-20 bg-slate-700/80 border-4 border-slate-600 rounded-full flex items-center justify-center shadow-xl group-active:scale-95 transition-transform backdrop-blur-sm">
                        <i data-lucide="volume-2" class="w-10 h-10 text-emerald-300"></i>
                    </div>
                </button>
                
                <!-- Speed Control -->
                <div class="flex items-center gap-2 bg-slate-800/80 px-3 py-1 rounded-full border border-slate-700 mb-2">
                    <input type="range" min="0.5" max="1.2" step="0.1" value="${STATE.speechRate}" 
                        oninput="updateSpeechRate(this.value)" 
                        class="w-20 h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-emerald-500">
                    <span id="rate-label" class="text-[10px] font-mono text-emerald-400 w-12 text-right">${STATE.speechRate.toFixed(1)}x</span>
                </div>

                ${STATE.isAnswered ? `
                    <div class="w-full text-center animate-fade-in-up">
                         <div class="bg-emerald-900/40 border border-emerald-500/30 text-emerald-100 px-4 py-2 rounded-xl text-sm inline-block shadow-sm">
                            ${q.target.jp}
                        </div>
                    </div>
                ` : `
                    <div class="h-9 flex items-center justify-center">
                        <span class="text-slate-500/50 text-[10px] uppercase tracking-[0.2em] font-bold animate-pulse">Listening...</span>
                    </div>
                `}
            </div>

            <!-- Reading Area -->
            <div class="flex-1 p-6 md:p-8 bg-slate-900 overflow-y-auto flex items-center justify-center">
                <div class="bg-slate-800/40 p-6 md:p-10 rounded-3xl border border-slate-700/50 shadow-inner w-full max-w-lg relative">
                    <div class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-slate-600/50 to-transparent"></div>
                    <h3 class="text-slate-500 text-xs font-black mb-6 uppercase tracking-widest text-center flex items-center justify-center gap-2">
                        <i data-lucide="book" class="w-3 h-3"></i>
                        ${q.passage.title}
                    </h3>
                    <div class="text-slate-200 text-left font-medium leading-[2.5rem] select-none text-lg">
                        ${sentencesHtml}
                    </div>
                </div>
            </div>
            
            <!-- Bottom Status -->
            <div class="bg-slate-900 text-center py-2 text-slate-600 text-[10px] font-mono">
                PASSAGE ${STATE.currentQuestionIndex + 1} / 2 • Q ${STATE.subQuestionIndex + 1} / 3
            </div>
        </div>
    `;
    render();
}

function showResult() {
    STATE.screen = 'result';
    const rank = getCurrentRank();
    const rankUp = STATE.totalGold >= rank.threshold && (STATE.totalGold - STATE.sessionGold) < rank.threshold;

    app.innerHTML = `
        <div class="flex flex-col h-full bg-slate-900 items-center justify-center p-8 text-center relative overflow-hidden">
             <!-- Celebration Particles (Static css needed but lets just use lucide) -->
             <div class="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
                <i data-lucide="sparkles" class="w-full h-full text-yellow-500 animate-spin-slow"></i>
             </div>

            <h2 class="text-4xl font-black text-white mb-2 drop-shadow-lg tracking-tight">MISSION CLEAR</h2>
            <div class="text-slate-400 mb-8 uppercase tracking-widest text-sm">Report</div>

            <div class="bg-slate-800/80 backdrop-blur rounded-3xl p-8 mb-8 border border-slate-700 shadow-2xl w-full max-w-sm">
                <div class="flex justify-between items-center mb-6 pb-6 border-b border-slate-700 border-dashed">
                    <span class="text-slate-400 font-bold uppercase text-xs">Gold Earned</span>
                    <div class="flex items-center gap-2 text-yellow-400">
                        <i data-lucide="plus" class="w-5 h-5"></i>
                        <span class="text-4xl font-sans font-black">${STATE.sessionGold}</span>
                    </div>
                </div>
                
                <div class="flex justify-between items-center">
                    <span class="text-slate-400 font-bold uppercase text-xs">Total Wealth</span>
                    <div class="flex items-center gap-2 text-slate-200">
                        <i data-lucide="coins" class="w-4 h-4 text-yellow-500"></i>
                        <span class="text-xl font-mono font-bold">${STATE.totalGold.toLocaleString()}</span>
                    </div>
                </div>
            </div>

            ${rankUp ? `
                <div class="mb-8 animate-bounce">
                    <div class="text-sm text-yellow-400 font-bold uppercase mb-1">Rank Up!</div>
                    <div class="text-2xl font-black text-white px-6 py-2 bg-gradient-to-r from-yellow-600 to-orange-500 rounded-full shadow-lg border border-yellow-300">
                        ${rank.icon} ${rank.title}
                    </div>
                </div>
            ` : ''}

            <button onclick="goToTitle()" class="w-full max-w-xs bg-emerald-500 hover:bg-emerald-400 text-white font-bold py-4 rounded-xl shadow-lg shadow-emerald-500/20 transition-all active:scale-95 flex items-center justify-center gap-2">
                <i data-lucide="rotate-ccw" class="w-5 h-5"></i>
                Return to Title
            </button>
        </div>
    `;
    render();
}

// Start App
showTitleScreen();