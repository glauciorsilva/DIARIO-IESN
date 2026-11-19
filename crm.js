/* =====================================================================
   CRM DO ALUNO — acompanhamento individual
   - Aba "CRM": um cartão por aluno com mini gráfico da evolução das médias
     (1º ao 4º bimestre), frequência, tendência e sinais de atenção.
   - Ficha do aluno: gráfico por bimestre (teste, trabalho, prova, ponto
     extra e recuperação) comparado com a média da turma, presença, provas
     corrigidas por foto, perfil do teste de personalidade (Big Five) e
     anotações datadas por categoria.
   - Importação do teste de personalidade pelo botão "📥 Importar notas"
     (aceita o JSON exportado pelo leitor do teste).
   Os dados ficam no mesmo estado do diário (Firebase, atrás do login):
     aluno.crm.anotacoes = [{ id, data, categoria, texto, criadoEm }]
     aluno.personalidade = { data, resultado: { extroversao: {total, faixa}, ... } }
   Nenhum dado de aluno fica neste arquivo (o repositório é público).
   Depende de: index.html (STATE, turmaAtual, agendarSalvamento, ...) e,
   para as provas corrigidas, correcao.js (fsConsultar).
   ===================================================================== */

const CRM_BIMS = ["b1", "b2", "b3", "b4"];
const CRM_CATEGORIAS = ["Pedagógico", "Comportamento", "Família", "Elogio", "Ocorrência", "Outro"];
const CRM_COR_CAT = {
  "Pedagógico": "#4A6FA5", "Comportamento": "#9A5B00", "Família": "#6b4fa0",
  "Elogio": "#2e7d32", "Ocorrência": "#7a141e", "Outro": "#6b6157"
};
const CRM_TRACOS = [
  ["extroversao", "Extroversão"], ["abertura", "Abertura"], ["responsabilidade", "Responsabilidade"],
  ["amabilidade", "Amabilidade"], ["equilibrio_emocional", "Equilíbrio emocional"]
];
const CRM_DESC = {
  extroversao: ["Gosta de estar com pessoas, fala com facilidade e se anima em grupo.",
                "Equilibra momentos em grupo e sozinho, conforme a situação.",
                "Mais reservado(a); prefere atividades individuais ou grupos pequenos."],
  abertura: ["Curioso(a) e criativo(a); gosta de ideias novas e de entender como as coisas funcionam.",
             "Aceita novidades, mas também valoriza o que já conhece.",
             "Prático(a); prefere rotina e caminhos conhecidos."],
  responsabilidade: ["Organizado(a), atento(a) aos detalhes e cumpre prazos.",
                     "Organiza-se na maior parte do tempo; às vezes precisa de lembretes.",
                     "Precisa de apoio para se organizar, planejar e terminar as tarefas."],
  amabilidade: ["Cooperativo(a), gentil e confia nas pessoas.",
                "Coopera, mas também defende bem o seu ponto de vista.",
                "Mais competitivo(a) e direto(a) nas opiniões."],
  equilibrio_emocional: ["Mantém a calma sob pressão e se recupera rápido quando algo dá errado.",
                         "Em geral tranquilo(a), com alguma oscilação em momentos de pressão.",
                         "Irrita-se ou se preocupa com facilidade; pode precisar de acolhimento."]
};

let CRM_SEL = null;                       // nº do aluno aberto na ficha (null = lista)
let CRM_FILTRO = { busca: "", so: "todos", ordem: "num" };
let CRM_CORRECOES = {};                   // "TURMA-num" -> lista de correções (cache da sessão)
let PERS_PREVIA = null;                   // prévia da importação do teste de personalidade

