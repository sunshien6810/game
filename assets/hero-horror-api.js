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
    detailCache: new Map(),
    matchups: { away: [], home: [] },
    viewMode: 'recommend',
    heroIndex: 0,
    horrorIndex: 0,
    fullLimit: 8,
  };

  const root = () => document.getElementById('heroHorrorApiRoot');
  const isPlusMode = () => document.getElementById('app')?.classList.contains('mode-plus');
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

  function matchupForPlayer(player) {
    if (!player || player.type !== 'batter') return null;
    const side = player.teamCode === state.game.awayCode ? 'away' : 'home';
    return (state.matchups?.[side] || []).find((row) => String(row.batter_id) === String(player.pid)) || null;
  }

  function sampleReliability(pa) {
    return Math.max(0, Math.min(1, (numberValue(pa) || 0) / 20));
  }

  function adjustedMatchupOps(ops, pa, baseline = 0.720) {
    const reliability = sampleReliability(pa);
    const raw = numberValue(ops);
    return (raw === null ? baseline : raw) * reliability + baseline * (1 - reliability);
  }

  function applyMatchupData() {
    state.players.forEach((player) => {
      if (player.type !== 'batter') return;
      const raw = matchupForPlayer(player);
      const pa = numberValue(raw?.pa) || 0;
      player.matchup = {
        pitcherId: raw?.pitcher_id ?? null,
        games: numberValue(raw?.games) || 0,
        pa,
        atbat: numberValue(raw?.atbat) || 0,
        hit: numberValue(raw?.hit) || 0,
        k: numberValue(raw?.k) || 0,
        hr: numberValue(raw?.hr) || 0,
        avg: numberValue(raw?.avg),
        ops: numberValue(raw?.ops),
        reliability: sampleReliability(pa),
        adjustedOps: adjustedMatchupOps(raw?.ops, pa),
      };
    });
  }

  async function fetchPitcherVsBatters(pitcherId, batters, stage) {
    if (!pitcherId || !Array.isArray(batters) || !batters.length) return [];
    const ids = batters.map((player) => player.pid).filter(Boolean);
    if (!ids.length) return [];
    const query = ids.map((id) => `batter_id=${encodeURIComponent(id)}`).join('&');
    return fetchJson(`${CONFIG.baseUrl}/kbo/player/pitcher_vs_batter?pitcher_id=${encodeURIComponent(pitcherId)}&${query}`, stage);
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
        const matchup = player.matchup || {};
        const matchupScore = percentile(matchup.adjustedOps, 0.400, 1.150);
        const matchupConfidence = (matchup.reliability || 0) * 100;
        player.matchupPoint = Math.round(
          0.42 * matchupScore + 0.18 * matchupConfidence
          + 0.20 * (recentScore * paWeight + 50 * (1 - paWeight))
          + 0.15 * seasonScore + 0.05 * leaderScore
        );
        player.heroScore = Math.round(
          0.50 * player.matchupPoint
          + 0.28 * (recentScore * paWeight + 50 * (1 - paWeight))
          + 0.17 * seasonScore + 0.05 * availability
        );

        const decline = player.recent.ops === null ? 35 : Math.max(0, Math.min(100, 50 + (player.season.ops - player.recent.ops) * 145));
        const strikeRisk = matchup.pa > 0
          ? Math.min(100, ((matchup.k || 0) / matchup.pa) * 180)
          : ((player.recent.pa || 0) > 0 ? Math.min(100, (player.recent.k / player.recent.pa) * 360) : 30);
        const poorMatchup = 100 - matchupScore;
        player.riskPoint = Math.round(
          0.40 * poorMatchup + 0.18 * matchupConfidence + 0.17 * strikeRisk
          + 0.15 * decline + 0.10 * (100 - seasonScore)
        );
        player.horrorScore = Math.round(
          0.55 * player.riskPoint + 0.25 * decline + 0.10 * (100 - seasonScore) + 0.10 * availability
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
      if (player.matchup?.pa) reasons.push(`오늘 선발 상대 OPS ${format3(player.matchup.ops)} · ${player.matchup.pa}PA`);
      if (player.matchup?.hr) reasons.push(`오늘 선발 상대 홈런 ${player.matchup.hr}개`);
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
      if (player.matchup?.pa) reasons.push(`오늘 선발 상대 OPS ${format3(player.matchup.ops)} · ${player.matchup.pa}PA`);
      if (player.matchup?.pa && player.matchup?.k) reasons.push(`오늘 선발 상대 삼진 ${player.matchup.k}개`);
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

  function eligiblePlayers() {
    return state.players.filter((player) => player.starter || (player.type === 'batter'
      ? (player.season.pa || 0) >= 40 && ((player.recent.pa || 0) >= 4 || (player.season.pa || 0) >= 180)
      : (player.season.games || 0) >= 9));
  }

  function recommendationList(type) {
    const scoreKey = type === 'hero' ? 'heroScore' : 'horrorScore';
    const preferred = eligiblePlayers().filter((player) => player.type === 'batter' || player.starter);
    return [...preferred].sort((a, b) => b[scoreKey] - a[scoreKey]).slice(0, 3);
  }

  function featuredMetric(player) {
    if (player.type === 'pitcher') return { label: 'ERA', value: format2(player.season.era) };
    const rank = player.ranks?.[0];
    if (rank?.key === 'hr') return { label: '홈런', value: `${player.season.hr ?? '—'}개` };
    if (rank?.key === 'steal') return { label: '도루', value: `${player.season.steal ?? '—'}개` };
    if (player.recent.ops !== null && player.recent.ops >= 0.9) return { label: '최근 OPS', value: format3(player.recent.ops) };
    return { label: 'OPS', value: format3(player.season.ops) };
  }

  function imageMarkup(player, className = '') {
    return `<div class="${className} hh-image-shell"><img src="${escapeHtml(player.imageUrl)}" alt="${escapeHtml(player.name)}" loading="lazy"><div class="hh-image-fallback">${escapeHtml(player.name.slice(-2))}</div></div>`;
  }

  function recommendationCard(type, player, index, total) {
    if (!player) return '';
    const isHero = type === 'hero';
    const reasons = isHero ? player.heroReasons : player.horrorReasons;
    const metric = featuredMetric(player);
    const selected = (isHero ? state.hero : state.horror) === player.id;
    return `<article class="hh-casting-card ${type} ${selected ? 'selected' : ''}">
      <div class="hh-card-glow"></div>
      <div class="hh-card-topline"><span>${isHero ? '오늘의 HERO 후보' : '오늘의 변수 후보'}</span><b>${index + 1} / ${total}</b></div>
      <button type="button" class="hh-casting-main" data-detail="${player.id}" aria-label="${escapeHtml(player.name)} 상세 보기">
        ${imageMarkup(player, 'hh-casting-photo')}
        <div class="hh-casting-copy">
          <small>${escapeHtml(player.teamName)} · ${escapeHtml(player.position)}</small>
          <h3>${escapeHtml(player.name)}</h3>
          <div class="hh-score-line"><strong>${isHero ? 'HERO' : 'RISK'} ${isHero ? player.heroScore : player.horrorScore}</strong><span>${escapeHtml(metric.label)} ${escapeHtml(metric.value)}</span></div>
        </div>
      </button>
      <div class="hh-story-points">${reasons.slice(0, 2).map((reason) => `<span>${escapeHtml(reason)}</span>`).join('')}</div>
      <div class="hh-carousel-controls">
        <button type="button" data-slide="${type}" data-dir="-1" aria-label="이전 후보">←</button>
        <div>${Array.from({length: total}, (_, i) => `<i class="${i === index ? 'active' : ''}"></i>`).join('')}</div>
        <button type="button" data-slide="${type}" data-dir="1" aria-label="다음 후보">→</button>
      </div>
      <button type="button" class="hh-cast-button ${type} ${selected ? 'active' : ''}" data-pick="${type}" data-id="${player.id}">${selected ? `✓ 나의 ${isHero ? 'HERO' : 'HORROR'}` : `${isHero ? 'HERO' : 'HORROR'}로 캐스팅`}</button>
      <button type="button" class="hh-why-button" data-detail="${player.id}">${isHero ? '왜 Hero 후보인가요?' : '왜 오늘의 변수인가요?'}</button>
    </article>`;
  }

  function matchupPointSection() {
    const configs = [
      { side: 'away', opponentCode: state.game.awayCode, opponentName: state.game.awayName, starterSide: 'home' },
      { side: 'home', opponentCode: state.game.homeCode, opponentName: state.game.homeName, starterSide: 'away' },
    ];
    const starterPlayer = (side) => state.players.find((player) => player.starter && player.teamCode === (side === 'away' ? state.game.awayCode : state.game.homeCode));
    const topRows = (players, type, pitcher) => players.map((player, index) => {
      const isRisk = type === 'risk';
      const point = isRisk ? player.riskPoint : player.matchupPoint;
      const matchup = player.matchup || {};
      const detail = matchup.pa
        ? `${pitcher?.name || '상대 선발'} 상대 ${matchup.pa}PA · OPS ${format3(matchup.ops)}`
        : '직접 맞대결 없음 · 최근/시즌 기록 반영';
      return `<button type="button" class="hh-matchup-row ${isRisk ? 'risk' : ''}" data-detail="${player.id}"><b>${index + 1}</b>${imageMarkup(player, 'hh-matchup-photo')}<span><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(detail)}</small></span><em>${point}<small>${isRisk ? 'RISK' : 'POINT'}</small></em></button>`;
    }).join('');

    const cards = configs.map((config) => {
      const pitcher = starterPlayer(config.starterSide);
      if (!pitcher) return '';
      const pool = state.players.filter((player) => player.type === 'batter' && player.teamCode === config.opponentCode);
      const matched = pool.filter((player) => (player.matchup?.pa || 0) > 0);
      const source = matched.length >= 3 ? matched : pool;
      const heroTop = [...source].sort((a, b) => (b.matchupPoint || 0) - (a.matchupPoint || 0)).slice(0, 3);
      const riskTop = [...source].sort((a, b) => (b.riskPoint || 0) - (a.riskPoint || 0)).slice(0, 3);
      return `<article class="hh-matchup-card"><header><div><small>TODAY'S MATCHUP POINT</small><h3>${escapeHtml(pitcher.name)} vs ${escapeHtml(config.opponentName)} 타선</h3><p>실제 맞대결에 표본 신뢰도·최근 7경기·시즌 기록을 함께 반영했습니다.</p></div><div class="hh-matchup-pitcher">${imageMarkup(pitcher, 'hh-matchup-pitcher-photo')}<span><b>ERA ${format2(pitcher.season.era)}</b><small>WHIP ${format2(pitcher.season.whip)}</small></span></div></header><div class="hh-matchup-columns"><section><h4>🔥 공략 기대 Top3</h4><div>${topRows(heroTop, 'hero', pitcher) || '<p class="hh-empty">맞대결 데이터가 없습니다.</p>'}</div></section><section><h4>⚠ 주의 후보 Top3</h4><div>${topRows(riskTop, 'risk', pitcher) || '<p class="hh-empty">맞대결 데이터가 없습니다.</p>'}</div></section></div><p class="hh-matchup-note">20PA 미만은 리그 평균 OPS 방향으로 보정해 작은 표본의 과대평가를 줄였습니다.</p></article>`;
    }).join('');
    return cards ? `<section class="hh-matchup-point"><div class="hh-section-heading"><div><small>MATCHUP POINT</small><h3>오늘 선발과 상대 타자의 맞대결</h3></div><span>실제 BvP 데이터</span></div>${cards}</section>` : '';
  }

  function compactPlayerCard(player) {
    const trend = trendMeta(player.trend);
    const metric = featuredMetric(player);
    const selectedHero = state.hero === player.id;
    const selectedHorror = state.horror === player.id;
    return `<article class="hh-compact-player ${selectedHero ? 'is-hero' : ''} ${selectedHorror ? 'is-horror' : ''}">
      <button type="button" class="hh-player-open" data-detail="${player.id}">
        ${imageMarkup(player, 'hh-compact-photo')}
        <div><small>${escapeHtml(player.teamName)} · ${escapeHtml(player.position)}</small><h4>${escapeHtml(player.name)}</h4><span class="hh-featured-stat">${escapeHtml(metric.label)} <b>${escapeHtml(metric.value)}</b></span><em class="hh-trend ${trend.cls}">${trend.text}</em></div>
      </button>
      <div class="hh-compact-actions"><button data-pick="hero" data-id="${player.id}" class="hero ${selectedHero ? 'active' : ''}">${selectedHero ? '✓ HERO' : 'HERO'}</button><button data-pick="horror" data-id="${player.id}" class="horror ${selectedHorror ? 'active' : ''}">${selectedHorror ? '✓ HORROR' : 'HORROR'}</button></div>
    </article>`;
  }

  function fullView() {
    const filtered = eligiblePlayers().filter((player) => state.teamFilter === 'ALL' || player.teamCode === state.teamFilter);
    const batters = filtered.filter((p) => p.type === 'batter').sort((a,b)=>Math.max(b.heroScore,b.horrorScore)-Math.max(a.heroScore,a.horrorScore));
    const pitchers = filtered.filter((p) => p.type === 'pitcher').sort((a,b)=>(b.starter?100:0)+Math.max(b.heroScore,b.horrorScore)-((a.starter?100:0)+Math.max(a.heroScore,a.horrorScore)));
    const visibleBatters = batters.slice(0, Math.max(4, state.fullLimit - 2));
    const visiblePitchers = pitchers.slice(0, Math.min(4, Math.ceil(state.fullLimit/3)));
    const totalVisible = visibleBatters.length + visiblePitchers.length;
    const total = batters.length + pitchers.length;
    return `<section class="hh-full-view">
      <div class="hh-team-chips">${[['ALL','전체'],[state.game.awayCode,state.game.awayName],[state.game.homeCode,state.game.homeName]].map(([v,l])=>`<button data-team="${v}" class="${state.teamFilter===v?'active':''}">${escapeHtml(l)}</button>`).join('')}</div>
      <div class="hh-section-heading"><div><small>SPOTLIGHT BATTERS</small><h3>주목할 타자</h3></div><span>${visibleBatters.length}명</span></div>
      <div class="hh-compact-grid">${visibleBatters.map(compactPlayerCard).join('') || '<p class="hh-empty">표시할 타자가 없습니다.</p>'}</div>
      <div class="hh-section-heading hh-pitcher-heading"><div><small>TODAY\'S PITCHERS</small><h3>오늘의 투수</h3></div><span>${visiblePitchers.length}명</span></div>
      <div class="hh-compact-grid">${visiblePitchers.map(compactPlayerCard).join('') || '<p class="hh-empty">표시할 투수가 없습니다.</p>'}</div>
      ${totalVisible < total ? '<button id="hhMore" class="hh-more-casting">선수 더보기</button>' : ''}
    </section>`;
  }

  function playPlayerCard(player) {
    const selectedHero = state.hero === player.id;
    const selectedHorror = state.horror === player.id;
    return `<article class="hh-play-player ${selectedHero ? 'is-hero' : ''} ${selectedHorror ? 'is-horror' : ''}">
      <button type="button" class="hh-play-player-main" data-detail="${player.id}">
        ${imageMarkup(player, 'hh-play-photo')}
        <span><small>${escapeHtml(player.teamName)} · ${escapeHtml(player.position)}</small><b>${escapeHtml(player.name)}</b>${player.number ? `<em>#${escapeHtml(player.number)}</em>` : ''}</span>
      </button>
      <div class="hh-play-actions"><button type="button" data-pick="hero" data-id="${player.id}" class="hero ${selectedHero ? 'active' : ''}">${selectedHero ? '✓ HERO' : 'HERO'}</button><button type="button" data-pick="horror" data-id="${player.id}" class="horror ${selectedHorror ? 'active' : ''}">${selectedHorror ? '✓ HORROR' : 'HORROR'}</button></div>
    </article>`;
  }

  function playView() {
    const filtered = eligiblePlayers().filter((player) => player.type === 'batter' && (state.teamFilter === 'ALL' || player.teamCode === state.teamFilter));
    const players = [...filtered].sort((a, b) => a.teamCode.localeCompare(b.teamCode) || a.name.localeCompare(b.name, 'ko'));
    const visible = players.slice(0, state.fullLimit);
    return `<section class="hh-play-view">
      <div class="hh-play-guide"><small>PLAY · NO RECOMMENDATION</small><h3>오늘은 누구일까요?</h3><p>추천 점수 없이 내 감과 응원으로 Hero와 Horror를 직접 선택하세요.</p></div>
      <div class="hh-team-chips">${[['ALL','전체'],[state.game.awayCode,state.game.awayName],[state.game.homeCode,state.game.homeName]].map(([v,l])=>`<button data-team="${v}" class="${state.teamFilter===v?'active':''}">${escapeHtml(l)}</button>`).join('')}</div>
      <div class="hh-play-grid">${visible.map(playPlayerCard).join('') || '<p class="hh-empty">표시할 타자가 없습니다.</p>'}</div>
      ${visible.length < players.length ? '<button id="hhMore" class="hh-more-casting">선수 더보기</button>' : ''}
    </section>`;
  }

  function selectionBar() {
    const hero = state.players.find((p) => p.id === state.hero);
    const horror = state.players.find((p) => p.id === state.horror);
    const mini = (label, player, type) => `<div class="hh-cast-slot ${type}"><small>${label}</small>${player ? `${imageMarkup(player, 'hh-mini-photo')}<b>${escapeHtml(player.name)}</b><button type="button" class="hh-clear-pick" data-clear-pick="${type}" aria-label="${label} 선택 해제">×</button>` : '<b>선택 전</b>'}</div>`;
    return `<div class="hh-sticky-casting"><span>내 캐스팅</span>${mini('HERO',hero,'hero')}${mini('HORROR',horror,'horror')}<button id="hhComplete" ${hero&&horror?'':'disabled'}>${hero&&horror?'선택 확정':'두 선수 선택'}</button></div>`;
  }

  function render() {
    const mount = root();
    if (!mount) return;
    if (state.loading) {
      mount.innerHTML = '<div class="card hh-loading-card"><h2>Hero / Horror</h2><p class="hint">오늘의 캐스팅 후보를 불러오고 있습니다.</p><div class="hh-skeleton"></div></div>';
      return;
    }
    if (state.error) {
      mount.innerHTML = `<div class="card hh-error-card"><h2>Hero / Horror</h2><p>${escapeHtml(state.error)}</p><button id="hhRetry">다시 시도</button></div>`;
      document.getElementById('hhRetry')?.addEventListener('click', load);
      return;
    }
    const plusMode = isPlusMode();
    const heroList = plusMode ? recommendationList('hero') : [];
    const horrorList = plusMode ? recommendationList('horror') : [];
    state.heroIndex = Math.min(state.heroIndex, Math.max(0, heroList.length - 1));
    state.horrorIndex = Math.min(state.horrorIndex, Math.max(0, horrorList.length - 1));
    const gameMeta = [state.game.time, state.game.stadium].filter(Boolean).join(' · ');
    mount.innerHTML = `
      <section class="hh-casting-header ${plusMode ? 'plus' : 'play'}">
        <div><small>${plusMode ? 'KBO PLAY+ DATA CASTING' : 'KBO PLAY CASTING'}</small><h2>${plusMode ? '데이터로 오늘의 Hero를 찾으세요' : '오늘의 Hero를 직접 골라보세요'}</h2><p><b>${escapeHtml(state.game.awayName)}</b> vs <b>${escapeHtml(state.game.homeName)}</b>${gameMeta?` · ${escapeHtml(gameMeta)}`:''}</p></div>
        <div class="hh-live-dot"><i></i> ${plusMode ? 'PLAY+ DATA' : 'PLAY'}</div>
      </section>
      ${selectionBar()}
      ${plusMode ? `<nav class="hh-view-tabs" aria-label="보기 방식"><button data-view="recommend" class="${state.viewMode==='recommend'?'active':''}">AI 추천</button><button data-view="full" class="${state.viewMode==='full'?'active':''}">전체 선수</button></nav>${state.viewMode === 'recommend' ? `<section class="hh-recommend-view"><div class="hh-casting-grid">${recommendationCard('hero', heroList[state.heroIndex], state.heroIndex, heroList.length)}${recommendationCard('horror', horrorList[state.horrorIndex], state.horrorIndex, horrorList.length)}</div>${matchupPointSection()}</section>` : fullView()}` : playView()}
    `;
    bindEvents();
    bindImageFallbacks();
  }

  function bindImageFallbacks(scope = document) {
    scope.querySelectorAll?.('.hh-image-shell img').forEach((img) => {
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
    if (type === 'hero') state.hero = state.hero === id ? null : id;
    if (type === 'horror') state.horror = state.horror === id ? null : id;
    localStorage.setItem(`kboHeroHorror:${state.game.id}`, JSON.stringify({ hero: state.hero, horror: state.horror }));
    render();
  }

  function detailElements() {
    return {
      body: document.getElementById('detailBody') || document.getElementById('detailContent'),
      title: document.getElementById('detailTitle'),
      sheet: document.getElementById('detailSheet'),
      overlay: document.getElementById('overlay'),
    };
  }

  function openDetailSheet(player, html) {
    const { body, title, sheet, overlay } = detailElements();
    if (!body || !sheet || !overlay) {
      console.error('[Hero/Horror] 상세 시트 DOM을 찾지 못했습니다.');
      window.showToast?.('상세 화면을 열 수 없습니다.');
      return false;
    }
    if (title) title.textContent = `${player.name} 상세`;
    body.innerHTML = html;
    overlay.classList.add('open');
    sheet.classList.add('open');
    bindImageFallbacks(sheet);
    return true;
  }

  function statCards(rows) {
    return `<div class="newsgrid hh-detail-grid">${rows.map(([label, value]) => `<div class="newscard"><strong>${escapeHtml(label)}</strong><b>${escapeHtml(value)}</b></div>`).join('')}</div>`;
  }

  function fullSeasonRows(player) {
    if (player.type === 'batter') {
      return [
        ['경기', player.season.games ?? '—'], ['타석', player.season.pa ?? '—'],
        ['타율', format3(player.season.avg)], ['출루율', format3(player.season.obp)],
        ['장타율', format3(player.season.slg)], ['OPS', format3(player.season.ops)],
        ['홈런', player.season.hr ?? '—'], ['타점', player.season.rbi ?? '—'],
        ['득점', player.season.run ?? '—'], ['도루', player.season.steal ?? '—'],
        ['삼진', player.season.k ?? '—'], ['병살', player.season.dpo ?? '—'],
      ];
    }
    return [
      ['경기', player.season.games ?? '—'], ['승-패', `${player.season.win ?? 0}-${player.season.lose ?? 0}`],
      ['ERA', format2(player.season.era)], ['WHIP', format2(player.season.whip)],
      ['이닝', player.season.inn || '—'], ['탈삼진', player.season.k ?? '—'],
      ['K/9', format2(player.season.k9)], ['QS', player.season.qs ?? '—'],
      ['홀드', player.season.hold ?? '—'], ['세이브', player.season.save ?? '—'],
      ['볼넷', player.season.bb ?? '—'], ['피홈런', player.season.hr ?? '—'],
    ];
  }

  function batterRecentRows(player) {
    return [
      ['경기', player.recent.games ?? '—'], ['타석', player.recent.pa ?? '—'],
      ['타율', format3(player.recent.avg)], ['OPS', format3(player.recent.ops)],
      ['홈런', player.recent.hr ?? '—'], ['삼진', player.recent.k ?? '—'],
    ];
  }

  function inningsText(row) {
    const inning = numberValue(row?.inning);
    const sub = numberValue(row?.inning_sub);
    if (inning === null) return '—';
    return sub ? `${inning}.${sub}` : String(inning);
  }

  function normalizePitcherSplits(payload) {
    const split = Array.isArray(payload?.season_split) ? payload.season_split[0] : null;
    const rows = split?.pit?.last;
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => ({
      games: numberValue(row.games), detail: textValue(row.split_detail), innings: inningsText(row),
      win: numberValue(row.win), lose: numberValue(row.lose), era: numberValue(row.era),
      whip: numberValue(row.whip), k: numberValue(row.k), hits: numberValue(row.hits),
      bb: numberValue(row.bb), hr: numberValue(row.hr), avg: numberValue(row.avg),
    })).sort((a, b) => Number(a.detail) - Number(b.detail));
  }

  async function fetchPitcherDetail(player) {
    if (state.detailCache.has(player.id)) return state.detailCache.get(player.id);
    const url = `${CONFIG.baseUrl}/kbo/player/season_split?player_id=${encodeURIComponent(player.pid)}&season=${state.game.season}&split_type=season&split_type=last`;
    const payload = await fetchJson(url, `${player.name} 최근 전적 API`);
    const result = normalizePitcherSplits(payload);
    state.detailCache.set(player.id, result);
    return result;
  }

  function detailHeader(player) {
    return `<div class="hh-detail-head">${imageMarkup(player, 'hh-detail-photo')}<div><small>${escapeHtml(player.teamName)}</small><h3>${escapeHtml(player.name)}</h3><p>${escapeHtml(player.position)}${player.side ? ` · ${escapeHtml(player.side)}` : ''}${player.number ? ` · #${escapeHtml(player.number)}` : ''}</p></div></div>`;
  }

  function aiDetail(player) {
    if (!isPlusMode()) return '';
    const ranks = player.ranks.slice(0, 4).map((r) => `${STAT_LABELS[r.key] || r.key} 팀 ${r.rank}위`).join(' · ');
    return `<div class="ai-note hh-detail-ai"><b>AI Hero ${player.heroScore} · Horror Risk ${player.horrorScore}</b><br>${escapeHtml(player.heroReasons.join(' · '))}${ranks ? `<br><span>${escapeHtml(ranks)}</span>` : ''}</div>`;
  }

  async function showDetail(player) {
    if (!player) return;
    const loadingHtml = `${detailHeader(player)}<div class="hh-detail-loading"><span></span><b>상세 데이터를 불러오고 있습니다.</b></div>`;
    if (!openDetailSheet(player, loadingHtml)) return;

    try {
      const primaryReasons = player.heroReasons.slice(0, 3);
      const story = isPlusMode() ? `<section class="hh-detail-story"><small>DATA STORY</small><h4>${escapeHtml(player.name)}은 왜 오늘의 후보일까요?</h4>${primaryReasons.map((reason, i) => `<div><b>${i + 1}</b><span>${escapeHtml(reason)}</span></div>`).join('')}</section>` : '';
      let html = `${detailHeader(player)}${story}<details class="hh-stat-details" open><summary>시즌 기록 자세히</summary>${statCards(fullSeasonRows(player))}</details>`;
      if (player.type === 'batter') {
        const opposingStarter = state.players.find((candidate) => candidate.starter && candidate.teamCode !== player.teamCode);
        if (isPlusMode() && player.matchup?.pa) html += `<h4>오늘 선발 ${escapeHtml(opposingStarter?.name || '')} 상대전적</h4>${statCards([
          ['경기', player.matchup.games ?? '—'], ['타석', player.matchup.pa ?? '—'],
          ['타율', format3(player.matchup.avg)], ['OPS', format3(player.matchup.ops)],
          ['안타', player.matchup.hit ?? '—'], ['홈런', player.matchup.hr ?? '—'], ['삼진', player.matchup.k ?? '—'], ['Matchup Point', player.matchupPoint ?? '—'],
        ])}<div class="hh-matchup-detail-note">${player.matchup.pa < 5 ? '맞대결 표본이 적어 최근·시즌 성적을 함께 반영했습니다.' : '실제 맞대결과 최근·시즌 성적을 종합한 결과입니다.'}</div>`;
        else html += '<div class="hh-detail-empty">오늘 선발과의 직접 맞대결 기록이 없어 최근·시즌 기록 중심으로 평가했습니다.</div>';
        html += `<h4>최근 7경기 흐름</h4>${statCards(batterRecentRows(player))}`;
      } else {
        const splits = await fetchPitcherDetail(player);
        if (splits.length) {
          html += `<h4>최근 등판 구간</h4><div class="hh-split-list">${splits.map((row) => `<section class="hh-split-card"><div><small>최근 ${escapeHtml(row.detail || row.games || '')}경기</small><strong>${row.win ?? 0}승 ${row.lose ?? 0}패</strong></div>${statCards([
            ['ERA', format2(row.era)], ['WHIP', format2(row.whip)], ['이닝', row.innings], ['탈삼진', row.k ?? '—'], ['피안타', row.hits ?? '—'], ['피안타율', format3(row.avg)],
          ])}</section>`).join('')}</div>`;
        } else {
          html += '<div class="hh-detail-empty">최근 등판 상세 데이터가 없습니다.</div>';
        }
      }
      html += `${aiDetail(player)}<div class="hh-detail-cast-actions"><button data-sheet-pick="hero" data-id="${player.id}">HERO로 캐스팅</button><button data-sheet-pick="horror" data-id="${player.id}">HORROR로 캐스팅</button></div>`;
      const { body, sheet } = detailElements();
      if (body) { body.innerHTML = html; body.querySelectorAll('[data-sheet-pick]').forEach((button) => button.addEventListener('click', () => choose(button.dataset.sheetPick, button.dataset.id))); }
      if (sheet) bindImageFallbacks(sheet);
    } catch (error) {
      console.error('[Hero/Horror detail]', error);
      const { body, sheet } = detailElements();
      if (body) body.innerHTML = `${detailHeader(player)}<h4>시즌 상세 기록</h4>${statCards(fullSeasonRows(player))}<div class="hh-detail-warning">최근 전적 API를 불러오지 못했습니다. 시즌 기록은 정상적으로 표시했습니다.<br><small>${escapeHtml(error.message || '')}</small></div>${aiDetail(player)}`;
      if (sheet) bindImageFallbacks(sheet);
    }
  }

  function bindEvents() {
    root()?.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
      state.viewMode = button.dataset.view;
      render();
    }));
    root()?.querySelectorAll('[data-team]').forEach((button) => button.addEventListener('click', () => {
      state.teamFilter = button.dataset.team;
      state.fullLimit = 8;
      render();
    }));
    root()?.querySelectorAll('[data-slide]').forEach((button) => button.addEventListener('click', () => {
      const type = button.dataset.slide;
      const list = recommendationList(type);
      if (!list.length) return;
      const key = type === 'hero' ? 'heroIndex' : 'horrorIndex';
      state[key] = (state[key] + Number(button.dataset.dir) + list.length) % list.length;
      render();
    }));
    root()?.querySelectorAll('[data-pick]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      choose(button.dataset.pick, button.dataset.id);
    }));
    root()?.querySelectorAll('[data-clear-pick]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const type = button.dataset.clearPick;
      if (type === 'hero') state.hero = null;
      if (type === 'horror') state.horror = null;
      localStorage.setItem(`kboHeroHorror:${state.game.id}`, JSON.stringify({ hero: state.hero, horror: state.horror }));
      render();
    }));
    root()?.querySelectorAll('[data-detail]').forEach((button) => button.addEventListener('click', () => showDetail(state.players.find((p) => p.id === button.dataset.detail))));
    document.getElementById('hhMore')?.addEventListener('click', () => { state.fullLimit += 6; render(); });
    const complete = document.getElementById('hhComplete');
    if (complete && !complete.disabled) complete.addEventListener('click', () => window.showToast?.('오늘의 Hero / Horror 캐스팅이 확정되었습니다.'));
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

      const awayBatters = state.players.filter((player) => player.type === 'batter' && player.teamCode === state.game.awayCode);
      const homeBatters = state.players.filter((player) => player.type === 'batter' && player.teamCode === state.game.homeCode);
      const matchupResults = await Promise.allSettled([
        fetchPitcherVsBatters(starterResult?.home?.pid, awayBatters, `${state.game.homeName} 선발 대 ${state.game.awayName} 타자 맞대결 API`),
        fetchPitcherVsBatters(starterResult?.away?.pid, homeBatters, `${state.game.awayName} 선발 대 ${state.game.homeName} 타자 맞대결 API`),
      ]);
      state.matchups.away = matchupResults[0].status === 'fulfilled' && Array.isArray(matchupResults[0].value) ? matchupResults[0].value : [];
      state.matchups.home = matchupResults[1].status === 'fulfilled' && Array.isArray(matchupResults[1].value) ? matchupResults[1].value : [];
      matchupResults.forEach((result) => { if (result.status === 'rejected') console.warn('[Hero/Horror matchup]', result.reason); });
      applyMatchupData();
      scorePlayers();
      const saved = JSON.parse(localStorage.getItem(`kboHeroHorror:${state.game.id}`) || '{}');
      state.hero = saved.hero || null;
      state.horror = saved.horror || null;
      state.loading = false;
      render();
    } catch (error) {
      console.error('[Hero/Horror v34]', error);
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
