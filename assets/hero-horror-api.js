(function () {
  'use strict';

  const CONFIG = {
    baseUrl: 'https://dataapi.spotistics.com',
    playerImageBase: 'https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/person/kbo',
    timeoutMs: 12000,
  };

  const TEAM_META = {
    LG: { name: 'LG 트윈스', aliases: ['LG', '엘지'] },
    NC: { name: 'NC 다이노스', aliases: ['NC', '엔씨'] },
    KT: { name: 'KT 위즈', aliases: ['KT', '케이티'] },
    SS: { name: '삼성 라이온즈', aliases: ['SS', '삼성'] },
    HT: { name: 'KIA 타이거즈', aliases: ['HT', 'KIA', '기아', '해태'] },
    SK: { name: 'SSG 랜더스', aliases: ['SK', 'SSG'] },
    HH: { name: '한화 이글스', aliases: ['HH', '한화'] },
    OB: { name: '두산 베어스', aliases: ['OB', '두산'] },
    LT: { name: '롯데 자이언츠', aliases: ['LT', '롯데'] },
    WO: { name: '키움 히어로즈', aliases: ['WO', '키움', '넥센'] },
  };

  const state = {
    game: null,
    starters: null,
    teamStats: null,
    players: [],
    teamFilter: 'ALL',
    roleFilter: 'ALL',
    expanded: false,
    hero: null,
    horror: null,
    loading: true,
    error: null,
  };

  const root = () => document.getElementById('heroHorrorApiRoot');
  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  function normalizedKey(key) {
    return String(key).replace(/[^a-zA-Z0-9가-힣]/g, '').toLowerCase();
  }

  function getByCandidates(obj, candidates) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
    const keys = new Map(Object.keys(obj).map((key) => [normalizedKey(key), key]));
    for (const candidate of candidates) {
      const actual = keys.get(normalizedKey(candidate));
      if (actual !== undefined && obj[actual] !== null && obj[actual] !== '') return obj[actual];
    }
    return undefined;
  }

  function collectObjects(value, result = [], depth = 0) {
    if (depth > 9 || value === null || value === undefined) return result;
    if (Array.isArray(value)) {
      value.forEach((item) => collectObjects(item, result, depth + 1));
    } else if (typeof value === 'object') {
      result.push(value);
      Object.values(value).forEach((item) => collectObjects(item, result, depth + 1));
    }
    return result;
  }

  function numberValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(String(value).replace(/,/g, '').replace('%', '').trim());
    return Number.isFinite(n) ? n : null;
  }

  function textValue(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim() || fallback;
    return fallback;
  }

  function teamCodeFrom(value, fallback = '') {
    if (value && typeof value === 'object') {
      const nested = getByCandidates(value, [
        'team_code', 'teamCode', 'code', 'abbr', 'short_code', 'shortCode',
        'team_id', 'teamId', 'id', 'team',
      ]);
      if (nested !== undefined && nested !== value) {
        const parsed = teamCodeFrom(nested, '');
        if (parsed) return parsed;
      }
    }
    const raw = String(value ?? '').toUpperCase().replace(/\s/g, '');
    if (TEAM_META[raw]) return raw;
    for (const [code, meta] of Object.entries(TEAM_META)) {
      if (meta.aliases.some((alias) => raw.includes(String(alias).toUpperCase()))) return code;
    }
    return fallback;
  }

  function teamDisplayName(code, rawValue) {
    if (TEAM_META[code]) return TEAM_META[code].name;
    if (rawValue && typeof rawValue === 'object') {
      const nested = getByCandidates(rawValue, ['team_name', 'teamName', 'name', 'short_name', 'shortName']);
      if (nested !== undefined && nested !== rawValue) return teamDisplayName(code, nested);
    }
    const raw = textValue(rawValue);
    return raw && raw !== '[object Object]' ? raw : (code || '팀');
  }

  function findGameRecord(payload) {
    const objects = collectObjects(payload);
    const gameIdKeys = ['kbo_gameid', 'kboGameId', 'gameid', 'game_id', 'gameId', 'gmkey', 'game_key'];
    return objects.find((obj) => gameIdKeys.some((key) => getByCandidates(obj, [key]) !== undefined)) || {};
  }

  function normalizeGame(payload) {
    const raw = findGameRecord(payload);
    const id = textValue(getByCandidates(raw, [
      'kbo_gameid', 'kboGameId', 'gameid', 'game_id', 'gameId', 'gmkey', 'game_key',
    ]));

    const awayRaw = getByCandidates(raw, [
      'away_team', 'awayTeam', 'away_team_name', 'awayTeamName', 'visitor',
      'visit_team', 'visitTeam', 'vteam', 'away', '원정팀',
    ]);
    const homeRaw = getByCandidates(raw, [
      'home_team', 'homeTeam', 'home_team_name', 'homeTeamName', 'hteam', 'home', '홈팀',
    ]);

    let awayCode = teamCodeFrom(awayRaw);
    let homeCode = teamCodeFrom(homeRaw);
    if (id && (!awayCode || !homeCode)) {
      const compact = id.replace(/[^A-Za-z0-9]/g, '');
      if (!awayCode && compact.length >= 10) awayCode = compact.slice(8, 10).toUpperCase();
      if (!homeCode && compact.length >= 12) homeCode = compact.slice(10, 12).toUpperCase();
    }

    if (!id || !awayCode || !homeCode) {
      throw new Error('경기 ID 또는 양 팀 정보를 확인하지 못했습니다. 경기 정보 API 응답 구조를 확인해 주세요.');
    }

    return {
      id,
      season: Number(id.slice(0, 4)) || Number(requestedDate().slice(0, 4)),
      awayCode,
      homeCode,
      awayName: teamDisplayName(awayCode, awayRaw),
      homeName: teamDisplayName(homeCode, homeRaw),
      time: textValue(getByCandidates(raw, ['game_time', 'gameTime', 'start_time', 'startTime', 'time'])),
      stadium: textValue(getByCandidates(raw, ['stadium', 'stadium_name', 'stadiumName', 'ballpark'])),
    };
  }

  function kstDate() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  function requestedDate() {
    return new URLSearchParams(location.search).get('date') || kstDate();
  }

  async function fetchJson(url, stage) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`${stage} 실패 · HTTP ${response.status}`);
      const payload = await response.json();
      return payload?.body?.result ?? payload?.result ?? payload?.body ?? payload;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(`${stage} 응답 시간이 초과되었습니다.`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function playerImage(pid, season) {
    return `${CONFIG.playerImageBase}/${encodeURIComponent(season)}/${encodeURIComponent(pid)}.png`;
  }

  function rankList(leaders, pid, type) {
    const source = type === 'batter' ? leaders?.batting : leaders?.pitching;
    const rows = [];
    Object.entries(source || {}).forEach(([key, list]) => {
      const item = Array.isArray(list) ? list.find((row) => String(row.pid) === String(pid)) : null;
      if (item) rows.push({ key, rank: numberValue(item.rank), value: item.value });
    });
    return rows.sort((a, b) => (a.rank || 99) - (b.rank || 99));
  }

  function normalizeBatter(raw, teamCode, leaders, season) {
    return {
      id: String(raw.pid), pid: raw.pid, name: textValue(raw.name, '선수'),
      teamCode, teamName: teamDisplayName(teamCode), type: 'batter',
      position: textValue(raw.pos, '타자'), number: textValue(raw.back_num), side: textValue(raw.bat_side),
      imageUrl: playerImage(raw.pid, season), trend: numberValue(raw.hotcold) || 0, starter: false,
      season: {
        games: numberValue(raw.games), pa: numberValue(raw.pa), avg: numberValue(raw.avg3),
        obp: numberValue(raw.obp3), slg: numberValue(raw.slg3), ops: numberValue(raw.ops3),
        hr: numberValue(raw.hr), rbi: numberValue(raw.rbi), run: numberValue(raw.run),
        k: numberValue(raw.k), steal: numberValue(raw.steal), dpo: numberValue(raw.dpo), error: numberValue(raw.error),
      },
      recent: {
        games: numberValue(raw.games_7), pa: numberValue(raw.pa_7), avg: numberValue(raw.avg_7),
        ops: numberValue(raw.ops_7), hr: numberValue(raw.hr_7), k: numberValue(raw.k_7),
      },
      ranks: rankList(leaders, raw.pid, 'batter'),
    };
  }

  function normalizePitcher(raw, teamCode, leaders, season, starterIds) {
    return {
      id: String(raw.pid), pid: raw.pid, name: textValue(raw.name, '선수'),
      teamCode, teamName: teamDisplayName(teamCode), type: 'pitcher',
      position: '투수', number: textValue(raw.back_num), side: textValue(raw.pit_hand),
      imageUrl: playerImage(raw.pid, season), trend: numberValue(raw.hotcold) || 0,
      starter: starterIds.has(String(raw.pid)),
      season: {
        games: numberValue(raw.games), win: numberValue(raw.win), lose: numberValue(raw.lose),
        hold: numberValue(raw.hold), save: numberValue(raw.save), qs: numberValue(raw.qs),
        bs: numberValue(raw.bs), inn: textValue(raw.inn), k: numberValue(raw.strikeouts),
        k9: numberValue(raw.k9), era: numberValue(raw.era2), whip: numberValue(raw.whip2),
        bb: numberValue(raw.bb_ibb), hr: numberValue(raw.hr),
      },
      recent: {}, ranks: rankList(leaders, raw.pid, 'pitcher'),
    };
  }

  function upsertStarterPlayers(starterResult, season, starterIds) {
    ['away', 'home'].forEach((side) => {
      const raw = starterResult?.[side];
      if (!raw?.pid) return;
      starterIds.add(String(raw.pid));
      const existing = state.players.find((player) => player.id === String(raw.pid));
      if (existing) {
        existing.starter = true;
        existing.season.era = numberValue(raw.era) ?? existing.season.era;
        existing.season.whip = numberValue(raw.whip) ?? existing.season.whip;
        existing.season.win = numberValue(raw.win) ?? existing.season.win;
        existing.season.lose = numberValue(raw.lose) ?? existing.season.lose;
        existing.season.k = numberValue(raw.k) ?? existing.season.k;
        existing.season.inn = textValue(raw.inn, existing.season.inn);
        return;
      }
      const code = teamCodeFrom(raw.team_name, side === 'away' ? state.game.awayCode : state.game.homeCode);
      state.players.push({
        id: String(raw.pid), pid: raw.pid, name: textValue(raw.pitcher_kor, '선발투수'),
        teamCode: code, teamName: teamDisplayName(code, raw.team_name), type: 'pitcher',
        position: '선발투수', number: '', side: textValue(raw.pit_hand),
        imageUrl: playerImage(raw.pid, season), trend: 0, starter: true, ranks: [], recent: {},
        season: {
          games: numberValue(raw.games), win: numberValue(raw.win), lose: numberValue(raw.lose),
          hold: 0, save: 0, qs: null, bs: 0, inn: textValue(raw.inn), k: numberValue(raw.k),
          k9: null, era: numberValue(raw.era), whip: numberValue(raw.whip), bb: null, hr: null,
        },
      });
    });
  }

  function percentile(value, min, max, invert = false) {
    if (value === null || value === undefined || !Number.isFinite(min) || !Number.isFinite(max) || max === min) return 50;
    let score = ((value - min) / (max - min)) * 100;
    if (invert) score = 100 - score;
    return Math.max(0, Math.min(100, score));
  }

  function range(players, key) {
    const values = players.map((p) => p.season[key]).filter((v) => Number.isFinite(v));
    return values.length ? [Math.min(...values), Math.max(...values)] : [0, 1];
  }

  function scorePlayers() {
    const batters = state.players.filter((p) => p.type === 'batter');
    const pitchers = state.players.filter((p) => p.type === 'pitcher');
    const [opsMin, opsMax] = range(batters, 'ops');
    const [avgMin, avgMax] = range(batters, 'avg');
    const [eraMin, eraMax] = range(pitchers, 'era');
    const [whipMin, whipMax] = range(pitchers, 'whip');

    state.players.forEach((player) => {
      const opponentCode = player.teamCode === state.game.awayCode ? state.game.homeCode : state.game.awayCode;
      const opponent = state.teamStats?.[opponentCode];

      if (player.type === 'batter') {
        const paWeight = Math.min(1, (player.recent.pa || 0) / 20);
        const seasonScore = 0.62 * percentile(player.season.ops, opsMin, opsMax)
          + 0.38 * percentile(player.season.avg, avgMin, avgMax);
        const recentScore = player.recent.ops === null ? 50 : Math.min(100, (player.recent.ops / 1.10) * 100);
        const bestRank = player.ranks.length ? Math.min(...player.ranks.map((r) => r.rank || 9)) : 6;
        const leaderScore = Math.max(10, 100 - (bestRank - 1) * 18);
        const environment = opponent ? percentile(numberValue(opponent.era2_starter), 3.3, 6.2) : 50;
        const availability = Math.min(100, (player.recent.pa || 0) * 5);
        player.heroScore = Math.round(
          0.30 * seasonScore + 0.30 * (recentScore * paWeight + 50 * (1 - paWeight))
          + 0.20 * leaderScore + 0.15 * environment + 0.05 * availability
        );

        const decline = player.recent.ops === null ? 35 : Math.max(0, Math.min(100, 50 + (player.season.ops - player.recent.ops) * 145));
        const strikeRisk = (player.recent.pa || 0) > 0 ? Math.min(100, (player.recent.k / player.recent.pa) * 360) : 30;
        const opponentK = opponent ? percentile(numberValue(opponent.p_k_pg2), 6, 9) : 50;
        player.horrorScore = Math.round(
          0.35 * decline + 0.20 * (100 - seasonScore) + 0.20 * opponentK
          + 0.15 * (0.72 * strikeRisk + 0.28 * Math.min(100, (player.season.dpo || 0) * 8))
          + 0.10 * availability
        );
      } else {
        const seasonScore = 0.56 * percentile(player.season.era, eraMin, eraMax, true)
          + 0.44 * percentile(player.season.whip, whipMin, whipMax, true);
        const strikeScore = Math.min(100, ((player.season.k9 || 7) / 12) * 100);
        const opponentOffense = opponent
          ? 0.5 * percentile(numberValue(opponent.ops3), 0.68, 0.82)
            + 0.5 * percentile(numberValue(opponent.run_pg2), 4, 6)
          : 50;
        player.heroScore = Math.round(
          0.35 * seasonScore + 0.20 * strikeScore + 0.20 * (100 - opponentOffense)
          + 0.15 * (player.trend > 0 ? 80 : player.trend < 0 ? 25 : 50)
          + 0.10 * (player.starter ? 100 : 25)
        );
        const controlRisk = Math.min(100, ((player.season.whip || 1.25) - 1) * 100 + 30);
        const eraRisk = Math.min(100, ((player.season.era || 4) / 7) * 100);
        player.horrorScore = Math.round(
          0.25 * eraRisk + 0.25 * (player.trend < 0 ? 85 : 45)
          + 0.20 * controlRisk + 0.20 * opponentOffense + 0.10 * (player.starter ? 100 : 20)
        );
      }

      player.heroReasons = heroReasons(player, opponent);
      player.horrorReasons = horrorReasons(player, opponent);
    });
  }

  const STAT_LABELS = {
    hr: '홈런', run: '득점', rbi: '타점', steal: '도루', avg: '타율', ops: 'OPS',
    inn: '이닝', strikeouts: '탈삼진', win: '승리', save: '세이브', era: 'ERA', whip: 'WHIP',
  };

  function format3(value) { return value === null || value === undefined ? '—' : Number(value).toFixed(3).replace(/^0/, ''); }
  function format2(value) { return value === null || value === undefined ? '—' : Number(value).toFixed(2); }

  function heroReasons(player, opponent) {
    const reasons = [];
    if (player.type === 'batter') {
      if (player.recent.ops !== null && player.season.ops !== null && player.recent.ops > player.season.ops) {
        reasons.push(`최근 7경기 OPS ${format3(player.recent.ops)}로 상승 흐름`);
      }
      if (player.ranks[0]) reasons.push(`팀 내 ${STAT_LABELS[player.ranks[0].key] || player.ranks[0].key} ${player.ranks[0].rank}위`);
      if (opponent) reasons.push(`상대 선발진 ERA ${format2(numberValue(opponent.era2_starter))}`);
    } else {
      if (player.starter) reasons.push('오늘 경기에 등판하는 선발투수');
      reasons.push(`시즌 ERA ${format2(player.season.era)} · WHIP ${format2(player.season.whip)}`);
      if (player.season.k9) reasons.push(`9이닝당 탈삼진 ${format2(player.season.k9)}`);
    }
    return reasons.slice(0, 3);
  }

  function horrorReasons(player, opponent) {
    const reasons = [];
    if (player.type === 'batter') {
      if (player.recent.ops !== null && player.season.ops !== null && player.recent.ops < player.season.ops) {
        reasons.push(`최근 OPS ${format3(player.recent.ops)}로 시즌 대비 하락`);
      }
      if ((player.recent.k || 0) >= 5) reasons.push(`최근 7경기 삼진 ${player.recent.k}개`);
      if (opponent) reasons.push(`상대 투수진 경기당 탈삼진 ${format2(numberValue(opponent.p_k_pg2))}`);
    } else {
      if ((player.season.whip || 0) >= 1.5) reasons.push(`WHIP ${format2(player.season.whip)}로 출루 허용 위험`);
      if ((player.season.era || 0) >= 5) reasons.push(`시즌 ERA ${format2(player.season.era)}`);
      if (opponent) reasons.push(`상대 팀 OPS ${format3(numberValue(opponent.ops3))}`);
    }
    return reasons.length ? reasons.slice(0, 3) : ['상대 매치업과 최근 흐름을 종합한 경기 변수 후보'];
  }

  function trendMeta(value) {
    if (value >= 2) return { text: '매우 상승', cls: 'hot2' };
    if (value === 1) return { text: '상승', cls: 'hot' };
    if (value === -1) return { text: '하락', cls: 'cold' };
    return { text: '보통', cls: 'normal' };
  }

  function statsFor(player) {
    return player.type === 'batter'
      ? [['AVG', format3(player.season.avg)], ['OPS', format3(player.season.ops)], ['HR', player.season.hr ?? '—'], ['RBI', player.season.rbi ?? '—']]
      : [['ERA', format2(player.season.era)], ['WHIP', format2(player.season.whip)], ['승-패', `${player.season.win ?? 0}-${player.season.lose ?? 0}`], ['K', player.season.k ?? '—']];
  }

  function candidatePlayers() {
    let list = state.players.filter((player) => {
      const teamOk = state.teamFilter === 'ALL' || player.teamCode === state.teamFilter;
      const roleOk = state.roleFilter === 'ALL' || player.type === state.roleFilter;
      const sampleOk = player.starter || (player.type === 'batter' ? (player.season.pa || 0) >= 40 : (player.season.games || 0) >= 9);
      return teamOk && roleOk && sampleOk;
    });
    list.sort((a, b) => Math.max(b.heroScore, b.horrorScore) - Math.max(a.heroScore, a.horrorScore));
    return state.expanded ? list : list.slice(0, 12);
  }

  function aiPick(type) {
    const scoreKey = type === 'hero' ? 'heroScore' : 'horrorScore';
    const eligible = state.players.filter((player) => player.type === 'batter' || player.starter);
    return [...eligible].sort((a, b) => b[scoreKey] - a[scoreKey])[0] || null;
  }

  function imageMarkup(player, className = '') {
    return `<div class="${className} hh-image-shell"><img src="${escapeHtml(player.imageUrl)}" alt="${escapeHtml(player.name)}" loading="lazy"><div class="hh-image-fallback">${escapeHtml(player.name.slice(-2))}</div></div>`;
  }

  function aiCard(type, player) {
    if (!player) return '';
    const isHero = type === 'hero';
    const reasons = isHero ? player.heroReasons : player.horrorReasons;
    return `<article class="hh-ai-card ${type}">
      <div class="hh-ai-kicker">${isHero ? 'AI HERO PICK' : 'AI HORROR PICK'}</div>
      <div class="hh-ai-content">
        ${imageMarkup(player, 'hh-ai-photo')}
        <div class="hh-ai-person"><b>${escapeHtml(player.name)}</b><span>${escapeHtml(player.teamName)} · ${escapeHtml(player.position)}</span></div>
        <div class="hh-ai-score"><small>${isHero ? '추천' : 'Risk'}</small><strong>${isHero ? player.heroScore : player.horrorScore}</strong></div>
      </div>
      <div class="hh-reason-list">${reasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join('')}</div>
      <button class="hh-ai-pick-btn ${type}" data-pick="${type}" data-id="${player.id}">${isHero ? 'Hero' : 'Horror'}로 선택</button>
    </article>`;
  }

  function playerCard(player) {
    const trend = trendMeta(player.trend);
    const selectedHero = state.hero === player.id;
    const selectedHorror = state.horror === player.id;
    return `<article class="hh-player-card ${selectedHero ? 'is-hero' : ''} ${selectedHorror ? 'is-horror' : ''}">
      <div class="hh-card-photo">
        ${imageMarkup(player)}
        ${player.starter ? '<span class="hh-starter-badge">오늘의 선발</span>' : ''}
      </div>
      <div class="hh-card-body">
        <div class="hh-player-title"><div><b>${escapeHtml(player.name)}</b><span>${escapeHtml(player.teamName)} · ${escapeHtml(player.position)}${player.side ? ` · ${escapeHtml(player.side)}` : ''}</span></div><em class="hh-trend ${trend.cls}">${trend.text}</em></div>
        <div class="hh-stat-grid">${statsFor(player).map(([label, value]) => `<div><small>${label}</small><strong>${value}</strong></div>`).join('')}</div>
        <div class="plus-only hh-recent-line">${player.type === 'batter' && player.recent.ops !== null
          ? `최근 7경기 AVG ${format3(player.recent.avg)} · OPS ${format3(player.recent.ops)}`
          : escapeHtml(player.heroReasons[0] || '')}</div>
        <div class="hh-card-actions">
          <button class="hh-detail-btn plus-only" data-detail="${player.id}">상세</button>
          <button class="hh-choice hero ${selectedHero ? 'active' : ''}" data-pick="hero" data-id="${player.id}">Hero</button>
          <button class="hh-choice horror ${selectedHorror ? 'active' : ''}" data-pick="horror" data-id="${player.id}">Horror</button>
        </div>
      </div>
    </article>`;
  }

  function starterSection() {
    const away = state.players.find((p) => p.starter && p.teamCode === state.game.awayCode);
    const home = state.players.find((p) => p.starter && p.teamCode === state.game.homeCode);
    if (!away && !home) return '';
    const one = (player) => player ? `<div class="hh-starter-player">${imageMarkup(player, 'hh-starter-photo')}<div><small>${escapeHtml(player.teamName)}</small><b>${escapeHtml(player.name)}</b><span>ERA ${format2(player.season.era)} · WHIP ${format2(player.season.whip)}</span></div></div>` : '<div class="hh-starter-player empty">선발 미정</div>';
    return `<section class="hh-starter-section plus-only"><div class="hh-section-title"><div><small>STARTING PITCHERS</small><h3>오늘의 선발 맞대결</h3></div></div><div class="hh-starter-matchup">${one(away)}<strong>VS</strong>${one(home)}</div></section>`;
  }

  function selectionBar() {
    const hero = state.players.find((p) => p.id === state.hero);
    const horror = state.players.find((p) => p.id === state.horror);
    const mini = (label, player, type) => `<div class="hh-selected ${type}"><small>나의 ${label}</small>${player ? `<div>${imageMarkup(player, 'hh-mini-photo')}<b>${escapeHtml(player.name)}</b></div>` : '<b>선택 전</b>'}</div>`;
    return `<div class="hh-selection-bar">${mini('Hero', hero, 'hero')}${mini('Horror', horror, 'horror')}<button id="hhComplete" ${hero && horror ? '' : 'disabled'}>${hero && horror ? '선택 완료' : '두 선수를 선택하세요'}</button></div>`;
  }

  function render() {
    const mount = root();
    if (!mount) return;
    if (state.loading) {
      mount.innerHTML = '<div class="card hh-loading-card"><h2>Hero / Horror</h2><p class="hint">API에서 경기와 선수 데이터를 불러오고 있습니다.</p><div class="hh-skeleton"></div></div>';
      return;
    }
    if (state.error) {
      mount.innerHTML = `<div class="card hh-error-card"><h2>Hero / Horror</h2><p>${escapeHtml(state.error)}</p><button id="hhRetry">다시 시도</button></div>`;
      document.getElementById('hhRetry')?.addEventListener('click', load);
      return;
    }

    const heroPick = aiPick('hero');
    const horrorPick = aiPick('horror');
    const players = candidatePlayers();
    const gameMeta = [state.game.time, state.game.stadium].filter(Boolean).join(' · ');

    mount.innerHTML = `
      <section class="hh-hero-header card">
        <div class="hh-header-row"><div><small>PLAYER PREDICTION</small><h2>Hero / Horror</h2><p><b>${escapeHtml(state.game.awayName)}</b> vs <b>${escapeHtml(state.game.homeName)}</b>${gameMeta ? ` · ${escapeHtml(gameMeta)}` : ''}</p><span>오늘 활약할 Hero와 경기의 변수가 될 Horror를 선택하세요.</span></div><div class="hh-api-live"><i></i>API LIVE</div></div>
        <div class="plus-only hh-ai-grid">${aiCard('hero', heroPick)}${aiCard('horror', horrorPick)}</div>
      </section>

      ${starterSection()}

      <section class="hh-candidate-section">
        <div class="hh-section-title"><div><small>PLAYER LIST</small><h3>선수 후보</h3></div><span>${players.length}명 표시</span></div>
        <div class="hh-filter-row">
          <div class="hh-filter-group">${[
            ['ALL', '전체'], [state.game.awayCode, state.game.awayName], [state.game.homeCode, state.game.homeName],
          ].map(([value, label]) => `<button data-team="${value}" class="${state.teamFilter === value ? 'active' : ''}">${escapeHtml(label)}</button>`).join('')}</div>
          <div class="hh-filter-group">${[['ALL', '전체'], ['batter', '타자'], ['pitcher', '투수']].map(([value, label]) => `<button data-role="${value}" class="${state.roleFilter === value ? 'active' : ''}">${label}</button>`).join('')}</div>
        </div>
        <div class="hh-player-grid">${players.length ? players.map(playerCard).join('') : '<div class="hh-empty">조건에 맞는 선수 후보가 없습니다.</div>'}</div>
        <button class="hh-more" id="hhMore">${state.expanded ? '추천 후보만 보기' : '전체 후보 더보기'}</button>
      </section>

      ${selectionBar()}`;

    bindEvents();
    bindImageFallbacks();
  }

  function bindImageFallbacks() {
    root()?.querySelectorAll('.hh-image-shell img').forEach((img) => {
      const shell = img.closest('.hh-image-shell');
      const fail = () => {
        img.style.display = 'none';
        shell?.classList.add('image-error');
      };
      img.addEventListener('error', fail, { once: true });
      if (img.complete && img.naturalWidth === 0) fail();
    });
  }

  function choose(type, id) {
    if (type === 'hero' && state.horror === id) {
      window.showToast?.('같은 선수를 Hero와 Horror로 선택할 수 없습니다.');
      return;
    }
    if (type === 'horror' && state.hero === id) {
      window.showToast?.('같은 선수를 Hero와 Horror로 선택할 수 없습니다.');
      return;
    }
    if (type === 'hero') state.hero = id;
    if (type === 'horror') state.horror = id;
    localStorage.setItem(`kboHeroHorror:${state.game.id}`, JSON.stringify({ hero: state.hero, horror: state.horror }));
    render();
  }

  function showDetail(player) {
    if (!player) return;
    const detail = document.getElementById('detailContent');
    if (!detail) return;
    const stats = statsFor(player);
    const recent = player.type === 'batter' ? [
      ['최근 경기', player.recent.games ?? '—'], ['최근 PA', player.recent.pa ?? '—'],
      ['최근 AVG', format3(player.recent.avg)], ['최근 OPS', format3(player.recent.ops)],
      ['최근 HR', player.recent.hr ?? '—'], ['최근 K', player.recent.k ?? '—'],
    ] : [];
    detail.innerHTML = `<div class="hh-detail-head">${imageMarkup(player, 'hh-detail-photo')}<div><h3>${escapeHtml(player.name)}</h3><p>${escapeHtml(player.teamName)} · ${escapeHtml(player.position)}</p></div></div><h4>시즌 기록</h4><div class="newsgrid">${stats.map(([label, value]) => `<div class="newscard"><strong>${label}</strong><b>${value}</b></div>`).join('')}</div>${recent.length ? `<h4>최근 7경기</h4><div class="newsgrid">${recent.map(([label, value]) => `<div class="newscard"><strong>${label}</strong><b>${value}</b></div>`).join('')}</div>` : ''}<div class="ai-note"><b>AI Hero ${player.heroScore} · Horror Risk ${player.horrorScore}</b><br>${escapeHtml(player.heroReasons.join(' · '))}</div>`;
    document.getElementById('overlay')?.classList.add('open');
    document.getElementById('detailSheet')?.classList.add('open');
    bindImageFallbacks();
  }

  function bindEvents() {
    root()?.querySelectorAll('[data-team]').forEach((button) => button.addEventListener('click', () => {
      state.teamFilter = button.dataset.team;
      state.expanded = false;
      render();
    }));
    root()?.querySelectorAll('[data-role]').forEach((button) => button.addEventListener('click', () => {
      state.roleFilter = button.dataset.role;
      state.expanded = false;
      render();
    }));
    root()?.querySelectorAll('[data-pick]').forEach((button) => button.addEventListener('click', () => choose(button.dataset.pick, button.dataset.id)));
    root()?.querySelectorAll('[data-detail]').forEach((button) => button.addEventListener('click', () => showDetail(state.players.find((p) => p.id === button.dataset.detail))));
    document.getElementById('hhMore')?.addEventListener('click', () => { state.expanded = !state.expanded; render(); });
    const complete = document.getElementById('hhComplete');
    if (complete && !complete.disabled) complete.addEventListener('click', () => window.showToast?.('Hero / Horror 선택이 저장되었습니다.'));
  }

  async function load() {
    state.loading = true;
    state.error = null;
    render();
    try {
      const gamePayload = await fetchJson(`${CONFIG.baseUrl}/kbo/game/gamebutton?date=${encodeURIComponent(requestedDate())}`, '경기 정보 API');
      state.game = normalizeGame(gamePayload);

      const [starterResult, awayLeaders, homeLeaders, teamStats] = await Promise.all([
        fetchJson(`${CONFIG.baseUrl}/kbo/game/starter?kbo_gameid=${encodeURIComponent(state.game.id)}`, '선발투수 API'),
        fetchJson(`${CONFIG.baseUrl}/kbo/player/team_leaders?season=${state.game.season}&team=${encodeURIComponent(state.game.awayCode)}`, `${state.game.awayName} 선수 API`),
        fetchJson(`${CONFIG.baseUrl}/kbo/player/team_leaders?season=${state.game.season}&team=${encodeURIComponent(state.game.homeCode)}`, `${state.game.homeName} 선수 API`),
        fetchJson(`${CONFIG.baseUrl}/kbo/player/team_stat?season=${state.game.season}`, '팀 스탯 API'),
      ]);

      state.starters = starterResult;
      state.teamStats = teamStats;
      const starterIds = new Set([starterResult?.away?.pid, starterResult?.home?.pid].filter(Boolean).map(String));
      const normalizeTeam = (leaders, code) => [
        ...(leaders?.roster?.batters || []).map((row) => normalizeBatter(row, code, leaders, state.game.season)),
        ...(leaders?.roster?.pitchers || []).map((row) => normalizePitcher(row, code, leaders, state.game.season, starterIds)),
      ];
      state.players = [
        ...normalizeTeam(awayLeaders, state.game.awayCode),
        ...normalizeTeam(homeLeaders, state.game.homeCode),
      ];
      upsertStarterPlayers(starterResult, state.game.season, starterIds);
      if (!state.players.length) throw new Error('선수 API에서 로스터 데이터를 찾지 못했습니다.');

      scorePlayers();
      const saved = JSON.parse(localStorage.getItem(`kboHeroHorror:${state.game.id}`) || '{}');
      state.hero = saved.hero || null;
      state.horror = saved.horror || null;
      state.loading = false;
      render();
    } catch (error) {
      console.error('[Hero/Horror v32]', error);
      state.loading = false;
      state.error = error.message || 'Hero/Horror 데이터를 불러오지 못했습니다.';
      render();
    }
  }

  window.KBOHeroHorror = { reload: load, getState: () => ({ ...state }) };
  window.renderPlayers = render;
  window.choosePlayer = (id, type) => choose(String(type).toLowerCase(), String(id));
  document.addEventListener('DOMContentLoaded', load);
  if (document.readyState !== 'loading') load();
}());
