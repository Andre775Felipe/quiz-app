document.addEventListener('DOMContentLoaded', () => {
  const perguntas = Array.from(document.querySelectorAll('.pergunta'));
  const btnFinalizar = document.getElementById('btnFinalizar');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const form = document.getElementById('quizForm');

  const totalPerguntas = perguntas.length;
  const idsPerguntas = perguntas.map(p => parseInt(p.dataset.id, 10));
  const respostas = [];
  const respostasErradas = [];

  let perguntaAtual = 0;
  let pontuacao = 0;
  let isSubmitting = false;
  let resultadoIndice = null;

  // Envia resultado inicial ao carregar
  const nomeInput = document.getElementById('nomeUsuario');
  const nome = (nomeInput?.value ?? '').trim();

  fetch('/resultado-inicial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome, idsPerguntas })
  })
    .then(r => r.json())
    .then(data => {
      resultadoIndice = data.indice;
    });


  // 🔒 Previne envio automático do form
  if (form) {
    form.addEventListener('submit', e => e.preventDefault());
  }

  // 🔁 Fallback: coleta respostas direto do DOM
  function coletarRespostasDoDOM() {
    const out = [];
    perguntas.forEach(p => {
      const id = parseInt(p.dataset.id, 10);
      const marcadaEl = p.querySelector('.opcao:checked');
      if (Number.isInteger(id) && marcadaEl) {
        const marcada = parseInt(marcadaEl.value, 10);
        if (Number.isInteger(marcada)) out.push({ id, marcada });
      }
    });
    return out;
  }

  function atualizarProgresso() {
    const respondidas = Math.min(respostas.length, totalPerguntas);
    const pct = Math.round((respondidas / totalPerguntas) * 100);
    progressBar.style.width = `${pct}%`;
    progressBar.setAttribute('aria-valuenow', respondidas);
    if (progressText) progressText.textContent = `${respondidas}/${totalPerguntas}`;
  }

  function limparFeedbackDoLabel(lbl) {
    lbl.classList.remove(
      'list-group-item-success',
      'list-group-item-danger',
      'bg-success',
      'bg-danger',
      'bg-opacity-50',
      'text-dark',
      'text-white',
      'disabled',
      'd-block',
      'w-100',
      'p-2',
      'rounded-2'
    );
  }

  function prepararOpcoesDaPergunta(containerPergunta) {
    containerPergunta.querySelectorAll('.opcao').forEach(o => {
      const lbl = containerPergunta.querySelector(`label[for="${o.id}"]`);
      if (lbl) limparFeedbackDoLabel(lbl);

      if (containerPergunta.classList.contains('respondida')) {
        o.disabled = true;
        o.setAttribute('aria-disabled', 'true');
      } else {
        o.disabled = false;
        o.removeAttribute('aria-disabled');
      }
    });
  }

  function mostrarPergunta(indice) {
    perguntas.forEach((p, i) => {
      if (i === indice) {
        p.classList.remove('d-none');
        prepararOpcoesDaPergunta(p);
        const primeiraOpcao = p.querySelector('.opcao:not([disabled])');
        if (primeiraOpcao) primeiraOpcao.focus();
        p.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        p.classList.add('d-none');
      }
    });
  }

  mostrarPergunta(perguntaAtual);
  atualizarProgresso();

  perguntas.forEach((perguntaDiv, idx) => {
    const opcoes = perguntaDiv.querySelectorAll('.opcao');

    opcoes.forEach(opcao => {
      opcao.addEventListener('change', () => {
        if (perguntaDiv.classList.contains('respondida')) return;

        const id = parseInt(perguntaDiv.dataset.id, 10);
        const marcada = parseInt(opcao.value, 10);
        const correta = parseInt(perguntaDiv.dataset.correta, 10);

        respostas.push({ id, marcada });
        perguntaDiv.classList.add('respondida');

        opcoes.forEach(o => {
          const lbl = perguntaDiv.querySelector(`label[for="${o.id}"]`);
          const val = parseInt(o.value, 10);
          if (lbl) {
            limparFeedbackDoLabel(lbl);
            lbl.classList.add('disabled', 'd-block', 'w-100', 'p-2', 'rounded-2');
            if (val === correta) {
              lbl.classList.add('bg-success', 'bg-opacity-50', 'text-dark');
            }
            if (o === opcao && val !== correta) {
              lbl.classList.add('bg-danger', 'bg-opacity-50', 'text-dark');
            }
          }
          o.disabled = true;
          o.setAttribute('aria-disabled', 'true');
        });

        if (marcada === correta) {
          pontuacao++;
        } else {
          const lblMarcada = perguntaDiv.querySelector(`label[for="${id}-${marcada}"]`);
          const lblCorreta = perguntaDiv.querySelector(`label[for="${id}-${correta}"]`);
          respostasErradas.push({
            id,
            pergunta: perguntaDiv.querySelector('h5')?.innerText ?? `Pergunta ${idx + 1}`,
            respostaErrada: lblMarcada ? lblMarcada.innerText.trim() : `Opção ${marcada}`,
            respostaCorreta: lblCorreta ? lblCorreta.innerText.trim() : `Opção ${correta}`,
            disciplina: perguntaDiv.dataset.disciplina
          });
        }

        atualizarProgresso();

        // Se ainda não chegou nas 3 últimas perguntas → envia parcial
        if (resultadoIndice !== null && perguntaAtual < totalPerguntas - 3) {
          fetch('/resultado-parcial', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              indice: resultadoIndice,
              resposta: { id, marcada }
            })
          }).catch(err => console.error('Erro ao salvar parcial:', err));
        }

        // Se entrou nas 3 últimas, mostra aviso no placar
        if (perguntaAtual === totalPerguntas - 3) {
          const aviso = document.getElementById('placarAviso');
          if (aviso) aviso.textContent = "⚠️ 3 perguntas restantes!";
        }



        if (perguntaAtual === totalPerguntas - 1) {
          btnFinalizar.classList.remove('d-none');
          btnFinalizar.focus();
          document.querySelector('body')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          setTimeout(() => {
            perguntaAtual++;
            mostrarPergunta(perguntaAtual);
          }, 3000);
        }
      });
    });
  });

  btnFinalizar.addEventListener('click', () => {
    if (isSubmitting) return;
    isSubmitting = true;
    btnFinalizar.disabled = true;
    btnFinalizar.textContent = 'Enviando...';

    const nomeInput = document.getElementById('nomeUsuario');
    const nome = (nomeInput?.value ?? '').trim();

    if (!nome) {
      alert('Por favor, informe seu nome antes de finalizar o quiz.');
      btnFinalizar.disabled = false;
      btnFinalizar.textContent = 'Finalizar Quiz';
      isSubmitting = false;
      return;
    }

    let respostasSanitizadas = respostas
      .filter(r => Number.isInteger(r.id) && Number.isInteger(r.marcada))
      .map(r => ({ id: Number(r.id), marcada: Number(r.marcada) }));

    if (respostasSanitizadas.length === 0) {
      respostasSanitizadas = coletarRespostasDoDOM();
    }

    const payload = {
      indice: resultadoIndice, // garante que atualiza o mesmo registro
      nome,
      totalPerguntas: totalPerguntas,
      respostas: respostasSanitizadas,
      respostasErradas,
      idsPerguntas,
      dataHora: new Date().toISOString()
    };


    console.log('[QUIZ] Enviando payload:', payload);

    fetch('/resultado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', // ✅ mantém cookies de sessão
      body: JSON.stringify(payload),
      redirect: 'follow'
    })
      .then(response => {
        if (response.redirected) {
          window.location.href = response.url;
          return;
        }
        if (response.ok) {
          return response.text().then(txt => console.log('Resposta do servidor:', txt));
        }
        return response.text().then(text => {
          throw new Error(`Erro do servidor (${response.status}): ${text}`);
        });
      })
      .catch(err => {
        console.error('Erro ao enviar resultado:', err);
        alert('Erro ao enviar resultado: ' + err.message);
        btnFinalizar.disabled = false;
        btnFinalizar.textContent = 'Finalizar Quiz';
        isSubmitting = false;
      });
  });
});
