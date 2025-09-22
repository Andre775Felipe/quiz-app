const express = require('express');
const exphbs = require('express-handlebars');
const path = require('path');
const fs = require('fs').promises; // Usando versão promise
const session = require('express-session'); // Importa o express-session

const app = express();
const PORT = process.env.PORT || 3000;

// Define o caminho para o arquivo de resultados globalmente
const resultadosPath = path.join(__dirname, 'data', 'resultados.json');
const resultadosTempPath = path.join(__dirname, 'data', 'resultados.json.tmp'); // Arquivo temporário

// Variável para controlar o bloqueio de escrita
let isWritingFile = false;
let writeQueue = []; // Fila para operações de escrita pendentes

// Configura Handlebars com helpers
const hbs = exphbs.create({
  defaultLayout: 'main',
  helpers: {
    increment: (value) => parseInt(value, 10) + 1,
    json: (context) => JSON.stringify(context),
    eq: (a, b) => a === b,
    gt: (a, b) => a > b,
    size: (obj) => obj ? Object.keys(obj).length : 0,
    formatDate: (dateString) => {
      if (!dateString) return ''; // Adicionado para evitar erro se data for nula
      const options = {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      };
      return new Date(dateString).toLocaleDateString('pt-BR', options);
    },
    calculatePercentage: (value, total) => {
      if (total === 0) return 0; // Evita divisão por zero
      return Math.round((value / total) * 100);
    },
    getScoreClass: (score, total) => {
      if (total === 0) return 'danger'; // Se não há perguntas, considere "ruim"
      const percentage = (score / total) * 100;
      if (percentage >= 80) return 'success';
      if (percentage >= 50) return 'warning';
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

// Configuração do middleware de sessão
app.use(session({
  secret: 'seu_segredo_muito_secreto_e_longo_aqui', // <-- MUITO IMPORTANTE: Troque por uma string aleatória e forte
  resave: false, // Não salva a sessão se não houver modificações
  saveUninitialized: true, // Salva sessões novas (não modificadas)
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 } // secure: true em produção (HTTPS), maxAge: 1 dia
}));


// Utilitário para carregar perguntas
async function carregarPerguntas() {
  console.log('Carregando perguntas do arquivo JSON...');
  try {
    const data = await fs.readFile(path.join(__dirname, 'data', 'perguntas.json'), 'utf-8');
    const perguntas = JSON.parse(data);
    console.log(`Carregadas ${perguntas.length} perguntas.`);
    return perguntas;
  } catch (err) {
    console.error('Erro ao carregar perguntas:', err);
    // Retorna um array vazio para evitar quebrar a aplicação
    return [];
  }
}

// Função auxiliar para ler e parsear resultados.json de forma robusta
async function lerResultadosJson() {
  let resultados = [];
  try {
    const fileContent = await fs.readFile(resultadosPath, 'utf-8');
    if (fileContent.trim().length === 0) {
      console.warn('Arquivo resultados.json está vazio ou contém apenas espaços, inicializando array vazio.');
      resultados = [];
    } else {
      resultados = JSON.parse(fileContent);
      if (!Array.isArray(resultados)) {
        console.warn('Arquivo resultados.json não contém um array JSON válido, resetando para array vazio.');
        resultados = [];
        // Tenta reescrever o arquivo para corrigir o formato se estiver inválido
        await fs.writeFile(resultadosPath, '[]', 'utf-8');
        console.log('Arquivo resultados.json resetado para array vazio devido a formato inválido.');
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('Arquivo resultados.json não encontrado, criando um novo.');
    } else if (err instanceof SyntaxError) {
      console.error('Erro de sintaxe ao parsear resultados.json (arquivo corrompido). Resetando arquivo.', err);
      // Se o JSON estiver corrompido, reseta o arquivo para um array vazio
      await fs.writeFile(resultadosPath, '[]', 'utf-8');
      resultados = [];
    } else {
      console.error('Erro ao ler ou parsear resultados.json:', err);
    }
    resultados = [];
  }
  return resultados;
}

// Função para salvar resultados.json de forma atômica e com fila
async function salvarResultadosJson(dataToSave) {
  return new Promise(async (resolve, reject) => {
    // Adiciona a operação à fila
    writeQueue.push({ data: dataToSave, resolve, reject });
    processWriteQueue();
  });
}

async function processWriteQueue() {
  if (isWritingFile || writeQueue.length === 0) {
    return;
  }

  isWritingFile = true;
  const { data, resolve, reject } = writeQueue.shift(); // Pega a próxima operação da fila

  try {
    const jsonString = JSON.stringify(data, null, 2);
    await fs.writeFile(resultadosTempPath, jsonString, 'utf-8'); // Escreve no arquivo temporário
    await fs.rename(resultadosTempPath, resultadosPath); // Renomeia o temporário para o arquivo final (operação atômica)
    console.log('Resultado salvo com sucesso (via fila e atômico).');
    resolve();
  } catch (err) {
    console.error('Erro ao salvar resultado (via fila e atômico):', err);
    reject(err);
  } finally {
    isWritingFile = false;
    processWriteQueue(); // Processa o próximo item da fila
  }
}


// Página inicial
app.get('/', async (req, res) => {
  console.log('Requisição GET / recebida.');
  const perguntas = await carregarPerguntas();
  // Garante que disciplinas seja um array único e ordenado
  const disciplinas = [...new Set(perguntas.map(p => p.disciplina))].sort();

  // Verifica se há uma mensagem na sessão (ex: de erro de quiz sem perguntas)
  const mensagem = req.session.mensagem;
  delete req.session.mensagem; // Limpa a mensagem da sessão após exibir

  console.log(`Disciplinas disponíveis: ${disciplinas.join(', ')}`);
  res.render('home', { disciplinas, mensagem }); // Passa a mensagem para a view
});

// Rota POST /quiz (agora salva na sessão e redireciona)
app.post('/quiz', async (req, res) => {
  console.log('Requisição POST /quiz recebida.');
  const { nome, disciplinas } = req.body;
  console.log(`Nome do usuário: ${nome}`);

  let disciplinasSelecionadas = [];
  if (Array.isArray(disciplinas)) {
    disciplinasSelecionadas = disciplinas;
  } else if (typeof disciplinas === 'string' && disciplinas.trim() !== '') {
    disciplinasSelecionadas = [disciplinas];
  }
  console.log(`Disciplinas selecionadas (array):`, disciplinasSelecionadas);

  const todasPerguntas = await carregarPerguntas();
  const perguntasFiltradas = todasPerguntas.filter(p => disciplinasSelecionadas.includes(p.disciplina));
  console.log(`Número de perguntas filtradas: ${perguntasFiltradas.length}`);

  if (perguntasFiltradas.length === 0) {
    console.warn('Nenhuma pergunta encontrada para as disciplinas selecionadas.');
    // Se não houver perguntas, armazena uma mensagem na sessão e redireciona para a home
    req.session.mensagem = 'Nenhuma pergunta encontrada para as disciplinas selecionadas. Por favor, selecione outras disciplinas.';
    return res.redirect('/');
  }

  // Salva os dados do quiz na sessão
  req.session.quizData = {
    nome: nome,
    perguntas: perguntasFiltradas
  };

  // Redireciona para a nova rota GET que irá renderizar o quiz
  res.redirect('/iniciar-quiz');
});

// Nova rota GET para renderizar o quiz (lê da sessão)
app.get('/iniciar-quiz', (req, res) => {
  const quizData = req.session.quizData;

  if (!quizData) {
    // Se não houver dados do quiz na sessão (ex: acesso direto ou sessão expirada), redireciona para a home
    req.session.mensagem = 'Nenhum quiz encontrado. Por favor, inicie um novo quiz.';
    return res.redirect('/');
  }

  // Limpa os dados do quiz da sessão após usá-los para evitar reutilização indevida
  delete req.session.quizData;

  res.render('quiz', {
    nome: quizData.nome,
    perguntas: quizData.perguntas
  });
});


// Resultado final (POST)
app.post('/resultado', async (req, res) => {
  console.log('Requisição POST /resultado recebida.');

  const resultadoBruto = req.body;

  const respostasUsuario = Array.isArray(resultadoBruto.respostas) ? resultadoBruto.respostas : [];

  const resultado = {
    nome: typeof resultadoBruto.nome === 'string' ? resultadoBruto.nome.trim() : '',
    totalPerguntas: parseInt(resultadoBruto.totalPerguntas, 10) || 0,
    respostas: respostasUsuario,
    respostasErradas: [],
    dataHora: new Date().toISOString()
  };

  if (!resultado.nome || resultado.totalPerguntas === 0 || respostasUsuario.length === 0) {
    console.warn('Dados inválidos recebidos no resultado.');
    return res.status(400).send('Dados inválidos no resultado.');
  }

  // Função fictícia que você já deve ter para carregar perguntas do JSON
  const perguntas = await carregarPerguntas();

  // Valida as respostas e preenche respostasErradas
  respostasUsuario.forEach(resp => {
    const pergunta = perguntas.find(p => p.id === resp.id);
    if (pergunta) {
      const correta = pergunta.correta;
      if (resp.marcada !== correta) {
        resultado.respostasErradas.push({
          id: pergunta.id,
          texto: pergunta.texto,
          correta,
          marcada: resp.marcada,
          disciplina: pergunta.disciplina
        });
      }
    }
  });

  // Calcula acertos por disciplina
  const acertosPorDisciplina = {};
  const disciplinas = [...new Set(perguntas.map(p => p.disciplina))];

  disciplinas.forEach(disciplina => {
    const totalPerguntasDisciplina = perguntas.filter(p => p.disciplina === disciplina).length;
    const erradas = resultado.respostasErradas.filter(r => r.disciplina === disciplina).length;
    acertosPorDisciplina[disciplina] = totalPerguntasDisciplina - erradas;
  });

  resultado.acertosPorDisciplina = acertosPorDisciplina;
  resultado.pontuacao = resultado.totalPerguntas - resultado.respostasErradas.length;

  console.log('Acertos por disciplina calculados:', acertosPorDisciplina);
  console.log(`Pontuação calculada: ${resultado.pontuacao}/${resultado.totalPerguntas}`);

  const resultadosExistentes = await lerResultadosJson();

  // Checa duplicidade
  const ultimo = resultadosExistentes[resultadosExistentes.length - 1];
  const ehDuplicado =
    ultimo &&
    ultimo.nome === resultado.nome &&
    ultimo.totalPerguntas === resultado.totalPerguntas &&
    ultimo.pontuacao === resultado.pontuacao &&
    JSON.stringify(ultimo.respostasErradas) === JSON.stringify(resultado.respostasErradas) &&
    Math.abs(new Date(ultimo.dataHora).getTime() - new Date(resultado.dataHora).getTime()) < 2000;

  if (ehDuplicado) {
    console.warn('Resultado duplicado detectado. Ignorando.');
    return res.redirect(`/resultado/${resultadosExistentes.length - 1}`);
  }

  resultadosExistentes.push(resultado);

  console.log(`Salvando novo resultado. Total: ${resultadosExistentes.length}`);

  try {
    await salvarResultadosJson(resultadosExistentes);
  } catch (err) {
    console.error('Erro ao salvar resultado:', err);
    return res.status(500).send('Erro ao salvar resultado');
  }

  res.redirect(`/resultado/${resultadosExistentes.length - 1}`);
});



// Página de histórico de tentativas
app.get('/historico', async (req, res) => {
  console.log('Requisição GET /historico recebida.');
  try {
    const tentativas = await lerResultadosJson(); // Usa a função auxiliar
    console.log(`Carregado histórico com ${tentativas.length} tentativas.`);
    res.render('historico', { tentativas: tentativas });
  } catch (err) {
    console.error('Erro ao carregar histórico:', err);
    res.status(500).send('Erro ao carregar histórico');
  }
});

// Visualização de uma tentativa específica
app.get('/resultado/:indice', async (req, res) => {
  console.log('Requisição GET /resultado/:indice recebida.');
  const indice = parseInt(req.params.indice, 10);
  console.log(`Índice solicitado: ${indice}`);
  try {
    const resultados = await lerResultadosJson(); // Usa a função auxiliar

    if (isNaN(indice) || indice < 0 || indice >= resultados.length) {
      console.warn('Índice inválido ou fora do limite:', indice);
      return res.status(404).send('Resultado não encontrado para o índice fornecido.');
    }

    const resultado = resultados[indice];
    console.log(`Exibindo resultado do índice ${indice}:`, JSON.stringify(resultado, null, 2));
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
    } catch {}

    const combinadas = [...atuais, ...novasQuestoes];
    await fs.writeFile(caminho, JSON.stringify(combinadas, null, 2));
    res.redirect('/adicionar');
  } catch (err) {
    console.error('Erro ao salvar questões:', err);
    res.status(400).send('Erro ao processar JSON. Verifique o formato.');
  }
});


app.post('/excluir-questao', async (req, res) => {
  const id = parseInt(req.body.id);
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





// Inicializa servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}` );
});
