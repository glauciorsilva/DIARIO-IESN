"""Modelo padrão de avaliação — Instituto de Educação Silva Nascimento (Prof. Glaucio Rafael).

Regras fixas:
- Borda retangular contornando toda a página.
- Logo da escola no canto superior esquerdo, ao lado do quadro do cabeçalho.
- Quadro do cabeçalho: nome da escola (negrito, sublinhado), PROF, DATA, DUQUE DE CAXIAS + SÉRIE, NOME + Nº.
- Título da avaliação centralizado em negrito, logo abaixo do cabeçalho.
- SEM quadro de instruções.
- Rodapé: frase de um filósofo, centralizada e em negrito, dentro da borda.

Correção por foto no Diário (08/10/2026):
- Cada folha leva no pé uma FAIXA DE RESPOSTAS com as bolinhas das questões daquela folha,
  4 quadrados pretos nos cantos, o Nº do aluno (texto + código de quadradinhos) e um QR code
  (gabarito, turma, nº, fila, folha e questões). Com isso o app junta as folhas de cada aluno.
- A geometria da faixa é a mesma de `correcao-core.js` (FAIXA) no repositório DIARIO-IESN.
  NÃO mude as medidas de um lado sem mudar do outro.
- `gerar_turma` gera uma prova nominal por aluno (nome e nº do diário), o gabarito do professor
  e o JSON do gabarito para colar no app (aba Correção → Novo gabarito → Colar JSON).
"""
import json
import os
import random
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm, mm
from reportlab.lib.colors import HexColor, black, white
from reportlab.pdfgen import canvas
from reportlab.lib.utils import simpleSplit
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

W, H = A4
M = 1.2 * cm                     # margem até a borda
AZUL = HexColor("#4A6FA5")       # cor do valor da questão
VERDE = HexColor("#1E8E3E")      # destaque do gabarito
CINZA = HexColor("#5A5A5A")
LOGO = "logo_iesn.png"
LETRAS = "ABCDE"

FRASES = [
    ("A educação tem raízes amargas, mas os seus frutos são doces.", "Aristóteles"),
    ("Só sei que nada sei.", "Sócrates"),
    ("Ousa saber!", "Immanuel Kant"),
    ("O homem é aquilo que ele faz de si mesmo.", "Jean-Paul Sartre"),
    ("Não é o que acontece com você, mas como você reage que importa.", "Epicteto"),
]

# ---------------- Faixa de respostas (igual a FAIXA em correcao-core.js) ----------------
# medidas em mm a partir do canto SUPERIOR esquerdo da folha
FAIXA = dict(
    x=14, y=216, w=182, h=52, marca=6,
    cantos=[(17, 219), (193, 219), (193, 265), (17, 265)],
    qr=dict(x=160, y=221, lado=22),
    colunas=[22, 58, 94], linhaY0=231, passoY=6.6, passoX=6.2, dxBolinha=9, raio=2.3, maxPorColuna=5,
    numX=133, codigo=dict(x=133, y=248, lado=2.2, passo=2.8, bits=9),
)
MAX_QUESTOES_POR_FOLHA = len(FAIXA["colunas"]) * FAIXA["maxPorColuna"]   # 15
LIMITE_QUESTOES = H - (FAIXA["y"] - 5) * mm   # questões não descem abaixo disto (y do reportlab)


def _y(mm_topo):
    """mm a partir do topo -> coordenada y do reportlab."""
    return H - mm_topo * mm


def bits_codigo(num, folha):
    """0–5 = nº do aluno, 6–7 = folha − 1 (1 a 4), 8 = paridade (total de pretos par)."""
    b = [(num >> i) & 1 for i in range(6)]
    f = max(0, min(3, (folha or 1) - 1))
    b += [f & 1, (f >> 1) & 1]
    b.append(sum(b) % 2)
    return b


def texto_qr(gab_id, turma, num, fila, folha, total, q_ini, q_fim):
    return "|".join(str(v) for v in ["IESN2", gab_id, turma, num, fila or "A", folha, total, q_ini, q_fim])