/* ---------------- estilos ---------------- */
(function crmEstilos() {
  const css = `
  .crm-toolbar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:14px; }
  .crm-toolbar input, .crm-toolbar select { padding:8px 10px; border:1px solid var(--line); border-radius:8px; font-size:14px; background:white; }
  .crm-toolbar input { flex:1; min-width:180px; }
  .crm-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(270px, 1fr)); gap:12px; }
  .crm-card { background:white; border:1px solid var(--line); border-radius:12px; padding:12px 14px; cursor:pointer; text-align:left;
              font:inherit; color:inherit; display:flex; flex-direction:column; gap:6px; transition:box-shadow .15s, border-color .15s; }
  .crm-card:hover, .crm-card:focus-visible { border-color:var(--gold); box-shadow:0 3px 10px rgba(43,36,32,.08); outline:none; }
  .crm-card.atencao { border-left:4px solid var(--red); }
  .crm-card-top { display:flex; gap:8px; align-items:flex-start; }
  .crm-num { font-family:"IBM Plex Mono",monospace; font-size:12px; color:#8a7f74; min-width:22px; padding-top:2px; }
  .crm-nome { font-weight:600; font-size:13.5px; line-height:1.25; flex:1; }
  .crm-card-mid { display:flex; align-items:center; gap:10px; }
  .crm-media { font-family:"IBM Plex Mono",monospace; font-size:20px; font-weight:600; line-height:1; }
  .crm-media small { display:block; font-family:Inter,sans-serif; font-size:10.5px; font-weight:500; color:#8a7f74; margin-top:3px; }
  .crm-spark { flex:1; min-width:0; }
  .crm-tags { display:flex; flex-wrap:wrap; gap:4px; }
  .crm-tag { font-size:11px; padding:2px 7px; border-radius:10px; background:#f3ede0; color:#6b6157; white-space:nowrap; }
  .crm-tag.ruim { background:#fde4e2; color:var(--red); }
  .crm-tag.bom { background:#e3f2e3; color:var(--green); }
  .crm-tag.pers { background:#EEF2F8; color:#4A6FA5; }
  .crm-voltar { margin-bottom:12px; }
  .crm-ficha-top { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start; }
  .crm-ficha-top h3 { margin:0; }
  .crm-sub { font-size:13px; color:#6b6157; margin-top:2px; }
  .crm-legenda { display:flex; flex-wrap:wrap; gap:12px; font-size:12px; color:#6b6157; margin-top:6px; }
  .crm-legenda i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:4px; vertical-align:-1px; }
  .crm-tab-mini { width:100%; font-size:12.5px; margin-top:10px; }
  .crm-tab-mini th, .crm-tab-mini td { padding:5px 6px; }
  .crm-traco { display:grid; grid-template-columns:150px 1fr 84px; gap:4px 10px; align-items:center; margin-bottom:12px; }
  .crm-traco .nm { font-weight:600; font-size:13px; }
  .crm-traco .vl { font-family:"IBM Plex Mono",monospace; font-size:12px; text-align:right; }
  .crm-traco .ds { grid-column:1 / -1; font-size:12.5px; color:#4d443d; }
  .crm-escala { position:relative; height:12px; border-radius:6px; overflow:hidden;
                background:linear-gradient(90deg,#FFF1D6 0 35.4%,#DCE4F1 35.4% 64.6%,#E3F3E9 64.6% 100%); }
  .crm-escala b { position:absolute; top:1px; width:10px; height:10px; border-radius:50%; margin-left:-5px; background:#4A6FA5; }
  .crm-faixa { font-size:11px; font-weight:700; padding:2px 7px; border-radius:10px; }
  .crm-faixa.ALTO { background:#E3F3E9; color:#1E7A44; }
  .crm-faixa.BAIXO { background:#FFF1D6; color:#9A5B00; }
  .crm-faixa.MEDIO, .crm-faixa.MÉDIO { background:#DCE4F1; color:#2b2420; }
  .crm-form { display:grid; grid-template-columns:150px 160px 1fr; gap:8px; margin-bottom:10px; }
  .crm-form textarea { grid-column:1 / -1; min-height:70px; padding:8px; border:1px solid var(--line); border-radius:8px; font:inherit; font-size:14px; }
  .crm-form input, .crm-form select { padding:8px; border:1px solid var(--line); border-radius:8px; font-size:14px; background:white; }
  .crm-form .acoes { grid-column:1 / -1; display:flex; gap:8px; justify-content:flex-end; }
  .crm-linha { display:flex; gap:10px; padding:10px 0; border-bottom:1px dashed var(--line); }
  .crm-linha:last-child { border-bottom:none; }
  .crm-linha .dt { font-family:"IBM Plex Mono",monospace; font-size:12px; color:#8a7f74; min-width:76px; padding-top:2px; }
  .crm-linha .ct { font-size:11px; font-weight:700; padding:2px 7px; border-radius:10px; color:white; white-space:nowrap; align-self:flex-start; }
  .crm-linha .tx { flex:1; font-size:13.5px; white-space:pre-wrap; word-break:break-word; }
  .crm-linha.auto .tx { color:#6b6157; font-style:italic; }
  .crm-filtro-cat { display:flex; gap:4px; flex-wrap:wrap; margin-bottom:6px; }
  .crm-filtro-cat button { border:1px solid var(--line); background:white; border-radius:14px; padding:3px 10px; font-size:12px; cursor:pointer; }
  .crm-filtro-cat button[aria-pressed="true"] { background:var(--ink); color:white; border-color:var(--ink); }
  .crm-2col { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
  @media (max-width: 820px) {
    .crm-2col { grid-template-columns:1fr; gap:0; }
    .crm-form { grid-template-columns:1fr 1fr; }
    .crm-traco { grid-template-columns:120px 1fr 74px; }
    .crm-stats { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .crm-stats .stat { min-width:0; padding:10px 8px; }
    .crm-stats .stat-num { font-size:20px; }
  }
  @media print {
    .app-header, .tabs, .appfoot, .crm-noprint { display:none !important; }
    main { padding:0; }
    .card { break-inside:avoid; border-color:#bbb; }
  }`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
})();

/* ---------------- cálculos ---------------- */
function crmTemDados(a, bim) {
  const n = (a.notas && a.notas[bim]) || {};
  const soma = (Number(n.teste) || 0) + (Number(n.trabalho) || 0) + (Number(n.prova) || 0);
  const ext = (a.pontosExtra && a.pontosExtra[bim]) || [];
  const rec = a.recuperacao && a.recuperacao[bim];
  return soma > 0 || ext.length > 0 || (rec !== null && rec !== undefined && rec !== "");
}
// Bimestre "lançado" = algum aluno da turma tem nota nele (assim um 0 real aparece no gráfico)
function crmBimsLancados(t) {
  return CRM_BIMS.filter((b) => t.alunos.some((a) => crmTemDados(a, b)));
}
function crmSerie(t, a) {
  const lanc = crmBimsLancados(t);
  return CRM_BIMS.map((b) => (lanc.includes(b) ? mediaBimestreFinal(a, b) : null));
}
function crmMediaTurma(t) {
  const lanc = crmBimsLancados(t);
  return CRM_BIMS.map((b) => {
    if (!lanc.includes(b) || !t.alunos.length) return null;
    return t.alunos.reduce((s, a) => s + mediaBimestreFinal(a, b), 0) / t.alunos.length;
  });
}
function crmFrequencia(a) {
  const v = Object.values(a.presencas || {});
  if (!v.length) return null;
  const faltas = v.filter((x) => x === "F").length;
  return { aulas: v.length, faltas, pct: (v.length - faltas) / v.length * 100 };
}
function crmResumo(t, a) {
  const serie = crmSerie(t, a);
  const vals = serie.map((v, i) => [i, v]).filter(([, v]) => v !== null);
  const ult = vals.length ? vals[vals.length - 1] : null;
  const pen = vals.length > 1 ? vals[vals.length - 2] : null;
  const delta = ult && pen ? ult[1] - pen[1] : null;
  const parcial = vals.length ? vals.reduce((s, [, v]) => s + v, 0) / vals.length : null;
  const freq = crmFrequencia(a);
  const alertas = [];
  if (ult && ult[1] < 7) alertas.push(`Média abaixo de 7 no ${ult[0] + 1}º bim.`);
  if (delta !== null && delta <= -1) alertas.push(`Caiu ${fmtCrm(-delta)} pontos`);
  if (freq && freq.aulas >= 4 && freq.pct < 75) alertas.push(`Frequência ${Math.round(freq.pct)}%`);
  const anot = ((a.crm && a.crm.anotacoes) || []).length;
  return { serie, ult, delta, parcial, freq, alertas, anot };
}
function fmtCrm(v) { return v === null || v === undefined ? "—" : (Math.round(v * 10) / 10).toFixed(1).replace(".", ","); }
function crmFaixa(v) { return v <= 14 ? "BAIXO" : v <= 21 ? "MÉDIO" : "ALTO"; }
function crmDataBR(iso) { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}/${y}`; }
function crmHojeISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

/* ---------------- mini gráfico (cartão) ---------------- */
function crmSparkline(serie, turma) {
  const W = 150, H = 44, px = 8, py = 6;
  const X = (i) => px + i * (W - 2 * px) / 3;
  const Y = (v) => py + (1 - v / 10) * (H - 2 * py);
  const caminho = (s) => {
    let d = "", aberto = false;
    s.forEach((v, i) => {
      if (v === null) { aberto = false; return; }
      d += (aberto ? " L" : " M") + X(i).toFixed(1) + " " + Y(v).toFixed(1);
      aberto = true;
    });
    return d.trim();
  };
  const tem = serie.some((v) => v !== null);
  const rot = serie.map((v, i) => [i, v]).filter(([, v]) => v !== null)
    .map(([i, v]) => `${i + 1}º bim.: ${fmtCrm(v)}`).join(", ");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${tem ? "Evolução das médias — " + rot : "Sem notas lançadas"}" preserveAspectRatio="none">
    <line x1="${px}" x2="${W - px}" y1="${Y(7)}" y2="${Y(7)}" stroke="#ddd2bd" stroke-dasharray="3 3" stroke-width="1"/>
    ${CRM_BIMS.map((_, i) => `<line x1="${X(i)}" x2="${X(i)}" y1="${H - 3}" y2="${H}" stroke="#ddd2bd"/>`).join("")}
    ${tem ? `<path d="${caminho(turma)}" fill="none" stroke="#b8ad9c" stroke-width="1.2" stroke-dasharray="2 2"/>
    <path d="${caminho(serie)}" fill="none" stroke="#2b2420" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    ${serie.map((v, i) => v === null ? "" : `<circle cx="${X(i)}" cy="${Y(v)}" r="3.2" fill="${v >= 7 ? "#2e7d32" : "#7a141e"}" stroke="white" stroke-width="1"/>`).join("")}`
    : `<text x="${W / 2}" y="${H / 2 + 4}" text-anchor="middle" font-size="10" fill="#948a7d">sem notas</text>`}
  </svg>`;
}

