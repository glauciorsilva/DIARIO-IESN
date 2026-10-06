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

## Turmas incluídas

- 6º Ano (26 alunos)
- 7º Ano (13 alunos)
- 8º Ano (9 alunos)
- 9º Ano (10 alunos)

## Publicação

Para publicar num domínio próprio, basta hospedar o `index.html` em qualquer serviço de
arquivos estáticos (Firebase Hosting, Netlify, Vercel, ou a própria VPS).