def desenhar_qr(c, texto, x_mm, y_topo_mm, lado_mm):
    w = QrCodeWidget(texto, barLevel="M", barBorder=0)
    x1, y1, x2, y2 = w.getBounds()
    lado = lado_mm * mm
    d = Drawing(lado, lado, transform=[lado / (x2 - x1), 0, 0, lado / (y2 - y1), 0, 0])
    d.add(w)
    renderPDF.draw(d, c, x_mm * mm, _y(y_topo_mm + lado_mm))


def faixa_respostas(c, info, k, corretas=None):
    """info: gab_id, turma, num, fila, folha, total, q_ini, q_fim.
    corretas: string do gabarito (versão do professor: pinta a certa em verde)."""
    F = FAIXA
    # moldura leve
    c.setStrokeColor(HexColor("#9A9A9A")); c.setLineWidth(0.6)
    c.roundRect(F["x"] * mm, _y(F["y"] + F["h"]), F["w"] * mm, F["h"] * mm, 2 * mm, stroke=1, fill=0)
    # quadrados dos cantos
    c.setFillColor(black)
    m = F["marca"]
    for (cx, cy) in F["cantos"]:
        c.rect((cx - m / 2) * mm, _y(cy + m / 2), m * mm, m * mm, stroke=0, fill=1)
    # título
    c.setFont("Helvetica-Bold", 7.5)
    c.drawString(22 * mm, _y(221.8), "RESPOSTAS DESTA FOLHA — pinte toda a bolinha. Só vale o que for marcado aqui.")
    # questões
    q_ini, q_fim = info["q_ini"], info["q_fim"]
    usadas = set()
    for q in range(q_ini, q_fim + 1):
        i = q - q_ini
        col, lin = divmod(i, F["maxPorColuna"])
        x0 = F["colunas"][col]
        y = F["linhaY0"] + lin * F["passoY"]
        usadas.add(col)
        c.setFillColor(black); c.setFont("Helvetica-Bold", 8)
        c.drawString((x0 + 0.5) * mm, _y(y + 1.2), f"{q:02d}")
        for j in range(k):
            bx = x0 + F["dxBolinha"] + j * F["passoX"]
            certo = corretas is not None and corretas[q - 1].upper() == LETRAS[j]
            c.setStrokeColor(HexColor("#5A5A5A")); c.setLineWidth(1)
            if certo:
                c.setFillColor(VERDE)
                c.circle(bx * mm, _y(y), F["raio"] * mm, stroke=1, fill=1)
            else:
                c.circle(bx * mm, _y(y), F["raio"] * mm, stroke=1, fill=0)
    # letras sobre cada coluna usada
    c.setFillColor(black); c.setFont("Helvetica-Bold", 7)
    for col in usadas:
        x0 = F["colunas"][col]
        for j in range(k):
            c.drawCentredString((x0 + F["dxBolinha"] + j * F["passoX"]) * mm, _y(227), LETRAS[j])
    # nº do aluno, folha e fila
    c.setFont("Helvetica-Bold", 13)
    c.drawString(F["numX"] * mm, _y(233), f"Nº {info['num']:02d}")
    c.setFont("Helvetica", 8)
    c.drawString(F["numX"] * mm, _y(238.5), f"FOLHA {info['folha']}/{info['total']}")
    c.drawString(F["numX"] * mm, _y(243.5), f"FILA {info.get('fila') or 'A'}")
    # código de quadradinhos (nº + folha + paridade)
    C = F["codigo"]
    for i, b in enumerate(bits_codigo(info["num"], info["folha"])):
        x = C["x"] + i * C["passo"]
        if b:
            c.setFillColor(black)
            c.rect(x * mm, _y(C["y"] + C["lado"]), C["lado"] * mm, C["lado"] * mm, stroke=0, fill=1)
        else:
            c.setStrokeColor(HexColor("#C8C8C8")); c.setLineWidth(0.3)
            c.rect(x * mm, _y(C["y"] + C["lado"]), C["lado"] * mm, C["lado"] * mm, stroke=1, fill=0)
    # QR
    c.setFillColor(black)
    Q = F["qr"]
    desenhar_qr(c, texto_qr(info["gab_id"], info["turma"], info["num"], info.get("fila"), info["folha"],
                            info["total"], q_ini, q_fim), Q["x"], Q["y"], Q["lado"])