/* ---------------- gráfico da ficha ---------------- */
function crmGraficoFicha(t, a) {
  const lanc = crmBimsLancados(t);
  const mt = crmMediaTurma(t);
  const estreito = window.innerWidth < 600;
  const W = estreito ? 360 : 560, H = estreito ? 210 : 230, ml = 26, mr = 8, mt0 = 18, mb = 30;
  const gw = (W - ml - mr) / 4, bw = Math.min(54, gw * 0.46);
  const Y = (v) => mt0 + (1 - v / 10) * (H - mt0 - mb);
  const cores = { teste: "#c9a227", trabalho: "#4A6FA5", prova: "#7a141e", extra: "#2e7d32" };
  let barras = "", turmaPts = [];
  CRM_BIMS.forEach((b, i) => {
    const cx = ml + gw * i + gw / 2;
    barras += `<text x="${cx}" y="${H - 10}" text-anchor="middle" font-size="11.5" fill="#6b6157">${i + 1}º bim.</text>`;
    if (!lanc.includes(b)) {
      barras += `<text x="${cx}" y="${Y(1.2)}" text-anchor="middle" font-size="10.5" fill="#b8ad9c">sem notas</text>`;
      return;
    }
    const n = a.notas[b] || {};
    const partes = [["teste", Number(n.teste) || 0], ["trabalho", Number(n.trabalho) || 0], ["prova", Number(n.prova) || 0],
                    ["extra", Math.max(0, somaPontosExtra(a, b))]];
    let acc = 0;
    partes.forEach(([k, v]) => {
      if (v <= 0) return;
      const ini = Math.min(acc, 10), fim = Math.min(acc + v, 10);
      acc += v;
      if (fim <= ini) return;
      barras += `<rect x="${cx - bw / 2}" y="${Y(fim)}" width="${bw}" height="${Y(ini) - Y(fim)}" fill="${cores[k]}" stroke="white" stroke-width="1"><title>${rotuloParteCrm(k)}: ${fmtCrm(v)}</title></rect>`;
    });
    const bruta = mediaBimestreBruta(a, b), fin = mediaBimestreFinal(a, b);
    if (fin > bruta + 0.001) {
      barras += `<rect x="${cx - bw / 2}" y="${Y(fin)}" width="${bw}" height="${Y(bruta) - Y(fin)}" fill="none" stroke="#2b2420" stroke-width="1.4" stroke-dasharray="3 2"><title>Recuperação: ${fmtCrm(fin)}</title></rect>`;
    }
    barras += `<text x="${cx}" y="${Y(fin) - 5}" text-anchor="middle" font-size="12" font-weight="700" fill="${fin >= 7 ? "#2e7d32" : "#7a141e"}" font-family="IBM Plex Mono, monospace">${fmtCrm(fin)}</text>`;
    if (mt[i] !== null) turmaPts.push([cx + bw / 2 + 9, Y(mt[i]), mt[i]]);
  });
  const linhaTurma = turmaPts.length
    ? `<polyline points="${turmaPts.map((p) => p[0] + "," + p[1]).join(" ")}" fill="none" stroke="#948a7d" stroke-width="1.3" stroke-dasharray="4 3"/>
       ${turmaPts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="white" stroke="#948a7d" stroke-width="1.5"><title>Média da turma: ${fmtCrm(p[2])}</title></circle>`).join("")}`
    : "";
  const grade = [0, 2, 4, 6, 8, 10].map((v) => `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v === 0 ? "#cfc4ae" : "#efe6d3"}"/>
    <text x="${ml - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="10" fill="#948a7d">${v}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:680px;display:block;" role="img" aria-label="Notas por bimestre comparadas com a média da turma">
    ${grade}
    <line x1="${ml}" x2="${W - mr}" y1="${Y(7)}" y2="${Y(7)}" stroke="#7a141e" stroke-opacity=".45" stroke-dasharray="5 4"/>
    <text x="${W - mr}" y="${Y(7) - 4}" text-anchor="end" font-size="10" fill="#7a141e" fill-opacity=".75">7,0</text>
    ${barras}${linhaTurma}
  </svg>
  <div class="crm-legenda">
    <span><i style="background:#c9a227"></i>Teste</span><span><i style="background:#4A6FA5"></i>Trabalho</span>
    <span><i style="background:#7a141e"></i>Prova</span><span><i style="background:#2e7d32"></i>Ponto extra</span>
    <span><i style="border:1.4px dashed #2b2420;background:none"></i>Recuperação</span>
    <span><i style="border:1.5px solid #948a7d;background:white;border-radius:50%"></i>Média da turma</span>
  </div>`;
}
function rotuloParteCrm(k) { return { teste: "Teste", trabalho: "Trabalho", prova: "Prova", extra: "Ponto extra" }[k] || k; }

/* ---------------- aba CRM: lista ---------------- */
function renderCRM() {
  const t = turmaAtual();
  if (CRM_SEL !== null && !t.alunos.some((a) => a.num === CRM_SEL)) CRM_SEL = null;
  if (CRM_SEL !== null) { renderFichaCRM(t, t.alunos.find((a) => a.num === CRM_SEL)); return; }
  const main = document.getElementById("mainContent");
  const mt = crmMediaTurma(t);
  const lanc = crmBimsLancados(t);
  let lista = t.alunos.map((a) => ({ a, r: crmResumo(t, a) }));
  const comPers = lista.filter((x) => x.a.personalidade).length;
  const nAtencao = lista.filter((x) => x.r.alertas.length).length;
  const busca = normalizarTexto(CRM_FILTRO.busca);
  if (busca) lista = lista.filter((x) => normalizarTexto(x.a.nome).includes(busca) || String(x.a.num) === busca);
  if (CRM_FILTRO.so === "atencao") lista = lista.filter((x) => x.r.alertas.length);
  if (CRM_FILTRO.so === "anotacoes") lista = lista.filter((x) => x.r.anot);
  const chave = { num: (x) => x.a.num, media: (x) => -(x.r.parcial ?? -1), menor: (x) => x.r.parcial ?? 99, tendencia: (x) => x.r.delta ?? 99 }[CRM_FILTRO.ordem] || ((x) => x.a.num);
  lista.sort((p, q) => chave(p) - chave(q) || p.a.num - q.a.num);
  const mtParc = mt.filter((v) => v !== null);
  main.innerHTML = `
    <div class="card">
      <h3>CRM do aluno — ${escapeHtml(t.nome)}</h3>
      <p class="hint">Toque no aluno para abrir a ficha com a evolução das notas, presença, perfil do teste de personalidade e anotações. No mini gráfico, a linha escura é o aluno, a tracejada é a média da turma e a faixa pontilhada marca o 7,0.</p>
      <div class="stat-strip crm-stats">
        <div class="stat"><span class="stat-num">${t.alunos.length}</span><span class="stat-label">Alunos</span></div>
        <div class="stat"><span class="stat-num">${mtParc.length ? fmtCrm(mtParc.reduce((s, v) => s + v, 0) / mtParc.length) : "—"}</span><span class="stat-label">Média da turma (${lanc.length} bim.)</span></div>
        <div class="stat"><span class="stat-num" style="color:${nAtencao ? "var(--red)" : "inherit"}">${nAtencao}</span><span class="stat-label">Pedem atenção</span></div>
        <div class="stat"><span class="stat-num">${comPers}/${t.alunos.length}</span><span class="stat-label">Com teste de personalidade</span></div>
      </div>
      <div class="crm-toolbar">
        <input type="search" id="crmBusca" placeholder="Buscar aluno pelo nome ou nº" value="${escapeHtml(CRM_FILTRO.busca)}">
        <select id="crmSo" aria-label="Filtrar">
          <option value="todos">Todos os alunos</option>
          <option value="atencao">Só quem pede atenção</option>
          <option value="anotacoes">Só com anotações</option>
        </select>
        <select id="crmOrdem" aria-label="Ordenar">
          <option value="num">Ordem da chamada</option>
          <option value="media">Maior média</option>
          <option value="menor">Menor média</option>
          <option value="tendencia">Maior queda</option>
        </select>
      </div>
      ${lista.length ? `<div class="crm-grid">${lista.map(({ a, r }) => htmlCartaoCRM(a, r, mt)).join("")}</div>`
        : `<p class="hint">Nenhum aluno com esse filtro.</p>`}
    </div>`;
  document.getElementById("crmSo").value = CRM_FILTRO.so;
  document.getElementById("crmOrdem").value = CRM_FILTRO.ordem;
  const inp = document.getElementById("crmBusca");
  inp.addEventListener("input", () => {
    CRM_FILTRO.busca = inp.value;
    const pos = inp.selectionStart;
    renderCRM();
    const novo = document.getElementById("crmBusca");
    novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (e) {}
  });
  document.getElementById("crmSo").addEventListener("change", (e) => { CRM_FILTRO.so = e.target.value; renderCRM(); });
  document.getElementById("crmOrdem").addEventListener("change", (e) => { CRM_FILTRO.ordem = e.target.value; renderCRM(); });
  main.querySelectorAll("[data-crm-aluno]").forEach((b) => b.addEventListener("click", () => {
    CRM_SEL = Number(b.dataset.crmAluno);
    renderCRM();
    window.scrollTo({ top: 0 });
  }));
}

function htmlCartaoCRM(a, r, mt) {
  const tags = [];
  r.alertas.forEach((x) => tags.push(`<span class="crm-tag ruim">${escapeHtml(x)}</span>`));
  if (r.delta !== null && r.delta >= 1) tags.push(`<span class="crm-tag bom">Subiu ${fmtCrm(r.delta)}</span>`);
  if (r.freq && !r.alertas.some((x) => x.startsWith("Frequência"))) tags.push(`<span class="crm-tag">${Math.round(r.freq.pct)}% presença</span>`);
  if (a.personalidade && a.personalidade.resultado) {
    const res = a.personalidade.resultado;
    const altos = CRM_TRACOS.filter(([k]) => res[k] && res[k].total >= 22).map(([, n]) => n.split(" ")[0]);
    tags.push(`<span class="crm-tag pers" title="Teste de personalidade">🧩 ${altos.length ? escapeHtml(altos.join(", ")) : "perfil equilibrado"}</span>`);
  }
  if (r.anot) tags.push(`<span class="crm-tag">📝 ${r.anot}</span>`);
  const seta = r.delta === null ? "" : r.delta >= 0.3 ? " ↑" : r.delta <= -0.3 ? " ↓" : " →";
  return `<button type="button" class="crm-card${r.alertas.length ? " atencao" : ""}" data-crm-aluno="${a.num}">
    <div class="crm-card-top"><span class="crm-num">${String(a.num).padStart(2, "0")}</span><span class="crm-nome">${escapeHtml(a.nome)}</span></div>
    <div class="crm-card-mid">
      <div class="crm-media" style="color:${r.ult ? (r.ult[1] >= 7 ? "var(--green)" : "var(--red)") : "#948a7d"}">${r.ult ? fmtCrm(r.ult[1]) : "—"}${seta}
        <small>${r.ult ? r.ult[0] + 1 + "º bimestre" : "sem notas"}</small></div>
      <div class="crm-spark">${crmSparkline(r.serie, mt)}</div>
    </div>
    ${tags.length ? `<div class="crm-tags">${tags.join("")}</div>` : ""}
  </button>`;
}

/* ---------------- ficha do aluno ---------------- */
function renderFichaCRM(t, a) {
  const main = document.getElementById("mainContent");
  const r = crmResumo(t, a);
  const mt = crmMediaTurma(t);
  const lanc = crmBimsLancados(t);
  a.crm = a.crm || { anotacoes: [] };
  a.crm.anotacoes = a.crm.anotacoes || [];
  const idx = t.alunos.indexOf(a);
  const ant = t.alunos[idx - 1], prox = t.alunos[idx + 1];
  const faltas = Object.entries(a.presencas || {}).filter(([, v]) => v === "F").map(([d]) => d).sort();
  const extras = CRM_BIMS.flatMap((b) => ((a.pontosExtra && a.pontosExtra[b]) || []).map((p) => ({ b, p })));

  main.innerHTML = `
    <div class="crm-noprint crm-voltar" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between;">
      <button class="btn" id="crmVoltar">← Todos os alunos</button>
      <span style="display:flex;gap:6px;">
        <button class="btn" id="crmAnt" ${ant ? "" : "disabled"} title="Aluno anterior">‹ Anterior</button>
        <button class="btn" id="crmProx" ${prox ? "" : "disabled"} title="Próximo aluno">Próximo ›</button>
        <button class="btn" id="crmImprimir" title="Imprimir ou salvar a ficha em PDF">🖨 Ficha</button>
      </span>
    </div>
    <div class="card">
      <div class="crm-ficha-top">
        <div>
          <h3>${String(a.num).padStart(2, "0")}. ${escapeHtml(a.nome)}</h3>
          <div class="crm-sub">${escapeHtml(t.nome)} · ${escapeHtml(t.disciplina || "")}</div>
        </div>
        <div>${badgeStatus(a)}</div>
      </div>
      <div class="stat-strip crm-stats" style="margin-top:14px;">
        <div class="stat"><span class="stat-num">${fmtCrm(r.parcial)}</span><span class="stat-label">Média dos bim. lançados</span></div>
        <div class="stat"><span class="stat-num">${fmtCrm(mediaFinalAno(a))}</span><span class="stat-label">Média final (÷ 4)</span></div>
        <div class="stat"><span class="stat-num" style="color:${r.delta === null ? "inherit" : r.delta < 0 ? "var(--red)" : "var(--green)"}">${r.delta === null ? "—" : (r.delta > 0 ? "+" : "") + fmtCrm(r.delta)}</span><span class="stat-label">Último bim. × anterior</span></div>
        <div class="stat"><span class="stat-num">${r.freq ? Math.round(r.freq.pct) + "%" : "—"}</span><span class="stat-label">${r.freq ? `Presença (${r.freq.faltas} falta${r.freq.faltas === 1 ? "" : "s"})` : "Presença"}</span></div>
      </div>
      ${r.alertas.length ? `<div class="crm-tags" style="margin-bottom:6px;">${r.alertas.map((x) => `<span class="crm-tag ruim">⚠ ${escapeHtml(x)}</span>`).join("")}</div>` : ""}
    </div>

    <div class="card">
      <h3>Evolução das notas</h3>
      ${crmGraficoFicha(t, a)}
      <div class="table-wrap"><table class="crm-tab-mini">
        <thead><tr><th style="text-align:left">Bimestre</th><th>Teste</th><th>Trabalho</th><th>Prova</th><th>Extra</th><th>Recup.</th><th>Média</th><th>Turma</th></tr></thead>
        <tbody>${CRM_BIMS.map((b, i) => {
          if (!lanc.includes(b)) return `<tr><td style="text-align:left">${rotuloBimestre(b)}</td><td colspan="7" style="color:#948a7d">sem notas lançadas</td></tr>`;
          const n = a.notas[b] || {};
          const rec = (b === "b2" || b === "b4") && a.recuperacao ? a.recuperacao[b] : null;
          const fin = mediaBimestreFinal(a, b);
          return `<tr><td style="text-align:left">${rotuloBimestre(b)}</td>
            <td>${fmtCrm(Number(n.teste) || 0)}</td><td>${fmtCrm(Number(n.trabalho) || 0)}</td><td>${fmtCrm(Number(n.prova) || 0)}</td>
            <td>${fmtCrm(somaPontosExtra(a, b))}</td><td>${rec === null || rec === undefined || rec === "" ? "—" : fmtCrm(Number(rec))}</td>
            <td><b style="color:${fin >= 7 ? "var(--green)" : "var(--red)"}">${fmtCrm(fin)}</b></td><td style="color:#8a7f74">${fmtCrm(mt[i])}</td></tr>`;
        }).join("")}</tbody></table></div>
    </div>

    <div class="crm-2col">
      <div class="card">
        <h3>Perfil do teste de personalidade</h3>
        ${htmlPersonalidadeCRM(a)}
      </div>
      <div class="card">
        <h3>Presença e pontos extras</h3>
        <p class="hint" style="margin-bottom:6px;">${r.freq ? `${r.freq.aulas} aula(s) registrada(s), ${r.freq.faltas} falta(s).` : "Nenhuma chamada registrada ainda."}</p>
        ${faltas.length ? `<div class="crm-tags" style="margin-bottom:12px;">${faltas.map((d) => `<span class="crm-tag ruim">Falta ${formatarDataCurta(d)}</span>`).join("")}</div>` : ""}
        ${extras.length ? `<table class="crm-tab-mini"><thead><tr><th>Bim.</th><th style="text-align:left">Descrição</th><th>Pontos</th></tr></thead><tbody>
          ${extras.map(({ b, p }) => `<tr><td>${b.slice(1)}º</td><td style="text-align:left;white-space:normal">${escapeHtml(p.desc || "—")}</td>
            <td style="color:${p.tipo === "sub" ? "var(--red)" : "var(--green)"}">${p.tipo === "sub" ? "−" : "+"}${fmtCrm(Math.abs(Number(p.valor) || 0))}</td></tr>`).join("")}
          </tbody></table>` : `<p class="hint">Nenhum ponto extra lançado.</p>`}
        <h4 style="margin-top:16px;">Provas corrigidas por foto</h4>
        <div id="crmCorrecoes"><p class="hint">Carregando...</p></div>
      </div>
    </div>

    <div class="card">
      <h3>Anotações</h3>
      <div class="crm-form crm-noprint">
        <input type="date" id="crmData" value="${crmHojeISO()}" aria-label="Data">
        <select id="crmCat" aria-label="Categoria">${CRM_CATEGORIAS.map((c) => `<option>${c}</option>`).join("")}</select>
        <span></span>
        <textarea id="crmTexto" placeholder="O que aconteceu, o que foi combinado, contato com a família..."></textarea>
        <div class="acoes"><button class="btn btn-primary" id="crmAdd">Adicionar anotação</button></div>
      </div>
      <div class="crm-filtro-cat crm-noprint" id="crmFiltroCat"></div>
      <div id="crmTimeline"></div>
      <h4 style="margin-top:18px;">Observações gerais</h4>
      <p class="hint" style="margin-bottom:6px;">Mesmo campo do botão 📝 da aba Presença.</p>
      <textarea id="crmObs" rows="3" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;font:inherit;font-size:14px;">${escapeHtml(a.observacoes || "")}</textarea>
    </div>`;

  const ir = (num) => { CRM_SEL = num; renderCRM(); window.scrollTo({ top: 0 }); };
  document.getElementById("crmVoltar").addEventListener("click", () => ir(null));
  if (ant) document.getElementById("crmAnt").addEventListener("click", () => ir(ant.num));
  if (prox) document.getElementById("crmProx").addEventListener("click", () => ir(prox.num));
  document.getElementById("crmImprimir").addEventListener("click", () => window.print());

  let obsTimer = null;
  document.getElementById("crmObs").addEventListener("input", (e) => {
    a.observacoes = e.target.value;
    clearTimeout(obsTimer);
    obsTimer = setTimeout(agendarSalvamento, 500);
  });

  document.getElementById("crmAdd").addEventListener("click", () => {
    const txt = document.getElementById("crmTexto").value.trim();
    if (!txt) { document.getElementById("crmTexto").focus(); return; }
    a.crm.anotacoes.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      data: document.getElementById("crmData").value || crmHojeISO(),
      categoria: document.getElementById("crmCat").value,
      texto: txt,
      criadoEm: new Date().toISOString()
    });
    agendarSalvamento();
    document.getElementById("crmTexto").value = "";
    desenharTimelineCRM(t, a);
  });

  desenharTimelineCRM(t, a);
  carregarCorrecoesCRM(a);
}

let CRM_CAT_FILTRO = "Todas";
function desenharTimelineCRM(t, a) {
  const anot = (a.crm.anotacoes || []).map((x) => Object.assign({ manual: true }, x));
  const auto = [];
  if (a.personalidade && a.personalidade.data) {
    auto.push({ data: a.personalidade.data, categoria: "Teste", texto: "Respondeu o teste de personalidade (Big Five).", criadoEm: "" });
  }
  (CRM_CORRECOES[TURMA_ATUAL + "-" + a.num] || []).forEach((c) => {
    auto.push({ data: String(c.corrigidoEm || "").slice(0, 10), categoria: "Avaliação",
                texto: `${c.titulo || "Prova"} corrigida: ${c.acertos} acerto(s), nota ${fmtCrm(Number(c.nota) || 0)}.`, criadoEm: c.corrigidoEm || "" });
  });
  const todas = anot.concat(auto).sort((p, q) => String(q.data).localeCompare(String(p.data)) || String(q.criadoEm).localeCompare(String(p.criadoEm)));
  const cats = ["Todas"].concat(CRM_CATEGORIAS.filter((c) => anot.some((x) => x.categoria === c)));
  if (!cats.includes(CRM_CAT_FILTRO)) CRM_CAT_FILTRO = "Todas";
  const filtro = document.getElementById("crmFiltroCat");
  filtro.innerHTML = anot.length ? cats.map((c) => `<button type="button" data-cat="${escapeHtml(c)}" aria-pressed="${c === CRM_CAT_FILTRO}">${escapeHtml(c)}</button>`).join("") : "";
  filtro.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => { CRM_CAT_FILTRO = b.dataset.cat; desenharTimelineCRM(t, a); }));
  const vis = CRM_CAT_FILTRO === "Todas" ? todas : todas.filter((x) => x.categoria === CRM_CAT_FILTRO);
  const box = document.getElementById("crmTimeline");
  if (!vis.length) { box.innerHTML = `<p class="hint">Nenhuma anotação ainda. Registre conversas, combinados, contatos com a família e conquistas do aluno.</p>`; return; }
  box.innerHTML = vis.map((x) => `
    <div class="crm-linha${x.manual ? "" : " auto"}">
      <span class="dt">${crmDataBR(x.data)}</span>
      <span class="ct" style="background:${CRM_COR_CAT[x.categoria] || "#948a7d"}">${escapeHtml(x.categoria)}</span>
      <span class="tx">${escapeHtml(x.texto)}</span>
      ${x.manual ? `<span class="crm-noprint" style="white-space:nowrap;"><button class="icon-btn" data-ed="${x.id}" title="Editar">✎</button><button class="icon-btn danger" data-del="${x.id}" title="Apagar">✕</button></span>` : ""}
    </div>`).join("");
  box.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
    const i = a.crm.anotacoes.findIndex((x) => x.id === b.dataset.del);
    if (i < 0 || !confirm("Apagar esta anotação?")) return;
    a.crm.anotacoes.splice(i, 1);
    agendarSalvamento();
    desenharTimelineCRM(t, a);
  }));
  box.querySelectorAll("[data-ed]").forEach((b) => b.addEventListener("click", () => editarAnotacaoCRM(t, a, b.dataset.ed)));
}

function editarAnotacaoCRM(t, a, id) {
  const x = a.crm.anotacoes.find((n) => n.id === id);
  if (!x) return;
  const ov = document.createElement("div");
  ov.className = "modal-overlay"; ov.style.display = "flex";
  ov.innerHTML = `<div class="modal"><h3>Editar anotação</h3>
    <div class="crm-form" style="grid-template-columns:1fr 1fr;">
      <input type="date" id="edData" value="${escapeHtml(x.data)}">
      <select id="edCat">${CRM_CATEGORIAS.map((c) => `<option ${c === x.categoria ? "selected" : ""}>${c}</option>`).join("")}</select>
      <textarea id="edTexto" rows="5">${escapeHtml(x.texto)}</textarea>
    </div>
    <div class="modal-actions"><button class="btn" id="edCanc">Cancelar</button><button class="btn btn-primary" id="edSalvar">Salvar</button></div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
  document.getElementById("edCanc").addEventListener("click", () => ov.remove());
  document.getElementById("edSalvar").addEventListener("click", () => {
    const txt = document.getElementById("edTexto").value.trim();
    if (!txt) return;
    Object.assign(x, { data: document.getElementById("edData").value || x.data, categoria: document.getElementById("edCat").value, texto: txt, editadoEm: new Date().toISOString() });
    agendarSalvamento();
    ov.remove();
    desenharTimelineCRM(t, a);
  });
}

