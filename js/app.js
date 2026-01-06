
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
    isSettingsOpen: false,
    statusMessage: '', // 音声再生状況のデバッグ表示用
    audioContext: null // Web Audio API用コンテキスト
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


function updateStatus(msg) {
    STATE.statusMessage = msg;
    const el = document.getElementById('status-monitor');
    if (el) el.innerHTML = msg; // リンクを表示可能にするためHTMLとして設定
}

// --- Free TTS Utility (Youdao Dictionary) ---
// Guide provided by user: Use https://dict.youdao.com/dictvoice?audio=[text]&type=2
function speakOne(item, onEnd) {
    updateStatus("Requesting Audio (Youdao)...");

    // 1. Create Youdao URL (type=2 is American English)
    const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(item.text)}&type=2`;

    // 2. Create Audio Object
    const audio = new Audio(url);
    STATE.currentAudioSource = audio;
    audio.playbackRate = item.rate;

    // 3. Setup Listeners
    audio.onended = () => {
        updateStatus("Finished (Youdao)");
        onEnd();
    };

    audio.onerror = (e) => {
        console.warn("Youdao Audio Error:", e);
        updateStatus("Audio Error. Fallback.");
        fallbackSpeak(item, onEnd);
    };

    // 4. Attempt Playback
    const playPromise = audio.play();
    if (playPromise !== undefined) {
        playPromise
            .then(() => updateStatus("Playing (Youdao)"))
            .catch(error => {
                console.warn("Youdao Playback Failed:", error);
                updateStatus("Playback Failed. Fallback.");
                fallbackSpeak(item, onEnd);
            });
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

function changeSpeed(delta) {
    let newRate = STATE.speechRate + delta;
    if (newRate < 0.5) newRate = 0.5;
    if (newRate > 2.5) newRate = 2.5; // Allow wider range
    STATE.speechRate = Math.round(newRate * 10) / 10;

    // UI Update
    const label = document.getElementById('rate-label');
    if (label) label.innerText = `${STATE.speechRate.toFixed(1)}x`;

    // Real-time Audio Update
    if (STATE.currentAudioSource) {
        try {
            // AudioContext SourceNode
            if (STATE.currentAudioSource.playbackRate && STATE.currentAudioSource.playbackRate.setValueAtTime) {
                STATE.currentAudioSource.playbackRate.setValueAtTime(STATE.speechRate, STATE.audioContext.currentTime);
            }
            // HTMLAudioElement
            else if (typeof STATE.currentAudioSource.playbackRate === 'number' || typeof STATE.currentAudioSource.playbackRate === 'object') {
                STATE.currentAudioSource.playbackRate = STATE.speechRate;
            }
        } catch (e) { console.error("Speed update error:", e); }
    }
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

        // AudioContextの初期化と再開 (Mobile対応)
        if (!STATE.audioContext) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            STATE.audioContext = new AudioContext();
        }
        if (STATE.audioContext.state === 'suspended') {
            await STATE.audioContext.resume();
            console.log("AudioContext Resumed");
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
    showTitleScreen();
}

function toggleTutorial() {
    STATE.isTutorialOpen = !STATE.isTutorialOpen;
    // if (STATE.isTutorialOpen) STATE.isSettingsOpen = false; // logic removed
    if (!STATE.isTutorialOpen && !localStorage.getItem('english_ear_tutorial_done')) {
        localStorage.setItem('english_ear_tutorial_done', 'true');
    }
    showTitleScreen();
}

// Settings functions removed (toggleSettings, saveSettings)

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
        // パッセージ + 質問をまとめて1回のリクエストにする (安定化のため)
        // Question Numberの前に無音区間を作るためにピリオド等を多めに入れる
        const fullPassageText = passage.sentences.map(s => s.text).join(' ');
        const questionText = `Question Number ${STATE.subQuestionIndex + 1}. ... ${target.text}`;

        // 結合して1つの音声としてリクエスト
        sequence.push({
            text: `${fullPassageText} ...... ${questionText}`,
            rate: STATE.speechRate
        });
    } else {
        // 2問目以降は質問のみ (これも一回で)
        const qText = `Question Number ${STATE.subQuestionIndex + 1}. ... ${target.text}`;
        sequence.push({ text: qText, rate: STATE.speechRate });
    }

    // 古い定義を削除
    // sequence.push({ text: `Question Number ${STATE.subQuestionIndex + 1}.`, rate: 1.0, delay: 1000 });
    // sequence.push({ text: target.text, rate: STATE.speechRate, delay: 500, isTarget: true });

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

    // Use speakOne to leverage Gemini TTS if available
    STATE.isReading = true;
    speakOne({
        text: STATE.currentQuestion.target.text,
        rate: STATE.speechRate
    }, () => {
        STATE.isReading = false;
        // On replay finish, we don't need to do anything specific other than unlocking reading state
        renderGameContent();
    });
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

            <!-- Help Button -->
            <button onclick="toggleTutorial()" class="absolute top-4 right-4 p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors z-20">
                <i data-lucide="help-circle" class="w-6 h-6 text-slate-300"></i>
            </button>

            <div class="mb-6 p-6 bg-white/10 rounded-full animate-bounce z-10">
                <i data-lucide="headphones" class="w-16 h-16 text-cyan-400"></i>
            </div>
            <h1 class="text-4xl font-black mb-2 tracking-tight z-10 drop-shadow-lg">英検4級<br>Basic Listening</h1>
            <p class="text-slate-400 mb-8 text-lg z-10">Hearing & Reading Quest</p>
            
            <!-- Rank Card -->
            <div class="w-full max-w-xs bg-slate-800/80 backdrop-blur border border-slate-600 rounded-2xl p-4 mb-4 z-10 shadow-xl">
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

            <!-- Initial Speed Setting -->
            <div class="w-full max-w-xs mb-8 z-10">
                 <div class="flex items-center justify-between bg-slate-800/80 px-4 py-2 rounded-xl border border-slate-600 shadow-lg backdrop-blur-sm">
                    <span class="text-xs text-slate-400 font-bold uppercase tracking-widest">Rate</span>
                    <div class="flex items-center gap-4">
                        <button onclick="changeSpeed(-0.1)" class="p-1 text-slate-400 hover:text-white rounded-full hover:bg-slate-700 transition-colors active:scale-90">
                             <i data-lucide="minus" class="w-4 h-4"></i>
                        </button>
                        <div id="rate-label" class="text-base font-black font-mono text-emerald-400 w-12 text-center tabular-nums">
                            ${STATE.speechRate.toFixed(1)}x
                        </div>
                        <button onclick="changeSpeed(0.1)" class="p-1 text-slate-400 hover:text-white rounded-full hover:bg-slate-700 transition-colors active:scale-90">
                             <i data-lucide="plus" class="w-4 h-4"></i>
                        </button>
                    </div>
                 </div>
            </div>

            <button onclick="initGame()" class="w-full max-w-xs bg-cyan-500 hover:bg-cyan-400 text-white font-bold py-4 rounded-xl shadow-lg shadow-cyan-500/30 transition-all active:scale-95 flex items-center justify-center gap-3 z-10 text-xl">
                <i data-lucide="play" class="w-8 h-8"></i>
                Start Mission
            </button>
            <p class="mt-4 text-xs text-slate-500">2 Passages • 6 Questions</p>

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
                
                <!-- Speed Control (Buttons) -->
                <div class="flex items-center gap-2 bg-slate-800/80 px-4 py-2 rounded-full border border-slate-700 mb-2 shadow-lg">
                    <button onclick="changeSpeed(-0.1)" class="p-1 text-slate-400 hover:text-white rounded-full hover:bg-slate-700 transition-colors active:scale-90">
                        <i data-lucide="minus" class="w-5 h-5"></i>
                    </button>
                    <div id="rate-label" class="text-sm font-black font-mono text-emerald-400 w-16 text-center tabular-nums">
                        ${STATE.speechRate.toFixed(1)}x
                    </div>
                    <button onclick="changeSpeed(0.1)" class="p-1 text-slate-400 hover:text-white rounded-full hover:bg-slate-700 transition-colors active:scale-90">
                        <i data-lucide="plus" class="w-5 h-5"></i>
                    </button>
                </div>

                ${STATE.isAnswered ? `
                    <div class="w-full text-center animate-fade-in-up">
                         <div class="bg-emerald-900/40 border border-emerald-500/30 text-emerald-100 px-4 py-2 rounded-xl text-sm inline-block shadow-sm">
                            ${q.target.jp}
                        </div>
                    </div>
                ` : `
                    <div class="h-12 flex flex-col items-center justify-center">
                        <span class="text-slate-500/50 text-[10px] uppercase tracking-[0.2em] font-bold animate-pulse">Listening...</span>
                        
                        <!-- Status Monitor for Debugging -->
                        <div id="status-monitor" class="mt-2 text-[10px] font-mono text-cyan-400/80 min-h-[1rem] max-w-full px-4 text-center leading-tight">
                            ${STATE.statusMessage || 'Ready'}
                        </div>
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