# ---------------- Cabeçalho / rodapé ----------------
def borda(c):
    c.setStrokeColor(black)
    c.setLineWidth(1.2)
    c.rect(M, M, W - 2 * M, H - 2 * M)


def cabecalho(c, serie, titulo, aluno=None):
    top = H - M - 0.5 * cm
    # logo
    if os.path.exists(LOGO):
        c.drawImage(LOGO, M + 0.35 * cm, top - 4.0 * cm, 3.7 * cm, 3.7 * cm,
                    mask="auto", preserveAspectRatio=True)
    # quadro
    bx, bw, bh = M + 4.4 * cm, W - 2 * M - 4.8 * cm, 3.6 * cm
    by = top - 3.85 * cm
    c.setStrokeColor(black); c.setFillColor(black)
    c.setLineWidth(0.8)
    c.rect(bx, by, bw, bh)
    x, y, lh = bx + 0.3 * cm, by + bh - 0.65 * cm, 0.68 * cm
    c.setFont("Helvetica-Bold", 12.5)
    t = "INSTITUTO DE EDUCAÇÃO SILVA NASCIMENTO"
    c.drawString(x, y, t)
    c.setLineWidth(0.7)
    c.line(x, y - 2, x + c.stringWidth(t, "Helvetica-Bold", 12.5), y - 2)
    c.setFont("Helvetica", 12)
    y -= lh; c.drawString(x, y, "PROF: GLAUCIO RAFAEL.")
    y -= lh; c.drawString(x, y, "DATA:_______/_________/_________")
    y -= lh; c.drawString(x, y, "DUQUE DE CAXIAS")
    c.drawString(bx + bw * 0.58, y, f"SÉRIE: {serie}")
    y -= lh
    c.drawString(x, y, "NOME:")
    nx = x + c.stringWidth("NOME:", "Helvetica", 12) + 2
    numx = bx + bw - 2.4 * cm
    c.line(nx, y - 1, numx - 0.3 * cm, y - 1)
    c.drawString(numx, y, "Nº:")
    c.line(numx + c.stringWidth("Nº:", "Helvetica", 12) + 2, y - 1, bx + bw - 0.3 * cm, y - 1)
    if aluno:
        nome = aluno["nome"]
        tam = 10
        while c.stringWidth(nome, "Helvetica-Bold", tam) > (numx - 0.4 * cm - nx - 4) and tam > 6:
            tam -= 0.5
        c.setFont("Helvetica-Bold", tam)
        c.drawString(nx + 3, y + 1, nome)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(numx + c.stringWidth("Nº:", "Helvetica", 12) + 6, y + 1, f"{aluno['num']:02d}")
    # título
    c.setFont("Helvetica-Bold", 13)
    c.drawCentredString(W / 2, by - 0.9 * cm, titulo)
    return by - 1.9 * cm


def rodape(c, frase):
    texto, autor = frase
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(W / 2, M + 0.95 * cm, f"“{texto}”")
    c.setFont("Helvetica-Oblique", 9.5)
    c.drawCentredString(W / 2, M + 0.45 * cm, f"— {autor}")


# ---------------- Questões ----------------
X0 = M + 1.0 * cm
LARGURA = W - 2 * M - 2.0 * cm


def altura_questao(q):
    h = 0.62 * cm + len(simpleSplit(q["enunciado"], "Times-Roman", 12.5, LARGURA)) * 0.58 * cm + 0.08 * cm
    pre = c_stringwidth("(    ) a) ", "Times-Bold", 12.5)
    for alt in q["alternativas"]:
        h += len(simpleSplit(alt, "Times-Roman", 12.5, LARGURA - 0.3 * cm - pre)) * 0.58 * cm
    return h + 0.35 * cm


def c_stringwidth(t, f, s):
    from reportlab.pdfbase.pdfmetrics import stringWidth
    return stringWidth(t, f, s)


