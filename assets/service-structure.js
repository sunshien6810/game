
(function(){
  'use strict';

  const qs=(s,r=document)=>r.querySelector(s);

  function createStatus(){
    if(qs('.my-status-card')) return;
    const game=qs('.game');
    if(!game) return;
    const card=document.createElement('section');
    card.className='my-status-card';
    card.innerHTML=`
      <div class="my-status-main">
        <span class="my-status-eyebrow">MY STATUS</span>
        <h2>LGV5</h2>
        <p>오늘도 예측하고 참여해 포인트를 쌓아보세요.</p>
      </div>
      <div class="my-status-stat"><b>1,420P</b><span>누적 포인트</span></div>
      <div class="my-status-stat"><b>27위</b><span>현재 랭킹</span></div>
      <div class="my-status-stat"><b>+280P</b><span>오늘 획득 가능</span></div>`;
    game.parentNode.insertBefore(card,game);
  }

  function createHomeActions(){
    const home=qs('#home');
    if(!home || qs('.home-action-card',home)) return;

    const action=document.createElement('section');
    action.className='home-action-card';
    action.innerHTML=`
      <div class="home-action-head">
        <div><h2>오늘의 플레이</h2><p>경기 시작 전에 빙고와 Hero/Horror 선택을 완료하세요.</p></div>
      </div>
      <div class="home-action-grid">
        <button class="home-action" data-go="bingo"><span>🎯</span><b>Mission Bingo</b><small>9개 미션을 골라 3×3 빙고를 완성합니다.</small></button>
        <button class="home-action" data-go="hero"><span>⭐</span><b>Hero / Horror</b><small>오늘 활약할 선수와 변수 선수를 선택합니다.</small></button>
      </div>`;
    home.appendChild(action);

    const pick=document.createElement('section');
    pick.className='ai-pick-home';
    pick.innerHTML=`
      <div class="ai-pick-row">
        <div>
          <h2>🤖 AI Pick</h2>
          <p>승부 예측과 경기 데이터를 참고해 오늘의 추천 미션 9개를 자동 구성합니다. Beta 일정에 따라 기능 노출을 끌 수 있습니다.</p>
          <div class="ai-pick-tags"><span>선발 6이닝+</span><span>삼진 10개+</span><span>멀티히트</span><span>세이브 성공</span></div>
        </div>
        <button class="ai-pick-btn" type="button">AI Pick 바로 적용</button>
      </div>`;
    home.appendChild(pick);

    action.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>{
      if(typeof window.goTab==='function') window.goTab(b.dataset.go);
    }));
    qs('.ai-pick-btn',pick).addEventListener('click',()=>{
      try{
        if(typeof window.setCategory==='function') window.setCategory('mixed');
        if(typeof window.recommend==='function') window.recommend();
        if(typeof window.goTab==='function') window.goTab('bingo');
      }catch(e){console.error('[Service Structure] AI Pick 적용 오류',e)}
    });
  }

  function syncHomeVisibility(){
    const isHome=qs('#home')?.classList.contains('active');
    document.body.classList.toggle('home-active',!!isHome);
  }

  function renameUI(){
    const bingoTitle=qs('#bingo h2');
    if(bingoTitle) bingoTitle.textContent='Mission Bingo';
    document.querySelectorAll('.category-tab').forEach(btn=>{
      const t=btn.textContent;
      if(t.includes('공격형')) btn.textContent='🔥 타자형';
      if(t.includes('수비형')) btn.textContent='⚾ 투수형';
      if(t.includes('조합형')) btn.textContent='🎯 균형형';
      if(t.includes('혼합형')) btn.textContent='🤖 AI Pick';
    });
  }

  function init(){
    createStatus();
    createHomeActions();
    renameUI();
    syncHomeVisibility();

    const observer=new MutationObserver(()=>{
      syncHomeVisibility();
      renameUI();
    });
    observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['class'],childList:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