async function carregarCorrecoesCRM(a) {
  const box = document.getElementById("crmCorrecoes");
  const chave = TURMA_ATUAL + "-" + a.num;
  const desenhar = (lista) => {
    if (!box || !document.body.contains(box)) return;
    box.innerHTML = lista.length
      ? `<table class="crm-tab-mini"><thead><tr><th style="text-align:left">Avaliação</th><th>Acertos</th><th>Nota</th><th>Data</th></tr></thead><tbody>
          ${lista.map((c) => `<tr><td style="text-align:left;white-space:normal">${escapeHtml(c.titulo || "—")}</td><td>${c.acertos ?? "—"}/${(Number(c.acertos) || 0) + (Number(c.erros) || 0) + (Number(c.brancos) || 0)}</td>
            <td><b>${fmtCrm(Number(c.nota) || 0)}</b></td><td>${crmDataBR(String(c.corrigidoEm || "").slice(0, 10))}</td></tr>`).join("")}</tbody></table>`
      : `<p class="hint">Nenhuma prova deste aluno corrigida pelo app ainda.</p>`;
  };
  if (CRM_CORRECOES[chave]) { desenhar(CRM_CORRECOES[chave]); return; }
  if (typeof fsConsultar !== "function" || !FB_CFG_ATIVA) { desenhar([]); return; }
  try {
    const cors = await fsConsultar({ tipo: "correcao", turma: TURMA_ATUAL, num: a.num }, ["titulo", "acertos", "erros", "brancos", "nota", "corrigidoEm", "bimestre", "avaliacao"]);
    cors.sort((p, q) => String(q.corrigidoEm || "").localeCompare(String(p.corrigidoEm || "")));
    CRM_CORRECOES[chave] = cors;
    desenhar(cors);
    if (CRM_SEL === a.num && document.getElementById("crmTimeline")) desenharTimelineCRM(turmaAtual(), a);
  } catch (e) {
    if (box && document.body.contains(box)) box.innerHTML = `<p class="hint">Não foi possível buscar as correções agora (sem conexão com o Firebase).</p>`;
  }
}

