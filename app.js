const express = require('express');
const exphbs = require('express-handlebars');
const path = require('path');
const fs = require('fs').promises;
const session = require('express-session');


const app = express();
const PORT = process.env.PORT || 3000;

// Caminhos de dados
const resultadosPath = path.join(__dirname, 'data', 'resultados.json');
const resultadosTempPath = path.join(__dirname, 'data', 'resultados.json.tmp');

// Controle de escrita com fila
let isWritingFile = false;
let writeQueue = [];

// Handlebars + helpers
const hbs = exphbs.create({
  defaultLayout: 'main',
  helpers: {
    increment: (value) => parseInt(value, 10) + 1,
    json: (context) => JSON.stringify(context),
    eq: (a, b) => a === b,
    gt: (a, b) => a > b,
    size: (obj) => obj ? Object.keys(obj).length : 0,
    formatDate: (dateString) => {
      if (!dateString) return '';
      const options = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };
      return new Date(dateString).toLocaleDateString('pt-BR', options);
    },
    calculatePercentage: (value, total) => {
      if (!total) return 0;
      return Math.round((value / total) * 100);
    },
    getScoreClass: (score, total) => {
      if (!total) return 'danger';
      const p = (score / total) * 100;
      if (p >= 80) return 'success';
      if (p >= 50) return 'warning';
      return 'danger';
    }
  }
});

app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: 'troque_este_segredo_por_um_valor_bem_aleatorio_e_grande',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
}));

