(() => {
    'use strict';

    const API_BASE_URL = 'https://gppls-daily-api.innovativehype.xyz';
    const STORAGE_KEY = 'gppls-daily';
    // Browser-renderable cover formats, best first. Anything else (e.g. .heic) gets generated art.
    const IMAGE_RANK = { jpg: 5, jpeg: 5, webp: 4, avif: 4, png: 3, gif: 2 };
    const UP_NEXT_COUNT = 12;
    const SONGS_URL = 'songs.json';
    const PLAYLISTS_URL = 'playlists.json';

    const $ = (id) => document.getElementById(id);
    const els = {
        hero: $('hero'),
        heroArt: $('heroArt'),
        heroSub: $('heroSub'),
        playAll: $('playAllButton'),
        shuffleAll: $('shuffleAllButton'),
        homeView: $('homeView'),
        playlists: $('playlists'),
        playlistShelf: $('playlistShelf'),
        playlistView: $('playlistView'),
        plArt: $('plArt'),
        plType: $('plType'),
        plTitle: $('plTitle'),
        plSub: $('plSub'),
        plDesc: $('plDesc'),
        plPlay: $('plPlay'),
        plShuffle: $('plShuffle'),
        plTracks: $('plTracks'),
        plSoundcloud: $('plSoundcloud'),
        backButton: $('backButton'),
        topbarSpacer: $('topbarSpacer'),
        npContext: $('npContext'),
        library: $('library'),
        count: $('libraryCount'),
        searchToggle: $('searchToggle'),
        searchRow: $('searchRow'),
        searchInput: $('searchInput'),
        mini: $('mini'),
        miniOpen: $('miniOpen'),
        miniArt: $('miniArt'),
        miniTitle: $('miniTitle'),
        miniSub: $('miniSub'),
        miniProgress: $('miniProgress'),
        np: $('np'),
        npBg: $('npBg'),
        npArt: $('npArt'),
        npTitle: $('npTitle'),
        npSub: $('npSub'),
        npClose: $('npClose'),
        npShare: $('npShare'),
        seek: $('seek'),
        currentTime: $('currentTime'),
        duration: $('duration'),
        repeat: $('repeatButton'),
        shuffle: $('shuffleButton'),
        mute: $('muteButton'),
        volume: $('volume'),
        upNext: $('upNext'),
        upNextSection: $('upNextSection'),
        npSoundcloud: $('npSoundcloud'),
        toast: $('toast'),
    };

    // ---------- Preferences (per-browser) ----------

    const prefs = (() => {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
    })();

    function savePrefs(patch) {
        Object.assign(prefs, patch);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
    }

    // ---------- State ----------

    const state = {
        tracks: [],          // every day we know about, newest first
        playlists: [],       // SoundCloud sets/albums made only of gppls daily songs
        context: null,       // playlist being played from, or null for all days
        openPlaylist: null,  // playlist shown in the playlist view
        byDay: new Map(),
        queue: [],           // days in play order
        index: -1,           // position in queue
        current: null,       // track object
        loadedDay: null,     // day currently loaded into the <audio> element
        pendingSeek: 0,
        shuffle: !!prefs.shuffle,
        repeat: ['off', 'all', 'one'].includes(prefs.repeat) ? prefs.repeat : 'off',
        sort: prefs.sort === 'oldest' ? 'oldest' : 'newest',
        view: prefs.view === 'list' ? 'list' : 'grid',
        plSort: ['newest', 'oldest'].includes(prefs.plSort) ? prefs.plSort : 'default',
        plView: prefs.plView === 'grid' ? 'grid' : 'list',
        seeking: false,
        errorStreak: 0,
    };

    const brokenImages = new Set();

    const audio = new Audio();
    audio.preload = 'metadata';
    audio.volume = typeof prefs.volume === 'number' ? prefs.volume : 1;

    // ---------- Helpers ----------

    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function formatTime(t) {
        if (!Number.isFinite(t) || t < 0) return '0:00';
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    function shuffled(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    let toastTimer;
    function toast(message) {
        els.toast.textContent = message;
        els.toast.classList.add('is-visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 2400);
    }

    function track(event, params) {
        if (typeof window.gtag === 'function') window.gtag('event', event, params);
    }

    function subtitle(t) {
        return [`Day ${t.day}`, t.producer && `prod. ${t.producer}`].filter(Boolean).join(' · ');
    }

    function artHtml(t, extra = '') {
        const img = t.image && !brokenImages.has(t.image)
            ? `<img src="${esc(t.image)}" alt="" loading="lazy" decoding="async">`
            : '';
        return `<span class="art" style="--hue:${(t.day * 47) % 360}"><span class="art-num" aria-hidden="true">${t.day}</span>${img}${extra}</span>`;
    }

    const EQ = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>';
    const HOVER_PLAY = '<span class="hover-play" aria-hidden="true"><svg><use href="#i-play"/></svg></span>';

    // Cover images fade in when loaded, and fall back to generated art if they fail.
    document.addEventListener('load', (e) => {
        if (e.target.tagName === 'IMG' && e.target.parentElement?.classList.contains('art')) {
            e.target.classList.add('loaded');
        }
    }, true);

    document.addEventListener('error', (e) => {
        if (e.target.tagName === 'IMG' && e.target.parentElement?.classList.contains('art')) {
            const src = e.target.getAttribute('src');
            if (!brokenImages.has(src)) console.warn('Cover art failed to load:', src);
            brokenImages.add(src);
            e.target.remove();
            if (state.current && state.current.image === src) els.npBg.style.backgroundImage = 'none';
        }
    }, true);

    // ---------- Data ----------

    async function getJson(path) {
        const res = await fetch(`${API_BASE_URL}${path}`);
        if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
        return res.json();
    }

    function buildLibrary(imageFiles, audioFiles, songs) {
        const byDay = new Map();
        const get = (day) => {
            if (!byDay.has(day)) {
                byDay.set(day, {
                    day, title: `gppls daily ${day}`, name: '', producer: null, date: null, soundcloud: null,
                    hasMeta: false, image: null, imageRank: 0, audio: null, audioExt: null,
                });
            }
            return byDay.get(day);
        };

        for (const song of songs) {
            if (!Number.isInteger(song.day)) continue;
            Object.assign(get(song.day), {
                title: song.title || `gppls daily ${song.day}`,
                name: song.name || '',
                producer: song.producer || null,
                date: song.date || null,
                soundcloud: song.soundcloud || null,
                hasMeta: true,
            });
        }

        for (const file of imageFiles) {
            const m = /^(\d+)\.([a-z0-9]+)$/i.exec(file);
            if (!m) continue;
            const rank = IMAGE_RANK[m[2].toLowerCase()];
            if (!rank) continue;
            const t = get(parseInt(m[1], 10));
            if (rank > t.imageRank) {
                t.image = `${API_BASE_URL}/images/${encodeURIComponent(file)}`;
                t.imageRank = rank;
            }
        }

        for (const file of audioFiles) {
            const m = /gppls daily (\d+).*\.(mp3|wav)$/i.exec(file);
            if (!m) continue;
            const t = get(parseInt(m[1], 10));
            const ext = m[2].toLowerCase();
            // Prefer mp3 over wav: far smaller, so it starts faster.
            if (!t.audio || (ext === 'mp3' && t.audioExt !== 'mp3')) {
                t.audio = `${API_BASE_URL}/audio/${encodeURIComponent(file)}`;
                t.audioExt = ext;
                if (!t.hasMeta) t.title = file.replace(/\.(mp3|wav)$/i, '');
            }
        }

        return [...byDay.values()].sort((a, b) => b.day - a.day);
    }

    async function loadLibrary() {
        renderSkeleton();
        const [images, songs, meta] = await Promise.allSettled([
            getJson('/image-files'),
            getJson('/audio-files'),
            fetch(SONGS_URL).then((res) => (res.ok ? res.json() : [])),
        ]);
        const playlistsRequest = fetch(PLAYLISTS_URL).then((res) => (res.ok ? res.json() : [])).catch(() => []);

        if (images.status === 'rejected') console.error('Could not load image list:', images.reason);
        if (songs.status === 'rejected') console.error('Could not load song list:', songs.reason);
        if (meta.status === 'rejected') console.warn('Could not load song titles:', meta.reason);

        if (songs.status === 'rejected' && images.status === 'rejected') {
            renderError();
            return;
        }

        state.tracks = buildLibrary(
            images.status === 'fulfilled' ? images.value : [],
            songs.status === 'fulfilled' ? songs.value : [],
            meta.status === 'fulfilled' && Array.isArray(meta.value) ? meta.value : [],
        );
        state.byDay = new Map(state.tracks.map((t) => [t.day, t]));

        if (!state.tracks.length) {
            renderError('No songs yet', 'Check back tomorrow.');
            return;
        }

        state.playlists = normalizePlaylists(await playlistsRequest);

        renderHero();
        renderPlaylists();
        renderLibrary();
        restoreSession();
        route();
    }

    function normalizePlaylists(list) {
        if (!Array.isArray(list)) return [];
        return list
            .map((p) => ({ ...p, days: (p.days || []).filter((d) => state.byDay.has(d)) }))
            .filter((p) => p.id && p.title && p.days.length);
    }

    // ---------- Rendering ----------

    function renderSkeleton() {
        els.library.innerHTML = Array.from({ length: 12 }, () => `
            <div class="card skeleton" aria-hidden="true">
                <span class="art shimmer"></span>
                <span class="bar shimmer"></span><span class="bar shimmer"></span>
            </div>`).join('');
    }

    function renderError(title = "Couldn't reach the gppls daily server", detail = 'It might be napping. Try again in a moment.') {
        els.hero.classList.remove('is-loading');
        els.heroSub.textContent = '';
        els.count.textContent = '';
        els.library.innerHTML = `
            <div class="error">
                <strong>${esc(title)}</strong>${esc(detail)}<br>
                <button class="pill" id="retryButton">Try again</button>
            </div>`;
        $('retryButton').addEventListener('click', loadLibrary);
    }

    function playableTracks() {
        return state.tracks.filter((t) => t.audio);
    }

    function renderHero() {
        const latest = state.tracks.find((t) => t.audio) || state.tracks[0];
        const playable = playableTracks().length;
        els.hero.classList.remove('is-loading');
        els.heroArt.innerHTML = artHtml(latest);
        els.heroSub.textContent = `gppls · ${playable} ${playable === 1 ? 'song' : 'songs'}`;
        els.playAll.disabled = els.shuffleAll.disabled = playable === 0;
    }

    // ---------- Playlists ----------

    function coverHtml(p) {
        // Releases without their own artwork use the g.ppls DAILY artboard
        const src = p.artwork || 'icons/icon-512.png';
        return `<span class="cover"><img src="${esc(src)}" alt="" loading="lazy" decoding="async"></span>`;
    }

    function playlistMeta(p) {
        const n = p.days.length;
        return `${p.type === 'album' ? 'Album' : 'Playlist'} · ${n} ${n === 1 ? 'song' : 'songs'}`;
    }

    function renderPlaylists() {
        els.playlists.hidden = state.playlists.length === 0;
        els.playlistShelf.innerHTML = state.playlists.map((p) => `
            <button class="pl-card" data-playlist="${esc(p.id)}">
                ${coverHtml(p)}
                <span class="card-text">
                    <span class="card-title">${esc(p.title)}</span>
                    <span class="card-sub">${esc(playlistMeta(p))}</span>
                </span>
            </button>`).join('');
    }

    function playlistFromHash() {
        const m = /^#playlist-(.+)$/.exec(location.hash);
        return m ? state.playlists.find((p) => p.id === decodeURIComponent(m[1])) : null;
    }

    function route() {
        const p = playlistFromHash();
        state.openPlaylist = p || null;
        els.homeView.hidden = !!p;
        els.playlistView.hidden = !p;
        els.backButton.hidden = !p;
        els.topbarSpacer.hidden = !!p;
        if (!p) {
            if (typeof history.state?.scrollY === 'number') window.scrollTo(0, history.state.scrollY);
            return;
        }
        els.plArt.innerHTML = coverHtml(p);
        els.plType.textContent = p.type === 'album' ? 'Album' : 'Playlist';
        els.plTitle.textContent = p.title;
        const year = /^\d{4}/.exec(p.released || '')?.[0];
        els.plSub.textContent = ['gppls', `${p.days.length} ${p.days.length === 1 ? 'song' : 'songs'}`, year].filter(Boolean).join(' · ');
        els.plDesc.hidden = !p.description;
        els.plDesc.textContent = p.description || '';
        els.plSoundcloud.hidden = !p.url;
        if (p.url) els.plSoundcloud.href = p.url;
        renderPlaylistTracks(p);
        const canPlay = p.days.some((d) => state.byDay.get(d).audio);
        els.plPlay.disabled = els.plShuffle.disabled = !canPlay;
        markCurrent();
        window.scrollTo(0, 0);
    }

    function orderedPlaylistDays(p) {
        if (state.plSort === 'newest') return p.days.slice().sort((a, b) => b - a);
        if (state.plSort === 'oldest') return p.days.slice().sort((a, b) => a - b);
        return p.days;
    }

    function renderPlaylistTracks(p) {
        els.plTracks.className = `library ${state.plView}`;
        els.plTracks.innerHTML = orderedPlaylistDays(p).map((d) => cardHtml(state.byDay.get(d))).join('');
        document.querySelectorAll('[data-plsort]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.plsort === state.plSort)));
        document.querySelectorAll('[data-plview]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.plview === state.plView)));
        markCurrent();
    }

    function openPlaylist(id) {
        location.hash = `#playlist-${encodeURIComponent(id)}`;
        history.replaceState({ fromHome: true }, '');
    }

    function goHome() {
        if (history.state?.fromHome) history.back();
        else location.hash = '';
    }

    function playPlaylist(p, { shuffle = false } = {}) {
        setShuffle(shuffle, { silent: true });
        state.context = p;
        const pool = orderedPlaylistDays(p).filter((d) => state.byDay.get(d).audio);
        if (!pool.length) return;
        playDay(shuffle ? pool[Math.floor(Math.random() * pool.length)] : pool[0], { context: p });
    }

    function orderedTracks() {
        return state.sort === 'oldest' ? state.tracks.slice().reverse() : state.tracks;
    }

    function cardHtml(t) {
        return `
            <button class="card${t.audio ? '' : ' is-unavailable'}" data-day="${t.day}"${t.audio || t.soundcloud ? '' : ' aria-disabled="true"'}>
                ${artHtml(t, EQ + HOVER_PLAY)}
                <span class="card-text">
                    <span class="card-title">${esc(t.title)}</span>
                    <span class="card-sub">${esc(subtitle(t))}${t.audio ? '' : t.soundcloud ? ' · on SoundCloud' : ' · coming soon'}</span>
                </span>
            </button>`;
    }

    function renderLibrary() {
        els.library.className = `library ${state.view}`;
        els.library.innerHTML = orderedTracks().map(cardHtml).join('') + '<p class="empty" id="noMatches" hidden></p>';

        document.querySelectorAll('[data-sort]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sort === state.sort)));
        document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
        applyFilter();
        markCurrent();
    }

    function applyFilter() {
        const q = els.searchInput.value.trim().toLowerCase();
        let shown = 0;
        els.library.querySelectorAll('.card').forEach((card) => {
            const t = state.byDay.get(Number(card.dataset.day));
            const haystack = `${t.title} ${t.name} ${t.producer || ''}`.toLowerCase();
            const match = !q || String(t.day) === q || haystack.includes(q);
            card.hidden = !match;
            if (match) shown++;
        });
        const noMatches = $('noMatches');
        noMatches.hidden = shown > 0;
        noMatches.textContent = `No days match “${q}”.`;
        els.count.textContent = q
            ? `${shown} of ${state.tracks.length} days`
            : `${state.tracks.length} days`;
    }

    function markCurrent() {
        const day = state.current?.day;
        document.querySelectorAll('.card[data-day]').forEach((card) => {
            const isCurrent = Number(card.dataset.day) === day;
            card.classList.toggle('is-current', isCurrent);
            if (isCurrent) card.setAttribute('aria-current', 'true'); else card.removeAttribute('aria-current');
        });
    }

    function renderNowPlaying() {
        const t = state.current;
        if (!t) return;
        document.body.classList.add('has-player');
        els.mini.hidden = false;
        els.miniArt.innerHTML = artHtml(t);
        els.miniTitle.textContent = t.title;
        els.miniSub.textContent = subtitle(t);
        els.npArt.innerHTML = artHtml(t);
        els.npTitle.textContent = t.title;
        els.npContext.textContent = state.context ? state.context.title : 'gppls daily';
        els.npSub.textContent = [subtitle(t), t.date].filter(Boolean).join(' · ');
        els.npSoundcloud.hidden = !t.soundcloud;
        if (t.soundcloud) els.npSoundcloud.href = t.soundcloud;
        els.npBg.style.backgroundImage = t.image && !brokenImages.has(t.image) ? `url("${t.image}")` : 'none';
        document.title = `${t.title} · gppls daily`;
        markCurrent();
        renderUpNext();
        renderModes();
    }

    function renderUpNext() {
        const days = upcomingDays();
        els.upNextSection.hidden = days.length === 0;
        els.upNext.innerHTML = days.map((day) => {
            const t = state.byDay.get(day);
            return `<li><button class="row" data-queue-day="${day}">
                ${artHtml(t)}
                <span class="card-text"><span class="card-title">${esc(t.title)}</span><span class="card-sub">${esc(subtitle(t))}</span></span>
            </button></li>`;
        }).join('');
    }

    function upcomingDays() {
        if (state.index < 0) return [];
        const after = state.queue.slice(state.index + 1, state.index + 1 + UP_NEXT_COUNT);
        if (state.repeat === 'all' && after.length < UP_NEXT_COUNT) {
            after.push(...state.queue.slice(0, Math.min(state.index, UP_NEXT_COUNT - after.length)));
        }
        return after;
    }

    function renderModes() {
        els.shuffle.classList.toggle('is-on', state.shuffle);
        els.shuffle.setAttribute('aria-pressed', String(state.shuffle));
        els.repeat.classList.toggle('is-on', state.repeat !== 'off');
        els.repeat.setAttribute('aria-label', `Repeat: ${state.repeat === 'one' ? 'this song' : state.repeat}`);
        els.repeat.querySelector('use').setAttribute('href', state.repeat === 'one' ? '#i-repeat-one' : '#i-repeat');
    }

    function renderPlayState() {
        const playing = !audio.paused;
        document.body.classList.toggle('is-playing', playing);
        document.querySelectorAll('.play-btn').forEach((btn) => {
            btn.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
            btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        });
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }

    function setBuffering(on) {
        document.querySelectorAll('.play-btn').forEach((btn) => btn.classList.toggle('is-buffering', on));
    }

    function renderProgress() {
        const d = audio.duration;
        const t = state.seeking ? (els.seek.value / 1000) * d : audio.currentTime;
        const ratio = Number.isFinite(d) && d > 0 ? t / d : 0;
        els.miniProgress.style.transform = `scaleX(${ratio})`;
        if (!state.seeking) els.seek.value = Math.round(ratio * 1000);
        els.seek.style.setProperty('--p', `${ratio * 100}%`);
        els.currentTime.textContent = formatTime(t);
        els.duration.textContent = formatTime(d);
    }

    // ---------- Playback ----------

    function contextDays() {
        if (state.context) return orderedPlaylistDays(state.context).filter((d) => state.byDay.get(d).audio);
        return (state.sort === 'oldest' ? playableTracks().reverse() : playableTracks()).map((t) => t.day);
    }

    function buildQueue(startDay) {
        const days = contextDays();
        if (state.shuffle) {
            const rest = shuffled(days.filter((d) => d !== startDay));
            state.queue = startDay != null ? [startDay, ...rest] : rest;
            state.index = 0;
        } else {
            state.queue = days;
            state.index = Math.max(0, days.indexOf(startDay));
        }
    }

    // Select a track without loading audio (used when restoring a session).
    function cue(t, startAt = 0) {
        state.current = t;
        state.pendingSeek = startAt;
        if (!state.queue.includes(t.day)) buildQueue(t.day);
        state.index = state.queue.indexOf(t.day);
        renderNowPlaying();
        renderProgress();
        updateMediaSession();
    }

    function playDay(day, { keepQueue = false, startAt = 0, context } = {}) {
        const t = state.byDay.get(day);
        if (!t || !t.audio) {
            if (t?.soundcloud) window.open(t.soundcloud, '_blank', 'noopener');
            else toast('That day doesn’t have audio yet');
            return;
        }
        if (context !== undefined && context !== state.context) {
            state.context = context;
            keepQueue = false;
        }
        if (!keepQueue || !state.queue.includes(day)) buildQueue(day);
        state.index = state.queue.indexOf(day);
        state.current = t;
        state.pendingSeek = startAt;
        loadAndPlay();
        renderNowPlaying();
        updateMediaSession();
        savePrefs({ lastDay: day, lastTime: startAt });
        track('play_song', { day, playlist: state.context?.id });
    }

    function loadAndPlay() {
        const t = state.current;
        if (state.loadedDay !== t.day) {
            audio.src = t.audio;
            state.loadedDay = t.day;
            setBuffering(true);
        }
        audio.play().catch((err) => {
            if (err.name === 'NotAllowedError') {
                // Autoplay blocked; the user just needs to tap play.
                setBuffering(false);
                renderPlayState();
            } else if (err.name !== 'AbortError') {
                console.error('Playback failed:', err);
            }
        });
    }

    function togglePlay() {
        if (!state.current) {
            playAll();
        } else if (audio.paused) {
            if (state.loadedDay !== state.current.day) {
                loadAndPlay();
                track('play_song', { day: state.current.day });
            } else {
                audio.play();
            }
        } else {
            audio.pause();
        }
    }

    function next({ auto = false } = {}) {
        if (!state.queue.length) return;
        if (auto && state.repeat === 'one') {
            audio.currentTime = 0;
            audio.play();
            return;
        }
        let i = state.index + 1;
        if (i >= state.queue.length) {
            if (auto && state.repeat === 'off') {
                audio.pause();
                audio.currentTime = 0;
                return;
            }
            i = 0;
        }
        playDay(state.queue[i], { keepQueue: true });
    }

    function prev() {
        if (!state.queue.length) return;
        if (audio.currentTime > 3 || state.index <= 0 && state.repeat !== 'all') {
            audio.currentTime = 0;
            if (audio.paused) togglePlay();
            return;
        }
        const i = state.index - 1 < 0 ? state.queue.length - 1 : state.index - 1;
        playDay(state.queue[i], { keepQueue: true });
    }

    function playAll() {
        setShuffle(false, { silent: true });
        state.context = null;
        const first = state.sort === 'oldest' ? playableTracks().at(-1) : playableTracks()[0];
        if (first) playDay(first.day);
    }

    function shuffleAll() {
        setShuffle(true, { silent: true });
        state.context = null;
        const pool = playableTracks();
        if (!pool.length) return;
        playDay(pool[Math.floor(Math.random() * pool.length)].day);
    }

    function setShuffle(on, { silent = false } = {}) {
        state.shuffle = on;
        savePrefs({ shuffle: on });
        if (state.current) {
            buildQueue(state.current.day);
            state.index = state.queue.indexOf(state.current.day);
            renderUpNext();
        }
        renderModes();
        if (!silent) toast(on ? 'Shuffle on' : 'Shuffle off');
    }

    function cycleRepeat() {
        state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat];
        savePrefs({ repeat: state.repeat });
        renderModes();
        renderUpNext();
        toast({ off: 'Repeat off', all: 'Repeating all songs', one: 'Repeating this song' }[state.repeat]);
    }

    function seekBy(seconds) {
        if (!Number.isFinite(audio.duration)) return;
        audio.currentTime = Math.min(Math.max(0, audio.currentTime + seconds), audio.duration);
    }

    function updateMediaSession() {
        if (!('mediaSession' in navigator) || !state.current) return;
        const t = state.current;
        navigator.mediaSession.metadata = new MediaMetadata({
            title: t.title,
            artist: 'gppls',
            album: `gppls daily ${t.day}`,
            // Lock screen falls back to the gppls daily artboard when a day has no cover
            artwork: [{ src: t.image && !brokenImages.has(t.image) ? t.image : new URL('icons/icon-512.png', location.href).href, sizes: '512x512' }],
        });
    }

    if ('mediaSession' in navigator) {
        const handlers = {
            play: () => togglePlay(),
            pause: () => audio.pause(),
            previoustrack: () => prev(),
            nexttrack: () => next(),
            seekbackward: () => seekBy(-10),
            seekforward: () => seekBy(10),
            seekto: (d) => { audio.currentTime = d.seekTime; },
        };
        for (const [action, fn] of Object.entries(handlers)) {
            try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported action */ }
        }
    }

    // ---------- Audio events ----------

    audio.addEventListener('loadedmetadata', () => {
        if (state.pendingSeek && state.pendingSeek < audio.duration - 1) audio.currentTime = state.pendingSeek;
        state.pendingSeek = 0;
        renderProgress();
    });
    audio.addEventListener('play', renderPlayState);
    audio.addEventListener('pause', () => {
        renderPlayState();
        if (state.current) savePrefs({ lastDay: state.current.day, lastTime: audio.currentTime });
    });
    audio.addEventListener('waiting', () => setBuffering(true));
    audio.addEventListener('playing', () => {
        setBuffering(false);
        state.errorStreak = 0;
    });
    audio.addEventListener('canplay', () => setBuffering(false));

    let lastSaved = 0;
    audio.addEventListener('timeupdate', () => {
        renderProgress();
        if (state.current && Math.abs(audio.currentTime - lastSaved) > 5) {
            lastSaved = audio.currentTime;
            savePrefs({ lastDay: state.current.day, lastTime: audio.currentTime });
        }
    });
    audio.addEventListener('durationchange', renderProgress);
    audio.addEventListener('ended', () => next({ auto: true }));
    audio.addEventListener('error', () => {
        setBuffering(false);
        if (!state.current) return;
        state.errorStreak++;
        console.error('Audio failed to load:', audio.currentSrc || audio.src);
        if (state.errorStreak >= 3) {
            toast('Having trouble reaching the server. Try again in a bit.');
            state.errorStreak = 0;
            return;
        }
        toast(`Couldn’t load day ${state.current.day}, skipping`);
        setTimeout(() => next({ auto: true }), 800);
    });

    // ---------- Now playing sheet ----------

    let lastFocus = null;
    function openNowPlaying() {
        if (!state.current) return;
        lastFocus = document.activeElement;
        els.np.hidden = false;
        document.body.classList.add('np-open');
        requestAnimationFrame(() => requestAnimationFrame(() => els.np.classList.add('is-open')));
        els.npClose.focus({ preventScroll: true });
    }

    function closeNowPlaying() {
        els.np.classList.remove('is-open');
        document.body.classList.remove('np-open');
        setTimeout(() => { if (!els.np.classList.contains('is-open')) els.np.hidden = true; }, 420);
        lastFocus?.focus?.({ preventScroll: true });
    }

    async function share() {
        const t = state.current;
        if (!t) return;
        const url = `${location.origin}${location.pathname}#day-${t.day}`;
        try {
            if (navigator.share) {
                await navigator.share({ title: t.title, text: `${t.title} by gppls`, url });
            } else {
                await navigator.clipboard.writeText(url);
                toast('Link copied');
            }
            track('share_song', { day: t.day });
        } catch { /* share sheet dismissed */ }
    }

    // ---------- Session restore & deep links ----------

    function dayFromHash() {
        const m = /^#day-(\d+)$/.exec(location.hash);
        return m ? parseInt(m[1], 10) : null;
    }

    function restoreSession() {
        const linked = state.byDay.get(dayFromHash());
        if (linked?.audio) {
            cue(linked);
            const card = els.library.querySelector(`.card[data-day="${linked.day}"]`);
            card?.scrollIntoView({ block: 'center' });
            return;
        }
        const last = state.byDay.get(prefs.lastDay);
        if (last?.audio) cue(last, prefs.lastTime || 0);
    }

    // ---------- Wiring ----------

    els.playAll.addEventListener('click', playAll);
    els.shuffleAll.addEventListener('click', shuffleAll);
    els.plPlay.addEventListener('click', () => state.openPlaylist && playPlaylist(state.openPlaylist));
    els.plShuffle.addEventListener('click', () => state.openPlaylist && playPlaylist(state.openPlaylist, { shuffle: true }));
    els.backButton.addEventListener('click', goHome);

    document.querySelectorAll('[data-plsort]').forEach((btn) => btn.addEventListener('click', () => {
        if (state.plSort === btn.dataset.plsort || !state.openPlaylist) return;
        state.plSort = btn.dataset.plsort;
        savePrefs({ plSort: state.plSort });
        renderPlaylistTracks(state.openPlaylist);
        // Keep playing the current song; what comes next follows the new order
        if (state.context === state.openPlaylist && state.current && !state.shuffle) {
            buildQueue(state.current.day);
            renderUpNext();
        }
    }));

    document.querySelectorAll('[data-plview]').forEach((btn) => btn.addEventListener('click', () => {
        if (state.plView === btn.dataset.plview || !state.openPlaylist) return;
        state.plView = btn.dataset.plview;
        savePrefs({ plView: state.plView });
        renderPlaylistTracks(state.openPlaylist);
    }));

    document.addEventListener('click', (e) => {
        const playlistCard = e.target.closest('[data-playlist]');
        if (playlistCard) {
            history.replaceState({ ...history.state, scrollY: window.scrollY }, '');
            openPlaylist(playlistCard.dataset.playlist);
            return;
        }
        const card = e.target.closest('.card[data-day]');
        if (card && !card.classList.contains('skeleton')) {
            const day = Number(card.dataset.day);
            const context = card.closest('#playlistView') ? state.openPlaylist : null;
            if (state.current?.day === day && state.context === context) togglePlay();
            else playDay(day, { context });
            return;
        }
        const queued = e.target.closest('[data-queue-day]');
        if (queued) {
            playDay(Number(queued.dataset.queueDay), { keepQueue: true });
            return;
        }
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'toggle') togglePlay();
        else if (action === 'next') next();
        else if (action === 'prev') prev();
    });

    document.querySelectorAll('[data-sort]').forEach((btn) => btn.addEventListener('click', () => {
        if (state.sort === btn.dataset.sort) return;
        state.sort = btn.dataset.sort;
        savePrefs({ sort: state.sort });
        renderLibrary();
    }));

    document.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', () => {
        if (state.view === btn.dataset.view) return;
        state.view = btn.dataset.view;
        savePrefs({ view: state.view });
        els.library.className = `library ${state.view}`;
        document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    }));

    els.searchToggle.addEventListener('click', () => {
        const open = els.searchRow.hidden;
        if (open && state.openPlaylist) goHome();
        els.searchRow.hidden = !open;
        els.searchToggle.setAttribute('aria-expanded', String(open));
        if (open) {
            els.searchInput.focus();
        } else {
            els.searchInput.value = '';
            if (state.tracks.length) applyFilter();
        }
    });
    els.searchInput.addEventListener('input', () => { if (state.tracks.length) applyFilter(); });

    els.miniOpen.addEventListener('click', openNowPlaying);
    els.npClose.addEventListener('click', closeNowPlaying);
    els.npShare.addEventListener('click', share);
    els.shuffle.addEventListener('click', () => setShuffle(!state.shuffle));
    els.repeat.addEventListener('click', cycleRepeat);

    els.seek.addEventListener('input', () => { state.seeking = true; renderProgress(); });
    els.seek.addEventListener('change', () => {
        if (Number.isFinite(audio.duration)) audio.currentTime = (els.seek.value / 1000) * audio.duration;
        state.seeking = false;
    });

    function renderVolume() {
        const v = audio.muted ? 0 : audio.volume;
        els.volume.value = Math.round(v * 100);
        els.volume.style.setProperty('--p', `${v * 100}%`);
        els.mute.querySelector('use').setAttribute('href', v === 0 ? '#i-volume-off' : '#i-volume');
        els.mute.setAttribute('aria-label', v === 0 ? 'Unmute' : 'Mute');
    }
    els.volume.addEventListener('input', () => {
        audio.muted = false;
        audio.volume = els.volume.value / 100;
        savePrefs({ volume: audio.volume });
        renderVolume();
    });
    els.mute.addEventListener('click', () => {
        if (audio.volume === 0) audio.volume = 1;
        audio.muted = !audio.muted;
        renderVolume();
    });
    renderVolume();

    document.addEventListener('keydown', (e) => {
        if (e.target.matches('input[type="search"], input[type="text"]') || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === ' ' && !e.target.matches('button, input')) {
            e.preventDefault();
            togglePlay();
        } else if (e.key === 'ArrowRight' && !e.target.matches('input')) {
            e.shiftKey ? next() : seekBy(5);
        } else if (e.key === 'ArrowLeft' && !e.target.matches('input')) {
            e.shiftKey ? prev() : seekBy(-5);
        } else if (e.key === 'Escape' && !els.np.hidden) {
            closeNowPlaying();
        } else if (e.key === '/' && els.searchRow.hidden) {
            e.preventDefault();
            els.searchToggle.click();
        }
    });

    window.addEventListener('hashchange', () => {
        if (state.tracks.length) route();
        const day = dayFromHash();
        if (day != null && day !== state.current?.day && state.byDay.get(day)?.audio) playDay(day);
    });

    renderModes();
    loadLibrary();
})();