function htmlPersonalidadeCRM(a) {
  const p = a.personalidade;
  if (!p || !p.resultado) {
    return `<p class="hint">Ainda não há resultado do teste para este aluno. Para trazer os resultados, use <b>📥 Importar notas</b> e escolha o arquivo do teste de personalidade (o mesmo JSON que o leitor do teste exporta).</p>`;
  }
  const res = p.resultado;
  const linhas = CRM_TRACOS.map(([k, nome]) => {
    const v = res[k] ? Number(res[k].total) : null;
    if (v === null || isNaN(v)) return "";
    const f = crmFaixa(v);
    const pos = Math.max(0, Math.min(100, (v - 6) / 24 * 100));
    const cor = f === "ALTO" ? "#1E7A44" : f === "BAIXO" ? "#9A5B00" : "#4A6FA5";
    return `<div class="crm-traco">
      <span class="nm">${nome}</span>
      <div class="crm-escala" role="img" aria-label="${nome}: ${v} de 30, ${f.toLowerCase()}"><b style="left:${pos}%;background:${cor}"></b></div>
      <span class="vl">${v} <span class="crm-faixa ${f}">${f}</span></span>
      <span class="ds">${CRM_DESC[k][f === "ALTO" ? 0 : f === "MÉDIO" ? 1 : 2]}</span>
    </div>`;
  }).join("");
  const altos = CRM_TRACOS.filter(([k]) => res[k] && res[k].total >= 22).map(([, n]) => n);
  const baixos = CRM_TRACOS.filter(([k]) => res[k] && res[k].total <= 14).map(([, n]) => n);
  return `<p class="hint" style="margin-bottom:12px;">Aplicado em ${crmDataBR(p.data)} · cada traço vai de 6 a 30 (até 14 baixo, 15 a 21 médio, 22 a 30 alto).</p>
    ${linhas}
    <div style="background:#EEF2F8;border-radius:8px;padding:10px 12px;font-size:13px;margin-top:4px;">
      <b>Pontos marcantes:</b> ${altos.length ? altos.join(", ") : "nenhum traço no nível alto"}.<br>
      <b>Pede atenção:</b> ${baixos.length ? baixos.join(", ") : "nenhum traço no nível baixo"}.
    </div>
    <p class="hint" style="margin:8px 0 0;font-size:11.5px;">Instrumento de autoconhecimento e apoio pedagógico, não diagnóstico. Nenhum traço é bom ou ruim. Uso exclusivo do professor.</p>`;
}

