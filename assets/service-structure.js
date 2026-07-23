
(function () {
  'use strict';

  const qs = (selector, root = document) => root.querySelector(selector);

  function setTextIfChanged(element, value) {
    if (element && element.textContent.trim() !== value) {
      element.textContent = value;
    }
  }

  function createStatus() {
    if (qs('.my-status-card')) return;

    const game = qs('.game');
    if (!game || !game.parentNode) return;

    const card = document.createElement('section');
    card.className = 'my-status-card';
    card.innerHTML = `
      <div class="my-status-main">
        <span class="my-status-eyebrow">MY STATUS</span>
        <h2>LGV5</h2>
        <p>오늘도 예측하고 참여해 포인트를 쌓아보세요.</p>
      </div>
      <div class="my-status-stat"><b>1,420P</b><span>누적 포인트</span></div>
      <div class="my-status-stat"><b>27위</b><span>현재 랭킹</span></div>
      <div class="my-status-stat"><b>+280P</b><span>오늘 획득 가능</span></div>
    `;

    game.parentNode.insertBefore(card, game);
  }

  function goToTab(tabName) {
    if (typeof window.goTab === 'function') {
      window.goTab(tabName);
      return;
    }

    const target =
      document.querySelector(`[data-tab="${tabName}"]`) ||
      document.querySelector(`[data-go="${tabName}"]`);

    if (target instanceof HTMLElement) {
      target.click();
    }
  }

  function applyAiPick() {
    try {
      if (typeof window.setCategory === 'function') {
        window.setCategory('mixed');
      }

      if (typeof window.recommend === 'function') {
        window.recommend();
      }

      goToTab('bingo');
    } catch (error) {
      console.error('[Service Structure] AI Pick 적용 오류', error);
    }
  }

  function createHomeActions() {
    const home = qs('#home');
    if (!home || qs('.home-action-card', home)) return;

    const action = document.createElement('section');
    action.className = 'home-action-card';
    action.innerHTML = `
      <div class="home-action-head">
        <div>
          <h2>오늘의 플레이</h2>
          <p>경기 시작 전에 빙고와 Hero/Horror 선택을 완료하세요.</p>
        </div>
      </div>
      <div class="home-action-grid">
        <button class="home-action" type="button" data-service-go="bingo">
          <span>🎯</span>
          <b>Mission Bingo</b>
          <small>9개 미션을 골라 3×3 빙고를 완성합니다.</small>
        </button>
        <button class="home-action" type="button" data-service-go="hero">
          <span>⭐</span>
          <b>Hero / Horror</b>
          <small>오늘 활약할 선수와 변수 선수를 선택합니다.</small>
        </button>
      </div>
    `;
    home.appendChild(action);

    const pick = document.createElement('section');
    pick.className = 'ai-pick-home';
    pick.innerHTML = `
      <div class="ai-pick-row">
        <div>
          <h2>🤖 AI Pick</h2>
          <p>승부 예측과 경기 데이터를 참고해 오늘의 추천 미션 9개를 자동 구성합니다. Beta 일정에 따라 기능 노출을 끌 수 있습니다.</p>
          <div class="ai-pick-tags">
            <span>선발 6이닝+</span>
            <span>삼진 10개+</span>
            <span>멀티히트</span>
            <span>세이브 성공</span>
          </div>
        </div>
        <button class="ai-pick-btn" type="button">AI Pick 바로 적용</button>
      </div>
    `;
    home.appendChild(pick);

    action.addEventListener('click', (event) => {
      const button = event.target.closest('[data-service-go]');
      if (!button) return;
      goToTab(button.dataset.serviceGo);
    });

    const aiButton = qs('.ai-pick-btn', pick);
    if (aiButton) {
      aiButton.addEventListener('click', applyAiPick);
    }
  }

  function syncHomeVisibility() {
    const home = qs('#home');
    const isHome = Boolean(home && home.classList.contains('active'));

    if (document.body.classList.contains('home-active') !== isHome) {
      document.body.classList.toggle('home-active', isHome);
    }
  }

  function renameCategoryButton(button) {
    if (!(button instanceof HTMLElement)) return;

    const current = button.textContent.trim();
    let next = null;

    if (current.includes('공격형')) next = '🔥 타자형';
    else if (current.includes('수비형')) next = '⚾ 투수형';
    else if (current.includes('조합형')) next = '🎯 균형형';
    else if (current.includes('혼합형')) next = '🤖 AI Pick';

    if (next && current !== next) {
      button.textContent = next;
    }
  }

  function renameUI(root = document) {
    const bingoTitle =
      root.matches?.('#bingo h2') ? root :
      root.querySelector?.('#bingo h2');

    setTextIfChanged(bingoTitle, 'Mission Bingo');

    if (root.matches?.('.category-tab')) {
      renameCategoryButton(root);
    }

    root.querySelectorAll?.('.category-tab').forEach(renameCategoryButton);
  }

  let scheduled = false;

  function scheduleUiSync(root = document) {
    if (scheduled) return;
    scheduled = true;

    window.requestAnimationFrame(() => {
      scheduled = false;
      syncHomeVisibility();
      renameUI(root);
    });
  }

  function observeRelevantChanges() {
    const observer = new MutationObserver((mutations) => {
      let shouldSyncHome = false;
      const addedRoots = [];

      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'class' &&
          mutation.target instanceof HTMLElement
        ) {
          if (mutation.target.id === 'home') {
            shouldSyncHome = true;
          }
          continue;
        }

        if (mutation.type === 'childList' && mutation.addedNodes.length) {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement) {
              addedRoots.push(node);
            }
          });
        }
      }

      if (shouldSyncHome) {
        scheduleUiSync();
      }

      for (const root of addedRoots) {
        if (
          root.matches?.('#bingo h2, .category-tab') ||
          root.querySelector?.('#bingo h2, .category-tab')
        ) {
          scheduleUiSync(root);
          break;
        }
      }
    });

    const home = qs('#home');
    if (home) {
      observer.observe(home, {
        attributes: true,
        attributeFilter: ['class']
      });
    }

    const bingo = qs('#bingo');
    if (bingo) {
      observer.observe(bingo, {
        childList: true,
        subtree: true
      });
    }
  }

  function init() {
    createStatus();
    createHomeActions();
    renameUI();
    syncHomeVisibility();
    observeRelevantChanges();

    console.info('[Service Structure] v31.1 initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
