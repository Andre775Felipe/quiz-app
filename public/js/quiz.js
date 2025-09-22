document.addEventListener('DOMContentLoaded', () => {
  const perguntas = document.querySelectorAll('.pergunta');
  const btnFinalizar = document.getElementById('btnFinalizar');
  let perguntaAtual = 0;
  let pontuacao = 0;
  const totalPerguntas = perguntas.length;
  const respostasErradas = [];
  const respostas = [];
  let isSubmitting = false;

  function mostrarPergunta(indice) {
    perguntas.forEach((p, i) => {
      p.style.display = i === indice ? 'block' : 'none';
      if (i === indice) {
        const opcoes = p.querySelectorAll('.opcao');
        opcoes.forEach(o => {
          const label = p.querySelector(`label[for="${o.id}"]`);
          label.style.color = '';
          label.style.fontWeight = '';
          o.checked = false;
        });
        p.classList.remove('respondida');
      }
    });
  }

  mostrarPergunta(perguntaAtual);

  perguntas.forEach((perguntaDiv) => {
    const opcoes = perguntaDiv.querySelectorAll('.opcao');
    opcoes.forEach((opcao) => {
      opcao.addEventListener('change', () => {
        if (perguntaDiv.classList.contains('respondida')) return;

        const respostaEscolhida = parseInt(opcao.value);
        const correta = parseInt(perguntaDiv.dataset.correta);
        const id = parseInt(perguntaDiv.dataset.id);

        perguntaDiv.classList.add('respondida');

        respostas.push({
          id,
          marcada: respostaEscolhida
        });

        opcoes.forEach((o) => {
          const label = perguntaDiv.querySelector(`label[for="${o.id}"]`);
          const val = parseInt(o.value);

          if (val === correta) {
            label.style.color = 'green';
            label.style.fontWeight = 'bold';
          }

          if (o === opcao && val !== correta) {
            label.style.color = 'red';
            label.style.fontWeight = 'bold';

            respostasErradas.push({
              id,
              pergunta: perguntaDiv.querySelector('h5').innerText,
              respostaErrada: label.innerText.trim(),
              respostaCorreta: perguntaDiv.querySelector(`label[for="${perguntaDiv.dataset.id}-${correta}"]`).innerText.trim(),
              disciplina: perguntaDiv.dataset.disciplina
            });
          }
        });

        if (respostaEscolhida === correta) pontuacao++;

        if (perguntaAtual === totalPerguntas - 1) {
          btnFinalizar.style.display = 'block';
        } else {
          setTimeout(() => {
            perguntaAtual++;
            mostrarPergunta(perguntaAtual);
          }, 1500);
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
    const nome = nomeInput ? nomeInput.value.trim() : '';

    if (!nome) {
      alert('Por favor, informe seu nome antes de finalizar o quiz.');
      btnFinalizar.disabled = false;
      btnFinalizar.textContent = 'Finalizar Quiz';
      isSubmitting = false;
      return;
    }

    const resultado = {
      nome,
      pontuacao,
      totalPerguntas,
      respostasErradas,
      respostas,
      dataHora: new Date().toISOString()
    };

    fetch('/resultado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resultado),
      redirect: 'follow'
    })
    .then(response => {
      if (response.redirected) {
        window.location.href = response.url;
      } else if (response.status === 200 || response.status === 204) {
        console.log('Resultado processado com sucesso.');
      } else {
        return response.text().then(text => {
          throw new Error(`Erro do servidor (${response.status}): ${text}`);
        });
      }
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
