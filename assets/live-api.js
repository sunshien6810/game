(function () {
  'use strict';

  const CONFIG = {
    baseUrl: 'https://dataapi.spotistics.com',
    teamImageBase: 'https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/emblem/regular/2025',
    playerImageBase: 'https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/person/kbo/2026',
    refreshMs: 30000,
    requestTimeoutMs: 12000,
    debug: true,
  };

  const state = {
    game: null,
    probability: null,
    loading: false,
    lastUpdatedAt: null,
    timer: null,
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function debug(...args) {
    if (CONFIG.debug) console.log('[KBO Live API]', ...args);
  }

  function kstDateString(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  function requestedDate() {
    const queryDate = new URLSearchParams(location.search).get('date');
    return queryDate || kstDateString();
  }

  async function requestJson(url, options = {}, stage = 'API') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

    try {
      debug(`${stage} 요청`, options.method || 'GET', url);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(options.headers || {}),
        },
      });

      const rawText = await response.text();
      let payload = null;

      try {
        payload = rawText ? JSON.parse(rawText) : null;
      } catch {
        payload = rawText;
      }

      debug(`${stage} 응답`, response.status, payload);

      if (!response.ok) {
        const detail =
          payload && typeof payload === 'object'
            ? payload.detail || payload.message || JSON.stringify(payload)
            : String(payload || '');

        throw new Error(
          `${stage} 실패 · HTTP ${response.status}${detail ? ` · ${detail}` : ''}`
        );
      }

      return payload;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`${stage} 요청 시간 초과`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchGames(date) {
    const url =
      `${CONFIG.baseUrl}/kbo/game/gamebutton?date=${encodeURIComponent(date)}`;

    return requestJson(url, { method: 'GET' }, '경기 정보 API');
  }

  async function fetchWinProbability(gameId) {
    const url =
      `${CONFIG.baseUrl}/spotv_data/kbo/data/win_probability` +
      `?kbo_gameid=${encodeURIComponent(gameId)}`;

    // 사용자가 확인한 실제 호출 방식: Query Parameter + POST
    return requestJson(url, { method: 'POST' }, '승리확률 API');
  }

  function normalizedKey(key) {
    return String(key).replace(/[^a-zA-Z0-9가-힣]/g, '').toLowerCase();
  }

  function getByCandidates(obj, candidates) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;

    const keyMap = new Map(
      Object.keys(obj).map((key) => [normalizedKey(key), key])
    );

    for (const candidate of candidates) {
      const originalKey = keyMap.get(normalizedKey(candidate));

      if (
        originalKey !== undefined &&
        obj[originalKey] !== null &&
        obj[originalKey] !== ''
      ) {
        return obj[originalKey];
      }
    }

    return undefined;
  }

  function objectContainsCandidate(obj, candidates) {
    return candidates.some((candidate) =>
      getByCandidates(obj, [candidate]) !== undefined
    );
  }

  function collectObjects(value, result = [], depth = 0) {
    if (depth > 8 || value === null || value === undefined) return result;

    if (Array.isArray(value)) {
      value.forEach((item) => collectObjects(item, result, depth + 1));
      return result;
    }

    if (typeof value === 'object') {
      result.push(value);
      Object.values(value).forEach((item) =>
        collectObjects(item, result, depth + 1)
      );
    }

    return result;
  }

  const GAME_ID_KEYS = [
    'kbo_gameid',
    'kboGameId',
    'gameid',
    'game_id',
    'gameId',
    'gmkey',
    'game_key',
    'gamepk',
    'game_pk',
  ];

  const HOME_PROBABILITY_KEYS = [
    'home_win_pct',
    'home_win_probability',
    'homeWinProbability',
    'home_win_prob',
    'home_probability',
    'home_prob',
    'home_wp',
    'h_win_probability',
    'hwp',
  ];

  const AWAY_PROBABILITY_KEYS = [
    'away_win_pct',
    'away_win_probability',
    'awayWinProbability',
    'away_win_prob',
    'away_probability',
    'away_prob',
    'away_wp',
    'a_win_probability',
    'v_win_probability',
    'awp',
  ];

  const SINGLE_PROBABILITY_KEYS = [
    'win_probability',
    'winProbability',
    'win_prob',
    'probability',
    'wp',
    'prediction',
  ];

  function findFirstGameRecord(payload) {
    const objects = collectObjects(payload);

    const byGameId = objects.find((obj) =>
      objectContainsCandidate(obj, GAME_ID_KEYS)
    );
    if (byGameId) return byGameId;

    const byTeams = objects.find(
      (obj) =>
        objectContainsCandidate(obj, [
          'home_team_name',
          'homeTeamName',
          'home_team',
          'homeTeam',
          'hteam',
        ]) &&
        objectContainsCandidate(obj, [
          'away_team_name',
          'awayTeamName',
          'away_team',
          'awayTeam',
          'vteam',
        ])
    );

    return byTeams || objects[0] || {};
  }

  function findProbabilityRecord(payload) {
    const objects = collectObjects(payload);

    const records = objects.filter(
      (obj) =>
        objectContainsCandidate(obj, HOME_PROBABILITY_KEYS) ||
        objectContainsCandidate(obj, AWAY_PROBABILITY_KEYS) ||
        objectContainsCandidate(obj, SINGLE_PROBABILITY_KEYS)
    );

    if (!records.length) return {};

    // 시계열 배열이라면 마지막 확률 레코드를 사용
    return records[records.length - 1];
  }

  function numberValue(value) {
    if (value === undefined || value === null || value === '') return null;

    const normalized = String(value)
      .replace(/,/g, '')
      .replace('%', '')
      .trim();

    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) return null;

    return numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric;
  }

  function textValue(value, fallback = '') {
    return value === undefined || value === null
      ? fallback
      : String(value).trim();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatGameTime(value) {
    const raw = textValue(value).replace(/[^0-9]/g, '');
    if (raw.length === 4) return `${raw.slice(0, 2)}:${raw.slice(2)}`;
    if (raw.length === 3) return `0${raw.slice(0, 1)}:${raw.slice(1)}`;
    return textValue(value);
  }

  function teamNameValue(value, fallback = '') {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value).trim() || fallback;
    }
    if (typeof value === 'object') {
      const nested = getByCandidates(value, [
        'team_name', 'teamName', 'name', 'short_name', 'shortName',
        'team_code', 'teamCode', 'code', 'abbr', 'team',
      ]);
      if (nested !== undefined && nested !== value) {
        return teamNameValue(nested, fallback);
      }
    }
    return fallback;
  }

  function teamCodeValue(value, teamName = '') {
    if (value && typeof value === 'object') {
      const nested = getByCandidates(value, [
        'team_code', 'teamCode', 'code', 'abbr', 'short_code', 'shortCode',
        'team_id', 'teamId', 'id',
      ]);
      if (nested !== undefined && nested !== value) {
        const code = textValue(nested).toUpperCase();
        if (code) return code;
      }
    }

    const name = String(teamName || value || '').toUpperCase().replace(/\s/g, '');
    const aliases = [
      [['LG', '엘지'], 'LG'],
      [['한화', 'HANWHA', 'HH'], 'HH'],
      [['두산', 'DOOSAN', 'OB'], 'OB'],
      [['삼성', 'SAMSUNG', 'SS'], 'SS'],
      [['KIA', '기아', '해태', 'HT'], 'HT'],
      [['롯데', 'LOTTE', 'LT'], 'LT'],
      [['SSG', 'SK'], 'SK'],
      [['KT', '케이티', 'KTWIZ'], 'KT'],
      [['NC', '엔씨'], 'NC'],
      [['키움', 'KIWOOM', 'WO', '넥센'], 'WO'],
    ];

    return aliases.find(([keys]) =>
      keys.some((key) => name.includes(String(key).toUpperCase()))
    )?.[1] || '';
  }

  function teamLogoUrl(code) {
    return code ? `${CONFIG.teamImageBase}/emblem_${encodeURIComponent(code)}.png` : '';
  }

  function playerImageUrl(playerId) {
    return playerId
      ? `${CONFIG.playerImageBase}/${encodeURIComponent(playerId)}.png`
      : '';
  }

  function playerValue(value, fallbackName = '') {
    if (value === undefined || value === null || value === '') {
      return { id: '', name: fallbackName };
    }

    if (typeof value === 'string' || typeof value === 'number') {
      return { id: '', name: textValue(value, fallbackName) };
    }

    if (typeof value === 'object') {
      const id = textValue(getByCandidates(value, [
        'player_id', 'playerId', 'person_id', 'personId', 'pitcher_id',
        'pitcherId', 'id', 'pcode', 'player_code', 'playerCode',
      ]));
      const name = textValue(getByCandidates(value, [
        'player_name', 'playerName', 'person_name', 'personName',
        'pitcher_name', 'pitcherName', 'name', 'kor_name', 'korName',
      ]), fallbackName);
      return { id, name };
    }

    return { id: '', name: fallbackName };
  }

  function starterFromRaw(raw, side) {
    const sidePrefixes = side === 'home'
      ? ['home', 'h']
      : ['away', 'visit', 'visitor', 'v', 'a'];

    const objectCandidates = [];
    const idCandidates = [];
    const nameCandidates = [];

    for (const prefix of sidePrefixes) {
      objectCandidates.push(
        `${prefix}_starter`, `${prefix}Starter`, `${prefix}_starting_pitcher`,
        `${prefix}StartingPitcher`, `${prefix}_starting_pitcher_info`,
        `${prefix}StartingPitcherInfo`, `${prefix}_pitcher`, `${prefix}Pitcher`,
        `${prefix}_sp`, `${prefix}Sp`
      );
      idCandidates.push(
        `${prefix}_starter_id`, `${prefix}StarterId`, `${prefix}_starting_pitcher_id`,
        `${prefix}StartingPitcherId`, `${prefix}_pitcher_id`, `${prefix}PitcherId`,
        `${prefix}_sp_id`, `${prefix}SpId`, `${prefix}_starter_code`, `${prefix}StarterCode`
      );
      nameCandidates.push(
        `${prefix}_starter_name`, `${prefix}StarterName`, `${prefix}_starting_pitcher_name`,
        `${prefix}StartingPitcherName`, `${prefix}_pitcher_name`, `${prefix}PitcherName`,
        `${prefix}_sp_name`, `${prefix}SpName`
      );
    }

    const objectValue = getByCandidates(raw, objectCandidates);
    const parsed = playerValue(objectValue);
    const directId = textValue(getByCandidates(raw, idCandidates), parsed.id);
    const directName = textValue(getByCandidates(raw, nameCandidates), parsed.name);

    return { id: directId, name: directName };
  }

  function normalizeGamePayload(payload) {
    const raw = findFirstGameRecord(payload);

    const id = textValue(getByCandidates(raw, GAME_ID_KEYS));

    if (!id) {
      debug('경기 정보 원본에서 gameid 탐색 실패', payload);
      throw new Error(
        '첫 번째 경기에서 gameid를 찾지 못했습니다. 개발자 도구 Console의 경기 정보 API 응답을 확인하세요.'
      );
    }

    const awayTeamRaw = getByCandidates(raw, [
      'away_team_name', 'awayTeamName', 'away_team', 'awayTeam',
      'visit_team_name', 'visitTeamName', 'visitor_team_name', 'visitor',
      'away', 'vteam_name', 'vteam', 'away_name', '원정팀',
    ]);
    const homeTeamRaw = getByCandidates(raw, [
      'home_team_name', 'homeTeamName', 'home_team', 'homeTeam', 'home',
      'hteam_name', 'hteam', 'home_name', '홈팀',
    ]);

    const awayTeam = teamNameValue(awayTeamRaw, '원정팀');
    const homeTeam = teamNameValue(homeTeamRaw, '홈팀');

    return {
      id,
      awayTeam,
      homeTeam,
      awayTeamCode: teamCodeValue(awayTeamRaw, awayTeam),
      homeTeamCode: teamCodeValue(homeTeamRaw, homeTeam),
      awayStarter: starterFromRaw(raw, 'away'),
      homeStarter: starterFromRaw(raw, 'home'),
      awayScore: numberValue(getByCandidates(raw, [
        'away_score', 'awayScore', 'visit_score', 'visitScore', 'vscore',
      ])),
      homeScore: numberValue(getByCandidates(raw, [
        'home_score', 'homeScore', 'hscore',
      ])),
      gameTime: formatGameTime(getByCandidates(raw, [
        'game_time', 'gameTime', 'start_time', 'startTime', 'time',
      ])),
      stadium: textValue(getByCandidates(raw, [
        'stadium', 'stadium_name', 'stadiumName', 'ballpark',
        'ground_name', 'groundName',
      ])),
      status: textValue(getByCandidates(raw, [
        'game_status', 'gameStatus', 'status', 'state',
        'game_state', 'gameState',
      ])),
      inning: textValue(getByCandidates(raw, [
        'inning', 'current_inning', 'currentInning', 'inning_text',
        'inningText', 'inning_status',
      ])),
      raw,
    };
  }

  function normalizeProbabilityPayload(payload, game) {
    const raw = findProbabilityRecord(payload);

    let home = numberValue(getByCandidates(raw, HOME_PROBABILITY_KEYS));
    let away = numberValue(getByCandidates(raw, AWAY_PROBABILITY_KEYS));

    if (home === null && away === null) {
      home = numberValue(getByCandidates(raw, SINGLE_PROBABILITY_KEYS));
    }

    if (home !== null && away === null) away = 100 - home;
    if (away !== null && home === null) home = 100 - away;

    if (home === null || away === null) {
      debug('승리확률 필드 탐색 실패', payload);
      throw new Error(
        '승부 예측 응답에서 home_win_pct 또는 away_win_pct 필드를 찾지 못했습니다.'
      );
    }

    const total = home + away;
    if (total > 0 && Math.abs(total - 100) > 0.5) {
      home = (home / total) * 100;
      away = (away / total) * 100;
    }

    const winnersRaw = getByCandidates(raw, ['winners']) || {};
    const commentsRaw = getByCandidates(raw, ['comment_strip', 'commentStrip']) || {};

    const probabilityHomeTeam = teamNameValue(
      getByCandidates(raw, ['home_team', 'homeTeam', 'home_team_name', 'homeTeamName']),
      game.homeTeam
    );
    const probabilityAwayTeam = teamNameValue(
      getByCandidates(raw, ['away_team', 'awayTeam', 'away_team_name', 'awayTeamName']),
      game.awayTeam
    );

    const predictionAwayStarter = starterFromRaw(raw, 'away');
    const predictionHomeStarter = starterFromRaw(raw, 'home');

    return {
      home: Math.max(0, Math.min(100, home)),
      away: Math.max(0, Math.min(100, away)),
      homeTeam: probabilityHomeTeam,
      awayTeam: probabilityAwayTeam,
      expectedHomeScore: numberValue(getByCandidates(raw, [
        'expected_home_score', 'expectedHomeScore', 'home_expected_score',
      ])),
      expectedAwayScore: numberValue(getByCandidates(raw, [
        'expected_away_score', 'expectedAwayScore', 'away_expected_score',
      ])),
      commentary: textValue(getByCandidates(raw, ['commentary'])),
      winners: {
        summary: textValue(getByCandidates(winnersRaw, ['summary_winner', 'summaryWinner'])),
        starter: textValue(getByCandidates(winnersRaw, ['starter_winner', 'starterWinner'])),
        offense: textValue(getByCandidates(winnersRaw, ['offense_winner', 'offenseWinner'])),
        bullpen: textValue(getByCandidates(winnersRaw, ['bullpen_winner', 'bullpenWinner'])),
      },
      comments: {
        summary: textValue(getByCandidates(commentsRaw, ['summary'])),
        starter: textValue(getByCandidates(commentsRaw, ['starter'])),
        offense: textValue(getByCandidates(commentsRaw, ['offense'])),
        bullpen: textValue(getByCandidates(commentsRaw, ['bullpen'])),
      },
      awayStarter: predictionAwayStarter.name || predictionAwayStarter.id
        ? predictionAwayStarter
        : game.awayStarter,
      homeStarter: predictionHomeStarter.name || predictionHomeStarter.id
        ? predictionHomeStarter
        : game.homeStarter,
      inning: textValue(
        getByCandidates(raw, ['inning', 'current_inning', 'currentInning', 'inning_text', 'inningText']),
        game.inning
      ),
      homeScore: numberValue(getByCandidates(raw, ['home_score', 'homeScore', 'hscore'])) ?? game.homeScore,
      awayScore: numberValue(getByCandidates(raw, ['away_score', 'awayScore', 'vscore'])) ?? game.awayScore,
      raw,
    };
  }

  function statusText(game) {
    return `${game.status || ''} ${game.inning || ''}`.trim() || '경기 정보';
  }

  function teamLogoMarkup(teamName, teamCode) {
    const src = teamLogoUrl(teamCode);
    if (!src) return '<span class="api-logo-fallback">⚾</span>';

    return `<img class="api-team-logo" src="${escapeHtml(src)}" alt="${escapeHtml(teamName)} 엠블럼" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'api-logo-fallback',textContent:'⚾'}))">`;
  }

  function starterMarkup(starter, teamName) {
    if (!starter?.name && !starter?.id) return '';

    const image = playerImageUrl(starter.id);
    return `
      <div class="api-starter-card">
        <div class="api-starter-photo">
          ${image
            ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(starter.name || teamName)} 선수" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">`
            : ''}
          <span class="api-player-fallback" ${image ? 'style="display:none"' : ''}>⚾</span>
        </div>
        <div>
          <small>${escapeHtml(teamName)} 선발</small>
          <strong>${escapeHtml(starter.name || `선수 ${starter.id}`)}</strong>
        </div>
      </div>`;
  }

  function renderGameHeader(game, probability) {
    const gameSection = $('.game');
    if (!gameSection) return;

    const match = $('.match', gameSection);
    const meta = $('.meta', gameSection);
    if (!match || !meta) return;

    const hasScore = probability && probability.awayScore !== null && probability.homeScore !== null;
    const awayTeam = probability?.awayTeam || game.awayTeam;
    const homeTeam = probability?.homeTeam || game.homeTeam;

    match.innerHTML = `
      <div class="team">
        <div class="logo api-logo-box">${teamLogoMarkup(awayTeam, game.awayTeamCode)}</div>
        <b>${escapeHtml(awayTeam)}</b>
      </div>
      <div class="vs">
        ${hasScore
          ? `<span class="api-score">${probability.awayScore} : ${probability.homeScore}</span>`
          : 'VS'}
      </div>
      <div class="team">
        <div class="logo api-logo-box">${teamLogoMarkup(homeTeam, game.homeTeamCode)}</div>
        <b>${escapeHtml(homeTeam)}</b>
      </div>
    `;

    const parts = [game.gameTime, game.stadium, probability?.inning || game.inning].filter(Boolean);
    meta.innerHTML =
      `${escapeHtml(parts.join(' · ') || '오늘의 첫 번째 경기')}` +
      `<span class="api-state">${escapeHtml(statusText(game))}</span>`;

    let starterRow = $('.api-starter-row', gameSection);
    if (!starterRow) {
      starterRow = document.createElement('div');
      starterRow.className = 'api-starter-row';
      meta.insertAdjacentElement('afterend', starterRow);
    }

    const starterHtml = [
      starterMarkup(probability?.awayStarter || game.awayStarter, awayTeam),
      starterMarkup(probability?.homeStarter || game.homeStarter, homeTeam),
    ].filter(Boolean).join('');

    starterRow.innerHTML = starterHtml;
    starterRow.hidden = !starterHtml;
  }

  function predictionCommentary(game, probability) {
    const awayTeam = probability.awayTeam || game.awayTeam;
    const homeTeam = probability.homeTeam || game.homeTeam;
    const diff = Math.abs(probability.home - probability.away);
    const leader = probability.home >= probability.away ? homeTeam : awayTeam;
    const leaderPct = Math.max(probability.home, probability.away);

    let balanceText = '';
    if (diff < 3) {
      balanceText = '양 팀의 예측치가 매우 근접해 팽팽한 승부가 예상됩니다.';
    } else if (diff < 10) {
      balanceText = `${leader}가 근소하게 앞서지만 경기 흐름에 따라 충분히 뒤집힐 수 있는 구간입니다.`;
    } else {
      balanceText = `${leader}가 ${leaderPct.toFixed(1)}%로 비교적 우세하게 예측됩니다.`;
    }

    const starterNames = [game.awayStarter?.name, game.homeStarter?.name].filter(Boolean);
    const starterText = starterNames.length === 2
      ? `선발 맞대결은 ${game.awayStarter.name} 대 ${game.homeStarter.name}입니다.`
      : starterNames.length === 1
        ? `${starterNames[0]}의 선발 등판 정보가 반영된 경기입니다.`
        : '';

    return `${balanceText}${starterText ? ` ${starterText}` : ''}`;
  }

  function winnerBadge(team) {
    if (!team) return '<span class="api-detail-badge is-neutral">비교</span>';
    return `<span class="api-detail-badge">${escapeHtml(team)} 우세</span>`;
  }

  function detailItem(label, icon, text, winner) {
    if (!text) return '';
    return `
      <article class="api-detail-item">
        <div class="api-detail-item-head">
          <strong><span aria-hidden="true">${icon}</span>${escapeHtml(label)}</strong>
          ${winnerBadge(winner)}
        </div>
        <p>${escapeHtml(text)}</p>
      </article>`;
  }

  function predictionDetailMarkup(probability) {
    const details = [
      detailItem('종합 전망', '⚾', probability.comments.summary, probability.winners.summary),
      detailItem('선발 비교', '🔥', probability.comments.starter, probability.winners.starter),
      detailItem('타선 비교', '📈', probability.comments.offense, probability.winners.offense),
      detailItem('불펜 비교', '🛡️', probability.comments.bullpen, probability.winners.bullpen),
    ].filter(Boolean).join('');

    if (!details && !probability.commentary) return '';

    return `
      <div class="api-detail-content" hidden>
        <section class="api-prediction-detail">
          <div class="api-detail-title-row">
            <h3>상세 승부 예측</h3>
            <span>Play+ 데이터 분석</span>
          </div>
          ${details ? `<div class="api-detail-grid">${details}</div>` : ''}
          ${probability.commentary ? `
            <details class="api-full-commentary">
              <summary>전체 분석 원문 보기</summary>
              <p>${escapeHtml(probability.commentary).replace(/\n/g, '<br>')}</p>
            </details>` : ''}
        </section>
      </div>`;
  }

  function predictionStarterMarkup(game, probability) {
    const awayStarter = probability.awayStarter || game.awayStarter;
    const homeStarter = probability.homeStarter || game.homeStarter;
    const awayTeam = probability.awayTeam || game.awayTeam;
    const homeTeam = probability.homeTeam || game.homeTeam;
    const cards = [
      starterMarkup(awayStarter, awayTeam),
      starterMarkup(homeStarter, homeTeam),
    ].filter(Boolean).join('');

    if (!cards) return '';
    return `
      <section class="api-prediction-starters">
        <div class="api-detail-title-row">
          <h3>오늘의 선발</h3>
        </div>
        <div class="api-prediction-starter-grid">${cards}</div>
      </section>`;
  }

  function isPlusMode() {
    return document.getElementById('app')?.classList.contains('mode-plus') ?? true;
  }

  function compactPredictionMarkup(game, probability) {
    const away = probability.away.toFixed(1);
    const home = probability.home.toFixed(1);
    const awayTeam = probability.awayTeam || game.awayTeam;
    const homeTeam = probability.homeTeam || game.homeTeam;
    const hasExpectedScore = probability.expectedAwayScore !== null && probability.expectedHomeScore !== null;
    const hint = probability.comments?.summary || probability.commentary || '';

    return `
      <div class="api-bingo-prediction-head">
        <div>
          <strong>오늘의 승부 예측</strong>
          <span>${escapeHtml(awayTeam)} vs ${escapeHtml(homeTeam)}</span>
        </div>
        ${hasExpectedScore ? `<b>예상 ${probability.expectedAwayScore.toFixed(1)} : ${probability.expectedHomeScore.toFixed(1)}</b>` : ''}
      </div>
      <div class="api-bingo-prob-row">
        <span>${escapeHtml(awayTeam)} <b>${away}%</b></span>
        <div class="api-bingo-prob-track" aria-label="${escapeHtml(awayTeam)} ${away}%, ${escapeHtml(homeTeam)} ${home}%">
          <i class="api-bingo-prob-away" style="width:${away}%"></i>
          <i class="api-bingo-prob-home" style="width:${home}%"></i>
        </div>
        <span><b>${home}%</b> ${escapeHtml(homeTeam)}</span>
      </div>
      ${hint ? `<div class="api-bingo-plus-hint"><strong>Play+ 미션 힌트</strong><p>${escapeHtml(hint)}</p></div>` : ''}`;
  }

  function renderBingoPrediction(game, probability) {
    const bingo = document.getElementById('bingo');
    if (!bingo) return;
    const card = bingo.querySelector('.card');
    if (!card) return;

    let compact = document.getElementById('apiBingoPrediction');
    if (!compact) {
      compact = document.createElement('section');
      compact.id = 'apiBingoPrediction';
      compact.className = 'api-bingo-prediction';
      const head = card.querySelector('.head');
      if (head) head.insertAdjacentElement('afterend', compact);
      else card.prepend(compact);
    }
    compact.innerHTML = compactPredictionMarkup(game, probability);
    compact.classList.toggle('is-plus', isPlusMode());
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

  function bindPredictionActions(card) {
    $('.api-refresh', card)?.addEventListener('click', loadLiveData);
    const toggle = $('.api-detail-toggle', card);
    const content = $('.api-detail-content', card);
    if (!toggle || !content) return;

    toggle.addEventListener('click', () => {
      const willOpen = content.hidden;
      content.hidden = !willOpen;
      toggle.setAttribute('aria-expanded', String(willOpen));
      toggle.innerHTML = willOpen
        ? '상세 승부 예측 접기 <span aria-hidden="true">▲</span>'
        : '상세 승부 예측 열기 <span aria-hidden="true">▼</span>';
    });
  }

  function applyModeVisibility() {
    const plus = isPlusMode();
    const card = document.getElementById('apiLiveProbability');
    if (card) {
      const toggle = card.querySelector('.api-detail-toggle');
      const content = card.querySelector('.api-detail-content');
      if (toggle) toggle.hidden = !plus;
      if (!plus && content) content.hidden = true;
      if (!plus && toggle) {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.innerHTML = '상세 승부 예측 열기 <span aria-hidden="true">▼</span>';
      }
    }
    const compact = document.getElementById('apiBingoPrediction');
    if (compact) compact.classList.toggle('is-plus', plus);
  }

  function renderProbability(game, probability, errorMessage = '') {
    const card = ensureProbabilityCard();
    if (!card) return;

    if (errorMessage) {
      card.innerHTML = `
        <div class="api-live-head">
          <div class="api-live-title"><div><h2>승부 예측</h2><p>Spotistics 경기 예측 데이터</p></div></div>
          <span class="api-live-badge">연결 확인</span>
        </div>
        <div class="api-error">${escapeHtml(errorMessage)}</div>
        <div class="api-live-foot">
          <span>개발자 도구 Console과 Network에서 실제 응답을 확인할 수 있습니다.</span>
          <button class="api-refresh" type="button">다시 불러오기</button>
        </div>`;
      bindPredictionActions(card);
      return;
    }

    const away = probability.away.toFixed(1);
    const home = probability.home.toFixed(1);
    const awayTeam = probability.awayTeam || game.awayTeam;
    const homeTeam = probability.homeTeam || game.homeTeam;
    const hasExpectedScore = probability.expectedAwayScore !== null && probability.expectedHomeScore !== null;
    const hasDetail = Boolean(
      probability.comments.summary || probability.comments.starter ||
      probability.comments.offense || probability.comments.bullpen || probability.commentary
    );

    card.innerHTML = `
      <div class="api-live-head">
        <div class="api-live-title">
          <div>
            <h2>승부 예측</h2>
            <p>${escapeHtml(awayTeam)} vs ${escapeHtml(homeTeam)} · 경기 전 예측 모델 기준</p>
          </div>
        </div>
        <span class="api-live-badge is-live">PREDICTION</span>
      </div>

      <div class="api-match-prediction">
        <div class="api-prediction-team is-away">
          <div class="api-prediction-logo">${teamLogoMarkup(awayTeam, game.awayTeamCode)}</div>
          <strong>${escapeHtml(awayTeam)}</strong>
          <b>${away}%</b>
        </div>

        <div class="api-expected-score">
          <span>예상 스코어</span>
          ${hasExpectedScore
            ? `<strong>${probability.expectedAwayScore.toFixed(1)} <em>:</em> ${probability.expectedHomeScore.toFixed(1)}</strong>`
            : '<strong>예측 중</strong>'}
        </div>

        <div class="api-prediction-team is-home">
          <div class="api-prediction-logo">${teamLogoMarkup(homeTeam, game.homeTeamCode)}</div>
          <strong>${escapeHtml(homeTeam)}</strong>
          <b>${home}%</b>
        </div>
      </div>

      <div class="api-prob-label">승리 확률</div>
      <div class="api-prob-track api-prob-track-large" aria-label="승부 예측 ${awayTeam} ${away}%, ${homeTeam} ${home}%">
        <div class="api-prob-away" style="width:${away}%"><span>${away}%</span></div>
        <div class="api-prob-home" style="width:${home}%"><span>${home}%</span></div>
      </div>

      ${hasDetail ? `<button class="api-detail-toggle" type="button" aria-expanded="false">상세 승부 예측 열기 <span aria-hidden="true">▼</span></button>` : ''}
      ${hasDetail ? predictionDetailMarkup(probability) : ''}
      ${predictionStarterMarkup(game, probability)}

      <div class="api-live-foot">
        <span>${escapeHtml(awayTeam)} vs ${escapeHtml(homeTeam)} · ${state.lastUpdatedAt?.toLocaleTimeString('ko-KR') || ''} 기준</span>
        <button class="api-refresh" type="button">새로고침</button>
      </div>`;

    bindPredictionActions(card);
    renderBingoPrediction(game, probability);
    applyModeVisibility();
  }

  async function loadLiveData() {
    if (state.loading) return;

    state.loading = true;
    $('.game')?.classList.add('api-loading');

    try {
      const date = requestedDate();
      const gamesPayload = await fetchGames(date);
      const game = normalizeGamePayload(gamesPayload);

      debug('선택된 첫 번째 경기', game);

      const probabilityPayload = await fetchWinProbability(game.id);
      const probability = normalizeProbabilityPayload(
        probabilityPayload,
        game
      );

      state.game = game;
      state.probability = probability;
      state.lastUpdatedAt = new Date();

      renderGameHeader(game, probability);
      renderProbability(game, probability);
    } catch (error) {
      console.error('[KBO Live API] 실행 오류', error);

      renderProbability(
        state.game || {
          id: '',
          awayTeam: '원정팀',
          homeTeam: '홈팀',
        },
        state.probability,
        `실데이터를 불러오지 못했습니다: ${error.message}`
      );
    } finally {
      state.loading = false;
      $('.game')?.classList.remove('api-loading');
    }
  }

  function start() {
    const appRoot = document.getElementById('app');
    if (appRoot) {
      new MutationObserver(applyModeVisibility).observe(appRoot, { attributes: true, attributeFilter: ['class'] });
    }
    loadLiveData();
    state.timer = window.setInterval(loadLiveData, CONFIG.refreshMs);

    window.addEventListener(
      'beforeunload',
      () => clearInterval(state.timer),
      { once: true }
    );
  }

  window.KBOLiveAPI = {
    refresh: loadLiveData,
    getState: () => ({ ...state }),
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
