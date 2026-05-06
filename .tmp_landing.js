// static/js/landing.js - Обновленная версия с AudioController и улучшениями

document.addEventListener('alpine:init', () => {

    // Глобальное управление аудио (Singleton pattern для всех аудио на странице)
    const AudioController = {
        currentAudio: new Audio(),
        currentBtn: null,

        play(url, btnElement) {
            // Если нажат тот же самый играющий файл -> пауза
            if (this.currentBtn === btnElement && !this.currentAudio.paused) {
                this.stop();
                return;
            }

            this.stop(); // Остановить предыдущее

            this.currentBtn = btnElement;
            this.currentAudio.src = url;

            // Визуальное состояние
            if(this.currentBtn) this.currentBtn.classList.add('is-playing');

            this.currentAudio.play().catch(e => console.warn('Audio play error:', e));

            this.currentAudio.onended = () => this.stop();
            this.currentAudio.onerror = () => this.stop();

            // Уведомить другие компоненты об остановке
            window.dispatchEvent(new CustomEvent('audio:stop'));
        },

        stop() {
            if (!this.currentAudio.paused) {
                this.currentAudio.pause();
                this.currentAudio.currentTime = 0;
            }
            if (this.currentBtn) {
                this.currentBtn.classList.remove('is-playing');
                this.currentBtn = null;
            }
            // Сброс всех кнопок в DOM для надежности
            document.querySelectorAll('.is-playing').forEach(el => el.classList.remove('is-playing'));

            // Уведомить другие компоненты
            window.dispatchEvent(new CustomEvent('audio:stop'));
        }
    };

    // --- Компонент: Hero Demo Widget ---
    Alpine.data('demoWidget', () => ({
        text: '',
        selectedVoiceId: '',
        voices: [],
        loading: false,
        processing: false, // Состояние генерации
        error: '',
        audioUrl: '',
        pollingTimer: null,
        _resultAudio: null, // Для хранения Audio объекта
        isPlaying: false, // Состояние воспроизведения результата
        showPulse: false, // Pulse-анимация на кнопке play после генерации

        // API URLs (захардкожены для надёжности)
        DEMO_API: {
            synthesize: '/api/public/demo-synthesize/',
            taskStatus: '/api/public/demo-task/',
            voices: '/api/public/showcase-voices-filtered/',
            challenge: '/api/public/demo-challenge/'
        },

        // Примеры текстов загружаются из шаблона (переведённые через Django i18n)
        sampleTexts: [],
        _lastTextIndex: -1,

        async init() {
            // Загрузить переведённые тексты из шаблона
            const sampleEl = document.getElementById('js-sample-texts');
            if (sampleEl) {
                try {
                    this.sampleTexts = JSON.parse(sampleEl.textContent);
                } catch (e) {
                    console.error('Ошибка парсинга sample texts:', e);
                }
            }
            // Fallback если JSON не загрузился
            if (this.sampleTexts.length === 0) {
                this.sampleTexts = ['Hello! This is a demo of AI voice synthesis.'];
            }
            await this.loadVoices();
            this.randomizeText();
            // Слушать глобальную остановку аудио (сохраняем ссылку для очистки)
            this._audioStopHandler = () => this.stopResultAudio();
            window.addEventListener('audio:stop', this._audioStopHandler);
        },

        randomizeText() {
            if (this.sampleTexts.length <= 1) {
                this.text = this.sampleTexts[0] || '';
                return;
            }
            let idx;
            do {
                idx = Math.floor(Math.random() * this.sampleTexts.length);
            } while (idx === this._lastTextIndex);
            this._lastTextIndex = idx;
            this.text = this.sampleTexts[idx];
        },

        async loadVoices() {
            try {
                const response = await fetch(this.DEMO_API.voices);
                const data = await response.json();
                this.voices = data.voices || [];
                // Выбираем первый мужской или просто первый голос по умолчанию
                if (this.voices.length > 0) {
                    const defaultVoice = this.voices.find(v => v.locale.startsWith('ru')) || this.voices[0];
                    this.selectedVoiceId = defaultVoice.id;
                }
            } catch (error) {
                console.error('Error loading voices:', error);
            }
        },

        async synthesize() {
            if (!this.text.trim() || !this.selectedVoiceId) return;

            this.processing = true;
            this.error = '';
            this.audioUrl = '';
            AudioController.stop();

            if (this.pollingTimer) {
                clearTimeout(this.pollingTimer);
                this.pollingTimer = null;
            }

            this._warmupAudio();

            try {
                // Шаг 1: Получить PoW challenge
                const challengeResp = await fetch(this.DEMO_API.challenge);
                if (!challengeResp.ok) {
                    throw new Error('Не удалось получить задачу защиты');
                }
                const challengeData = await challengeResp.json();

                // Шаг 2: Решить PoW
                const nonce = await this._solvePoW(challengeData.challenge, challengeData.difficulty);

                // Шаг 3: Отправить запрос с PoW
                const response = await fetch(this.DEMO_API.synthesize, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: this.text,
                        voice_id: this.selectedVoiceId,
                        pow_challenge: challengeData.challenge,
                        pow_nonce: nonce
                    })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Ошибка синтеза');
                }

                if (typeof UmamiTracker !== 'undefined') {
                    UmamiTracker.demoSynthesize(this.selectedVoiceId);
                }

                if (data.audio_url) {
                    this.playResult(data.audio_url);
                    this.processing = false;
                } else {
                    this.pollTaskStatus(data.task_id, 0);
                }

            } catch (error) {
                this.error = error.message;
                this.processing = false;
            }
        },

        // Чистый JS SHA-256 (без crypto.subtle — работает на всех браузерах включая iOS WebKit)
        _sha256(str) {
            const K = [
                0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
                0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
                0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
                0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
                0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
                0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
                0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
                0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
            ];
            const rr = (v,n) => (v>>>n)|(v<<(32-n));
            const bytes = new TextEncoder().encode(str);
            const len = bytes.length;
            const bits = len * 8;
            const padded = new Uint8Array(((len + 9 + 63) & ~63));
            padded.set(bytes);
            padded[len] = 0x80;
            const dv = new DataView(padded.buffer);
            dv.setUint32(padded.length - 4, bits, false);
            let [h0,h1,h2,h3,h4,h5,h6,h7] = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
            for (let off = 0; off < padded.length; off += 64) {
                const w = new Uint32Array(64);
                for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i*4, false);
                for (let i = 16; i < 64; i++) {
                    const s0 = rr(w[i-15],7)^rr(w[i-15],18)^(w[i-15]>>>3);
                    const s1 = rr(w[i-2],17)^rr(w[i-2],19)^(w[i-2]>>>10);
                    w[i] = (w[i-16]+s0+w[i-7]+s1)|0;
                }
                let [a,b,c,d,e,f,g,h] = [h0,h1,h2,h3,h4,h5,h6,h7];
                for (let i = 0; i < 64; i++) {
                    const S1 = rr(e,6)^rr(e,11)^rr(e,25);
                    const ch = (e&f)^(~e&g);
                    const t1 = (h+S1+ch+K[i]+w[i])|0;
                    const S0 = rr(a,2)^rr(a,13)^rr(a,22);
                    const maj = (a&b)^(a&c)^(b&c);
                    const t2 = (S0+maj)|0;
                    h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
                }
                h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0;
                h4=(h4+e)|0; h5=(h5+f)|0; h6=(h6+g)|0; h7=(h7+h)|0;
            }
            return [h0,h1,h2,h3,h4,h5,h6,h7].map(v=>(v>>>0).toString(16).padStart(8,'0')).join('');
        },

        _solvePoW(challenge, difficulty) {
            const prefix = '0'.repeat(difficulty);
            let nonce = 0;
            while (nonce < 50000000) {
                if (this._sha256(challenge + nonce.toString()).startsWith(prefix)) {
                    return Promise.resolve(nonce.toString());
                }
                nonce++;
            }
            return Promise.reject(new Error('Превышено время ожидания'));
        },

        // Прогрев Audio элемента в контексте user gesture (iOS WebKit fix).
        // Вызывается синхронно при клике "Озвучить", до любых async операций.
        // Переиспользуем один элемент — это надёжнее, чем создавать new Audio() позже.
        _warmupAudio() {
            if (this._resultAudio) {
                this._resultAudio.pause();
                this._resultAudio.removeAttribute('src');
                this._resultAudio.load();
            } else {
                this._resultAudio = new Audio();
            }
            this._resultAudio.muted = true;
            const p = this._resultAudio.play();
            if (p !== undefined) p.catch(() => {});
            this._resultAudio.pause();
            this._resultAudio.muted = false;

            this._resultAudio.onended = () => { this.isPlaying = false; };
            this._resultAudio.onerror = () => { this.isPlaying = false; };
        },

        pollTaskStatus(taskId, attempt) {
            const MAX_ATTEMPTS = 30; // 30 * 2сек = 60 секунд максимум

            if (attempt >= MAX_ATTEMPTS) {
                this.error = 'Превышено время ожидания. Попробуйте позже.';
                this.processing = false;
                return;
            }

            this.pollingTimer = setTimeout(async () => {
                try {
                    const response = await fetch(`${this.DEMO_API.taskStatus}${taskId}/`);
                    const data = await response.json();

                    if (!response.ok) {
                        throw new Error(data.error || 'Ошибка получения статуса');
                    }

                    if (data.status_code === 'COMPLETED' && data.audio_url) {
                        // Успех - воспроизводим
                        this.playResult(data.audio_url);
                        this.processing = false;
                    } else if (data.status_code === 'FAILED') {
                        // Ошибка
                        this.error = data.error || 'Не удалось выполнить синтез';
                        this.processing = false;
                    } else {
                        // PENDING/LOCAL_PROCESSING - продолжаем polling
                        this.pollTaskStatus(taskId, attempt + 1);
                    }

                } catch (error) {
                    this.error = error.message;
                    this.processing = false;
                }
            }, 2000); // Polling каждые 2 секунды
        },

        playResult(audioUrl) {
            this.audioUrl = audioUrl;

            // Остановить все другие аудио через глобальный контроллер
            AudioController.stop();

            // Переиспользуем прогретый Audio элемент (iOS warm-up).
            // Если по какой-то причине _resultAudio нет — создаём новый.
            if (!this._resultAudio) {
                this._resultAudio = new Audio();
                this._resultAudio.onended = () => { this.isPlaying = false; };
                this._resultAudio.onerror = () => { this.isPlaying = false; };
            }

            // Меняем src на прогретом элементе — это надёжно работает на iOS
            this._resultAudio.src = audioUrl;
            this._resultAudio.load();

            // Не вызываем play() автоматически — на мобильных это блокируется
            // autoplay policy, т.к. мы вне user gesture (polling/async fetch).
            // Пользователь нажмёт кнопку play вручную.
            this.isPlaying = false;
            if (this._pulseTimer) clearTimeout(this._pulseTimer);
            this.showPulse = true;
            this._pulseTimer = setTimeout(() => { this.showPulse = false; }, 3000);
        },

        // Воспроизведение/пауза результата (вызывается из кнопки play в шаблоне)
        toggleResultAudio() {
            if (!this.audioUrl) return;

            // Если Audio объект потерян — пересоздаём и загружаем src
            if (!this._resultAudio) {
                this._resultAudio = new Audio(this.audioUrl);
                this._resultAudio.onended = () => { this.isPlaying = false; };
                this._resultAudio.onerror = () => { this.isPlaying = false; };
            }

            if (!this._resultAudio.paused) {
                this._resultAudio.pause();
                this._resultAudio.currentTime = 0;
                this.isPlaying = false;
            } else {
                this._resultAudio.play().then(() => {
                    this.isPlaying = true;
                    this.showPulse = false;
                }).catch(() => {
                    this.isPlaying = false;
                });
            }
        },

        stopResultAudio() {
            if (this._resultAudio) {
                if (!this._resultAudio.paused) {
                    this._resultAudio.pause();
                    this._resultAudio.currentTime = 0;
                }
                // Не уничтожаем объект — он может быть прогрет для iOS
            }
            this.isPlaying = false;
        },

        destroy() {
            // Очистка при уничтожении компонента
            if (this.pollingTimer) {
                clearTimeout(this.pollingTimer);
                this.pollingTimer = null;
            }
            if (this._pulseTimer) {
                clearTimeout(this._pulseTimer);
                this._pulseTimer = null;
            }
            if (this._audioStopHandler) {
                window.removeEventListener('audio:stop', this._audioStopHandler);
            }
            this.stopResultAudio();
            // Полная очистка Audio объекта при уничтожении компонента
            if (this._resultAudio) {
                this._resultAudio.src = '';
                this._resultAudio = null;
            }
        }
    }));

    // --- Компонент: Showcase Voices ---
    Alpine.data('voiceShowcase', () => ({
        voices: [],
        totalVoiceCount: 0,
        activeFilter: 'male',
        showAll: false,
        loading: false,
        error: '',
        currentlyPlayingId: null,
        currentAudio: new Audio(),

        async init() {
            await this.loadVoices();
            // Слушать глобальную остановку аудио (сохраняем ссылку для removeEventListener)
            this._audioStopHandler = () => this.stopAudio();
            window.addEventListener('audio:stop', this._audioStopHandler);
        },

        get filteredVoices() {
            let result;
            if (this.activeFilter === 'male') {
                result = this.voices.filter(v => v.gender === 'MALE');
            } else if (this.activeFilter === 'female') {
                result = this.voices.filter(v => v.gender === 'FEMALE');
            } else {
                result = this.voices;
            }
            // На мобильных показываем 3 карточки (+ плашка = 4 ячейки = ровная сетка 2×2)
            if (!this.showAll && window.innerWidth < 768) {
                return result.slice(0, 3);
            }
            return result;
        },

        get hasMoreVoices() {
            let all;
            if (this.activeFilter === 'male') {
                all = this.voices.filter(v => v.gender === 'MALE');
            } else if (this.activeFilter === 'female') {
                all = this.voices.filter(v => v.gender === 'FEMALE');
            } else {
                all = this.voices;
            }
            return !this.showAll && window.innerWidth < 768 && all.length > 3;
        },

        get remainingCount() {
            return this.totalVoiceCount > 0 ? this.totalVoiceCount : '100+';
        },

        async loadVoices() {
            this.loading = true;
            this.error = '';
            try {
                const response = await fetch('/api/public/showcase-voices-filtered/');
                if (!response.ok) throw new Error('Не удалось загрузить голоса');
                const data = await response.json();
                this.voices = data.voices || [];
                this.totalVoiceCount = data.total_count || 0;
            } catch (error) {
                console.error('Error:', error);
                this.error = error.message;
            } finally {
                this.loading = false;
            }
        },

        playPreview(voice, $event) {
            if (!voice.preview_audio_url) return;

            // Клик на тот же голос — стоп
            if (this.currentlyPlayingId === voice.id) {
                this.stopAudio();
                // Уведомить глобально
                window.dispatchEvent(new CustomEvent('audio:stop'));
                return;
            }

            // Остановить все другие аудио глобально
            AudioController.stop();

            // Остановить предыдущее аудио в этом компоненте
            this.stopAudio();

            // Запустить новое
            this.currentlyPlayingId = voice.id;
            this.currentAudio.src = voice.preview_audio_url;

            this.currentAudio.play().catch(e => {
                console.warn('Audio play error:', e);
                this.currentlyPlayingId = null;
            });

            // Обработчики завершения
            this.currentAudio.onended = () => {
                this.currentlyPlayingId = null;
            };

            this.currentAudio.onerror = () => {
                console.error('Audio error for voice:', voice.id);
                this.currentlyPlayingId = null;
            };
        },

        stopAudio() {
            // Очистить обработчики
            this.currentAudio.onended = null;
            this.currentAudio.onerror = null;

            if (!this.currentAudio.paused) {
                this.currentAudio.pause();
                this.currentAudio.currentTime = 0;
            }
            this.currentlyPlayingId = null;
        },

        destroy() {
            // Очистка при уничтожении компонента
            this.stopAudio();
            this.currentAudio.src = '';
            if (this._audioStopHandler) {
                window.removeEventListener('audio:stop', this._audioStopHandler);
            }
        }
    }));

    // --- Компонент: Metrics Widget ---
    Alpine.data('metricsWidget', () => ({
        totalChars: 0,
        totalUsers: 0,
        totalVoices: 0,

        async init() {
            // Читаем начальные значения из SSR
            const initialMetricsEl = document.getElementById('js-initial-metrics');
            if (initialMetricsEl) {
                try {
                    const initialData = JSON.parse(initialMetricsEl.textContent);
                    this.totalChars = initialData.totalChars || 0;
                    this.totalUsers = initialData.totalUsers || 0;
                    this.totalVoices = initialData.totalVoices || 0;
                } catch (e) {
                    console.error('Ошибка парсинга начальных метрик:', e);
                }
            }

            await this.loadMetrics();
        },

        async loadMetrics() {
            try {
                const configElement = document.getElementById('js-config');
                if (!configElement) return;
                const config = JSON.parse(configElement.textContent);

                const response = await fetch(config.metricsUrl);
                const data = await response.json();

                // Обновляем только если получили свежие данные (не fallback)
                if (!data.is_fallback) {
                    this.totalChars = data.total_chars || 0;
                    this.totalUsers = data.total_users || 0;
                    this.totalVoices = data.total_voices || 0;
                }
            } catch (error) {
                console.error('Ошибка загрузки метрик:', error);
                // При ошибке оставляем SSR-значения, не обнуляем
            }
        },

        get formattedChars() {
            return this.formatNumber(this.totalChars);
        },

        get formattedUsers() {
            return this.formatNumber(this.totalUsers);
        },

        formatNumber(num) {
            // Сокращаем большие числа для читаемости
            if (num >= 1_000_000_000) {
                return (num / 1_000_000_000).toFixed(1).replace('.', ',') + ' млрд';
            }
            if (num >= 1_000_000) {
                return (num / 1_000_000).toFixed(1).replace('.', ',') + ' млн';
            }
            if (num >= 1_000) {
                return (num / 1_000).toFixed(1).replace('.', ',') + ' тыс';
            }
            return num.toString();
        }
    }));

    // --- Компонент: Calculator ---
    Alpine.data('savingsCalculator', () => ({
        charsPerMonth: 500000,
        get humanCost() { return Math.round((this.charsPerMonth / 1000) * 0.10); },
        get elevenlabsCost() {
             if (this.charsPerMonth <= 100000) return 22;
             if (this.charsPerMonth <= 500000) return 99;
             return Math.round((this.charsPerMonth / 1000) * 0.09);
        },
        get savings() { return Math.max(0, this.elevenlabsCost - 40); },
        formatNumber(num) { return new Intl.NumberFormat('ru-RU').format(num); }
    }));
});

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    // js-config больше не обязателен - URLs захардкожены в компонентах
    const configElement = document.getElementById('js-config');
    if (configElement) {
        // Конфиг есть, но компоненты используют захардкоженные URLs для надёжности
        console.log('js-config loaded (fallback)');
    } else {
        console.warn('js-config not found - using hardcoded URLs');
    }

    // Загружаем переводы (если есть)
    const translationsEl = document.getElementById('js-translations');
    const TR = translationsEl ? JSON.parse(translationsEl.textContent) : {};

    // Новый лендинг не использует fade-in-section анимации и sticky header логику
    // Все стилизовано через Tailwind с фиксированным header
});
