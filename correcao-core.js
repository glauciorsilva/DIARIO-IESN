/* =====================================================================
   CORREÇÃO POR FOTO — núcleo (sem tela)
   Instituto de Educação Silva Nascimento — Prof. Glaucio Rafael

   - Desenha o cartão-resposta nominal (A4, jsPDF) com 4 quadrados pretos
     nos cantos e um QR code com: gabarito, turma, nº do aluno e fila.
   - Lê a foto: acha os 4 quadrados, corrige a perspectiva (homografia),
     lê o QR e mede o quanto cada bolinha está pintada.
   Funciona no navegador (window.CorrecaoCore) e no Node (testes).
   ===================================================================== */
(function (raiz) {
  "use strict";

  // ---------------- Layout do cartão (milímetros) ----------------
  const PAG = { w: 210, h: 297 };
  const MARCA = 10; // lado dos quadrados pretos
  const CANTOS = [ // centros, no sentido horário: sup.esq, sup.dir, inf.dir, inf.esq
    { x: 15, y: 15 }, { x: 195, y: 15 }, { x: 195, y: 282 }, { x: 15, y: 282 }
  ];
  const QR = { x: 162, y: 24, lado: 30 };
  const GRADE = { y0: 86, passoY: 7.4, passoX: 9, raio: 2.6, maxPorColuna: 25 };
  const LETRAS = "ABCDE";
  const PREFIXO_QR = "IESN1";   // cartão-resposta de folha inteira
  const PREFIXO_QR2 = "IESN2";  // faixa de respostas no pé de cada folha da prova
  const PREFIXO_QR3 = "IESN3";  // cartão-resposta abaixo do cabeçalho da 1ª folha (padrão)

  // ---------------- Faixa de respostas (prova de várias folhas) ----------------
  // Desenhada pelo gerador de provas (modelo/iesn_modelo.py) no pé de CADA folha:
  // 4 quadrados nos cantos da faixa, bolinhas das questões daquela folha, Nº do aluno
  // (texto + código de quadradinhos) e QR com gabarito/turma/nº/fila/folha/questões.
  // Coordenadas em mm a partir do canto superior esquerdo da folha A4.
  const FAIXA = {
    x: 14, y: 216, w: 182, h: 52, marca: 6,
    cantos: [{ x: 17, y: 219 }, { x: 193, y: 219 }, { x: 193, y: 265 }, { x: 17, y: 265 }],
    qr: { x: 160, y: 221, lado: 22 },
    colunas: [22, 58, 94], linhaY0: 231, passoY: 6.6, passoX: 6.2, dxBolinha: 9, raio: 2.3, maxPorColuna: 5,
    numX: 133, codigo: { x: 133, y: 248, lado: 2.2, passo: 2.8, bits: 9 }
  };
  // A mesma faixa serve em dois lugares (mesmo desenho, só muda a altura na folha):
  //  • "topo"  = CARTÃO-RESPOSTA da prova, logo abaixo do cabeçalho da 1ª folha, com TODAS as questões
  //             (padrão desde 08/10/2026; 5 linhas = até 15 questões, 10 linhas = até 30)
  //  • "faixa" = faixa no pé de cada folha (formato anterior, ainda aceito)
  const TOPO_Y = 69;
  function criarGeomFaixa(nome, y0, linhas, desceLinhas) {
    const h = 52 + (linhas - 5) * FAIXA.passoY, dy = y0 - FAIXA.y;
    return {
      nome, forma: "faixa" + linhas, y0, linhas, h, marca: FAIXA.marca, margemQR: 2.5,
      cantos: [{ x: 17, y: y0 + 3 }, { x: 193, y: y0 + 3 }, { x: 193, y: y0 + h - 3 }, { x: 17, y: y0 + h - 3 }],
      qr: { x: FAIXA.qr.x, y: FAIXA.qr.y + dy, lado: FAIXA.qr.lado },
      colunas: FAIXA.colunas, linhaY0: FAIXA.linhaY0 + dy + (desceLinhas || 0), maxPorColuna: linhas,
      codigo: Object.assign({}, FAIXA.codigo, { y: FAIXA.codigo.y + dy })
    };
  }
  const GEOMETRIAS = {
    cartao: { nome: "cartao", forma: "cartao", cantos: null, marca: 10, qr: null, margemQR: 5 }, // completado abaixo
    faixa: criarGeomFaixa("faixa", FAIXA.y, 5),
    topo5: criarGeomFaixa("topo5", TOPO_Y, 5, 1.5),   // cartão tem 2 linhas de instrução: bolinhas 1,5 mm abaixo
    topo10: criarGeomFaixa("topo10", TOPO_Y, 10, 1.5)
  };

  function layoutFaixa(qIni, qFim, k, geom) {
    geom = geom || GEOMETRIAS.faixa;
    const lista = [];
    for (let q = qIni; q <= qFim; q++) {
      const i = q - qIni, c = Math.floor(i / geom.maxPorColuna), lin = i % geom.maxPorColuna;
      const x0 = geom.colunas[c], y = geom.linhaY0 + lin * FAIXA.passoY;
      const bolinhas = [];
      for (let j = 0; j < k; j++) bolinhas.push({ x: x0 + FAIXA.dxBolinha + j * FAIXA.passoX, y });
      lista.push({ q, x0, y, bolinhas, raio: FAIXA.raio });
    }
    return lista;
  }
  // bits do código: 0–5 = nº do aluno, 6–7 = folha − 1 (folhas 1 a 4), 8 = paridade (total de pretos par)
  function bitsCodigo(num, folha) {
    const b = [];
    for (let i = 0; i < 6; i++) b.push((num >> i) & 1);
    const f = Math.max(0, Math.min(3, (folha || 1) - 1));
    b.push(f & 1, (f >> 1) & 1);
    b.push(b.reduce((a, x) => a + x, 0) % 2);
    return b;
  }

  const FRASES = [
    ["A educação tem raízes amargas, mas os seus frutos são doces.", "Aristóteles"],
    ["Só sei que nada sei.", "Sócrates"],
    ["Ousa saber!", "Immanuel Kant"],
    ["O homem é aquilo que ele faz de si mesmo.", "Jean-Paul Sartre"],
    ["Não é o que acontece com você, mas como você reage que importa.", "Epicteto"]
  ];

  GEOMETRIAS.cartao.cantos = CANTOS; GEOMETRIAS.cartao.qr = QR;

  function layoutQuestoes(n, k) {
    const cols = n > GRADE.maxPorColuna ? 2 : 1;
    const porCol = Math.ceil(n / cols);
    const larguraCol = 14 + (k - 1) * GRADE.passoX + 6;
    const xs = cols === 1 ? [(PAG.w - larguraCol) / 2] : [32, 118];
    const lista = [];
    for (let q = 0; q < n; q++) {
      const c = Math.floor(q / porCol), lin = q % porCol;
      const x0 = xs[c], y = GRADE.y0 + lin * GRADE.passoY;
      const bolinhas = [];
      for (let j = 0; j < k; j++) bolinhas.push({ x: x0 + 14 + j * GRADE.passoX, y });
      lista.push({ q: q + 1, x0, y, bolinhas });
    }
    return { cols, porCol, xs, larguraCol, lista };
  }

  // ---------------- QR: texto ----------------
  function textoQR(info) {
    return [PREFIXO_QR, info.gabId, info.turma, info.num, info.fila || "A"].join("|");
  }
  function lerTextoQR(txt) {
    const p = String(txt || "").split("|");
    if (p.length < 5 || (p[0] !== PREFIXO_QR && p[0] !== PREFIXO_QR2 && p[0] !== PREFIXO_QR3)) return null;
    const num = Number(p[3]);
    if (!p[1] || !p[2] || !isFinite(num)) return null;
    const info = { tipo: "cartao", gabId: p[1], turma: p[2], num, fila: p[4] || "A" };
    if (p[0] === PREFIXO_QR3) { // IESN3|gab|turma|num|fila|n|linhas
      const n = Number(p[5]) || 1, linhas = Number(p[6]) === 10 ? 10 : 5;
      Object.assign(info, { tipo: "topo" + linhas, folha: 1, total: 1, qIni: 1, qFim: n });
    }
    if (p[0] === PREFIXO_QR2) {
      Object.assign(info, { tipo: "faixa", folha: Number(p[5]) || 1, total: Number(p[6]) || 1, qIni: Number(p[7]) || 1, qFim: Number(p[8]) || 1 });
    }
    return info;
  }
  function textoQRTopo(info) {
    return [PREFIXO_QR3, info.gabId, info.turma, info.num, info.fila || "A", info.n, info.linhas].join("|");
  }
  function textoQRFaixa(info) {
    return [PREFIXO_QR2, info.gabId, info.turma, info.num, info.fila || "A", info.folha, info.total, info.qIni, info.qFim].join("|");
  }

  // ---------------- Cartão em PDF (uma página por aluno) ----------------
  // opts: { qrcode (lib qrcode-generator), escola, prof, titulo, serie, bimestre,
  //         avaliacao, n, k, gabId, turma, alunos:[{num,nome,fila}] }
  function desenharCartoes(doc, opts) {
    const L = layoutQuestoes(opts.n, opts.k);
    const frase = FRASES[Math.floor(Math.random() * FRASES.length)];
    opts.alunos.forEach((al, idx) => {
      if (idx > 0) doc.addPage("a4", "portrait");
      doc.setDrawColor(0); doc.setFillColor(0, 0, 0); doc.setTextColor(0);
      CANTOS.forEach((c) => doc.rect(c.x - MARCA / 2, c.y - MARCA / 2, MARCA, MARCA, "F"));

      // cabeçalho
      doc.setFont("helvetica", "bold"); doc.setFontSize(12);
      const escola = opts.escola || "INSTITUTO DE EDUCAÇÃO SILVA NASCIMENTO";
      doc.text(escola, 25, 17);
      doc.setLineWidth(0.3); doc.line(25, 18, 25 + doc.getTextWidth(escola), 18);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      doc.text(opts.prof || "PROF: GLAUCIO RAFAEL.", 25, 23.5);
      doc.setFont("helvetica", "bold"); doc.setFontSize(11);
      doc.text(doc.splitTextToSize("CARTÃO-RESPOSTA — " + (opts.titulo || ""), 132)[0], 25, 30);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      let nomeTxt = "NOME: " + al.nome;
      let fs = 10;
      while (doc.getTextWidth(nomeTxt) > 132 && fs > 7) { fs -= 0.5; doc.setFontSize(fs); }
      doc.text(nomeTxt, 25, 37);
      doc.setFontSize(10);
      doc.text(`Nº: ${al.num}     SÉRIE: ${opts.serie || ""}     ${opts.bimestre || ""}º BIMESTRE`, 25, 43);
      doc.text("DATA: ____/____/______", 25, 49);
      doc.setFont("helvetica", "bold"); doc.setFontSize(13);
      doc.text("FILA " + (al.fila || "A"), 110, 49);

      // QR (vetorial)
      const qr = opts.qrcode(0, "M");
      qr.addData(textoQR({ gabId: opts.gabId, turma: opts.turma, num: al.num, fila: al.fila }));
      qr.make();
      const m = qr.getModuleCount(), mod = QR.lado / m;
      for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) {
        if (qr.isDark(r, c)) doc.rect(QR.x + c * mod, QR.y + r * mod, mod + 0.02, mod + 0.02, "F");
      }

      // instruções curtas (exigência da leitura)
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(60);
      doc.text("Pinte TODA a bolinha da resposta, com caneta azul ou preta. Uma só por questão. Não rasure nem dobre o cartão.", PAG.w / 2, 62, { align: "center" });
      doc.text("Não escreva perto dos quadrados pretos nem do código.", PAG.w / 2, 66.5, { align: "center" });

      // grade
      doc.setTextColor(0);
      L.xs.forEach((x0, c) => {
        const qtd = Math.min(L.porCol, opts.n - c * L.porCol);
        if (qtd <= 0) return;
        doc.setDrawColor(150); doc.setLineWidth(0.25);
        doc.roundedRect(x0 - 2, GRADE.y0 - 12, L.larguraCol + 2, qtd * GRADE.passoY + 9, 2, 2, "S");
        doc.setFont("helvetica", "bold"); doc.setFontSize(10);
        for (let j = 0; j < opts.k; j++) doc.text(LETRAS[j], x0 + 14 + j * GRADE.passoX, GRADE.y0 - 6, { align: "center" });
      });
      L.lista.forEach((q) => {
        doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(0);
        doc.text(String(q.q).padStart(2, "0"), q.x0 + 3, q.y + 1.3);
        doc.setDrawColor(90); doc.setLineWidth(0.35);
        q.bolinhas.forEach((b) => doc.circle(b.x, b.y, GRADE.raio, "S"));
      });

      // rodapé
      doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(0);
      doc.text("“" + frase[0] + "”", PAG.w / 2, 281, { align: "center" });
      doc.setFont("helvetica", "italic"); doc.setFontSize(8);
      doc.text("— " + frase[1], PAG.w / 2, 285, { align: "center" });
    });
    return doc;
  }

  // ---------------- Imagem: cinza + limiar adaptativo ----------------
  function prepararImagem(img) {
    const w = img.width, h = img.height, d = img.data;
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) gray[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
    // imagem integral para média local
    const integ = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let soma = 0;
      for (let x = 0; x < w; x++) {
        soma += gray[y * w + x];
        integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + soma;
      }
    }
    const r = Math.max(8, Math.round(Math.max(w, h) / 40));
    const bin = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y1 = Math.max(0, y - r), y2 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x1 = Math.max(0, x - r), x2 = Math.min(w, x + r + 1);
        const area = (x2 - x1) * (y2 - y1);
        const s = integ[y2 * (w + 1) + x2] - integ[y1 * (w + 1) + x2] - integ[y2 * (w + 1) + x1] + integ[y1 * (w + 1) + x1];
        const g = gray[y * w + x];
        bin[y * w + x] = (g * area < s * 0.82 && g < 170) ? 1 : 0;
      }
    }
    return { w, h, gray, bin };
  }

  // ---------------- Componentes escuros (candidatos a quadrado) ----------------
  function candidatosMarcadores(prep) {
    const { w, h, bin } = prep;
    const rot = new Int32Array(w * h);
    const pilha = new Int32Array(w * h);
    const cands = [];
    const minA = (w * h) * 0.00004, maxA = (w * h) * 0.02;
    let id = 0;
    for (let i = 0; i < w * h; i++) {
      if (!bin[i] || rot[i]) continue;
      id++;
      let topo = 0; pilha[topo++] = i; rot[i] = id;
      let n = 0, sx = 0, sy = 0, xmin = w, xmax = 0, ymin = h, ymax = 0;
      while (topo) {
        const p = pilha[--topo];
        const x = p % w, y = (p / w) | 0;
        n++; sx += x; sy += y;
        if (x < xmin) xmin = x; if (x > xmax) xmax = x;
        if (y < ymin) ymin = y; if (y > ymax) ymax = y;
        if (x > 0 && bin[p - 1] && !rot[p - 1]) { rot[p - 1] = id; pilha[topo++] = p - 1; }
        if (x < w - 1 && bin[p + 1] && !rot[p + 1]) { rot[p + 1] = id; pilha[topo++] = p + 1; }
        if (y > 0 && bin[p - w] && !rot[p - w]) { rot[p - w] = id; pilha[topo++] = p - w; }
        if (y < h - 1 && bin[p + w] && !rot[p + w]) { rot[p + w] = id; pilha[topo++] = p + w; }
      }
      if (n < minA || n > maxA) continue;
      const bw = xmax - xmin + 1, bh = ymax - ymin + 1;
      const asp = bw / bh;
      const preench = n / (bw * bh);
      // quadrado cheio: muito preenchido (girado 45° o preenchimento cai para ~0,5)
      if (asp < 0.5 || asp > 2 || preench < 0.45) continue;
      cands.push({ x: sx / n, y: sy / n, area: n, preench, bw, bh });
    }
    return cands;
  }

  function ordenarHorario(pts) {
    const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    return pts.slice().sort((a, b) => Math.atan2(a.y - my, a.x - mx) - Math.atan2(b.y - my, b.x - mx));
  }

  function areaPoligono(p) {
    let s = 0;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; }
    return Math.abs(s) / 2;
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // Escolhe os 4 quadrados que formam o retângulo da folha
  function encontrarCantos(prep, geom) {
    geom = geom || GEOMETRIAS.cartao;
    const CT = geom.cantos;
    let cands = candidatosMarcadores(prep);
    // um quadrado de verdade é quase cheio — sem o filtro de preenchimento, letras e o QR atrapalham
    cands = cands.filter((c) => c.preench > 0.6 || (c.preench > 0.45 && Math.abs(c.bw / c.bh - 1) < 0.25));
    cands.sort((a, b) => b.area - a.area);
    cands = cands.slice(0, 18);
    if (cands.length < 4) throw new Error("Não encontrei os 4 quadrados pretos dos cantos. Fotografe o cartão inteiro, de cima e com boa luz.");
    const ladoA = CT[1].x - CT[0].x, ladoB = CT[3].y - CT[0].y;
    const razaoEsperada = Math.max(ladoA, ladoB) / Math.min(ladoA, ladoB); // folha ~1,48 · faixa ~3,8
    let melhor = null;
    const N = cands.length;
    for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) for (let c = b + 1; c < N; c++) for (let d = c + 1; d < N; d++) {
      const g = [cands[a], cands[b], cands[c], cands[d]];
      const areas = g.map((p) => p.area);
      if (Math.min(...areas) / Math.max(...areas) < 0.3) continue;
      const o = ordenarHorario(g);
      const s = [dist(o[0], o[1]), dist(o[1], o[2]), dist(o[2], o[3]), dist(o[3], o[0])];
      if (Math.min(s[0], s[2]) / Math.max(s[0], s[2]) < 0.6) continue;
      if (Math.min(s[1], s[3]) / Math.max(s[1], s[3]) < 0.6) continue;
      const lado1 = (s[0] + s[2]) / 2, lado2 = (s[1] + s[3]) / 2;
      const razao = Math.max(lado1, lado2) / Math.min(lado1, lado2);
      const errRazao = Math.abs(razao - razaoEsperada) / razaoEsperada;
      if (errRazao > 0.3) continue;
      // tamanho do quadrado coerente com o tamanho da folha
      const ladoEsperado = Math.min(lado1, lado2) * geom.marca / Math.min(ladoA, ladoB);
      const ladoMedio = Math.sqrt(areas.reduce((x, y) => x + y, 0) / 4);
      const errLado = ladoMedio / ladoEsperado;
      if (errLado < 0.45 || errLado > 1.8) continue;
      const pontos = areaPoligono(o) * (1 - errRazao) * (1 - Math.abs(1 - errLado) * 0.5);
      if (!melhor || pontos > melhor.pontos) melhor = { pontos, cantos: o };
    }
    if (!melhor) throw new Error("Não consegui identificar a folha pelos quadrados dos cantos. Tente de novo, com o cartão inteiro na foto e sem sombra.");
    return melhor.cantos;
  }

  // ---------------- Homografia ----------------
  function resolver(A, b) { // eliminação de Gauss
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let mx = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[mx][i])) mx = r;
      [A[i], A[mx]] = [A[mx], A[i]]; [b[i], b[mx]] = [b[mx], b[i]];
      for (let r = i + 1; r < n; r++) {
        const f = A[r][i] / A[i][i];
        for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
      x[i] = s / A[i][i];
    }
    return x;
  }
  function homografia(origem, destino) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = origem[i], { x: u, y: v } = destino[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = resolver(A, b);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }
  function aplicarH(H, x, y) {
    const z = H[6] * x + H[7] * y + H[8];
    return { x: (H[0] * x + H[1] * y + H[2]) / z, y: (H[3] * x + H[4] * y + H[5]) / z };
  }
  function hipoteses(cantosImg, geom) { // as 4 rotações possíveis da folha na foto
    const CT = (geom || GEOMETRIAS.cartao).cantos;
    const lista = [];
    for (let r = 0; r < 4; r++) {
      const dest = [0, 1, 2, 3].map((i) => cantosImg[(i + r) % 4]);
      lista.push({ r, H: homografia(CT, dest) });
    }
    return lista;
  }

  // Recorta a região do QR já "endireitada" (para o jsQR ler mesmo com a foto torta)
  function recortarQR(img, H, px, geom) {
    px = px || 360;
    geom = geom || GEOMETRIAS.cartao;
    const Q = geom.qr, marg = geom.margemQR;
    const x0 = Q.x - marg, y0 = Q.y - marg, lado = Q.lado + 2 * marg;
    const out = new Uint8ClampedArray(px * px * 4);
    for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
      const p = aplicarH(H, x0 + (i + 0.5) * lado / px, y0 + (j + 0.5) * lado / px);
      const xi = Math.round(p.x), yi = Math.round(p.y);
      const o = (j * px + i) * 4;
      if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) { out[o] = out[o + 1] = out[o + 2] = 255; }
      else { const s = (yi * img.width + xi) * 4; out[o] = img.data[s]; out[o + 1] = img.data[s + 1]; out[o + 2] = img.data[s + 2]; }
      out[o + 3] = 255;
    }
    return { data: out, width: px, height: px };
  }

  function emPe(res) {
    const lc = res && res.location;
    return lc && lc.topLeftCorner.x < lc.topRightCorner.x && lc.topLeftCorner.y < lc.bottomLeftCorner.y;
  }

  // Lê o código de quadradinhos da faixa (nº do aluno + folha), validando a paridade
  function lerCodigo(prep, H, geom) {
    const C = (geom || GEOMETRIAS.faixa).codigo, bits = [];
    for (let i = 0; i < C.bits; i++) {
      const cx = C.x + i * C.passo + C.lado / 2, cy = C.y + C.lado / 2;
      bits.push(medirBolinha(prep, H, cx, cy, C.lado / 2) > 0.5 ? 1 : 0);
    }
    const soma = bits.slice(0, 8).reduce((a, b) => a + b, 0);
    if (soma % 2 !== bits[8]) return null;
    let num = 0;
    for (let i = 0; i < 6; i++) num |= bits[i] << i;
    if (num < 1) return null;
    return { num, folha: 1 + bits[6] + 2 * bits[7] };
  }

  // Acha a folha (faixa de respostas ou cartão inteiro), a orientação certa e lê o QR.
  // Retorna { geom: "faixa"|"cartao", H, cantos, qr, rotacao }  (qr pode vir só com {num, folha})
  function localizarFolha(img, prep, jsQR) {
    // uma busca por forma de retângulo; topo5 e faixa têm a mesma forma (só muda a altura na folha)
    const formas = [GEOMETRIAS.topo5, GEOMETRIAS.topo10, GEOMETRIAS.cartao];
    const geomDoQR = (info) => GEOMETRIAS[info.tipo] || null;
    const ajustar = (geomCerta, cantos, r) => homografia(geomCerta.cantos, [0, 1, 2, 3].map((i) => cantos[(i + r) % 4]));
    const achados = [];
    for (const geom of formas) {
      let cantos;
      try { cantos = encontrarCantos(prep, geom); } catch (e) { continue; }
      const hips = hipoteses(cantos, geom);
      achados.push({ geom, cantos, hips });
      if (jsQR) {
        for (const hp of hips) {
          const rec = recortarQR(img, hp.H, 360, geom);
          const res = jsQR(rec.data, rec.width, rec.height, { inversionAttempts: "dontInvert" });
          const info = res && lerTextoQR(res.data);
          const certa = info && geomDoQR(info);
          if (certa && certa.forma === geom.forma && emPe(res)) {
            return { geom: certa.nome, H: certa === geom ? hp.H : ajustar(certa, cantos, hp.r), cantos, qr: info, rotacao: hp.r };
          }
        }
      }
    }
    // QR procurado na foto inteira (decide a forma pelo prefixo e a rotação pela posição)
    if (jsQR) {
      const res = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      const info = res && lerTextoQR(res.data);
      const certa = info && geomDoQR(info);
      const ach = certa && achados.find((a) => a.geom.forma === certa.forma);
      if (ach) {
        const lc = res.location, Q = certa.qr;
        const cq = { x: (lc.topLeftCorner.x + lc.bottomRightCorner.x) / 2, y: (lc.topLeftCorner.y + lc.bottomRightCorner.y) / 2 };
        let melhor = null;
        for (let r = 0; r < 4; r++) {
          const H = ajustar(certa, ach.cantos, r);
          const p = aplicarH(H, Q.x + Q.lado / 2, Q.y + Q.lado / 2);
          const dd = dist(p, cq);
          if (!melhor || dd < melhor.dd) melhor = { dd, H, r };
        }
        return { geom: certa.nome, H: melhor.H, cantos: ach.cantos, qr: info, rotacao: melhor.r };
      }
    }
    // sem QR: nº do aluno pelo código de quadradinhos (vale para o cartão do topo e para a faixa)
    for (const ach of achados.filter((a) => a.geom.forma !== "cartao")) {
      for (const hp of ach.hips) {
        const cod = lerCodigo(prep, hp.H, ach.geom);
        if (!cod) continue;
        // cartão do topo ou faixa do pé? (mesma forma) — vê de que lado estão os contornos das bolinhas
        let geom = ach.geom, H = hp.H;
        if (ach.geom.forma === "faixa5") {
          const opcoes = [GEOMETRIAS.topo5, GEOMETRIAS.faixa].map((g) => {
            const Hg = g === ach.geom ? hp.H : ajustar(g, ach.cantos, hp.r);
            const q1 = layoutFaixa(1, 1, 4, g)[0];
            const nota = q1.bolinhas.reduce((acc, bo) => acc + medirAnel(prep, Hg, bo.x, bo.y, q1.raio), 0);
            return { g, Hg, nota };
          }).sort((x, y) => y.nota - x.nota);
          geom = cod.folha > 1 ? GEOMETRIAS.faixa : opcoes[0].g;
          H = (opcoes.find((o) => o.g === geom) || opcoes[0]).Hg;
        }
        return { geom: geom.nome, H, cantos: ach.cantos, qr: { tipo: geom.nome, parcial: true, num: cod.num, folha: cod.folha }, rotacao: hp.r };
      }
    }
    const ct = achados.find((a) => a.geom.forma === "cartao") || achados[0];
    if (!ct) throw new Error("Não encontrei os quadrados pretos do cartão-resposta. Fotografe a 1ª folha inteira, de cima e com boa luz.");
    // sem QR: assume a folha em pé (canto superior esquerdo = mais perto do topo-esquerda da foto)
    let r0 = 0, menor = Infinity;
    ct.cantos.forEach((c, i) => { if (c.x + c.y < menor) { menor = c.x + c.y; r0 = i; } });
    return { geom: ct.geom.nome, H: ct.hips[r0].H, cantos: ct.cantos, qr: null, rotacao: r0 };
  }

  // ---------------- Bolinhas ----------------
  const LIMIAR_MARCADA = 0.28, LIMIAR_DUVIDA = 0.12;

  function medirBolinha(prep, H, cx, cy, raio) {
    let escuro = 0, total = 0;
    const rr = raio * 0.62, passos = 9;
    for (let a = 0; a < passos; a++) for (let b = 0; b < passos; b++) {
      const dx = (a / (passos - 1) * 2 - 1) * rr, dy = (b / (passos - 1) * 2 - 1) * rr;
      if (dx * dx + dy * dy > rr * rr) continue;
      const p = aplicarH(H, cx + dx, cy + dy);
      const xi = Math.round(p.x), yi = Math.round(p.y);
      total++;
      if (xi >= 0 && yi >= 0 && xi < prep.w && yi < prep.h && prep.bin[yi * prep.w + xi]) escuro++;
    }
    return total ? escuro / total : 0;
  }

  // quanto do contorno impresso de uma bolinha aparece (para distinguir posições parecidas)
  function medirAnel(prep, H, cx, cy, raio) {
    let escuro = 0, total = 0;
    for (let t = 0; t < 24; t++) {
      const a = t / 24 * Math.PI * 2, p = aplicarH(H, cx + Math.cos(a) * raio, cy + Math.sin(a) * raio);
      const xi = Math.round(p.x), yi = Math.round(p.y);
      total++;
      if (xi >= 0 && yi >= 0 && xi < prep.w && yi < prep.h && prep.bin[yi * prep.w + xi]) escuro++;
    }
    return escuro / total;
  }

  function lerBolinhas(prep, H, n, k) {
    return lerBolinhasLista(prep, H, layoutQuestoes(n, k).lista);
  }
  // lista: [{ q, bolinhas:[{x,y}], raio? }] em coordenadas da folha (mm)
  function lerBolinhasLista(prep, H, lista) {
    return lista.map((q) => {
      const fills = q.bolinhas.map((b) => Math.round(medirBolinha(prep, H, b.x, b.y, q.raio || GRADE.raio) * 100) / 100);
      const ordem = fills.map((f, i) => [f, i]).sort((a, b) => b[0] - a[0]);
      const [f1, i1] = ordem[0], f2 = ordem[1] ? ordem[1][0] : 0;
      let marcada = -1, status = "ok";
      if (f1 < LIMIAR_DUVIDA) { status = "branco"; }
      else if (f1 < LIMIAR_MARCADA) { marcada = i1; status = "duvida"; }
      else if (f2 >= LIMIAR_MARCADA && f1 < f2 * 1.8) { status = "dupla"; }
      else { marcada = i1; if (f2 >= LIMIAR_DUVIDA) status = "duvida"; }
      return { q: q.q, fills, marcada, status };
    });
  }

  // ---------------- Correção ----------------
  // gabaritoFila: string "CABD..." (letra correta de cada questão; "X" = anulada, vale para todos)
  // respostas: array de índices (-1 = branco/inválida)
  // bonusBranco (opcional): pontos ganhos por deixar a questão em branco (ex.: "quem não responder a 3 ganha 1,5")
  function corrigir(respostas, gabaritoFila, valores, bonusBranco) {
    let acertos = 0, erros = 0, brancos = 0, nota = 0;
    const detalhe = respostas.map((r, i) => {
      const certa = String(gabaritoFila[i] || "").toUpperCase();
      const v = Number(valores[i]) || 0;
      if (certa === "X") { acertos++; nota += v; return "anulada"; } // questão anulada: ponto para todos
      if (r < 0) { brancos++; nota += Number((bonusBranco || [])[i]) || 0; return "branco"; }
      if (LETRAS[r] === certa) { acertos++; nota += v; return "certo"; }
      erros++; return "errado";
    });
    return { acertos, erros, brancos, nota: Math.round(nota * 100) / 100, detalhe };
  }

  const API = {
    PAG, CANTOS, QR, GRADE, LETRAS, FRASES, LIMIAR_MARCADA, LIMIAR_DUVIDA,
    FAIXA, TOPO_Y, GEOMETRIAS, criarGeomFaixa, layoutQuestoes, layoutFaixa, bitsCodigo, textoQR, textoQRFaixa, textoQRTopo, lerTextoQR, desenharCartoes,
    prepararImagem, encontrarCantos, homografia, aplicarH, localizarFolha, recortarQR, lerCodigo,
    lerBolinhas, lerBolinhasLista, corrigir
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else raiz.CorrecaoCore = API;
})(typeof window !== "undefined" ? window : globalThis);
