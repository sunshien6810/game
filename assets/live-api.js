(function () {
  'use strict';

  const CONFIG = {
    baseUrl: 'https://dataapi.spotistics.com',
    refreshMs: 30000,
    requestTimeoutMs: 12000,
  };

  const state = {
    game: null,
    probability: null,
    loading: false,
    lastUpdatedAt: null,
    timer: null,
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function kstDateString(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  }

  async function requestJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: { Accept: 'application/json', ...(options.headers || {}) },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchGames(date) {
    const url = `${CONFIG.baseUrl}/kbo/game/gamebutton?date=${encodeURIComponent(date)}`;
    return requestJson(url, { method: 'GET' });
  }

  async function fetchWinProbability(gameId) {
    const endpoint = `${CONFIG.baseUrl}/spotv_data/kbo/data/win_probability`;
    const queryUrl = `${endpoint}?kbo_gameid=${encodeURIComponent(gameId)}`;

    // 현재 API는 POST 방식이며, 우선 Query Parameter POST로 호출합니다.
    // 서버 구현이 JSON Body 방식일 경우를 대비해 한 번 더 시도합니다.
    try {
      return await requestJson(queryUrl, { method: 'POST' });
    } catch (firstError) {
      return requestJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kbo_gameid: gameId }),
      });
    }
  }

  function getByCandidates(obj, candidates) {
    if (!obj || typeof obj !== 'object') return undefined;
    const map = new Map(Object.keys(obj).map(key => [key.toLowerCase(), key]));
    for (const candidate of candidates) {
      const realKey = map.get(candidate.toLowerCase());
      if (realKey !== undefined && obj[realKey] !== null && obj[realKey] !== '') return obj[realKey];
    }
    return undefined;
  }

  function findFirstArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    const preferred = ['data', 'result', 'results', 'games', 'game_list', 'list', 'items', 'rows'];
    for (const key of preferred) {
      const value = getByCandidates(payload, [key]);
      if (Array.isArray(value)) return value;
      if (value && typeof value === 'object') {
        const nested = findFirstArray(value);
        if (nested.length) return nested;
      }
    }
    for (const value of Object.values(payload)) {
      if (Array.isArray(value)) return value;
    }
    return [];
  }

  function findLatestRecord(payload) {
    const rows = findFirstArray(payload);
    if (rows.length) return rows[rows.length - 1];
    const preferred = ['data', 'result', 'latest', 'current'];
    for (const key of preferred) {
      const value = getByCandidates(payload, [key]);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    }
    return payload && typeof payload === 'object' ? payload : {};
  }

  function numberValue(value) {
    if (value === undefined || value === null || value === '') return null;
    const numeric = Number(String(value).replace('%', '').trim());
    if (!Number.isFinite(numeric)) return null;
    return numeric <= 1 ? numeric * 100 : numeric;
  }

  function textValue(value, fallback = '') {
    return value === undefined || value === null ? fallback : String(value).trim();
  }

  function normalizeGamePayload(payload) {
    const rows = findFirstArray(payload);
    const raw = rows[0] || (payload && typeof payload === 'object' ? payload : {});
    if (!raw || typeof raw !== 'object') throw new Error('경기 정보가 없습니다.');

    const id = textValue(getByCandidates(raw, [
      'kbo_gameid', 'gameid', 'game_id', 'gameId', 'gmkey', 'game_key', 'gamepk', 'game_pk',
    ]));

    const awayTeam = textValue(getByCandidates(raw, [
      'away_team_name', 'awayteamname', 'away_team', 'awayteam', 'visit_team_name', 'visitteamname',
      'visitor_team_name', 'visitor', 'away', 'vteam_name', 'away_name',
    ]), '원정팀');

    const homeTeam = textValue(getByCandidates(raw, [
      'home_team_name', 'hometeamname', 'home_team', 'hometeam', 'home', 'hteam_name', 'home_name',
    ]), '홈팀');

    return {
      id,
      awayTeam,
      homeTeam,
      awayScore: numberValue(getByCandidates(raw, ['away_score', 'awayscore', 'visit_score', 'visitscore', 'vscore'])),
      homeScore: numberValue(getByCandidates(raw, ['home_score', 'homescore', 'hscore'])),
      gameTime: textValue(getByCandidates(raw, ['game_time', 'gametime', 'start_time', 'starttime', 'time'])),
      stadium: textValue(getByCandidates(raw, ['stadium', 'stadium_name', 'stadiumname', 'ballpark', 'ground_name'])),
      status: textValue(getByCandidates(raw, ['game_status', 'gamestatus', 'status', 'state', 'game_state'])),
      inning: textValue(getByCandidates(raw, ['inning', 'current_inning', 'inning_text', 'inning_status'])),
      raw,
    };
  }

  function normalizeProbabilityPayload(payload, game) {
    const raw = findLatestRecord(payload);
    let home = numberValue(getByCandidates(raw, [
      'home_win_probability', 'home_win_prob', 'home_probability', 'home_prob', 'home_wp', 'h_win_probability', 'hwp',
    ]));
    let away = numberValue(getByCandidates(raw, [
      'away_win_probability', 'away_win_prob', 'away_probability', 'away_prob', 'away_wp', 'a_win_probability', 'v_win_probability', 'awp',
    ]));

    // 단일 승리확률 필드만 있는 경우 home 기준으로 간주합니다.
    if (home === null && away === null) {
      home = numberValue(getByCandidates(raw, ['win_probability', 'win_prob', 'probability', 'wp', 'prediction']));
    }
    if (home !== null && away === null) away = 100 - home;
    if (away !== null && home === null) home = 100 - away;
    if (home === null || away === null) throw new Error('승리확률 필드를 확인할 수 없습니다.');

    const total = home + away;
    if (total > 0 && Math.abs(total - 100) > 0.5) {
      home = home / total * 100;
      away = away / total * 100;
    }

    return {
      home: Math.max(0, Math.min(100, home)),
      away: Math.max(0, Math.min(100, away)),
      inning: textValue(getByCandidates(raw, ['inning', 'current_inning', 'inning_text']), game.inning),
      homeScore: numberValue(getByCandidates(raw, ['home_score', 'homescore', 'hscore'])) ?? game.homeScore,
      awayScore: numberValue(getByCandidates(raw, ['away_score', 'awayscore', 'vscore'])) ?? game.awayScore,
      raw,
    };
  }

  function teamEmoji(name) {
    const team = String(name || '').toUpperCase();
    const map = [
      [['LG', '엘지'], '🦖'], [['한화', 'HANWHA', 'HH'], '🦅'], [['두산', 'DOOSAN', 'OB'], '🐻'],
      [['삼성', 'SAMSUNG', 'SS'], '🦁'], [['KIA', '기아', '해태'], '🐯'], [['롯데', 'LOTTE', 'LT'], '🕊️'],
      [['SSG', 'SK'], '🚀'], [['KT', '케이티'], '🧙'], [['NC', '엔씨'], '🦕'], [['키움', 'KIWOOM', 'WO'], '🦸'],
    ];
    return map.find(([keys]) => keys.some(key => team.includes(String(key).toUpperCase())))?.[1] || '⚾';
  }

  function statusText(game) {
    const source = `${game.status} ${game.inning}`.trim();
    if (!source) return '경기 정보';
    return source;
  }

  function renderGameHeader(game, probability) {
    const gameSection = $('.game');
    if (!gameSection) return;
    const match = $('.match', gameSection);
    const meta = $('.meta', gameSection);
    if (!match || !meta) return;

    const hasScore = probability && probability.awayScore !== null && probability.homeScore !== null;
    match.innerHTML = `
      <div class="team"><div class="logo">${teamEmoji(game.awayTeam)}</div><b>${game.awayTeam}</b></div>
      <div class="vs">${hasScore ? `<span class="api-score">${probability.awayScore} : ${probability.homeScore}</span>` : 'VS'}</div>
      <div class="team"><div class="logo">${teamEmoji(game.homeTeam)}</div><b>${game.homeTeam}</b></div>
    `;

    const parts = [game.gameTime, game.stadium, probability?.inning || game.inning].filter(Boolean);
    const stateLabel = statusText(game);
    meta.innerHTML = `${parts.join(' · ') || '오늘의 첫 번째 경기'}<span class="api-state">${stateLabel}</span>`;
  }

  function ensureProbabilityCard() {
    const home = $('#home');
    if (!home) return null;
    let card = $('#apiLiveProbability');
    if (!card) {
      card = document.createElement('section');
      card.id = 'apiLiveProbability';
      card.className = 'api-live-card';
      home.prepend(card);
    }
    return card;
  }

  function renderProbability(game, probability, errorMessage = '') {
    const card = ensureProbabilityCard();
    if (!card) return;

    if (errorMessage) {
      card.innerHTML = `
        <div class="api-live-head"><div class="api-live-title"><div><h2>실시간 승리확률</h2><p>Spotistics 데이터 연결</p></div></div><span class="api-live-badge">연결 확인</span></div>
        <div class="api-error">${errorMessage}<br>기존 데모 데이터는 그대로 유지됩니다.</div>
        <div class="api-live-foot"><span>GitHub Pages에서 CORS 오류가 발생하면 API 프록시가 필요합니다.</span><button class="api-refresh" type="button">다시 불러오기</button></div>`;
      $('.api-refresh', card)?.addEventListener('click', loadLiveData);
      return;
    }

    const away = probability.away.toFixed(1);
    const home = probability.home.toFixed(1);
    card.innerHTML = `
      <div class="api-live-head">
        <div class="api-live-title"><div><h2>실시간 승리확률</h2><p>${game.id || '선택 경기'} · 첫 번째 경기 기준</p></div></div>
        <span class="api-live-badge is-live">LIVE DATA</span>
      </div>
      <div class="api-prob-wrap">
        <div class="api-prob-team"><strong>${game.awayTeam}</strong><b>${away}%</b></div>
        <div class="api-prob-track" aria-label="승리확률 ${game.awayTeam} ${away}%, ${game.homeTeam} ${home}%">
          <div class="api-prob-away" style="width:${away}%"></div><div class="api-prob-home" style="width:${home}%"></div>
        </div>
        <div class="api-prob-team"><strong>${game.homeTeam}</strong><b>${home}%</b></div>
      </div>
      <div class="api-live-foot"><span>${probability.inning || statusText(game)} · ${state.lastUpdatedAt ? state.lastUpdatedAt.toLocaleTimeString('ko-KR') : ''} 갱신</span><button class="api-refresh" type="button">새로고침</button></div>`;
    $('.api-refresh', card)?.addEventListener('click', loadLiveData);
  }

  async function loadLiveData() {
    if (state.loading) return;
    state.loading = true;
    $('.game')?.classList.add('api-loading');
    try {
      const date = kstDateString();
      const gamesPayload = await fetchGames(date);
      const game = normalizeGamePayload(gamesPayload);
      if (!game.id) throw new Error('첫 번째 경기에서 gameid를 찾지 못했습니다.');
      const probabilityPayload = await fetchWinProbability(game.id);
      const probability = normalizeProbabilityPayload(probabilityPayload, game);

      state.game = game;
      state.probability = probability;
      state.lastUpdatedAt = new Date();
      renderGameHeader(game, probability);
      renderProbability(game, probability);
    } catch (error) {
      console.error('[KBO Live API]', error);
      renderProbability(state.game || { id: '', awayTeam: '원정팀', homeTeam: '홈팀' }, state.probability, `실데이터를 불러오지 못했습니다: ${error.message}`);
    } finally {
      state.loading = false;
      $('.game')?.classList.remove('api-loading');
    }
  }

  function start() {
    loadLiveData();
    state.timer = window.setInterval(loadLiveData, CONFIG.refreshMs);
    window.addEventListener('beforeunload', () => clearInterval(state.timer), { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