def paginar(lista, y_inicio):
    """Divide as questões em folhas. Retorna [(q_ini, q_fim), ...] (1-based)."""
    folhas, ini, y = [], 1, y_inicio
    for i, q in enumerate(lista, 1):
        h = altura_questao(q)
        cheia = (i - ini) >= MAX_QUESTOES_POR_FOLHA
        if (y - h < LIMITE_QUESTOES or cheia) and i > ini:
            folhas.append((ini, i - 1)); ini = i; y = y_inicio
        y -= h
    folhas.append((ini, len(lista)))
    return folhas


def desenhar_questoes(c, y, lista, q_ini, q_fim, gabarito):
    for i in range(q_ini, q_fim + 1):
        q = lista[i - 1]
        c.setFont("Times-Bold", 13)
        lab = f"QUESTÃO {i:02d} "
        c.setFillColor(black); c.drawString(X0, y, lab)
        c.setFont("Times-Roman", 12.5); c.setFillColor(AZUL)
        c.drawString(X0 + c.stringWidth(lab, "Times-Bold", 13), y, f"({q['valor']})")
        c.setFillColor(black)
        y -= 0.62 * cm
        for ln in simpleSplit(q["enunciado"], "Times-Roman", 12.5, LARGURA):
            c.drawString(X0, y, ln); y -= 0.58 * cm
        y -= 0.08 * cm
        for j, alt in enumerate(q["alternativas"]):
            letra = "abcde"[j]
            certo = gabarito and j == q["correta"]
            marca = "( X ) " if certo else "(    ) "
            c.setFillColor(VERDE if certo else black)
            c.setFont("Times-Bold", 12.5)
            pre = f"{marca}{letra}) "
            c.drawString(X0 + 0.3 * cm, y, pre)
            c.setFont("Times-Bold" if certo else "Times-Roman", 12.5)
            px = X0 + 0.3 * cm + c.stringWidth(pre, "Times-Bold", 12.5)
            for ln in simpleSplit(alt, "Times-Roman", 12.5, LARGURA - (px - X0)):
                c.drawString(px, y, ln); y -= 0.58 * cm
            c.setFillColor(black)
        y -= 0.35 * cm
    return y


def _valor_num(v):
    return float(str(v).split()[0].replace(",", "."))


def gabarito_json(gab_id, titulo, turma, bimestre, avaliacao, lista, folhas):
    k = max(len(q["alternativas"]) for q in lista)
    return {
        "id": gab_id, "titulo": titulo, "turma": turma, "bimestre": bimestre, "avaliacao": avaliacao,
        "alternativas": k, "paginas": [list(f) for f in folhas],
        "questoes": [{"A": LETRAS[q["correta"]], "valor": _valor_num(q["valor"])} for q in lista],
    }


def gerar_turma(prefixo, serie, turma, titulo, lista, alunos, gab_id, bimestre, avaliacao="prova", frase=None, fila="A"):
    """Gera: <prefixo>_ALUNOS.pdf (uma prova nominal por aluno, várias folhas),
    <prefixo>_GABARITO.pdf (professor) e <prefixo>_gabarito.json (para o app)."""
    frase = frase or random.choice(FRASES)
    k = max(len(q["alternativas"]) for q in lista)
    # mede a 1ª folha para saber onde as questões começam
    tmp = canvas.Canvas(os.devnull, pagesize=A4)
    y0 = cabecalho(tmp, serie, titulo)
    folhas = paginar(lista, y0)
    corretas = "".join(LETRAS[q["correta"]] for q in lista)

    def prova(c, aluno, gabarito):
        for f, (qi, qf) in enumerate(folhas, 1):
            borda(c)
            y = cabecalho(c, serie, titulo + (" — GABARITO" if gabarito else ""), aluno)
            desenhar_questoes(c, y, lista, qi, qf, gabarito)
            faixa_respostas(c, dict(gab_id=gab_id, turma=turma, num=aluno["num"], fila=aluno.get("fila", fila),
                                    folha=f, total=len(folhas), q_ini=qi, q_fim=qf), k,
                            corretas if gabarito else None)
            rodape(c, frase)
            c.showPage()

    c = canvas.Canvas(f"{prefixo}_ALUNOS.pdf", pagesize=A4); c.setTitle(titulo)
    for al in alunos:
        prova(c, al, False)
    c.save()
    c = canvas.Canvas(f"{prefixo}_GABARITO.pdf", pagesize=A4); c.setTitle(titulo + " — GABARITO")
    prova(c, {"num": 0, "nome": "GABARITO DO PROFESSOR"}, True)
    c.save()
    gj = gabarito_json(gab_id, titulo, turma, bimestre, avaliacao, lista, folhas)
    with open(f"{prefixo}_gabarito.json", "w", encoding="utf-8") as fp:
        json.dump(gj, fp, ensure_ascii=False, indent=2)
    return folhas, gj


