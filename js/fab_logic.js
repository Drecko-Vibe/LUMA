// =========================================================
// VARIÁVEIS GLOBAIS
// =========================================================
let isDragging = false;
let startX, startY, initialLeft, initialTop;
let idleTimeout;
const IDLE_TIME = 3000;

// =========================================================
// INICIALIZADOR
// =========================================================
function iniciarFisicaDoLuma() {
  const container = document.getElementById('luma-fab-container');
  const fab = document.getElementById('luma-main-fab');

  if (!container || !fab) return;

  container.style.left = `${window.innerWidth - 90}px`;
  container.style.top = `${window.innerHeight - 90}px`;
  iniciarModoSono(); 

  fab.addEventListener('mousedown', (e) => {
    isDragging = false;
    startX = e.clientX;
    startY = e.clientY;
    
    const rect = container.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    container.style.transition = 'none';
    container.classList.remove('luma-sleeping');
    container.classList.add('luma-dragging');
    clearTimeout(idleTimeout);

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    if (Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5) {
      isDragging = true;
      container.classList.remove('luma-menu-open');
    }

    if (isDragging) {
      let newLeft = initialLeft + (e.clientX - startX);
      let newTop = initialTop + (e.clientY - startY);
      
      const maxLeft = window.innerWidth - container.offsetWidth;
      const maxTop = window.innerHeight - container.offsetHeight;
      
      container.style.left = `${Math.max(0, Math.min(newLeft, maxLeft))}px`;
      container.style.top = `${Math.max(0, Math.min(newTop, maxTop))}px`;
    }
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    container.classList.remove('luma-dragging');

    if (isDragging) {
      container.style.transition = 'all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)';
      puxarParaBorda();
      setTimeout(() => { isDragging = false; }, 50);
    }
  }

  function puxarParaBorda() {
    const rect = container.getBoundingClientRect();
    const centroDaTela = window.innerWidth / 2;
    const centroDoBotao = rect.left + (rect.width / 2);

    if (centroDoBotao < centroDaTela) {
      container.style.left = '20px'; 
      container.classList.add('luma-left-side'); 
    } else {
      container.style.left = `${window.innerWidth - rect.width - 20}px`;
      container.classList.remove('luma-left-side'); 
    }
    iniciarModoSono();
  }

  function iniciarModoSono() {
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => {
      if (!container.classList.contains('luma-menu-open')) {
        container.classList.add('luma-sleeping');
      }
    }, IDLE_TIME);
  }

  container.addEventListener('mouseenter', () => {
    container.classList.remove('luma-sleeping');
    clearTimeout(idleTimeout);
  });

  container.addEventListener('mouseleave', () => {
    if (!isDragging) iniciarModoSono();
  });

  document.addEventListener('click', function(event) {
    if (isDragging) return;

    if (fab.contains(event.target)) {
      container.classList.toggle('luma-menu-open');
      if (container.classList.contains('luma-menu-open')) {
        container.classList.remove('luma-sleeping');
        clearTimeout(idleTimeout);
      } else {
        iniciarModoSono();
      }
      return;
    }

    if (!container.contains(event.target) && container.classList.contains('luma-menu-open')) {
      container.classList.remove('luma-menu-open');
      iniciarModoSono();
    }

    const subBtn = event.target.closest('.luma-sub-btn');
    if (subBtn) {
      const acaoEscolhida = subBtn.dataset.lumaAction;
      console.log('LUMA 2.0: Módulo ' + acaoEscolhida.toUpperCase());
      container.classList.remove('luma-menu-open'); 
      iniciarModoSono();

      if (typeof window.abrirPainelLuma === 'function') {
        window.abrirPainelLuma(acaoEscolhida);
      }
    }
  });
}