/* ---------------- importação do teste de personalidade ---------------- */
function ehImportPersonalidade(dados) {
  return extrairLotes(dados).some((l) => l && (l.origem === "teste_personalidade_big_five" || l.tipo === "personalidade"));
}

function previaPersonalidade(dados) {
  const area = document.getElementById("impPreviaArea");
  const btn = document.getElementById("impConfirmar");
  IMPORT_PREVIA = null;
  const linhas = [];
  extrairLotes(dados).forEach((lote) => {
    (Array.isArray(lote.registros) ? lote.registros : []).forEach((r) => {
      const turmaId = resolverTurmaId(r.turma || lote.turma);
      const l = { turmaId, numero: r.numero, nomeJson: r.nome || "", data: r.data || "", resultado: r.resultado };
      const okRes = r.resultado && CRM_TRACOS.every(([k]) => r.resultado[k] && isFinite(Number(r.resultado[k].total)));
      if (!turmaId) { linhas.push(Object.assign(l, { status: "erro", erro: "Turma não reconhecida", marcado: false })); return; }
      if (!okRes) { linhas.push(Object.assign(l, { status: "erro", erro: "Resultado incompleto", marcado: false })); return; }
      const turma = STATE.turmas[turmaId];
      l.turmaNome = turma.nome;
      let aluno = turma.alunos.find((a) => normalizarTexto(a.nome) === normalizarTexto(r.nome));
      let cmp = aluno ? "igual" : null;
      if (!aluno && r.numero !== undefined) {
        const porNum = turma.alunos.find((a) => a.num === Number(r.numero));
        if (porNum) { aluno = porNum; cmp = compararNomes(r.nome, porNum.nome); }
      }
      if (!aluno) { linhas.push(Object.assign(l, { status: "erro", erro: "Aluno não encontrado na turma", marcado: false })); return; }
      l.numero = aluno.num; l.nomeDiario = aluno.nome;
      const ja = aluno.personalidade && aluno.personalidade.resultado;
      if (cmp === "diferente") Object.assign(l, { status: "alerta", erro: "Nome não confere — verifique", marcado: false });
      else if (cmp === "parecido") Object.assign(l, { status: "alerta", erro: "Nome parecido", marcado: true });
      else Object.assign(l, { status: "ok", erro: ja ? "Atualiza o resultado" : "Novo", marcado: true });
      linhas.push(l);
    });
  });
  // um aluno só pode receber um resultado (fica o mais recente)
  const vistos = {};
  linhas.filter((l) => l.nomeDiario).sort((p, q) => String(q.data).localeCompare(String(p.data))).forEach((l) => {
    const k = l.turmaId + "|" + l.nomeDiario;
    if (vistos[k]) Object.assign(l, { status: "erro", erro: "Repetido (fica o mais recente)", marcado: false });
    vistos[k] = true;
  });
  PERS_PREVIA = linhas;
  if (!linhas.length) { area.innerHTML = `<p class="hint" style="color:var(--red)">O arquivo não tem nenhum registro do teste.</p>`; btn.disabled = true; return; }

  const cont = { ok: 0, alerta: 0, erro: 0 };
  linhas.forEach((l) => { cont[l.status]++; });
  let ctx = "";
  area.innerHTML = `<h4 style="margin-top:10px;">🧩 Teste de personalidade (Big Five)</h4>
    <div class="imp-resumo"><span>${linhas.length} registros</span><span style="color:var(--green)">${cont.ok} ok</span>
      <span style="color:#8a6a1c">${cont.alerta} p/ conferir</span><span style="color:var(--red)">${cont.erro} com erro</span></div>
    <div class="table-wrap" style="max-height:50vh;"><table class="imp-tabela"><thead><tr>
      <th class="fix-num">Nº</th><th class="fix-nome" style="text-align:left">Aluno(a)</th><th>E</th><th>A</th><th>R</th><th>Am</th><th>EE</th><th>✔</th><th>Status</th><th style="text-align:left">Nome no arquivo</th>
    </tr></thead><tbody>${linhas.map((l, i) => {
      let cab = "";
      if ((l.turmaNome || "—") !== ctx) { ctx = l.turmaNome || "—"; cab = `<tr><td colspan="10" style="text-align:left;background:#f3ede0;font-weight:700;"><span style="position:sticky;left:8px;">${escapeHtml(ctx)}</span></td></tr>`; }
      const v = (k) => (l.resultado && l.resultado[k] ? l.resultado[k].total : "—");
      return cab + `<tr class="${l.status === "alerta" ? "imp-alerta" : l.status === "erro" ? "imp-erro" : ""}">
        <td class="fix-num">${escapeHtml(l.numero ?? "—")}</td><td class="nm fix-nome">${escapeHtml(l.nomeDiario || "—")}</td>
        ${CRM_TRACOS.map(([k]) => `<td>${v(k)}</td>`).join("")}
        <td>${l.status === "erro" ? "" : `<input type="checkbox" data-pers-idx="${i}" ${l.marcado ? "checked" : ""}>`}</td>
        <td><span class="imp-st ${l.status}">${escapeHtml(l.erro)}</span></td>
        <td class="nm" style="color:#8a7f74">${escapeHtml(l.nomeJson || "—")}</td></tr>`;
    }).join("")}</tbody></table></div>
    <p class="hint" style="margin-top:8px;">E = Extroversão · A = Abertura · R = Responsabilidade · Am = Amabilidade · EE = Equilíbrio emocional. O resultado vai para a ficha do aluno na aba CRM. Notas não são alteradas.</p>`;
  area.querySelectorAll("[data-pers-idx]").forEach((cb) => cb.addEventListener("change", () => {
    PERS_PREVIA[Number(cb.dataset.persIdx)].marcado = cb.checked;
    atualizarBotaoPers();
  }));
  if (!btn.dataset.persLigado) {
    btn.dataset.persLigado = "1";
    btn.addEventListener("click", confirmarImportPersonalidade);
  }
  atualizarBotaoPers();
  area.scrollIntoView({ behavior: "smooth", block: "start" });
}