def gerar(saida, serie, titulo, lista, gabarito=False, frase=None):
    """Versão simples (uma folha, sem faixa de respostas) — mantida por compatibilidade."""
    c = canvas.Canvas(saida, pagesize=A4)
    c.setTitle(titulo)
    frase = frase or random.choice(FRASES)
    borda(c)
    y = cabecalho(c, serie, titulo + (" — GABARITO" if gabarito else ""))
    desenhar_questoes(c, y, lista, 1, len(lista), gabarito)
    rodape(c, frase)
    c.save()


if __name__ == "__main__":
    Q = [
        dict(valor="0,4 ponto", enunciado="Sobre a União Ibérica, assinale a alternativa correta.", correta=3, alternativas=[
            "Entre 1580 e 1640, Portugal e França tiveram o mesmo rei o monarca espanhol.",
            "Entre 1580 e 1640 Portugal e Espanha tiveram o mesmo rei, o monarca português.",
            "Entre 1500 e 1640, Portugal e Espanha tiveram o mesmo rei o monarca espanhol.",
            "Entre 1580 e 1640, Portugal e Espanha tiveram o mesmo rei, o monarca espanhol."]),
        dict(valor="0,7 ponto", enunciado="Sobre a Carta Régia de 1701, assinale a alternativa correta.", correta=0, alternativas=[
            "A Carta Régia de 1701, para proteger os canaviais, afastou o gado do litoral.",
            "A Carta Régia de 1701, para proteger os currais afastou o gado do litoral.",
            "A Carta Régia de 1701 para proteger os canaviais, aproximou o gado do litoral.",
            "A Carta Régia de 1801, para proteger os canaviais afastou o gado do litoral."]),
        dict(valor="0,3 ponto", enunciado="Qual rio ficou conhecido como “rio dos currais”?", correta=1, alternativas=[
            "O rio São Francisco, eixo da pecuária, ficou conhecido, como rio dos engenhos.",
            "O rio São Francisco, eixo da pecuária, ficou conhecido como rio dos currais.",
            "O rio São Lourenço, eixo da pecuária ficou conhecido como rio dos currais.",
            "O rio São Francisco eixo da mineração, ficou conhecido como rio dos currais."]),
        dict(valor="0,8 ponto", enunciado="Sobre o pagamento dos vaqueiros, assinale a alternativa correta.", correta=0, alternativas=[
            "Os vaqueiros, remunerados pela quarta, recebiam um bezerro a cada quatro nascidos.",
            "Os vaqueiros, remunerados pela quarta recebiam um bezerro a cada dez nascidos.",
            "Os bandeirantes, remunerados pela quarta recebiam um bezerro a cada quatro nascidos.",
            "Os vaqueiros remunerados pela quarta, recebiam um salário a cada quatro nascidos."]),
    ]
    ALUNOS = [{"num": 1, "nome": "ANNA PAULA FELISBINO VIEIRA DOS SANTOS"}, {"num": 2, "nome": "DAVI RIBEIRO CASTILHO DE ASSIS"}]
    gerar_turma("Modelo_Prova_IESN_7ano", "7º ANO", "7ANO", "PROVA DE HISTÓRIA 3º BIMESTRE", Q, ALUNOS,
                gab_id="modelo7a", bimestre=3, frase=FRASES[0])
