# Diário de Classe — Instituto de Educação Silva Nascimento (2026)

Sistema de diário de classe digital para o Prof. Glaucio Rafael, com:

- **Presença**: lista de chamada por data, com adição/remoção de alunos
- **Ponto Extra**: lançamentos de pontos (soma ou desconto) por bimestre
- **Notas**: média do bimestre = soma de teste + trabalho + prova + ponto extra (máx. 10); média final = soma das 4 médias ÷ 4 (aprovado com 7). Recuperação do meio do ano altera o 2º bimestre e a do fim do ano, o 4º — vale a maior nota
- **Mapa de Notas**: resumo final por turma, com exportação em PDF
- **Observações**: anotações livres por aluno
- Sincronização automática com Firebase Firestore (via API REST)

## Como usar

Abra o arquivo `index.html` em qualquer navegador. Não precisa de instalação, servidor ou build —
é um sistema estático de um único arquivo.

## App instalável

O diário pode ser instalado no celular como app (botão **📲 Instalar App**). Arquivos:
`manifest.json`, `sw.js` e ícones `icon-*.png`. Ao mudar arquivos do app, suba a versão
do cache em `sw.js` (`CACHE_NAME`).

## Importar notas (JSON)

Botão **📥 Importar notas** no topo. Escolha o arquivo `.json` (ou cole o conteúdo), confira a
prévia e confirme. Nada é gravado sem confirmação, e a última importação pode ser desfeita.

```json
{
  "turma": "7ANO",
  "bimestre": 3,
  "avaliacao": "prova",
  "notas": [
    { "numero": 1, "nome": "ANNA PAULA FELISBINO VIEIRA DOS SANTOS", "nota": 8.5 },
    { "numero": 2, "nome": "DAVI RIBEIRO CASTILHO DE ASSIS", "nota": null }
  ]
}
```

- `turma`: `6ANO`, `7ANO`, `8ANO`, `9ANO` (também aceita "7º Ano" ou "7")
- `bimestre`: 1 a 4 · `avaliacao`: `teste`, `trabalho`, `prova` ou `recuperacao` (só 2º e 4º)
- `numero`: número da chamada (localiza o aluno; o nome serve de conferência)
- `nota`: 0 a 10; `null` pula o aluno · vários lotes: envie uma lista `[ {...}, {...} ]`

## Correção por foto (cartão-resposta)

Aba **Correção** (e botões **📷 Corrigir prova** no topo e na aba Notas).

1. **+ Novo gabarito**: título, bimestre, onde lançar (teste, trabalho, prova ou recuperação),
   nº de questões (até 50), alternativas (A–D ou A–E), fila única ou filas A e B, e o valor de
   cada questão. Também aceita colar o gabarito em JSON:
   `{ "titulo": "...", "bimestre": 3, "avaliacao": "prova", "alternativas": 5, "questoes": [ { "A": "D", "B": "A", "valor": 0.4 } ] }`.
   ∅ anula a questão (ponto para todos).
2. **🖨 Cartões**: gera o PDF com um cartão-resposta por aluno (nome e nº do diário, fila e um
   QR code). Imprimir em A4, tamanho real.
3. **📷 Corrigir por foto**: fotografe o cartão inteiro (os 4 quadrados pretos aparecendo). O app
   acha a folha, lê o QR (gabarito, aluno e fila), lê as bolinhas e mostra a conferência: acertos,
   erros, em branco, marcações duplas e a nota. Dá para ajustar qualquer questão à mão.
   **Salvar e lançar nota** grava a nota na aba Notas e envia ao Firebase a foto do cartão
   (já endireitada e comprimida, ~80 KB) com as marcações, acertos, erros e nota.
4. **📊 Resultados**: quem já foi corrigido, acertos/erros/nota e a foto de cada cartão.
   Editar o gabarito (ex.: anular uma questão) oferece recalcular as notas já lançadas.

**Provas de várias folhas (faixa de respostas):** o gerador de provas (`modelo/iesn_modelo.py`, no
Projeto do Claude, função `gerar_turma`) põe no pé de **cada folha** uma faixa com as bolinhas das
questões daquela folha, 4 quadrados nos cantos, o **Nº do aluno** (texto + código de quadradinhos) e um
QR (gabarito, turma, nº, fila, folha, questões). Fotografe cada folha, em qualquer ordem: o app guarda as
folhas no aparelho e só abre a conferência quando todas as folhas do aluno chegaram (dá para "Conferir
assim" se faltar alguma). O aluno é sempre localizado pelo **número**; o nome só confere. Sem QR, o nº
vem do código de quadradinhos e o app pede para confirmar a prova. O gerador também cria
`<prova>_gabarito.json` (com `id` e `paginas`) para colar em **Novo gabarito → Colar JSON**.
A geometria da faixa (`FAIXA`) é igual em `correcao-core.js` e em `iesn_modelo.py`.

**✍️ Digitar respostas**: para provas sem cartão-resposta (ex.: as do 3º bimestre já aplicadas) — escolha
o aluno e a letra marcada em cada questão; o app confere com o gabarito e lança a nota do mesmo jeito.

`gabaritos-iniciais.js` traz os gabaritos das provas do 3º bimestre (6º ao 9º ano: 10 questões a–d,
valores 0,4/0,7/0,3/0,8/0,8/0,4/0,8/0,4/0,5/0,9 = 6,0, e +1,5 para quem deixar a questão 3 em branco).
Eles são gravados no Firebase automaticamente na primeira abertura com internet (uma vez só).

Sem internet, a nota vai para o diário e a foto fica guardada no aparelho até **Enviar agora**.

### Onde fica no Firebase

Mesma coleção do diário (`diario_silva_nascimento`), em documentos separados:
- `gab_<id>` — gabarito (`tipo: "gabarito"`)
- `cor_<gabarito>_<turma>_<nº>` — correção de um aluno (`tipo: "correcao"`): `foto`, `marcadas`,
  `acertos`, `erros`, `brancos`, `nota`, `notaAnterior`, `corrigidoEm`...

As regras do Firestore precisam liberar **a coleção inteira** para o login do professor:

```
match /diario_silva_nascimento/{doc} {
  allow read, write: if request.auth != null
    && request.auth.token.email == 'rafael.glaucio2@gmail.com';
}
```

Arquivos: `correcao-core.js` (cartão em PDF + leitura da foto), `correcao.js` (telas),
`vendor/jsQR.js` (Apache-2.0) e `vendor/qrcode.js` (MIT).

## Turmas incluídas

- 6º Ano (26 alunos)
- 7º Ano (13 alunos)
- 8º Ano (9 alunos)
- 9º Ano (10 alunos)

## Publicação

Para publicar num domínio próprio, basta hospedar o `index.html` em qualquer serviço de
arquivos estáticos (Firebase Hosting, Netlify, Vercel, ou a própria VPS).
