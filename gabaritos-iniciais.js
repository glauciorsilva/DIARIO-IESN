/* Gabaritos das avaliações já aplicadas (gerados nas conversas com o Claude).
   Na primeira vez que o diário abrir com internet, cada um é gravado no Firebase
   (coleção diario_silva_nascimento, documento gab_<id>). Depois disso, edite pelo app. */
window.GABARITOS_INICIAIS = (function () {
  // Provas bimestrais de 01/10/2026: 10 questões, alternativas a–d, total 6,0.
  // Fáceis: 1, 3, 6, 8, 9 · Difíceis: 2, 4, 5, 7, 10.
  // Rodapé da prova: "Quem não responder a questão número 3 vai ganhar um ponto e meio (1,5)".
  const VALORES = [0.4, 0.7, 0.3, 0.8, 0.8, 0.4, 0.8, 0.4, 0.5, 0.9];
  const BONUS_Q3 = [0, 0, 1.5, 0, 0, 0, 0, 0, 0, 0];
  const base = (id, turma, titulo, respostas) => ({
    id, turma, titulo, bimestre: 3, avaliacao: "prova", n: 10, k: 4,
    filas: ["A"], respostas: { A: respostas }, valores: VALORES.slice(),
    bonusBranco: BONUS_Q3.slice(), total: 6, origem: "provas 3º bimestre (01/10/2026)"
  });
  return [
    base("p3b26a6", "6ANO", "PROVA DE HISTÓRIA 3º BIMESTRE — CAP. 12: A CIVILIZAÇÃO ROMANA", "DCACADBABB"),
    base("p3b26a7", "7ANO", "PROVA DE HISTÓRIA 3º BIMESTRE — CAP. 12", "DABACBABCD"),
    base("p3b26a8", "8ANO", "PROVA DE HISTÓRIA 3º BIMESTRE — CAP. 11", "BBDCADACAB"),
    base("p3b26a9", "9ANO", "PROVA DE HISTÓRIA 3º BIMESTRE — CAP. 12", "DABBBCADAC")
  ];
})();