function atualizarBotaoPers() {
  const n = (PERS_PREVIA || []).filter((l) => l.marcado).length;
  const btn = document.getElementById("impConfirmar");
  btn.disabled = n === 0;
  btn.textContent = n ? `Confirmar importação (${n})` : "Confirmar importação";
}

function confirmarImportPersonalidade() {
  if (!PERS_PREVIA) return;
  const linhas = PERS_PREVIA.filter((l) => l.marcado);
  if (!linhas.length) return;
  if (!confirm(`Gravar o resultado do teste de personalidade de ${linhas.length} aluno(s)?`)) return;
  const btn = document.getElementById("impConfirmar");
  btn.disabled = true; btn.textContent = "Gravando...";
  const buscarRemoto = FB_CFG_ATIVA ? Promise.resolve().then(() => firestoreGet(FB_CFG_ATIVA)).catch(() => null) : Promise.resolve(null);
  buscarRemoto.then((remoto) => {
    if (remoto && remoto.turmas) STATE = remoto;
    localStorage.setItem(IMPORT_BACKUP_KEY, JSON.stringify({ quando: new Date().toISOString(), estado: STATE }));
    let n = 0;
    linhas.forEach((l) => {
      const turma = STATE.turmas[l.turmaId];
      const aluno = turma && (turma.alunos.find((a) => normalizarTexto(a.nome) === normalizarTexto(l.nomeDiario)) || turma.alunos.find((a) => a.num === l.numero));
      if (!aluno) return;
      const resultado = {};
      CRM_TRACOS.forEach(([k]) => { const v = Number(l.resultado[k].total); resultado[k] = { total: v, faixa: crmFaixa(v) }; });
      aluno.personalidade = { data: l.data, resultado, origem: "teste_personalidade_big_five", importadoEm: new Date().toISOString() };
      n++;
    });
    agendarSalvamento();
    PERS_PREVIA = null;
    const turmaIds = Array.from(new Set(linhas.map((l) => l.turmaId)));
    if (turmaIds.length === 1) TURMA_ATUAL = turmaIds[0];
    CRM_SEL = null;
    ABA_ATUAL = "crm";
    document.querySelectorAll("#tabsNav [data-aba]").forEach((b) => b.classList.toggle("active", b.dataset.aba === "crm"));
    renderTurmaSelect();
    renderAll();
    const ov = document.getElementById("modalImportOverlay");
    if (ov) ov.remove();
    alert(`${n} resultado(s) do teste de personalidade gravado(s). Eles aparecem na ficha de cada aluno, na aba CRM.\n\nSe algo estiver errado, use "Importar notas → Desfazer última importação".`);
  });
}