// Utilitários
async function carregarPerguntas() {
  try {
    const data = await fs.readFile(path.join(__dirname, 'data', 'perguntas.json'), 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Erro ao carregar perguntas:', err);
    return [];
  }
}

async function lerResultadosJson() {
  let resultados = [];
  try {
    const fileContent = await fs.readFile(resultadosPath, 'utf-8');
    if (fileContent.trim().length === 0) {
      resultados = [];
    } else {
      resultados = JSON.parse(fileContent);
      if (!Array.isArray(resultados)) {
        resultados = [];
        await fs.writeFile(resultadosPath, '[]', 'utf-8');
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      // arquivo será criado no save
    } else if (err instanceof SyntaxError) {
      await fs.writeFile(resultadosPath, '[]', 'utf-8');
    } else {
      console.error('Erro ao ler resultados.json:', err);
    }
    resultados = [];
  }
  return resultados;
}

async function salvarResultadosJson(dataToSave) {
  return new Promise(async (resolve, reject) => {
    writeQueue.push({ data: dataToSave, resolve, reject });
    processWriteQueue();
  });
}

async function processWriteQueue() {
  if (isWritingFile || writeQueue.length === 0) return;

  isWritingFile = true;
  const { data, resolve, reject } = writeQueue.shift();

  try {
    const jsonString = JSON.stringify(data, null, 2);
    await fs.writeFile(resultadosTempPath, jsonString, 'utf-8');
    await fs.rename(resultadosTempPath, resultadosPath);
    resolve();
  } catch (err) {
    console.error('Erro ao salvar resultado:', err);
    reject(err);
  } finally {
    isWritingFile = false;
    processWriteQueue();
  }
}



// Rotas


// Limpar placar (apaga resultados.json)
app.post('/limpar-placar', async (req, res) => {
  try {
    await fs.writeFile(resultadosPath, '[]', 'utf-8'); // zera o arquivo
    res.redirect('/'); // volta para a tela de placar
  } catch (err) {
    console.error('Erro ao limpar placar:', err);
    res.status(500).send('Erro ao limpar placar');
  }
});


app.post('/resultado-inicial', async (req, res) => {
  const { nome, idsPerguntas } = req.body;

  // 🚫 Se não veio nome ou não veio lista de perguntas, não cria nada
  if (!nome || !idsPerguntas || !Array.isArray(idsPerguntas) || idsPerguntas.length === 0) {
    return res.json({ skip: true }); // só devolve um "aviso" pro front
  }

  const resultados = await lerResultadosJson();

  const resultado = {
    nome: nome.trim(),
    totalPerguntas: idsPerguntas.length,
    respostas: [],
    respostasErradas: [],
    dataHora: new Date().toISOString(),
    acertosPorDisciplina: {},
    pontuacao: 0,
    status: 'iniciado'
  };

  resultados.push(resultado);
  await salvarResultadosJson(resultados);

  res.json({ indice: resultados.length - 1 });
});

app.post('/resultado-parcial', async (req, res) => {
  const { indice, resposta } = req.body;
  const resultados = await lerResultadosJson();

  if (!resultados[indice]) {
    return res.status(404).json({ error: 'Resultado não encontrado' });
  }

  // Atualiza a lista de respostas (remove anterior se existir)
  resultados[indice].respostas = resultados[indice].respostas.filter(r => r.id !== resposta.id);
  resultados[indice].respostas.push(resposta);

  // Recalcular pontuação parcial
  const perguntas = await carregarPerguntas();
  const perguntasMap = new Map(perguntas.map(p => [p.id, p]));

  let acertos = 0;
  const respostasErradas = [];

  for (const r of resultados[indice].respostas) {
    const perg = perguntasMap.get(r.id);
    if (!perg) continue;

    const correta = parseInt(perg.correta, 10);
    if (r.marcada === correta) {
      acertos++;
    } else {
      respostasErradas.push({
        id: perg.id,
        pergunta: perg.texto,
        respostaErrada: perg.opcoes?.[r.marcada] ?? `Opção ${r.marcada}`,
        respostaCorreta: perg.opcoes?.[correta] ?? `Opção ${correta}`,
        disciplina: perg.disciplina
      });
    }
  }

  resultados[indice].pontuacao = acertos;
  resultados[indice].respostasErradas = respostasErradas;
  resultados[indice].status = 'parcial';
  resultados[indice].dataHora = new Date().toISOString();

  await salvarResultadosJson(resultados);

  res.json({ ok: true, pontuacao: acertos });
});








app.get("/placar", (req, res) => {
  res.render("placar");
});



app.get("/api/resultados", async (req, res) => {
  try {
    const resultados = await lerResultadosJson();
    res.json(resultados);
  } catch (err) {
    console.error("Erro ao carregar resultados:", err);
    res.status(500).json({ error: "Erro ao carregar resultados" });
  }
});





app.get('/', async (req, res) => {
  const perguntas = await carregarPerguntas();
  const disciplinas = [...new Set(perguntas.map(p => p.disciplina))].sort();
  const mensagem = req.session.mensagem;
  delete req.session.mensagem;

  res.render('home', { disciplinas, mensagem });
});

app.post('/quiz', async (req, res) => {
  const { nome, disciplinas } = req.body;

  let disciplinasSelecionadas = [];
  if (Array.isArray(disciplinas)) {
    disciplinasSelecionadas = disciplinas;
  } else if (typeof disciplinas === 'string' && disciplinas.trim() !== '') {
    disciplinasSelecionadas = [disciplinas];
  }

  const todasPerguntas = await carregarPerguntas();
  const perguntasFiltradas = todasPerguntas.filter(p => disciplinasSelecionadas.includes(p.disciplina));

  if (perguntasFiltradas.length === 0) {
    req.session.mensagem = 'Nenhuma pergunta encontrada para as disciplinas selecionadas. Por favor, selecione outras disciplinas.';
    return res.redirect('/');
  }

  req.session.quizData = { nome: nome?.trim() || '', perguntas: perguntasFiltradas };
  res.redirect('/iniciar-quiz');
});

app.get('/iniciar-quiz', (req, res) => {
  const quizData = req.session.quizData;
  if (!quizData) {
    req.session.mensagem = 'Nenhum quiz encontrado. Por favor, inicie um novo quiz.';
    return res.redirect('/');
  }
  delete req.session.quizData;
  res.render('quiz', { nome: quizData.nome, perguntas: quizData.perguntas });
});

app.post('/resultado', async (req, res) => {
  try {
    const body = req.body ?? {};

    let respostasUsuarioRaw = body.respostas;
    try {
      if (typeof respostasUsuarioRaw === 'string') {
        respostasUsuarioRaw = JSON.parse(respostasUsuarioRaw);
      }
    } catch (e) { }

    let respostasUsuario = [];
    if (Array.isArray(respostasUsuarioRaw)) {
      respostasUsuario = respostasUsuarioRaw;
    } else if (respostasUsuarioRaw && typeof respostasUsuarioRaw === 'object') {
      respostasUsuario = Object.entries(respostasUsuarioRaw).map(([id, marcada]) => ({ id, marcada }));
    }

    respostasUsuario = respostasUsuario
      .map(r => ({ id: parseInt(r.id, 10), marcada: parseInt(r.marcada, 10) }))
      .filter(r => Number.isInteger(r.id) && Number.isInteger(r.marcada));

    if (!respostasUsuario.length) {
      return res.status(400).send('Responda ao menos uma pergunta.');
    }

    const nomeRaw = typeof body.nome === 'string' ? body.nome : '';
    const nome = nomeRaw.trim().slice(0, 80) || 'Anônimo';

    const perguntas = await carregarPerguntas();

    let idsPermitidos = Array.isArray(body.idsPerguntas)
      ? body.idsPerguntas.map(n => parseInt(n, 10)).filter(Number.isInteger)
      : [];
    if (!idsPermitidos.length) {
      idsPermitidos = [...new Set(respostasUsuario.map(r => r.id))];
    }

    let perguntasFiltradas = idsPermitidos.length
      ? perguntas.filter(p => idsPermitidos.includes(p.id))
      : perguntas;
    if (!perguntasFiltradas.length) perguntasFiltradas = perguntas;

    const perguntasMap = new Map(perguntasFiltradas.map(p => [p.id, p]));

    const resultado = {
      nome,
      totalPerguntas: perguntasFiltradas.length || respostasUsuario.length,
      respostas: respostasUsuario,
      respostasErradas: [],
      dataHora: new Date().toISOString(),
      acertosPorDisciplina: {},
      pontuacao: 0,
      status: 'finalizado'
    };

    // Calcula acertos/erradas
    let acertos = 0;
    for (const r of respostasUsuario) {
      const perg = perguntasMap.get(r.id);
      if (!perg) continue;

      const correta = parseInt(perg.correta, 10);
      const marcada = r.marcada;

      if (Number.isInteger(correta) && marcada === correta) {
        acertos++;
      } else {
        const errIdx = Number.isInteger(marcada) ? marcada : -1;
        const corIdx = Number.isInteger(correta) ? correta : -1;
        resultado.respostasErradas.push({
          id: perg.id,
          pergunta: perg.texto,
          respostaErrada: perg.opcoes?.[errIdx] ?? `Opção ${errIdx}`,
          respostaCorreta: perg.opcoes?.[corIdx] ?? `Opção ${corIdx}`,
          disciplina: perg.disciplina
        });
      }
    }
    resultado.pontuacao = acertos;

    // Acertos por disciplina
    const totalPorDisc = {};
    for (const r of respostasUsuario) {
      const p = perguntasMap.get(r.id);
      if (!p) continue;
      totalPorDisc[p.disciplina] = (totalPorDisc[p.disciplina] || 0) + 1;
    }
    const erradasPorDisc = {};
    for (const e of resultado.respostasErradas) {
      erradasPorDisc[e.disciplina] = (erradasPorDisc[e.disciplina] || 0) + 1;
    }
    for (const [disc, tot] of Object.entries(totalPorDisc)) {
      resultado.acertosPorDisciplina[disc] = tot - (erradasPorDisc[disc] || 0);
    }

    // Persistência
    const resultadosExistentes = await lerResultadosJson();

    if (typeof body.indice === 'number' && resultadosExistentes[body.indice]) {
      // Atualiza o mesmo índice (resultado iniciado)
      resultadosExistentes[body.indice] = resultado;
    } else {
      // Caso não tenha índice válido, adiciona no final (fallback)
      resultadosExistentes.push(resultado);
    }

    await salvarResultadosJson(resultadosExistentes);

    const destino = (typeof body.indice === 'number' && resultadosExistentes[body.indice])
      ? body.indice
      : resultadosExistentes.length - 1;

    return res.redirect(`/resultado/${destino}`);
  } catch (err) {
    console.error('Erro ao processar /resultado:', err);
    return res.status(500).send('Erro ao salvar resultado');
  }
});





app.get('/historico', async (req, res) => {
  try {
    const tentativas = await lerResultadosJson();
    res.render('historico', { tentativas });
  } catch (err) {
    console.error('Erro ao carregar histórico:', err);
    res.status(500).send('Erro ao carregar histórico');
  }
});

app.get('/resultado/:indice', async (req, res) => {
  const indice = parseInt(req.params.indice, 10);
  try {
    const resultados = await lerResultadosJson();
    if (isNaN(indice) || indice < 0 || indice >= resultados.length) {
      return res.status(404).send('Resultado não encontrado para o índice fornecido.');
    }
    const resultado = resultados[indice];
    res.render('resultado', { resultado });
  } catch (err) {
    console.error('Erro ao carregar resultado para visualização:', err);
    res.status(500).send('Erro ao carregar resultado');
  }
});

app.get('/adicionar', async (req, res) => {
  try {
    const data = await fs.readFile(path.join(__dirname, 'data', 'perguntas.json'), 'utf8');
    const perguntas = JSON.parse(data);
    res.render('adicionar', { perguntas });
  } catch (err) {
    console.error('Erro ao carregar perguntas:', err);
    res.render('adicionar', { perguntas: [] });
  }
});

app.post('/salvar-questoes', async (req, res) => {
  try {
    const novasQuestoes = JSON.parse(req.body.json);
    const caminho = path.join(__dirname, 'data', 'perguntas.json');
    let atuais = [];

    try {
      const data = await fs.readFile(caminho, 'utf8');
      atuais = JSON.parse(data);
    } catch { }

    const combinadas = [...atuais, ...novasQuestoes];
    await fs.writeFile(caminho, JSON.stringify(combinadas, null, 2));
    res.redirect('/adicionar');
  } catch (err) {
    console.error('Erro ao salvar questões:', err);
    res.status(400).send('Erro ao processar JSON. Verifique o formato.');
  }
});

app.post('/excluir-questao', async (req, res) => {
  const id = parseInt(req.body.id, 10);
  const caminho = path.join(__dirname, 'data', 'perguntas.json');

  try {
    const data = await fs.readFile(caminho, 'utf8');
    const perguntas = JSON.parse(data);
    const atualizadas = perguntas.filter(q => q.id !== id);
    await fs.writeFile(caminho, JSON.stringify(atualizadas, null, 2));
    res.redirect('/adicionar');
  } catch (err) {
    console.error('Erro ao excluir questão:', err);
    res.status(500).send('Erro ao excluir questão');
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
