# Diário de Classe — Instituto de Educação Silva Nascimento (2026)

Sistema de diário de classe digital para o Prof. Glaucio Rafael, com:

- **Presença**: lista de chamada por data, com adição/remoção de alunos
- **Ponto Extra**: lançamentos de pontos (soma ou desconto) por bimestre
- **Notas**: teste, trabalho e prova por bimestre (pesos 3/1/6), com recuperação no 2º e 4º bimestre substituindo a média
- **Mapa de Notas**: resumo final por turma, com exportação em PDF
- **Observações**: anotações livres por aluno
- Sincronização automática com Firebase Firestore (via API REST)

## Como usar

Abra o arquivo `index.html` em qualquer navegador. Não precisa de instalação, servidor ou build —
é um sistema estático de um único arquivo.

## Turmas incluídas

- 6º Ano (26 alunos)
- 7º Ano (13 alunos)
- 8º Ano (9 alunos)
- 9º Ano (10 alunos)

## Publicação

Para publicar num domínio próprio, basta hospedar o `index.html` em qualquer serviço de
arquivos estáticos (Firebase Hosting, Netlify, Vercel, ou a própria VPS).
