
(() => {
  const API = 'https://dataapi.spotistics.com';
  const DEFAULT_GAME_ID = new URLSearchParams(location.search).get('game') || '20260723NCLG0';
  const SEASON = Number(new URLSearchParams(location.search).get('season') || DEFAULT_GAME_ID.slice(0,4) || 2026);
  const $ = id => document.getElementById(id);
  const state = {
    gameId: DEFAULT_GAME_ID, teams:{away:'NC',home:'LG'}, starters:null,
    rosters:{}, leaders:{}, teamStats:{}, split:{}, matchups:{},
    players:[], hero:null, horror:null, view:'recommend', filter:'ALL', visible:8
  };

  const num = (v, d=0) => {
    const n = Number(v); return Number.isFinite(n) ? n : d;
  };
  const clamp = (v,min=0,max=100)=>Math.max(min,Math.min(max,v));
  const fmt = v => Number.isFinite(Number(v)) ? Number(v).toFixed(3).replace(/^0/,'') : '-';
  const apiResult = j => j?.body?.result ?? j?.result ?? null;

  async function fetchJSON(path){
    const res = await fetch(API + path, {headers:{'Accept':'application/json'}});
    if(!res.ok) throw new Error(`${res.status} ${path}`);
    return apiResult(await res.json());
  }

  async function fetchTeam(team){
    const result = await fetchJSON(`/kbo/player/team_leaders?season=${SEASON}&team=${encodeURIComponent(team)}`);
    state.leaders[team] = result;
    state.rosters[team] = result?.roster || {batters:[],pitchers:[]};
  }

  async function fetchStarterSplit(starter){
    if(!starter?.pid) return null;
    try{
      return await fetchJSON(`/kbo/player/season_split?player_id=${starter.pid}&season=${SEASON}&split_type=season&split_type=last`);
    }catch(e){ return null; }
  }

  function batterIds(team){
    return (state.rosters[team]?.batters || []).map(x=>x.pid).filter(Boolean);
  }

  async function fetchMatchup(pitcherId, opponentTeam){
    const ids = batterIds(opponentTeam);
    if(!pitcherId || !ids.length) return [];
    const qs = ids.map(id=>`batter_id=${encodeURIComponent(id)}`).join('&');
    return await fetchJSON(`/kbo/player/pitcher_vs_batter?pitcher_id=${pitcherId}&${qs}`) || [];
  }

  function normalize(value, low, high){
    return clamp((num(value)-low)/(high-low)*100);
  }

  function sampleReliability(pa){
    // 20 PA부터 최대 신뢰도로 처리하고, 1~3 PA 과대평가를 억제한다.
    return clamp(num(pa)/20*100);
  }

  function adjustedOps(rawOps, pa, baseline=.720){
    const reliability = Math.min(1, num(pa)/20);
    return num(rawOps, baseline)*reliability + baseline*(1-reliability);
  }

  function buildPlayer(team, batter){
    const matchup = state.matchups[team]?.find(m=>String(m.batter_id)===String(batter.pid)) || null;
    const recentOps = num(batter.ops_7, num(batter.ops3,.650));
    const seasonOps = num(batter.ops3,.650);
    const pa = num(matchup?.pa);
    const ops = num(matchup?.ops,.720);
    const avg = num(matchup?.avg,.250);
    const adjusted = adjustedOps(ops, pa);
    const sample = sampleReliability(pa);
    const matchupPerformance = normalize(adjusted,.400,1.150);
    const recentScore = normalize(recentOps,.350,1.100);
    const seasonScore = normalize(seasonOps,.450,1.000);
    const hrScore = clamp(num(matchup?.hr)*35);
    const contactScore = pa ? clamp(100 - num(matchup?.k)/pa*170) : 50;
    const matchupPoint = Math.round(clamp(
      matchupPerformance*.42 + sample*.18 + recentScore*.20 + seasonScore*.15 + hrScore*.03 + contactScore*.02
    ));
    const poorMatchup = normalize(1-adjusted,0,0.75);
    const kRisk = pa ? clamp(num(matchup?.k)/pa*180) : 45;
    const recentRisk = 100-recentScore;
    const seasonRisk = 100-seasonScore;
    const riskPoint = Math.round(clamp(
      poorMatchup*.40 + sample*.18 + kRisk*.17 + recentRisk*.15 + seasonRisk*.10
    ));
    return {
      id:batter.pid, team, name:batter.name, pos:batter.pos, backNum:batter.back_num,
      season:{pa:num(batter.pa),avg:num(batter.avg3),ops:seasonOps,hr:num(batter.hr),k:num(batter.k)},
      recent:{pa:num(batter.pa_7),avg:num(batter.avg_7),ops:recentOps,hr:num(batter.hr_7),k:num(batter.k_7)},
      matchup:{games:num(matchup?.games),pa,atbat:num(matchup?.atbat),hit:num(matchup?.hit),k:num(matchup?.k),hr:num(matchup?.hr),avg,ops},
      matchupPoint,riskPoint,sample,
      reasonsHero: heroReasons({matchup:{pa,ops,avg,hr:num(matchup?.hr)},recent:{ops:recentOps},season:{ops:seasonOps},sample}),
      reasonsHorror: horrorReasons({matchup:{pa,ops,k:num(matchup?.k)},recent:{ops:recentOps},season:{ops:seasonOps},sample})
    };
  }

  function heroReasons(p){
    const r=[];
    if(p.matchup.pa) r.push(`선발 상대 OPS ${fmt(p.matchup.ops)} · ${p.matchup.pa}PA`);
    if(p.matchup.hr) r.push(`맞대결 홈런 ${p.matchup.hr}개`);
    if(p.recent.ops>=.850) r.push(`최근 OPS ${fmt(p.recent.ops)}`);
    if(p.season.ops>=.800) r.push(`시즌 OPS ${fmt(p.season.ops)}`);
    if(p.sample<25 && p.matchup.pa) r.push('맞대결 표본 적음');
    return r.slice(0,3);
  }

  function horrorReasons(p){
    const r=[];
    if(p.matchup.pa) r.push(`선발 상대 OPS ${fmt(p.matchup.ops)} · ${p.matchup.pa}PA`);
    if(p.matchup.pa && p.matchup.k) r.push(`맞대결 삼진 ${p.matchup.k}개`);
    if(p.recent.ops<.600) r.push(`최근 OPS ${fmt(p.recent.ops)}`);
    if(p.season.ops<.650) r.push(`시즌 OPS ${fmt(p.season.ops)}`);
    if(p.sample<25 && p.matchup.pa) r.push('맞대결 표본 적음');
    return r.slice(0,3);
  }

  function pitcherForOpponentTeam(team){
    if(team===state.teams.away) return state.starters?.home;
    return state.starters?.away;
  }

  async function load(){
    setLoading();
    try{
      state.starters = await fetchJSON(`/kbo/game/starter?kbo_gameid=${encodeURIComponent(state.gameId)}`);
      state.teams.away = state.starters?.away?.team_name || state.teams.away;
      state.teams.home = state.starters?.home?.team_name || state.teams.home;
      await Promise.all([fetchTeam(state.teams.away),fetchTeam(state.teams.home)]);
      try{ state.teamStats = await fetchJSON(`/kbo/player/team_stat?season=${SEASON}`) || {}; }catch(e){}
      const [awaySplit,homeSplit] = await Promise.all([
        fetchStarterSplit(state.starters?.away),fetchStarterSplit(state.starters?.home)
      ]);
      state.split[state.starters?.away?.pid] = awaySplit;
      state.split[state.starters?.home?.pid] = homeSplit;
      const [vsAway,vsHome] = await Promise.all([
        fetchMatchup(state.starters?.home?.pid,state.teams.away),
        fetchMatchup(state.starters?.away?.pid,state.teams.home)
      ]);
      state.matchups[state.teams.away] = vsAway;
      state.matchups[state.teams.home] = vsHome;
      state.players = [
        ...(state.rosters[state.teams.away]?.batters||[]).map(b=>buildPlayer(state.teams.away,b)),
        ...(state.rosters[state.teams.home]?.batters||[]).map(b=>buildPlayer(state.teams.home,b))
      ];
      render();
    }catch(err){
      console.error(err);
      useDemoData();
      toast('실제 API 연결 실패로 데모 데이터를 표시합니다.');
    }
  }

  function useDemoData(){
    state.starters = {
      away:{pid:56966,pitcher_kor:'테일러',team_name:'NC',era:'4.13',whip:'1.28',win:6,lose:4},
      home:{pid:55348,pitcher_kor:'웰스',team_name:'LG',era:'3.30',whip:'1.13',win:5,lose:4}
    };
    state.teams={away:'NC',home:'LG'};
    const demo = [
      ['NC',68912,'김형준','포수',.790,.920,2,1,1,1.000],
      ['NC',62907,'박민우','내야수',.894,.860,3,1,1,.667],
      ['NC',63260,'이우성','외야수',.814,.780,2,1,0,1.000],
      ['NC',79215,'박건우','외야수',.875,1.075,2,0,1,.000],
      ['NC',51907,'김주원','내야수',.842,.540,3,0,0,.667],
      ['LG',61186,'오스틴','내야수',.930,1.020,18,7,2,1.050],
      ['LG',64166,'문성주','외야수',.801,.760,15,5,3,.820],
      ['LG',52166,'홍창기','외야수',.870,.910,21,8,2,.940],
      ['LG',60100,'박동원','포수',.760,.510,17,3,8,.490]
    ];
    state.players=demo.map(([team,id,name,pos,sops,rops,pa,hit,k,ops])=>{
      const p={pid:id,name,pos,pa:300,avg3:'.280',ops3:String(sops),hr:8,k:55,pa_7:24,avg_7:.300,ops_7:rops,hr_7:1,k_7:5};
      state.matchups[team]=state.matchups[team]||[];
      state.matchups[team].push({batter_id:id,pa,atbat:Math.max(1,pa-1),hit,k,hr:0,avg:String(hit/Math.max(1,pa-1)),ops:String(ops),games:2});
      return buildPlayer(team,p);
    });
    render();
  }

  function setLoading(){
    $('matchupCenters').innerHTML='<div class="loading-card">맞대결 데이터를 불러오는 중입니다.</div>';
    $('heroRecommendations').innerHTML='';
    $('horrorRecommendations').innerHTML='';
  }

  function render(){
    $('awayTeam').textContent=state.teams.away;
    $('homeTeam').textContent=state.teams.home;
    $('gameIdText').textContent=state.gameId;
    $('gameSummary').textContent=`${state.teams.away} vs ${state.teams.home} · 오늘 경기의 주인공과 변수를 선택하세요.`;
    renderCasting();
    renderMatchupCenters();
    renderRecommendations();
    renderFilters();
    renderAllPlayers();
    renderConfirm();
  }

  function topForTeam(team,type='hero'){
    const hasMatch = state.players.filter(p=>p.team===team && p.matchup.pa>0);
    const pool = hasMatch.length ? hasMatch : state.players.filter(p=>p.team===team);
    return [...pool].sort((a,b)=>type==='hero'?b.matchupPoint-a.matchupPoint:b.riskPoint-a.riskPoint).slice(0,3);
  }

  function renderMatchupCenters(){
    const configs=[
      {starter:state.starters?.home, opponent:state.teams.away},
      {starter:state.starters?.away, opponent:state.teams.home}
    ];
    $('matchupCenters').innerHTML=configs.map(c=>{
      const hero=topForTeam(c.opponent,'hero');
      const risk=topForTeam(c.opponent,'risk');
      const starter=c.starter||{};
      const rows=(list,riskMode)=>list.length?list.map((p,i)=>`
        <button class="top-row ${riskMode?'risk':''}" data-detail="${p.id}">
          <span class="rank">${i+1}</span>
          <span><b>${p.name}</b><small>${p.matchup.pa?`${starter.pitcher_kor} 상대 ${p.matchup.pa}PA · OPS ${fmt(p.matchup.ops)}`:'맞대결 기록 없음 · 최근/시즌 성적 반영'}</small></span>
          <span class="point"><b>${riskMode?p.riskPoint:p.matchupPoint}</b><small>${riskMode?'Risk':'Point'}</small></span>
        </button>`).join(''):'<div class="matchup-empty">표시할 선수가 없습니다.</div>';
      return `<article class="matchup-card">
        <header class="matchup-header">
          <div class="pitcher-line">
            <div><span class="eyebrow">${starter.team_name||''} STARTER</span><h3>${starter.pitcher_kor||'선발 미정'}</h3><p>vs ${c.opponent} 타선 맞대결 포인트</p></div>
            <strong>${starter.pit_hand==='L'?'좌완':starter.pit_hand==='R'?'우완':''}</strong>
          </div>
          <div class="pitcher-stats">
            <span>ERA ${starter.era||'-'}</span><span>WHIP ${starter.whip||'-'}</span><span>${starter.win||0}승 ${starter.lose||0}패</span>
          </div>
        </header>
        <div class="matchup-body">
          <p class="matchup-intro">${starter.pitcher_kor||'선발투수'}와 ${c.opponent} 타자들의 실제 맞대결에 표본 신뢰도, 최근 7경기, 시즌 OPS를 함께 반영했습니다.</p>
          <h4>🔥 공략 기대 Top3</h4><div class="top-list">${rows(hero,false)}</div>
          <h4 style="margin:16px 0 9px">⚠ 주의 후보 Top3</h4><div class="top-list">${rows(risk,true)}</div>
          <div class="matchup-note">PA가 적은 고OPS 기록은 리그 평균 방향으로 보정됩니다. 맞대결 표본이 없으면 최근·시즌 기록 중심으로 계산합니다.</div>
        </div>
      </article>`;
    }).join('');
    document.querySelectorAll('[data-detail]').forEach(el=>el.onclick=()=>openDetail(Number(el.dataset.detail)));
  }

  function globalTop(type){
    const matched=state.players.filter(p=>p.matchup.pa>0);
    const pool=matched.length>=3?matched:state.players;
    return [...pool].sort((a,b)=>type==='hero'?b.matchupPoint-a.matchupPoint:b.riskPoint-a.riskPoint).slice(0,3);
  }

  function playerCard(p,type){
    const chosen=(type==='hero'?state.hero:state.horror)===p.id;
    const score=type==='hero'?p.matchupPoint:p.riskPoint;
    const reasons=type==='hero'?p.reasonsHero:p.reasonsHorror;
    return `<article class="player-card ${type} ${chosen?'selected':''}">
      <div class="player-head">
        <div class="player-name"><b>${p.name}</b><small>${p.team} · ${p.pos||'타자'}</small></div>
        <span class="score-pill">${type==='hero'?'Matchup':'Risk'} ${score}</span>
      </div>
      <div class="reason-list">${reasons.map(x=>`<span>${x}</span>`).join('')||'<span>시즌·최근 흐름 기반</span>'}</div>
      <div class="player-actions">
        <button class="detail-btn" data-detail="${p.id}">상세 보기</button>
        <button class="select-btn" data-select="${type}:${p.id}">${chosen?'선택 해제':type==='hero'?'HERO로 캐스팅':'HORROR로 캐스팅'}</button>
      </div>
    </article>`;
  }

  function bindCards(){
    document.querySelectorAll('[data-detail]').forEach(el=>el.onclick=()=>openDetail(Number(el.dataset.detail)));
    document.querySelectorAll('[data-select]').forEach(el=>el.onclick=()=>{
      const [type,id]=el.dataset.select.split(':'); choose(type,Number(id));
    });
  }

  function renderRecommendations(){
    $('heroRecommendations').innerHTML=globalTop('hero').map(p=>playerCard(p,'hero')).join('');
    $('horrorRecommendations').innerHTML=globalTop('risk').map(p=>playerCard(p,'horror')).join('');
    bindCards();
  }

  function renderCasting(){
    const slot=(type,id)=>{
      const p=state.players.find(x=>x.id===id);
      if(!p) return `<div class="slot-top"><span class="slot-label">${type.toUpperCase()}</span></div><div class="slot-name">아직 선택하지 않았습니다.</div><div class="slot-meta">추천 또는 전체 선수에서 선택하세요.</div>`;
      return `<div class="slot-top"><span class="slot-label">${type.toUpperCase()}</span><button class="clear-one" data-clear="${type}">✕</button></div><div class="slot-name">${p.name}</div><div class="slot-meta">${p.team} · ${type==='hero'?'Matchup Point '+p.matchupPoint:'Risk Point '+p.riskPoint}</div>`;
    };
    $('heroSlot').className='cast-slot hero '+(state.hero?'filled':'');
    $('horrorSlot').className='cast-slot horror '+(state.horror?'filled':'');
    $('heroSlot').innerHTML=slot('hero',state.hero);
    $('horrorSlot').innerHTML=slot('horror',state.horror);
    document.querySelectorAll('[data-clear]').forEach(b=>b.onclick=()=>clearChoice(b.dataset.clear));
  }

  function choose(type,id){
    if(type==='hero') state.hero=state.hero===id?null:id;
    else state.horror=state.horror===id?null:id;
    renderCasting();renderRecommendations();renderAllPlayers();renderConfirm();
    toast(type==='hero'?(state.hero?'Hero를 선택했습니다.':'Hero 선택을 해제했습니다.'):(state.horror?'Horror를 선택했습니다.':'Horror 선택을 해제했습니다.'));
  }

  function clearChoice(type){
    if(type==='hero') state.hero=null; else state.horror=null;
    renderCasting();renderRecommendations();renderAllPlayers();renderConfirm();
    toast(`${type==='hero'?'Hero':'Horror'} 선택을 해제했습니다.`);
  }

  function resetAll(){
    state.hero=null;state.horror=null;
    renderCasting();renderRecommendations();renderAllPlayers();renderConfirm();
    toast('Hero와 Horror 선택을 모두 초기화했습니다.');
  }

  function renderFilters(){
    const teams=['ALL',state.teams.away,state.teams.home];
    $('teamFilters').innerHTML=teams.map(t=>`<button class="${state.filter===t?'active':''}" data-filter="${t}">${t==='ALL'?'전체':t}</button>`).join('');
    document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;state.visible=8;renderFilters();renderAllPlayers();});
  }

  function renderAllPlayers(){
    let list=[...state.players];
    if(state.filter!=='ALL') list=list.filter(p=>p.team===state.filter);
    list.sort((a,b)=>Math.max(b.matchupPoint,b.riskPoint)-Math.max(a.matchupPoint,a.riskPoint));
    $('allPlayers').innerHTML=list.slice(0,state.visible).map(p=>`
      <article class="player-card ${state.hero===p.id?'selected hero':state.horror===p.id?'selected horror':''}">
        <div class="player-head"><div class="player-name"><b>${p.name}</b><small>${p.team} · ${p.pos||'타자'}</small></div><span class="score-pill">M ${p.matchupPoint} · R ${p.riskPoint}</span></div>
        <div class="reason-list"><span>선발 상대 ${p.matchup.pa||0}PA</span><span>OPS ${p.matchup.pa?fmt(p.matchup.ops):'-'}</span><span>최근 ${fmt(p.recent.ops)}</span></div>
        <div class="player-actions"><button class="detail-btn" data-detail="${p.id}">상세 보기</button><button class="select-btn" data-open-choice="${p.id}">선택</button></div>
      </article>`).join('');
    $('loadMoreBtn').hidden=state.visible>=list.length;
    bindCards();
    document.querySelectorAll('[data-open-choice]').forEach(b=>b.onclick=()=>openDetail(Number(b.dataset.openChoice)));
  }

  function openDetail(id){
    const p=state.players.find(x=>x.id===id); if(!p)return;
    const starter=pitcherForOpponentTeam(p.team)||{};
    $('detailEyebrow').textContent=`${p.team} · ${p.pos||'타자'}`;
    $('detailTitle').textContent=p.name;
    $('detailBody').innerHTML=`
      <div class="detail-hero"><div><span class="eyebrow">TODAY'S MATCHUP</span><h3>vs ${starter.pitcher_kor||'상대 선발'}</h3><p>${p.matchup.pa?`${p.matchup.games}경기 · ${p.matchup.pa}타석`:'직접 맞대결 기록 없음'}</p></div><strong class="detail-score">${p.matchupPoint}</strong></div>
      <section class="detail-section"><h4>선발투수 상대전적</h4><div class="detail-stats">
        <div class="detail-stat"><small>PA</small><b>${p.matchup.pa||'-'}</b></div>
        <div class="detail-stat"><small>AVG</small><b>${p.matchup.pa?fmt(p.matchup.avg):'-'}</b></div>
        <div class="detail-stat"><small>OPS</small><b>${p.matchup.pa?fmt(p.matchup.ops):'-'}</b></div>
        <div class="detail-stat"><small>HIT</small><b>${p.matchup.pa?p.matchup.hit:'-'}</b></div>
        <div class="detail-stat"><small>HR</small><b>${p.matchup.pa?p.matchup.hr:'-'}</b></div>
        <div class="detail-stat"><small>K</small><b>${p.matchup.pa?p.matchup.k:'-'}</b></div>
      </div></section>
      <section class="detail-section"><h4>최근 7경기</h4><div class="detail-stats">
        <div class="detail-stat"><small>OPS</small><b>${fmt(p.recent.ops)}</b></div><div class="detail-stat"><small>AVG</small><b>${fmt(p.recent.avg)}</b></div><div class="detail-stat"><small>HR</small><b>${p.recent.hr}</b></div>
      </div></section>
      <section class="detail-section"><h4>시즌 기록</h4><div class="detail-stats">
        <div class="detail-stat"><small>OPS</small><b>${fmt(p.season.ops)}</b></div><div class="detail-stat"><small>AVG</small><b>${fmt(p.season.avg)}</b></div><div class="detail-stat"><small>HR</small><b>${p.season.hr}</b></div>
      </div></section>
      <div class="matchup-note">${p.matchup.pa<5&&p.matchup.pa?'맞대결 표본이 적습니다. Matchup Point는 표본을 보정해 최근·시즌 성적을 함께 반영합니다.':'Matchup Point는 직접 맞대결, 표본 신뢰도, 최근 7경기와 시즌 OPS를 종합한 지표입니다.'}</div>
      <div class="detail-action"><button class="hero-action" data-detail-choice="hero:${p.id}">${state.hero===p.id?'HERO 해제':'HERO 선택'}</button><button class="horror-action" data-detail-choice="horror:${p.id}">${state.horror===p.id?'HORROR 해제':'HORROR 선택'}</button></div>`;
    $('overlay').classList.add('open');$('detailSheet').classList.add('open');
    document.querySelectorAll('[data-detail-choice]').forEach(b=>b.onclick=()=>{const [t,i]=b.dataset.detailChoice.split(':');choose(t,Number(i));closeSheet();});
  }

  function closeSheet(){$('overlay').classList.remove('open');$('detailSheet').classList.remove('open')}

  function renderConfirm(){
    const h=state.players.find(x=>x.id===state.hero),r=state.players.find(x=>x.id===state.horror);
    $('confirmSummary').textContent=h&&r?`HERO ${h.name} · HORROR ${r.name}`:h?`HERO ${h.name} · Horror를 선택하세요.`:r?`Hero를 선택하세요. · HORROR ${r.name}`:'Hero와 Horror를 선택하세요.';
    $('confirmBtn').disabled=!(h&&r);
  }

  function toast(msg){
    $('toast').textContent=msg;$('toast').classList.add('show');
    clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').classList.remove('show'),1700);
  }

  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{
    state.view=b.dataset.view;
    document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x===b));
    $('recommendView').hidden=state.view!=='recommend';$('allView').hidden=state.view!=='all';
  });
  $('resetAllBtn').onclick=resetAll;
  $('loadMoreBtn').onclick=()=>{state.visible+=8;renderAllPlayers()};
  $('reloadBtn').onclick=load;
  $('overlay').onclick=closeSheet;$('closeSheetBtn').onclick=closeSheet;
  $('confirmBtn').onclick=()=>toast('캐스팅을 확정했습니다.');
  load();
})();
