/* =====================================================================
   CORREÇÃO POR FOTO — telas do diário
   - Aba "Correção": gabaritos da turma, cartões-resposta em PDF, resultados.
   - Botão 📷: tira a foto do cartão, lê as marcações, confere com o gabarito,
     mostra para revisão e, ao confirmar:
       • grava no Firebase (mesma coleção do diário) a foto, as marcações,
         acertos, erros, brancos e a nota;
       • lança a nota na aba Notas (bimestre + avaliação do gabarito).
   Depende de: index.html (STATE, FB_CFG_ATIVA, obterIdTokenValido, ...),
   correcao-core.js, vendor/jsQR.js, vendor/qrcode.js e jsPDF.
   ===================================================================== */

const CORR_PEND_KEY = "isn_diario_2026_correcoes_pendentes";
const CORR_GAB_CACHE_KEY = "isn_diario_2026_gabaritos_cache";
const VALOR_PADRAO = { teste: 3, trabalho: 1, prova: 6, recuperacao: 10 };
let GABARITOS = {};          // id -> gabarito
let GABARITOS_CARREGADOS = false;
let CORR_ATUAL = null;       // correção em revisão

/* ---------------- Firestore (documentos separados do estado do diário) ---------------- */
function fsBase() {
  const cfg = FB_CFG_ATIVA || DEFAULT_FIREBASE_CONFIG;
  return `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents`;
}
function fsCampos(obj) {
  const f = {};
  Object.entries(obj).forEach(([k, v]) => { if (v !== undefined) f[k] = jsToFirestoreValue(v); });
  return f;
}
function fsObjeto(doc) {
  const o = {};
  Object.entries((doc && doc.fields) || {}).forEach(([k, v]) => { o[k] = firestoreValueToJs(v); });
  return o;
}
async function fsErro(resp, acao) {
  let det = "";
  try { const j = await resp.json(); det = (j.error && j.error.message) || ""; } catch (e) {}
  const err = new Error(`${acao} falhou (${resp.status}) ${det}`);
  err.status = resp.status;
  return err;
}
async function fsSalvarDoc(id, obj, campos) {
  const token = await obterIdTokenValido();
  let url = `${fsBase()}/${FIRESTORE_COLLECTION}/${encodeURIComponent(id)}`;
  if (campos) url += "?" + campos.map((c) => "updateMask.fieldPaths=" + encodeURIComponent(c)).join("&");
  const resp = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields: fsCampos(obj) })
  });
  if (!resp.ok) throw await fsErro(resp, "Gravar");
  return true;
}
async function fsLerDoc(id) {
  const token = await obterIdTokenValido();
  const resp = await fetch(`${fsBase()}/${FIRESTORE_COLLECTION}/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (resp.status === 404) return null;
  if (!resp.ok) throw await fsErro(resp, "Ler");
  return fsObjeto(await resp.json());
}
async function fsApagarDoc(id) {
  const token = await obterIdTokenValido();
  const resp = await fetch(`${fsBase()}/${FIRESTORE_COLLECTION}/${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok && resp.status !== 404) throw await fsErro(resp, "Apagar");
}
// filtros: { campo: valor } (só igualdade); campos: lista para "select" (null = todos)
async function fsConsultar(filtros, campos) {
  const token = await obterIdTokenValido();
  const lista = Object.entries(filtros).map(([k, v]) => ({ fieldFilter: { field: { fieldPath: k }, op: "EQUAL", value: jsToFirestoreValue(v) } }));
  const q = { from: [{ collectionId: FIRESTORE_COLLECTION }] };
  q.where = lista.length === 1 ? lista[0] : { compositeFilter: { op: "AND", filters: lista } };
  if (campos) q.select = { fields: campos.map((c) => ({ fieldPath: c })) };
  const resp = await fetch(`${fsBase()}:runQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ structuredQuery: q })
  });
  if (!resp.ok) throw await fsErro(resp, "Consultar");
  const arr = await resp.json();
  return arr.filter((r) => r.document).map((r) => {
    const o = fsObjeto(r.document);
    o._id = r.document.name.split("/").pop();
    return o;
  });
}
function msgErroFirebaseCorrecao(err) {
  if (err && err.status === 403) {
    return "O Firebase recusou a gravação (403). As regras do Firestore precisam liberar a coleção \"diario_silva_nascimento\" inteira para o seu login — veja o README (seção Correção por foto).";
  }
  return "Sem conexão com o Firebase agora (" + ((err && err.message) || "erro") + ").";
}

/* ---------------- Gabaritos ---------------- */
function salvarCacheGabaritos() {
  try { localStorage.setItem(CORR_GAB_CACHE_KEY, JSON.stringify(GABARITOS)); } catch (e) {}
}
function lerCacheGabaritos() {
  try { const r = localStorage.getItem(CORR_GAB_CACHE_KEY); if (r) GABARITOS = JSON.parse(r) || {}; } catch (e) {}
}
async function carregarGabaritos(forcar) {
  if (GABARITOS_CARREGADOS && !forcar) return GABARITOS;
  lerCacheGabaritos();
  try {
    const lista = await fsConsultar({ tipo: "gabarito" });
    GABARITOS = {};
    lista.forEach((g) => { GABARITOS[g.id] = g; });
    await semearGabaritos();
    salvarCacheGabaritos();
    GABARITOS_CARREGADOS = true;
  } catch (e) {
    console.warn("Gabaritos: usando cópia local", e);
  }
  return GABARITOS;
}
// Gabaritos já usados em sala (gabaritos-iniciais.js): cada um é gravado uma única vez.
// Se for apagado depois, não volta (a marca "semeado" fica no Firebase).
async function semearGabaritos() {
  const sementes = window.GABARITOS_INICIAIS || [];
  for (const sem of sementes) {
    if (GABARITOS[sem.id]) continue;
    const marca = await fsLerDoc("semente_gab_" + sem.id).catch(() => ({}));
    if (marca) continue;
    const g = Object.assign({ tipo: "gabarito", criadoEm: new Date().toISOString() }, sem);
    g.atualizadoEm = g.criadoEm;
    await fsSalvarDoc("gab_" + g.id, g);
    await fsSalvarDoc("semente_gab_" + g.id, { tipo: "semente", gabaritoId: g.id, em: g.criadoEm });
    GABARITOS[g.id] = g;
  }
}

function gabaritosDaTurma(turmaId) {
  return Object.values(GABARITOS).filter((g) => g.turma === turmaId)
    .sort((a, b) => (b.bimestre - a.bimestre) || String(b.criadoEm).localeCompare(String(a.criadoEm)));
}
function novoIdCurto() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-2);
}
function rotuloAvCurto(av) { return { teste: "Teste", trabalho: "Trabalho", prova: "Prova", recuperacao: "Recuperação" }[av] || av; }
function fmtNota(v) { return (Math.round((Number(v) || 0) * 100) / 100).toFixed(2).replace(".", ","); }

/* ---------------- CSS da funcionalidade ---------------- */
(function injetarCss() {
  const css = `
  .corr-hero { display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
  .corr-hero .btn-primary { font-size:16px; padding:14px 22px; }
  .corr-lista { display:grid; gap:10px; }
  .corr-item { border:1px solid var(--line); border-radius:10px; padding:12px 14px; display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center; background:#fffdf8; }
  .corr-item h4 { margin:0 0 2px; font-size:15px; }
  .corr-item .meta { font-size:12px; color:#6b6157; }
  .corr-item .acoes { display:flex; gap:6px; flex-wrap:wrap; }
  .corr-aviso { background:#fff6dc; border:1px solid #e8d38f; border-radius:10px; padding:10px 12px; font-size:13px; margin-bottom:12px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .gab-grade td, .gab-grade th { padding:4px 6px; }
  .gab-alt { display:inline-flex; gap:3px; }
  .gab-alt button { width:28px; height:28px; border-radius:50%; border:1.5px solid #9a8f80; background:white; font-weight:700; font-size:12px; cursor:pointer; color:#6b6157; padding:0; }
  .gab-alt button.on { background:var(--green); border-color:var(--green); color:white; }
  .gab-alt button.anul.on { background:#8a6a1c; border-color:#8a6a1c; }
  .gab-grade input.gab-valor { width:56px; }
  .gab-form { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:12px; }
  .gab-form label { font-size:12px; color:#6b6157; display:flex; flex-direction:column; gap:4px; }
  .gab-form input, .gab-form select { padding:7px 8px; border:1px solid var(--line); border-radius:8px; font-size:14px; }
  .rev-wrap { display:grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap:16px; }
  @media (max-width: 760px) { .rev-wrap { grid-template-columns: 1fr; } .rev-wrap > div:first-child { order: 2; } }
  #modalRevisao .modal-actions { position: sticky; bottom: -24px; background: white; padding: 10px 0 14px; margin-bottom: -10px; border-top: 1px solid var(--line); }
  .rev-wrap canvas { width:100%; height:auto; border:1px solid var(--line); border-radius:8px; background:#fff; }
  .rev-totais { display:flex; gap:8px; flex-wrap:wrap; margin:8px 0 12px; }
  .rev-totais div { background:#f9f5ea; border-radius:10px; padding:8px 12px; text-align:center; min-width:70px; }
  .rev-totais b { display:block; font-size:20px; font-family:"IBM Plex Mono",monospace; }
  .rev-totais span { font-size:11px; color:#6b6157; }
  .rev-q { display:grid; grid-template-columns:repeat(auto-fill,minmax(112px,1fr)); gap:6px; }
  .rev-q div { border:1px solid var(--line); border-radius:8px; padding:4px 6px; display:flex; align-items:center; gap:4px; font-size:12px; }
  .rev-q div.certo { background:#e3f2e3; } .rev-q div.errado { background:#fde4e2; } .rev-q div.branco, .rev-q div.anulada { background:#f3ede0; }
  .rev-q div.atencao { outline:2px solid #d4a72c; }
  .rev-q select { font-size:12px; padding:2px; border-radius:6px; border:1px solid var(--line); }
  .rev-campos { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px; }
  .rev-campos select { padding:6px; border-radius:8px; border:1px solid var(--line); max-width:100%; }
  .corr-carregando { position:fixed; inset:0; background:rgba(0,0,0,.55); color:white; display:flex; align-items:center; justify-content:center; z-index:1000; font-size:16px; font-weight:600; text-align:center; padding:20px; }
  `;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
})();

function mostrarCarregando(txt) {
  let el = document.getElementById("corrCarregando");
  if (!txt) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "corrCarregando"; el.className = "corr-carregando"; document.body.appendChild(el); }
  el.textContent = txt;
}
function criarModal(id, largo) {
  let ov = document.getElementById(id);
  if (ov) ov.remove();
  ov = document.createElement("div");
  ov.id = id; ov.className = "modal-overlay"; ov.style.display = "flex";
  ov.innerHTML = `<div class="modal ${largo ? "wide" : ""}"></div>`;
  document.body.appendChild(ov);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
  return { ov, box: ov.firstElementChild };
}

/* ======================= ABA CORREÇÃO ======================= */
function renderCorrecao() {
  const main = document.getElementById("mainContent");
  const t = turmaAtual();
  const pend = lerPendentes();
  const gabs = gabaritosDaTurma(TURMA_ATUAL);
  main.innerHTML = `
    <div class="card">
      <h3>Correção por foto — ${t.nome}</h3>
      <p class="hint">1) Cadastre o gabarito (ou cole o JSON que vem com a prova) · 2) Aplique a prova com o <b>cartão-resposta abaixo do cabeçalho da 1ª folha</b> (padrão do gerador de provas) · 3) Toque em <b>Corrigir por foto</b> e fotografe <b>só a 1ª folha</b> de cada aluno. O app reconhece o aluno pelo <b>nº</b> (QR ou código de quadradinhos do cartão), confere com o gabarito, guarda as fotos, acertos e erros no Firebase e lança a nota na aba Notas.</p>
      ${htmlColetaPendente()}
      ${pend.length ? `<div class="corr-aviso">⏳ ${pend.length} correção(ões) aguardando envio ao Firebase (as notas já estão no diário). <button class="btn btn-sm" id="corrReenviar">Enviar agora</button></div>` : ""}
      <div class="corr-hero">
        <button class="btn btn-primary" id="corrFoto">📷 Corrigir por foto</button>
        <button class="btn" id="corrDigitar">✍️ Digitar respostas</button>
        <button class="btn" id="corrNovoGab">+ Novo gabarito</button>
        <button class="btn" id="corrAtualizar">↻ Atualizar</button>
      </div>
    </div>
    <div class="card">
      <h3>Gabaritos — ${t.nome}</h3>
      <div class="corr-lista" id="corrLista">
        ${gabs.length ? gabs.map((g) => `
          <div class="corr-item">
            <div>
              <h4>${escapeHtml(g.titulo || "Sem título")}</h4>
              <div class="meta">${g.bimestre}º bimestre · ${rotuloAvCurto(g.avaliacao)} · ${g.n} questões (${"ABCDE".slice(0, g.k)}) · ${(g.filas || ["A"]).length > 1 ? "Filas A e B" : "Fila única"}${g.paginas && g.paginas.length > 1 ? ` · ${g.paginas.length} folhas (${g.paginas.map((p) => p[0] + "–" + p[1]).join(", ")})` : ""} · vale ${fmtNota(g.total)}${(g.bonusBranco || []).some((v) => v) ? " · bônus: " + g.bonusBranco.map((v, i) => (v ? `Q${i + 1} em branco +${fmtNota(v)}` : "")).filter(Boolean).join(", ") : ""}</div>
            </div>
            <div class="acoes">
              <button class="btn btn-sm" data-gab-cartoes="${g.id}">🖨 Cartões</button>
              <button class="btn btn-sm" data-gab-result="${g.id}">📊 Resultados</button>
              <button class="btn btn-sm" data-gab-digitar="${g.id}">✍️ Digitar</button>
              <button class="btn btn-sm" data-gab-editar="${g.id}">✏️ Editar</button>
              <button class="btn btn-sm" data-gab-apagar="${g.id}" style="color:var(--red)">🗑</button>
            </div>
          </div>`).join("") : `<p class="hint" style="margin:0">Nenhum gabarito cadastrado para esta turma ainda.</p>`}
      </div>
    </div>`;
  document.getElementById("corrFoto").addEventListener("click", abrirCamera);
  document.getElementById("corrNovoGab").addEventListener("click", () => abrirEditorGabarito(null));
  document.getElementById("corrDigitar").addEventListener("click", () => digitarRespostas());
  document.getElementById("corrAtualizar").addEventListener("click", async () => { await carregarGabaritos(true); renderCorrecao(); });
  main.querySelectorAll("[data-col-abrir]").forEach((b) => b.addEventListener("click", () => abrirConferenciaColeta(b.dataset.colAbrir)));
  main.querySelectorAll("[data-col-apagar]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Descartar as folhas já fotografadas deste aluno?")) return;
    const col = lerColeta(); delete col[b.dataset.colApagar]; gravarColeta(); renderAll();
  }));
  const btnR = document.getElementById("corrReenviar");
  if (btnR) btnR.addEventListener("click", reenviarPendentes);
  main.querySelectorAll("[data-gab-cartoes]").forEach((b) => b.addEventListener("click", () => abrirModalCartoes(GABARITOS[b.dataset.gabCartoes])));
  main.querySelectorAll("[data-gab-result]").forEach((b) => b.addEventListener("click", () => abrirResultados(GABARITOS[b.dataset.gabResult])));
  main.querySelectorAll("[data-gab-digitar]").forEach((b) => b.addEventListener("click", () => digitarRespostas(b.dataset.gabDigitar)));
  main.querySelectorAll("[data-gab-editar]").forEach((b) => b.addEventListener("click", () => abrirEditorGabarito(GABARITOS[b.dataset.gabEditar])));
  main.querySelectorAll("[data-gab-apagar]").forEach((b) => b.addEventListener("click", () => apagarGabarito(GABARITOS[b.dataset.gabApagar])));
  if (!GABARITOS_CARREGADOS) carregarGabaritos().then(() => { if (ABA_ATUAL === "correcao") renderCorrecao(); });
}

function htmlColetaPendente() {
  const col = lerColeta(), itens = Object.entries(col);
  if (!itens.length) return "";
  return `<div class="corr-aviso" style="display:block">📄 <b>Provas esperando a outra folha</b> (guardadas neste aparelho):
    ${itens.map(([k, it]) => {
      const t = STATE.turmas[it.turma] || { alunos: [], nome: it.turma };
      const al = t.alunos.find((a) => a.num === it.num);
      const tem = Object.keys(it.folhas).map(Number).sort();
      const faltam = []; for (let f = 1; f <= it.total; f++) if (!it.folhas[f]) faltam.push(f);
      return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px">
        <span>${escapeHtml(t.nome)} · Nº ${it.num}${al ? " " + escapeHtml(al.nome) : ""} — tem folha ${tem.join(", ")}, falta ${faltam.join(", ")}</span>
        <button class="btn btn-sm" data-col-abrir="${escapeHtml(k)}">Conferir assim</button>
        <button class="btn btn-sm" data-col-apagar="${escapeHtml(k)}" style="color:var(--red)">Descartar</button></div>`;
    }).join("")}</div>`;
}

/* ---------------- Editor de gabarito ---------------- */
function abrirEditorGabarito(gab) {
  const t = turmaAtual();
  const mes = new Date().getMonth() + 1;
  const g = gab ? JSON.parse(JSON.stringify(gab)) : {
    id: novoIdCurto(), tipo: "gabarito", turma: TURMA_ATUAL, titulo: "",
    bimestre: mes <= 4 ? 1 : mes <= 7 ? 2 : mes <= 9 ? 3 : 4, avaliacao: "prova",
    n: 10, k: 5, filas: ["A"], respostas: { A: "" }, valores: [], total: VALOR_PADRAO.prova
  };
  const { ov, box } = criarModal("modalGabarito", true);

  function ajustarTamanhos() {
    g.filas.forEach((f) => { g.respostas[f] = (g.respostas[f] || "").padEnd(g.n, "?").slice(0, g.n); });
    Object.keys(g.respostas).forEach((f) => { if (!g.filas.includes(f)) delete g.respostas[f]; });
    while (g.valores.length < g.n) g.valores.push(0);
    g.valores = g.valores.slice(0, g.n);
    if (g.valores.every((v) => !v)) distribuir();
  }
  function distribuir() {
    const base = Math.floor((g.total / g.n) * 100) / 100;
    g.valores = Array.from({ length: g.n }, () => base);
    const resto = Math.round((g.total - base * g.n) * 100) / 100;
    if (g.n) g.valores[g.n - 1] = Math.round((base + resto) * 100) / 100;
  }
  function somaValores() { return Math.round(g.valores.reduce((a, b) => a + (Number(b) || 0), 0) * 100) / 100; }

  function desenhar() {
    ajustarTamanhos();
    const letras = "ABCDE".slice(0, g.k).split("");
    box.innerHTML = `
      <h3>${gab ? "Editar" : "Novo"} gabarito — ${t.nome}</h3>
      <div class="gab-form">
        <label style="grid-column:1/-1">Título da avaliação<input id="gTitulo" value="${escapeHtml(g.titulo)}" placeholder="Ex.: PROVA DE HISTÓRIA 3º BIMESTRE"></label>
        <label>Bimestre<select id="gBim">${[1, 2, 3, 4].map((b) => `<option value="${b}" ${g.bimestre == b ? "selected" : ""}>${b}º</option>`).join("")}</select></label>
        <label>Lançar em<select id="gAv">${["teste", "trabalho", "prova", "recuperacao"].map((a) => `<option value="${a}" ${g.avaliacao === a ? "selected" : ""}>${rotuloAvCurto(a)}</option>`).join("")}</select></label>
        <label>Nº de questões<input id="gN" type="number" min="1" max="50" value="${g.n}"></label>
        <label>Alternativas<select id="gK"><option value="4" ${g.k == 4 ? "selected" : ""}>A a D</option><option value="5" ${g.k == 5 ? "selected" : ""}>A a E</option></select></label>
        <label>Filas<select id="gFilas"><option value="A" ${g.filas.length === 1 ? "selected" : ""}>Fila única</option><option value="AB" ${g.filas.length > 1 ? "selected" : ""}>Filas A e B</option></select></label>
        <label>Questões por folha (prova com faixa)<input id="gPaginas" placeholder="ex.: 1-5, 6-10" value="${(g.paginas || []).map((p) => p[0] + "-" + p[1]).join(", ")}"></label>
        <label>Valor total<input id="gTotal" type="text" inputmode="decimal" data-numerico data-max="10" value="${String(g.total).replace(".", ",")}"></label>
      </div>
      <details style="margin-bottom:10px"><summary class="hint" style="cursor:pointer;margin:0">Colar gabarito em JSON (gerado pelo Claude junto com a prova)</summary>
        <textarea id="gJson" rows="5" style="width:100%;font-family:'IBM Plex Mono',monospace;font-size:12px;margin-top:6px" placeholder='{ "titulo": "PROVA DE HISTÓRIA 3º BIMESTRE", "bimestre": 3, "avaliacao": "prova", "alternativas": 5, "questoes": [ { "A": "D", "B": "A", "valor": 0.4 } ] }'></textarea>
        <button class="btn btn-sm" id="gJsonAplicar" style="margin-top:6px">Aplicar JSON</button>
      </details>
      ${(g.bonusBranco || []).some((v) => v) ? `<div class="corr-aviso" style="margin-bottom:8px">Bônus por deixar em branco: ${g.bonusBranco.map((v, i) => (v ? `Q${i + 1} +${fmtNota(v)}` : "")).filter(Boolean).join(", ")} (a nota pode passar do valor total).</div>` : ""}
      <p class="hint" style="margin-bottom:6px">Toque na letra certa de cada questão. <b>∅</b> = questão anulada (todos ganham o ponto). Soma dos valores: <b id="gSoma">${fmtNota(somaValores())}</b> <button class="btn btn-sm" id="gDistribuir">Distribuir igualmente</button></p>
      <div class="table-wrap" style="max-height:46vh">
        <table class="gab-grade"><thead><tr><th>Q</th>${g.filas.map((f) => `<th>${g.filas.length > 1 ? "Fila " + f : "Resposta"}</th>`).join("")}<th>Valor</th></tr></thead>
        <tbody>${Array.from({ length: g.n }, (_, i) => `
          <tr><td><b>${String(i + 1).padStart(2, "0")}</b></td>
          ${g.filas.map((f) => `<td><span class="gab-alt">${letras.map((L) => `<button type="button" class="${g.respostas[f][i] === L ? "on" : ""}" data-q="${i}" data-f="${f}" data-l="${L}">${L}</button>`).join("")}<button type="button" class="anul ${g.respostas[f][i] === "X" ? "on" : ""}" data-q="${i}" data-f="${f}" data-l="X" title="Anular">∅</button></span></td>`).join("")}
          <td><input type="text" class="gab-valor" data-v="${i}" value="${String(g.valores[i]).replace(".", ",")}" inputmode="decimal" data-numerico data-max="10"></td></tr>`).join("")}
        </tbody></table>
      </div>
      <p class="hint" id="gErro" style="color:var(--red);min-height:18px;margin:8px 0 0"></p>
      <div class="modal-actions">
        <button class="btn" id="gCancelar">Cancelar</button>
        <button class="btn btn-primary" id="gSalvar">Salvar gabarito</button>
      </div>`;

    const lerCabecalho = () => {
      const pgTxt = (document.getElementById("gPaginas") || {}).value || "";
      const pgs = pgTxt.split(/[;,]/).map((x) => x.trim()).filter(Boolean).map((x) => x.split(/\s*[-–a]\s*/).map(Number)).filter((p) => p[0] >= 1 && (p[1] || p[0]) >= p[0]).map((p) => [p[0], p[1] || p[0]]);
      if (pgs.length) g.paginas = pgs; else delete g.paginas;
      g.titulo = document.getElementById("gTitulo").value.trim();
      g.bimestre = Number(document.getElementById("gBim").value);
      g.avaliacao = document.getElementById("gAv").value;
    };
    document.getElementById("gTitulo").addEventListener("input", lerCabecalho);
    document.getElementById("gBim").addEventListener("change", lerCabecalho);
    document.getElementById("gAv").addEventListener("change", () => {
      lerCabecalho();
      g.total = VALOR_PADRAO[g.avaliacao] || g.total; distribuir(); desenhar();
    });
    document.getElementById("gN").addEventListener("change", (e) => {
      lerCabecalho();
      g.n = Math.max(1, Math.min(50, Number(e.target.value) || 1)); g.valores = []; delete g.bonusBranco; desenhar();
    });
    document.getElementById("gK").addEventListener("change", (e) => {
      lerCabecalho(); g.k = Number(e.target.value);
      g.filas.forEach((f) => { g.respostas[f] = g.respostas[f].split("").map((c) => (c === "E" && g.k === 4 ? "?" : c)).join(""); });
      desenhar();
    });
    document.getElementById("gFilas").addEventListener("change", (e) => { lerCabecalho(); g.filas = e.target.value === "AB" ? ["A", "B"] : ["A"]; desenhar(); });
    document.getElementById("gTotal").addEventListener("change", (e) => { lerCabecalho(); g.total = parseDecimal(e.target.value) || 0; distribuir(); desenhar(); });
    document.getElementById("gDistribuir").addEventListener("click", () => { lerCabecalho(); distribuir(); desenhar(); });
    box.querySelectorAll(".gab-alt button").forEach((b) => b.addEventListener("click", () => {
      const i = Number(b.dataset.q), f = b.dataset.f;
      const arr = g.respostas[f].split(""); arr[i] = b.dataset.l; g.respostas[f] = arr.join("");
      b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    }));
    box.querySelectorAll("[data-v]").forEach((inp) => inp.addEventListener("input", () => {
      g.valores[Number(inp.dataset.v)] = parseDecimal(inp.value);
      document.getElementById("gSoma").textContent = fmtNota(somaValores());
    }));
    document.getElementById("gJsonAplicar").addEventListener("click", () => {
      try {
        lerCabecalho();
        const j = JSON.parse(document.getElementById("gJson").value);
        const qs = j.questoes || [];
        if (!qs.length) throw new Error("O JSON não tem \"questoes\".");
        if (j.titulo) g.titulo = j.titulo;
        if (j.id && !gab) g.id = String(j.id).replace(/[^\w-]/g, "").slice(0, 20) || g.id;
        g.paginas = Array.isArray(j.paginas) && j.paginas.length ? j.paginas.map((p) => [Number(p[0]), Number(p[1])]) : undefined;
        if (!g.paginas) delete g.paginas;
        if (j.bimestre && resolverBimestre(j.bimestre)) g.bimestre = Number(resolverBimestre(j.bimestre).slice(1));
        if (j.avaliacao && resolverAvaliacao(j.avaliacao)) g.avaliacao = resolverAvaliacao(j.avaliacao);
        g.k = Number(j.alternativas) === 4 ? 4 : 5;
        g.n = Math.min(50, qs.length);
        g.filas = qs.some((q) => q.B) ? ["A", "B"] : ["A"];
        g.filas.forEach((f) => {
          g.respostas[f] = qs.slice(0, g.n).map((q) => {
            const v = String(q[f] || q.resposta || "?").trim().toUpperCase();
            return /^[A-E]$/.test(v) ? v : v === "X" || v === "ANULADA" ? "X" : "?";
          }).join("");
        });
        g.valores = qs.slice(0, g.n).map((q) => Number(String(q.valor === undefined ? "" : q.valor).replace(",", ".")) || 0);
        g.bonusBranco = qs.slice(0, g.n).map((q) => Number(String(q.bonusEmBranco === undefined ? "" : q.bonusEmBranco).replace(",", ".")) || 0);
        if (!g.bonusBranco.some((v) => v)) delete g.bonusBranco;
        g.total = g.valores.some((v) => v) ? somaValores() : (VALOR_PADRAO[g.avaliacao] || 10);
        if (!g.valores.some((v) => v)) g.valores = [];
        desenhar();
      } catch (e) { document.getElementById("gErro").textContent = "JSON inválido: " + e.message; }
    });
    document.getElementById("gCancelar").addEventListener("click", () => ov.remove());
    document.getElementById("gSalvar").addEventListener("click", async () => {
      lerCabecalho();
      const erroEl = document.getElementById("gErro");
      if (!g.titulo) { erroEl.textContent = "Dê um título à avaliação."; return; }
      if (g.avaliacao === "recuperacao" && g.bimestre !== 2 && g.bimestre !== 4) { erroEl.textContent = "Recuperação só no 2º e 4º bimestres."; return; }
      for (const f of g.filas) {
        const falta = g.respostas[f].split("").map((c, i) => (c === "?" ? i + 1 : 0)).filter(Boolean);
        if (falta.length) { erroEl.textContent = `Falta marcar a resposta${g.filas.length > 1 ? " da fila " + f : ""} nas questões: ${falta.join(", ")}.`; return; }
      }
      if (Math.abs(somaValores() - g.total) > 0.01 && !confirm(`A soma dos valores (${fmtNota(somaValores())}) é diferente do valor total (${fmtNota(g.total)}). Salvar mesmo assim?`)) return;
      g.total = somaValores();
      g.atualizadoEm = new Date().toISOString();
      if (!g.criadoEm) g.criadoEm = g.atualizadoEm;
      const mudouRespostas = gab && (JSON.stringify(gab.respostas) !== JSON.stringify(g.respostas) || JSON.stringify(gab.valores) !== JSON.stringify(g.valores) || JSON.stringify(gab.bonusBranco || []) !== JSON.stringify(g.bonusBranco || []));
      const btn = document.getElementById("gSalvar"); btn.disabled = true; btn.textContent = "Salvando...";
      try {
        await fsSalvarDoc("gab_" + g.id, g);
        GABARITOS[g.id] = g; salvarCacheGabaritos();
        ov.remove();
        if (mudouRespostas && confirm("O gabarito mudou. Recalcular as notas dos cartões já corrigidos com este gabarito?")) await recalcularCorrecoes(g);
        renderAll();
      } catch (e) {
        erroEl.textContent = msgErroFirebaseCorrecao(e);
        btn.disabled = false; btn.textContent = "Salvar gabarito";
      }
    });
  }
  desenhar();
}

async function apagarGabarito(g) {
  if (!g || !confirm(`Apagar o gabarito "${g.titulo}"?\n\nAs correções e fotos ligadas a ele também serão apagadas do Firebase. As notas já lançadas no diário continuam.`)) return;
  mostrarCarregando("Apagando...");
  try {
    const cors = await fsConsultar({ tipo: "correcao", gabaritoId: g.id }, ["num"]);
    for (const c of cors) await fsApagarDoc(c._id);
    await fsApagarDoc("gab_" + g.id);
    delete GABARITOS[g.id]; salvarCacheGabaritos();
  } catch (e) { alert(msgErroFirebaseCorrecao(e)); }
  mostrarCarregando(null);
  renderAll();
}

/* ---------------- Cartões-resposta em PDF ---------------- */
function abrirModalCartoes(g) {
  const t = STATE.turmas[g.turma];
  const duasFilas = (g.filas || ["A"]).length > 1;
  const { ov, box } = criarModal("modalCartoes");
  box.innerHTML = `
    <h3>Cartões-resposta</h3>
    <p class="hint">${escapeHtml(g.titulo)} — ${t.nome}. Gera uma folha por aluno, com nome e número do diário. Imprima em A4, sem ajustar à página (tamanho real).</p>
    ${duasFilas ? `<label class="hint" style="display:block">Fila de cada aluno
      <select id="cFila" style="display:block;margin-top:4px;padding:6px;border-radius:8px;border:1px solid var(--line)">
        <option value="impar">Nº ímpar = Fila A · Nº par = Fila B</option>
        <option value="A">Todos Fila A</option><option value="B">Todos Fila B</option>
      </select></label>` : ""}
    <label class="hint" style="display:block">Alunos
      <select id="cAlunos" style="display:block;margin-top:4px;padding:6px;border-radius:8px;border:1px solid var(--line);width:100%">
        <option value="todos">Turma inteira (${t.alunos.length})</option>
        ${t.alunos.map((a) => `<option value="${a.num}">${a.num}. ${escapeHtml(a.nome)}</option>`).join("")}
      </select></label>
    <div class="modal-actions"><button class="btn" id="cFechar">Fechar</button><button class="btn btn-primary" id="cGerar">Gerar PDF</button></div>`;
  document.getElementById("cFechar").addEventListener("click", () => ov.remove());
  document.getElementById("cGerar").addEventListener("click", () => {
    const modo = duasFilas ? document.getElementById("cFila").value : "A";
    const sel = document.getElementById("cAlunos").value;
    const alunos = t.alunos.filter((a) => sel === "todos" || a.num === Number(sel)).map((a) => ({
      num: a.num, nome: a.nome, fila: modo === "impar" ? (a.num % 2 ? "A" : "B") : modo
    }));
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    CorrecaoCore.desenharCartoes(doc, {
      qrcode: window.qrcode, titulo: g.titulo, serie: t.nome.toUpperCase(), bimestre: g.bimestre,
      n: g.n, k: g.k, gabId: g.id, turma: g.turma, alunos
    });
    doc.save(`Cartoes_${g.turma}_${(g.titulo || "avaliacao").replace(/[^\wÀ-ú]+/g, "_")}.pdf`);
    ov.remove();
  });
}

/* ======================= CÂMERA → LEITURA ======================= */
function abrirCamera() {
  let inp = document.getElementById("corrInputFoto");
  if (!inp) {
    inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*"; inp.setAttribute("capture", "environment");
    inp.id = "corrInputFoto"; inp.style.display = "none";
    document.body.appendChild(inp);
    inp.addEventListener("change", () => {
      const f = inp.files && inp.files[0];
      inp.value = "";
      if (f) processarFoto(f);
    });
  }
  inp.click();
}

async function carregarImagemReduzida(file, maxLado) {
  let fonte;
  try { fonte = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch (e) {
    fonte = await new Promise((ok, falha) => {
      const im = new Image();
      im.onload = () => ok(im); im.onerror = () => falha(new Error("Não consegui abrir a foto."));
      im.src = URL.createObjectURL(file);
    });
  }
  const w0 = fonte.width, h0 = fonte.height;
  const f = Math.min(1, maxLado / Math.max(w0, h0));
  const cv = document.createElement("canvas");
  cv.width = Math.round(w0 * f); cv.height = Math.round(h0 * f);
  cv.getContext("2d").drawImage(fonte, 0, 0, cv.width, cv.height);
  return cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
}

// Cartão "endireitado" (vira a foto guardada no Firebase)
function retificarCartao(img, H, largura) {
  const P = CorrecaoCore.PAG, W = largura, Hh = Math.round(largura * P.h / P.w);
  const cv = document.createElement("canvas"); cv.width = W; cv.height = Hh;
  const ctx = cv.getContext("2d"); const out = ctx.createImageData(W, Hh);
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
    const p = CorrecaoCore.aplicarH(H, (i + 0.5) * P.w / W, (j + 0.5) * P.h / Hh);
    const x = Math.round(p.x), y = Math.round(p.y), o = (j * W + i) * 4;
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) { out.data[o] = out.data[o + 1] = out.data[o + 2] = 255; }
    else { const s = (y * img.width + x) * 4; out.data[o] = img.data[s]; out.data[o + 1] = img.data[s + 1]; out.data[o + 2] = img.data[s + 2]; }
    out.data[o + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return cv;
}

/* ---------- Provas de várias folhas: junta as folhas de cada aluno antes de corrigir ---------- */
const CORR_COLETA_KEY = "isn_diario_2026_folhas_coletadas";
let COLETA = null; // chave "gab|turma|num" -> { gabId, turma, num, fila, total, folhas: { n: {qIni,qFim,leitura,foto} } }
const PREPS = {};  // imagem já preparada de cada folha desta sessão (para reler se trocar o gabarito)

function lerColeta() {
  if (COLETA) return COLETA;
  try { COLETA = JSON.parse(localStorage.getItem(CORR_COLETA_KEY) || "{}") || {}; } catch (e) { COLETA = {}; }
  return COLETA;
}
function gravarColeta() {
  try { localStorage.setItem(CORR_COLETA_KEY, JSON.stringify(COLETA || {})); }
  catch (e) { console.warn("Sem espaço para guardar as folhas no aparelho", e); }
}
function chaveColeta(gabId, turma, num) { return `${gabId}|${turma}|${num}`; }

// Questões de cada folha: pelo QR; senão pelo gabarito (campo paginas); senão divide igualmente
function faixaDaFolha(g, folha, total) {
  if (g.paginas && g.paginas[folha - 1]) return g.paginas[folha - 1];
  total = total || (g.paginas ? g.paginas.length : 2);
  const por = Math.ceil(g.n / total), ini = (folha - 1) * por + 1;
  return [ini, Math.min(g.n, ini + por - 1)];
}
function totalFolhas(g, qr) { return (qr && qr.total) || (g && g.paginas ? g.paginas.length : 1); }

function listaDaPagina(g, pg) {
  if (!pg.geom || pg.geom === "cartao") return CorrecaoCore.layoutQuestoes(g.n, g.k).lista;
  return CorrecaoCore.layoutFaixa(pg.qIni, pg.ehTopo ? g.n : pg.qFim, g.k, CorrecaoCore.GEOMETRIAS[pg.geom] || CorrecaoCore.GEOMETRIAS.faixa);
}

async function processarFoto(file) {
  mostrarCarregando("Lendo a folha...");
  await new Promise((r) => setTimeout(r, 30));
  try {
    await carregarGabaritos();
    const img = await carregarImagemReduzida(file, 1600);
    const prep = CorrecaoCore.prepararImagem(img);
    const loc = CorrecaoCore.localizarFolha(img, prep, window.jsQR);
    const qr = loc.qr || {};
    let gab = qr.gabId ? GABARITOS[qr.gabId] : null;
    if (qr.gabId && !gab) { await carregarGabaritos(true); gab = GABARITOS[qr.gabId]; }
    const fotoCanvas = retificarCartao(img, loc.H, 900);

    if (loc.geom === "cartao") { // cartão-resposta de folha inteira (todas as questões)
      CORR_ATUAL = { paginas: [{ folha: 1, geom: "cartao", qIni: 1, qFim: gab ? gab.n : 0, canvas: fotoCanvas, prep, H: loc.H }],
        qr: loc.qr, respostas: [], leitura: null };
      CORR_ATUAL.gabId = gab ? gab.id : (gabaritosDaTurma(TURMA_ATUAL)[0] || {}).id;
      CORR_ATUAL.turma = gab ? gab.turma : TURMA_ATUAL;
      CORR_ATUAL.num = qr.num || null;
      CORR_ATUAL.fila = qr.fila || "A";
      if (CORR_ATUAL.gabId) lerComGabarito();
      mostrarCarregando(null);
      abrirRevisao(qr.gabId && !gab ? "O código aponta para um gabarito que não existe mais. Escolha o gabarito abaixo." :
        !loc.qr ? "Não consegui ler o código do cartão. Confira o gabarito e o aluno abaixo." : "");
      return;
    }

    // faixa de respostas de uma folha da prova
    mostrarCarregando(null);
    const folha = {
      geom: loc.geom, ehTopo: /^topo/.test(loc.geom), folha: qr.folha || 1, qIni: qr.qIni || null, qFim: qr.qFim || null,
      canvas: fotoCanvas, prep, H: loc.H
    };
    let info = { gabId: gab ? gab.id : null, turma: gab ? gab.turma : (qr.turma || TURMA_ATUAL), num: qr.num || null, fila: qr.fila || "A", total: folha.ehTopo ? 1 : (qr.total || null) };
    if (!info.gabId || !info.num) {
      // sem QR: o nº veio do código de quadradinhos da faixa — sugere a prova que já espera esta folha deste nº
      if (!info.gabId) {
        const esperando = Object.values(lerColeta()).filter((it) => it.num === info.num && !it.folhas[folha.folha]);
        const sug = esperando[0] ? GABARITOS[esperando[0].gabId] :
          (gabaritosDaTurma(TURMA_ATUAL).find((x) => x.paginas && x.paginas.length > 1) || gabaritosDaTurma(TURMA_ATUAL)[0]);
        if (sug) { info.gabId = sug.id; info.turma = sug.turma; if (esperando[0]) info.total = esperando[0].total; }
      }
      info = await identificarFolha(folha, info, qr.parcial ? "Não consegui ler o QR desta folha. Nº lido pelo código da faixa: " + (info.num || "?") + ". Confira:" : "Confirme de quem é esta folha:");
      if (!info) return;
    }
    const g = GABARITOS[info.gabId];
    if (folha.ehTopo) { folha.folha = 1; folha.qIni = 1; folha.qFim = g.n; info.total = 1; }
    else if (!folha.qIni) { const f = faixaDaFolha(g, folha.folha, info.total); folha.qIni = f[0]; folha.qFim = f[1]; }
    folha.leitura = CorrecaoCore.lerBolinhasLista(prep, loc.H, listaDaPagina(g, folha));
    adicionarFolhaColetada(info, folha);
  } catch (e) {
    mostrarCarregando(null);
    alert(e.message || "Não foi possível ler a foto.");
  }
}

// Pede gabarito / aluno / folha quando o QR não pôde ser lido
function identificarFolha(folha, info, titulo) {
  return new Promise((ok) => {
    const { ov, box } = criarModal("modalIdent", true);
    const gabs = Object.values(GABARITOS).sort((a, b) => (b.paginas ? 1 : 0) - (a.paginas ? 1 : 0));
    const desenhar = () => {
      const g = GABARITOS[info.gabId] || gabs[0];
      if (g && !info.gabId) info.gabId = g.id;
      const turma = STATE.turmas[g ? g.turma : info.turma] || turmaAtual();
      const total = g ? totalFolhas(g, info) : 2;
      box.innerHTML = `<h3>Identificar folha</h3><p class="hint">${escapeHtml(titulo)}</p>
        <div class="rev-campos">
          <select id="iGab">${gabs.map((x) => `<option value="${x.id}" ${x.id === info.gabId ? "selected" : ""}>${escapeHtml((STATE.turmas[x.turma] || {}).nome || x.turma)} · ${escapeHtml(x.titulo)}</option>`).join("")}</select>
          <select id="iAluno"><option value="">— nº / aluno —</option>${turma.alunos.map((a) => `<option value="${a.num}" ${a.num === info.num ? "selected" : ""}>${a.num}. ${escapeHtml(a.nome)}</option>`).join("")}</select>
          <select id="iFolha" ${folha.ehTopo ? 'style="display:none"' : ""}>${Array.from({ length: Math.max(total, folha.folha) }, (_, i) => `<option value="${i + 1}" ${i + 1 === folha.folha ? "selected" : ""}>Folha ${i + 1}</option>`).join("")}</select>
        </div>
        <canvas id="iCanvas" style="width:100%;max-width:520px;border:1px solid var(--line);border-radius:8px"></canvas>
        <div class="modal-actions"><button class="btn" id="iCancelar">Cancelar</button><button class="btn btn-primary" id="iOk">Continuar</button></div>`;
      const cv = document.getElementById("iCanvas"); cv.width = folha.canvas.width; cv.height = folha.canvas.height;
      cv.getContext("2d").drawImage(folha.canvas, 0, 0);
      document.getElementById("iGab").addEventListener("change", (e) => { info.gabId = e.target.value; info.turma = GABARITOS[info.gabId].turma; desenhar(); });
      document.getElementById("iAluno").addEventListener("change", (e) => { info.num = e.target.value ? Number(e.target.value) : null; });
      document.getElementById("iFolha").addEventListener("change", (e) => { folha.folha = Number(e.target.value); });
      document.getElementById("iCancelar").addEventListener("click", () => { ov.remove(); ok(null); });
      document.getElementById("iOk").addEventListener("click", () => {
        if (!info.gabId || !info.num) { alert("Escolha o gabarito e o nº do aluno."); return; }
        info.turma = GABARITOS[info.gabId].turma; info.total = folha.ehTopo ? 1 : (info.total || totalFolhas(GABARITOS[info.gabId], null));
        folha.qIni = null; folha.qFim = null;
        ov.remove(); ok(info);
      });
    };
    desenhar();
  });
}

function adicionarFolhaColetada(info, folha) {
  const g = GABARITOS[info.gabId];
  const total = info.total || totalFolhas(g, null);
  const col = lerColeta();
  const k = chaveColeta(g.id, g.turma, info.num);
  const item = col[k] || { gabId: g.id, turma: g.turma, num: info.num, fila: info.fila, total, folhas: {} };
  item.total = Math.max(item.total || 1, total);
  item.fila = info.fila || item.fila;
  item.folhas[folha.folha] = { geom: folha.geom, ehTopo: !!folha.ehTopo, qIni: folha.qIni, qFim: folha.qFim, leitura: folha.leitura, foto: folha.canvas.toDataURL("image/jpeg", 0.6) };
  PREPS[k + "|" + folha.folha] = { prep: folha.prep, H: folha.H, canvas: folha.canvas };
  col[k] = item; gravarColeta();
  const faltam = [];
  for (let f = 1; f <= item.total; f++) if (!item.folhas[f]) faltam.push(f);
  const aluno = (STATE.turmas[g.turma] || { alunos: [] }).alunos.find((a) => a.num === info.num);
  const quem = `Nº ${info.num}${aluno ? " — " + aluno.nome : ""}`;
  if (faltam.length) {
    renderAll();
    const { ov, box } = criarModal("modalFalta");
    box.innerHTML = `<h3>Folha ${folha.folha} de ${item.total} lida ✓</h3>
      <p><b>${escapeHtml(quem)}</b><br><span class="hint">${escapeHtml(g.titulo)} · questões ${folha.qIni} a ${folha.qFim}</span></p>
      <div class="corr-aviso">Falta fotografar: <b>${faltam.map((f) => "folha " + f).join(", ")}</b>. Pode ser agora ou depois — fica guardado neste aparelho.</div>
      <div class="modal-actions" style="flex-wrap:wrap"><button class="btn" id="fdFechar">Depois</button><button class="btn btn-primary" id="fdFoto">📷 Fotografar a folha que falta</button></div>`;
    document.getElementById("fdFechar").addEventListener("click", () => ov.remove());
    document.getElementById("fdFoto").addEventListener("click", () => { ov.remove(); abrirCamera(); });
    return;
  }
  abrirConferenciaColeta(k);
}

// Monta a conferência com todas as folhas do aluno
function abrirConferenciaColeta(k, aviso) {
  const item = lerColeta()[k];
  const g = GABARITOS[item.gabId];
  if (!g) { alert("O gabarito desta prova não foi encontrado."); return; }
  const leitura = Array.from({ length: g.n }, (_, i) => ({ q: i + 1, fills: [], marcada: -1, status: "faltando" }));
  const paginas = [];
  Object.keys(item.folhas).map(Number).sort((a, b) => a - b).forEach((f) => {
    const fo = item.folhas[f];
    (fo.leitura || []).forEach((r) => { if (r.q >= 1 && r.q <= g.n) leitura[r.q - 1] = r; });
    const mem = PREPS[k + "|" + f];
    paginas.push({ folha: f, geom: fo.geom || "faixa", ehTopo: !!fo.ehTopo, qIni: fo.qIni, qFim: fo.qFim, foto: fo.foto, canvas: mem ? mem.canvas : null, prep: mem ? mem.prep : null, H: mem ? mem.H : null });
  });
  CORR_ATUAL = { paginas, leitura, respostas: leitura.map((r) => r.marcada), gabId: g.id, turma: item.turma, num: item.num, fila: item.fila || "A", chaveColeta: k };
  const faltando = leitura.filter((r) => r.status === "faltando").map((r) => r.q);
  abrirRevisao(aviso || (faltando.length ? `Questões sem folha fotografada: ${faltando.join(", ")} (contam como em branco).` : ""));
}

function coletaIncompleta() {
  const it = CORR_ATUAL && CORR_ATUAL.chaveColeta ? lerColeta()[CORR_ATUAL.chaveColeta] : null;
  if (!it) return false;
  for (let f = 1; f <= (it.total || 1); f++) if (!it.folhas[f]) return true;
  return false;
}

function lerComGabarito() {
  const g = GABARITOS[CORR_ATUAL.gabId];
  if (!g) return;
  const pgs = CORR_ATUAL.paginas || [];
  if (!pgs.length) { // digitação manual (prova sem cartão-resposta)
    CORR_ATUAL.leitura = Array.from({ length: g.n }, (_, i) => ({ q: i + 1, fills: [], marcada: -1, status: "ok" }));
    CORR_ATUAL.respostas = CORR_ATUAL.leitura.map(() => -1);
    return;
  }
  const leitura = Array.from({ length: g.n }, (_, i) => ({ q: i + 1, fills: [], marcada: -1, status: "faltando" }));
  pgs.forEach((pg) => {
    if (pg.geom === "cartao") pg.qFim = g.n;
    if (!pg.prep) return;
    CorrecaoCore.lerBolinhasLista(pg.prep, pg.H, listaDaPagina(g, pg)).forEach((r) => { if (r.q <= g.n) leitura[r.q - 1] = r; });
  });
  CORR_ATUAL.leitura = leitura;
  CORR_ATUAL.respostas = leitura.map((r) => r.marcada);
}

function resultadoAtual() {
  const g = GABARITOS[CORR_ATUAL.gabId];
  const fila = (g.filas || ["A"]).includes(CORR_ATUAL.fila) ? CORR_ATUAL.fila : "A";
  return CorrecaoCore.corrigir(CORR_ATUAL.respostas, g.respostas[fila], g.valores, g.bonusBranco);
}

// Desenha a foto de uma folha com as marcações por cima (lista = questões daquela folha)
function desenharSobreposicao(canvas, base, g, respostas, fila, detalhe, lista) {
  const ctx = canvas.getContext("2d");
  canvas.width = base.width; canvas.height = base.height;
  ctx.drawImage(base, 0, 0);
  const esc = base.width / CorrecaoCore.PAG.w;
  lista = lista || CorrecaoCore.layoutQuestoes(g.n, g.k).lista;
  const certas = g.respostas[fila] || "";
  lista.forEach((q) => {
    const i = q.q - 1;
    if (i < 0 || i >= g.n) return;
    const r = (q.raio || CorrecaoCore.GRADE.raio) * esc + 3;
    const iCerta = CorrecaoCore.LETRAS.indexOf(certas[i]);
    if (iCerta >= 0 && q.bolinhas[iCerta]) {
      const b = q.bolinhas[iCerta];
      ctx.lineWidth = 3; ctx.strokeStyle = "#2e7d32";
      ctx.beginPath(); ctx.arc(b.x * esc, b.y * esc, r, 0, Math.PI * 2); ctx.stroke();
    }
    const m = respostas[i];
    if (m >= 0 && q.bolinhas[m]) {
      const b = q.bolinhas[m];
      ctx.fillStyle = detalhe[i] === "certo" || detalhe[i] === "anulada" ? "rgba(46,125,50,.45)" : "rgba(179,38,30,.5)";
      ctx.beginPath(); ctx.arc(b.x * esc, b.y * esc, r - 1, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = "rgba(212,167,44,.35)";
      const b0 = q.bolinhas[0], bk = q.bolinhas[q.bolinhas.length - 1];
      ctx.fillRect(b0.x * esc - r, b0.y * esc - r, (bk.x - b0.x) * esc + 2 * r, 2 * r);
    }
  });
}

function carregarImagemDataURL(url) {
  return new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = url; });
}

function abrirRevisao(aviso) {
  const { ov, box } = criarModal("modalRevisao", true);
  box.style.maxWidth = "1000px";
  const pgs = CORR_ATUAL.paginas || [];

  function desenhar() {
    const g = GABARITOS[CORR_ATUAL.gabId];
    const turma = STATE.turmas[CORR_ATUAL.turma] || turmaAtual();
    const gabsTurma = Object.values(GABARITOS).sort((a, b) => String(a.turma).localeCompare(b.turma) || b.bimestre - a.bimestre);
    const aluno = turma.alunos.find((a) => a.num === CORR_ATUAL.num);
    let res = null;
    if (g && CORR_ATUAL.leitura) res = resultadoAtual();
    const notaAtual = g && aluno ? valorAtualNota(aluno, "b" + g.bimestre, g.avaliacao) : null;
    const letras = g ? CorrecaoCore.LETRAS.slice(0, g.k).split("") : [];
    box.innerHTML = `
      <h3>Conferir correção${pgs.length > 1 ? ` — ${pgs.length} folhas` : ""}</h3>
      ${aviso ? `<div class="corr-aviso">⚠️ ${escapeHtml(aviso)}</div>` : ""}
      <div class="rev-campos">
        <select id="rGab">${gabsTurma.length ? "" : `<option value="">(nenhum gabarito)</option>`}${gabsTurma.map((x) => `<option value="${x.id}" ${x.id === CORR_ATUAL.gabId ? "selected" : ""}>${escapeHtml((STATE.turmas[x.turma] || {}).nome || x.turma)} · ${escapeHtml(x.titulo)}</option>`).join("")}</select>
        <select id="rAluno"><option value="">— escolha o aluno (nº) —</option>${turma.alunos.map((a) => `<option value="${a.num}" ${a.num === CORR_ATUAL.num ? "selected" : ""}>${a.num}. ${escapeHtml(a.nome)}</option>`).join("")}</select>
        ${g && (g.filas || []).length > 1 ? `<select id="rFila"><option value="A" ${CORR_ATUAL.fila === "A" ? "selected" : ""}>Fila A</option><option value="B" ${CORR_ATUAL.fila === "B" ? "selected" : ""}>Fila B</option></select>` : ""}
      </div>
      ${!g ? `<p class="hint" style="color:var(--red)">Cadastre um gabarito na aba Correção antes de corrigir.</p>` : `
      <div class="rev-wrap">
        ${!pgs.length ? `<div><p class="hint">Sem foto: escolha ao lado a letra que o aluno marcou em cada questão (— = em branco ou rasurada).</p></div>` : `<div>${pgs.map((pg, i) => `${pgs.length > 1 ? `<p class="hint" style="margin:8px 0 4px"><b>Folha ${pg.folha}</b> · questões ${pg.qIni} a ${pg.qFim}</p>` : ""}<canvas id="rCanvas${i}"></canvas>`).join("")}<p class="hint" style="margin-top:4px">Verde = resposta certa · preenchido verde/vermelho = o que o aluno marcou · amarelo = em branco ou marcação dupla.</p></div>`}
        <div>
          <div class="hint" style="margin:0 0 4px">${g.bimestre}º bimestre · lança em <b>${rotuloAvCurto(g.avaliacao)}</b>${notaAtual !== null && notaAtual !== 0 ? ` · nota atual no diário: <b>${fmtNota(notaAtual)}</b> (será substituída)` : ""}</div>
          <div class="rev-totais">
            <div><b style="color:var(--green)">${res.acertos}</b><span>acertos</span></div>
            <div><b style="color:var(--red)">${res.erros}</b><span>erros</span></div>
            <div><b>${res.brancos}</b><span>em branco</span></div>
            <div><b>${fmtNota(res.nota)}</b><span>nota (de ${fmtNota(g.total)})</span></div>
          </div>
          <p class="hint" style="margin-bottom:6px">Se a leitura errou alguma questão, corrija aqui. Questões com contorno amarelo merecem uma olhada.</p>
          <div class="rev-q">${CORR_ATUAL.leitura.map((r, i) => {
            const m = CORR_ATUAL.respostas[i];
            const atencao = r.status === "duvida" || r.status === "dupla" || r.status === "faltando";
            return `<div class="${res.detalhe[i]} ${atencao ? "atencao" : ""}" title="${r.status === "dupla" ? "Marcação dupla" : r.status === "duvida" ? "Marcação fraca" : r.status === "faltando" ? "Folha não fotografada" : ""}">
              <b>${String(i + 1).padStart(2, "0")}</b>
              <select data-rq="${i}"><option value="-1" ${m < 0 ? "selected" : ""}>—</option>${letras.map((L, j) => `<option value="${j}" ${m === j ? "selected" : ""}>${L}</option>`).join("")}</select>
              <span>${res.detalhe[i] === "certo" ? "✓" : res.detalhe[i] === "errado" ? "✗ (" + (g.respostas[CORR_ATUAL.fila] || g.respostas.A)[i] + ")" : res.detalhe[i] === "anulada" ? "anul." : r.status === "dupla" ? "dupla" : r.status === "faltando" ? "sem folha" : ""}</span>
            </div>`;
          }).join("")}</div>
        </div>
      </div>`}
      <p class="hint" id="rErro" style="color:var(--red);min-height:18px;margin:8px 0 0"></p>
      <div class="modal-actions" style="flex-wrap:wrap">
        <button class="btn" id="rCancelar">${coletaIncompleta() ? "Fechar (guardar)" : "Cancelar"}</button>
        <button class="btn" id="rOutra">📷 Tirar outra foto</button>
        ${g ? `<button class="btn btn-primary" id="rSalvar">Salvar e lançar nota</button>` : ""}
      </div>`;

    if (g && CORR_ATUAL.leitura && pgs.length) {
      const fila = (g.filas || ["A"]).includes(CORR_ATUAL.fila) ? CORR_ATUAL.fila : "A";
      pgs.forEach(async (pg, i) => {
        const base = pg.canvas || (pg.foto ? await carregarImagemDataURL(pg.foto) : null);
        const cv = document.getElementById("rCanvas" + i);
        if (base && cv) desenharSobreposicao(cv, base, g, CORR_ATUAL.respostas, fila, res.detalhe, listaDaPagina(g, pg));
      });
    }
    document.getElementById("rGab").addEventListener("change", (e) => {
      CORR_ATUAL.gabId = e.target.value;
      const ng = GABARITOS[CORR_ATUAL.gabId];
      if (ng) { CORR_ATUAL.turma = ng.turma; lerComGabarito(); }
      desenhar();
    });
    document.getElementById("rAluno").addEventListener("change", (e) => { CORR_ATUAL.num = e.target.value ? Number(e.target.value) : null; desenhar(); });
    const rf = document.getElementById("rFila");
    if (rf) rf.addEventListener("change", (e) => { CORR_ATUAL.fila = e.target.value; desenhar(); });
    box.querySelectorAll("[data-rq]").forEach((s) => s.addEventListener("change", () => {
      CORR_ATUAL.respostas[Number(s.dataset.rq)] = Number(s.value);
      CORR_ATUAL.editadaManual = true;
      desenhar();
    }));
    document.getElementById("rCancelar").addEventListener("click", () => {
      // prova completa (ex.: cartão da 1ª folha) não fica "esperando folha" depois de cancelar
      if (CORR_ATUAL.chaveColeta && !coletaIncompleta()) { const col = lerColeta(); delete col[CORR_ATUAL.chaveColeta]; gravarColeta(); renderAll(); }
      ov.remove();
    });
    document.getElementById("rOutra").addEventListener("click", () => { ov.remove(); abrirCamera(); });
    const bs = document.getElementById("rSalvar");
    if (bs) bs.addEventListener("click", () => salvarCorrecao(ov));
  }
  desenhar();
}

// Lançar respostas à mão (provas antigas, sem cartão-resposta): mesma conferência, sem foto
async function digitarRespostas(gabId) {
  await carregarGabaritos();
  const g = GABARITOS[gabId] || gabaritosDaTurma(TURMA_ATUAL)[0];
  CORR_ATUAL = { paginas: [], qr: null, leitura: null, respostas: [],
    gabId: g ? g.id : null, turma: g ? g.turma : TURMA_ATUAL, num: null, fila: "A" };
  if (g) lerComGabarito();
  abrirRevisao("");
}

/* ======================= SALVAR ======================= */
function lerPendentes() { try { return JSON.parse(localStorage.getItem(CORR_PEND_KEY) || "[]"); } catch (e) { return []; } }
function gravarPendentes(l) { localStorage.setItem(CORR_PEND_KEY, JSON.stringify(l)); }

// Lança a nota no diário (busca a versão mais nova no Firebase antes, como a importação)
async function lancarNotaNoDiario(turmaId, num, nomeAluno, bim, av, nota) {
  if (FB_CFG_ATIVA) {
    try { const remoto = await firestoreGet(FB_CFG_ATIVA); if (remoto && remoto.turmas) STATE = remoto; } catch (e) {}
  }
  const turma = STATE.turmas[turmaId];
  if (!turma) return null;
  const aluno = turma.alunos.find((a) => a.num === num) || turma.alunos.find((a) => normalizarTexto(a.nome) === normalizarTexto(nomeAluno));
  if (!aluno) return null;
  const anterior = valorAtualNota(aluno, bim, av);
  if (av === "recuperacao") { aluno.recuperacao = aluno.recuperacao || { b2: null, b4: null }; aluno.recuperacao[bim] = nota; }
  else aluno.notas[bim][av] = nota;
  agendarSalvamento();
  return { anterior };
}

async function salvarCorrecao(ov) {
  const g = GABARITOS[CORR_ATUAL.gabId];
  const erroEl = document.getElementById("rErro");
  const turma = STATE.turmas[CORR_ATUAL.turma];
  const aluno = turma && turma.alunos.find((a) => a.num === CORR_ATUAL.num);
  if (!aluno) { erroEl.textContent = "Escolha o aluno."; return; }
  const res = resultadoAtual();
  const bim = "b" + g.bimestre;
  const btn = document.getElementById("rSalvar"); btn.disabled = true; btn.textContent = "Salvando...";

  const lanc = await lancarNotaNoDiario(g.turma, aluno.num, aluno.nome, bim, g.avaliacao, res.nota);
  const fotosAtuais = (CORR_ATUAL.paginas || []).map((pg) => (pg.canvas ? pg.canvas.toDataURL("image/jpeg", 0.6) : pg.foto)).filter(Boolean);
  const marcadas = CORR_ATUAL.respostas.map((r, i) => (r >= 0 ? CorrecaoCore.LETRAS[r] : CORR_ATUAL.leitura[i].status === "dupla" ? "*" : "-")).join("");
  const id = `cor_${g.id}_${g.turma}_${aluno.num}`;
  const doc = {
    tipo: "correcao", gabaritoId: g.id, titulo: g.titulo, turma: g.turma, bimestre: g.bimestre, avaliacao: g.avaliacao,
    num: aluno.num, nome: aluno.nome, fila: CORR_ATUAL.fila, marcadas, gabaritoUsado: g.respostas[CORR_ATUAL.fila] || g.respostas.A,
    acertos: res.acertos, erros: res.erros, brancos: res.brancos, nota: res.nota, valorTotal: g.total,
    notaAnterior: lanc ? lanc.anterior : null, lancadaNoDiario: !!lanc, ajusteManual: !!CORR_ATUAL.editadaManual,
    corrigidoEm: new Date().toISOString(),
    foto: fotosAtuais[0] || null,
    fotos: fotosAtuais,
    paginas: (CORR_ATUAL.paginas || []).map((pg) => ({ folha: pg.folha, geom: pg.geom, ehTopo: !!pg.ehTopo, qIni: pg.qIni, qFim: pg.qFim })),
    origemLeitura: fotosAtuais.length ? "foto" : "digitada"
  };
  let enviado = true;
  try { await fsSalvarDoc(id, doc); }
  catch (e) {
    enviado = false;
    const pend = lerPendentes().filter((p) => p.id !== id);
    pend.push({ id, doc });
    try { gravarPendentes(pend); } catch (e2) { alert("Sem espaço para guardar a foto no aparelho. A nota foi lançada, mas a foto não foi salva."); }
    console.warn(msgErroFirebaseCorrecao(e));
  }
  if (CORR_ATUAL.chaveColeta) {
    const col = lerColeta();
    delete col[CORR_ATUAL.chaveColeta];
    Object.keys(PREPS).forEach((p) => { if (p.startsWith(CORR_ATUAL.chaveColeta + "|")) delete PREPS[p]; });
    gravarColeta();
  }
  ov.remove();
  renderAll();
  const msg = `${aluno.num}. ${aluno.nome}\n${res.acertos} acertos · ${res.erros} erros · ${res.brancos} em branco\nNota ${fmtNota(res.nota)} lançada em ${rotuloAvCurto(g.avaliacao)} (${g.bimestre}º bim.).` +
    (enviado ? "" : "\n\n⚠️ A foto ficou guardada no aparelho e será enviada ao Firebase depois (aba Correção → Enviar agora).") +
    "\n\nCorrigir o próximo cartão?";
  if (!doc.foto) {
    if (confirm(msg.replace("Corrigir o próximo cartão?", "Digitar a prova do próximo aluno?"))) digitarRespostas(g.id);
  } else if (confirm(msg)) abrirCamera();
}

async function reenviarPendentes() {
  const pend = lerPendentes();
  const sobra = [];
  let ultimoErro = null;
  mostrarCarregando("Enviando...");
  for (const p of pend) {
    try { await fsSalvarDoc(p.id, p.doc); } catch (e) { sobra.push(p); ultimoErro = e; }
  }
  gravarPendentes(sobra);
  mostrarCarregando(null);
  if (ultimoErro) alert(msgErroFirebaseCorrecao(ultimoErro));
  renderAll();
}

/* ======================= RESULTADOS ======================= */
async function abrirResultados(g) {
  const { ov, box } = criarModal("modalResultados", true);
  box.innerHTML = `<h3>Resultados — ${escapeHtml(g.titulo)}</h3><p class="hint">Carregando...</p>`;
  let cors = [];
  try {
    cors = await fsConsultar({ tipo: "correcao", gabaritoId: g.id }, ["num", "nome", "fila", "acertos", "erros", "brancos", "nota", "corrigidoEm", "ajusteManual", "origemLeitura"]);
  } catch (e) { box.innerHTML += `<p class="hint" style="color:var(--red)">${escapeHtml(msgErroFirebaseCorrecao(e))}</p>`; }
  const pend = lerPendentes().filter((p) => p.doc.gabaritoId === g.id).map((p) => Object.assign({ _id: p.id, _pendente: true }, p.doc));
  pend.forEach((p) => { if (!cors.some((c) => c._id === p._id)) cors.push(p); });
  const t = STATE.turmas[g.turma];
  const porNum = {}; cors.forEach((c) => { porNum[c.num] = c; });
  const notas = cors.map((c) => Number(c.nota) || 0);
  const media = notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : 0;
  box.innerHTML = `
    <h3>Resultados — ${escapeHtml(g.titulo)}</h3>
    <div class="stat-strip">
      <div class="stat"><span class="stat-num">${cors.length}/${t.alunos.length}</span><span class="stat-label">Corrigidos</span></div>
      <div class="stat"><span class="stat-num">${fmtNota(media)}</span><span class="stat-label">Média (de ${fmtNota(g.total)})</span></div>
    </div>
    <div class="table-wrap" style="max-height:55vh"><table>
      <thead><tr><th class="fix-num">Nº</th><th class="fix-nome">Aluno(a)</th><th>Fila</th><th>Acertos</th><th>Erros</th><th>Branco</th><th>Nota</th><th>Foto</th></tr></thead>
      <tbody>${t.alunos.map((a) => {
        const c = porNum[a.num];
        return `<tr><td class="fix-num">${a.num}</td><td class="nome-col fix-nome">${escapeHtml(a.nome)}</td>
          ${c ? `<td>${c.fila || "A"}</td><td style="color:var(--green)">${c.acertos}</td><td style="color:var(--red)">${c.erros}</td><td>${c.brancos}</td><td><b>${fmtNota(c.nota)}</b>${c.ajusteManual ? " ✎" : ""}</td>
          <td>${c._pendente ? "⏳" : c.origemLeitura === "digitada" ? "✍️" : `<button class="icon-btn" data-foto="${c._id}">🖼</button>`}</td>`
          : `<td colspan="6" style="color:#948a7d">não corrigido</td>`}</tr>`;
      }).join("")}</tbody></table></div>
    <p class="hint" style="margin-top:8px">✎ = alguma questão foi ajustada à mão na conferência. Para corrigir de novo, é só fotografar o cartão outra vez (substitui o anterior).</p>
    <div class="modal-actions"><button class="btn" id="resFechar">Fechar</button><button class="btn btn-primary" id="resFoto">📷 Corrigir por foto</button></div>`;
  document.getElementById("resFechar").addEventListener("click", () => ov.remove());
  document.getElementById("resFoto").addEventListener("click", () => { ov.remove(); abrirCamera(); });
  box.querySelectorAll("[data-foto]").forEach((b) => b.addEventListener("click", () => verFoto(b.dataset.foto, g)));
}

async function verFoto(id, g) {
  mostrarCarregando("Abrindo foto...");
  let c = null;
  try { c = await fsLerDoc(id); } catch (e) { mostrarCarregando(null); alert(msgErroFirebaseCorrecao(e)); return; }
  mostrarCarregando(null);
  const fotos = (c && c.fotos && c.fotos.length) ? c.fotos : (c && c.foto ? [c.foto] : []);
  if (!fotos.length) { alert("Foto não encontrada."); return; }
  const paginas = (c.paginas && c.paginas.length) ? c.paginas : [{ folha: 1, geom: "cartao", qIni: 1, qFim: g.n }];
  const { ov, box } = criarModal("modalFoto", true);
  box.innerHTML = `<h3>${c.num}. ${escapeHtml(c.nome)}</h3>
    <p class="hint">${c.acertos} acertos · ${c.erros} erros · ${c.brancos} em branco · nota <b>${fmtNota(c.nota)}</b> · corrigido em ${new Date(c.corrigidoEm).toLocaleString("pt-BR")}</p>
    ${fotos.map((_, i) => `${fotos.length > 1 ? `<p class="hint" style="margin:8px 0 4px"><b>Folha ${(paginas[i] || {}).folha || i + 1}</b></p>` : ""}<canvas id="fCanvas${i}" style="width:100%;max-width:640px;border:1px solid var(--line);border-radius:8px"></canvas>`).join("")}
    <div class="modal-actions"><button class="btn" id="fFechar">Fechar</button></div>`;
  document.getElementById("fFechar").addEventListener("click", () => ov.remove());
  const resp = String(c.marcadas || "").split("").map((L) => CorrecaoCore.LETRAS.indexOf(L));
  const fila = c.fila || "A";
  const gg = Object.assign({}, g, { respostas: { [fila]: c.gabaritoUsado || g.respostas[fila] } });
  const det = CorrecaoCore.corrigir(resp, gg.respostas[fila], g.valores, g.bonusBranco).detalhe;
  fotos.forEach(async (url, i) => {
    const im = await carregarImagemDataURL(url);
    if (im) desenharSobreposicao(document.getElementById("fCanvas" + i), im, gg, resp, fila, det, listaDaPagina(g, paginas[i] || paginas[0]));
  });
}

// Recalcula as correções já feitas quando o gabarito muda (ex.: questão anulada)
async function recalcularCorrecoes(g) {
  mostrarCarregando("Recalculando notas...");
  let n = 0;
  try {
    if (FB_CFG_ATIVA) { try { const remoto = await firestoreGet(FB_CFG_ATIVA); if (remoto && remoto.turmas) STATE = remoto; } catch (e) {} }
    const cors = await fsConsultar({ tipo: "correcao", gabaritoId: g.id }, ["num", "nome", "fila", "marcadas", "turma"]);
    for (const c of cors) {
      const fila = (g.filas || ["A"]).includes(c.fila) ? c.fila : "A";
      const resp = String(c.marcadas || "").split("").map((L) => CorrecaoCore.LETRAS.indexOf(L));
      const r = CorrecaoCore.corrigir(resp, g.respostas[fila], g.valores, g.bonusBranco);
      await fsSalvarDoc(c._id, { acertos: r.acertos, erros: r.erros, brancos: r.brancos, nota: r.nota, valorTotal: g.total, gabaritoUsado: g.respostas[fila], titulo: g.titulo, bimestre: g.bimestre, avaliacao: g.avaliacao },
        ["acertos", "erros", "brancos", "nota", "valorTotal", "gabaritoUsado", "titulo", "bimestre", "avaliacao"]);
      const turma = STATE.turmas[g.turma];
      const aluno = turma && (turma.alunos.find((a) => a.num === c.num) || turma.alunos.find((a) => normalizarTexto(a.nome) === normalizarTexto(c.nome)));
      if (aluno) {
        const bim = "b" + g.bimestre;
        if (g.avaliacao === "recuperacao") { aluno.recuperacao = aluno.recuperacao || { b2: null, b4: null }; aluno.recuperacao[bim] = r.nota; }
        else aluno.notas[bim][g.avaliacao] = r.nota;
      }
      n++;
    }
    if (n) agendarSalvamento();
  } catch (e) { alert(msgErroFirebaseCorrecao(e)); }
  mostrarCarregando(null);
  if (n) alert(n + " nota(s) recalculada(s) e atualizada(s) no diário.");
}
