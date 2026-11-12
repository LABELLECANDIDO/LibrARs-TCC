# TCC — LibrasAI (LaTeX)

Documento do Trabalho de Conclusão de Curso de Labelle Cândido, no template da
Faculdade Nova Roma. O documento mestre é [`main.tex`](main.tex); o texto está
dividido por seções em [`sections/`](sections).

## Estrutura

```
latex/
├── main.tex                      # mestre: preâmbulo, timbre, dados e ordem das seções
├── sections/
│   ├── capa.tex                  # pré-textuais (dirigidas pelos \tcc... do main.tex)
│   ├── folha-rosto.tex
│   ├── folha-aprovacao.tex
│   ├── resumo.tex                # resumo + abstract
│   ├── introducao.tex            # 1 Introdução (contexto, problema, objetivos, estrutura)
│   ├── referencial.tex           # 2 Referencial teórico
│   ├── trabalhos-relacionados.tex# 3 Estado da arte e trabalhos relacionados
│   ├── metodologia.tex           # 4 Metodologia
│   ├── desenvolvimento.tex       # 5 Desenvolvimento do sistema
│   ├── resultados.tex            # 6 Resultados e discussão
│   ├── conclusao.tex             # 7 Considerações finais
│   └── referencias.tex           # Referências
├── figures/                      # prints da aplicação e gráficos (a inserir)
├── timbre/                       # papel timbrado institucional (obrigatório)
└── main.pdf                      # PDF gerado (após compilar)
```

## O que ainda falta preencher

- **Figuras:** as figuras marcadas com um quadro de *placeholder* `[Figura pendente]`
  no texto devem ser substituídas pelos prints reais (salvar em `figures/` e trocar
  o `\figpendente{...}` por `\includegraphics[width=...]{nome-do-arquivo}`).
- **Marcadores `[PENDENTE: ...]`** no texto e nas referências: pontos a confirmar/
  completar (hiperparâmetros, números do dataset, datas de acesso, etc.).

## Como compilar

Rode **duas vezes** (a 2ª resolve sumário, listas e referências):

```bash
pdflatex main.tex
pdflatex main.tex
```

Ou, em uma etapa: `latexmk -pdf main.tex`. Também funciona no Overleaf (basta
subir a pasta `latex/` inteira e definir `main.tex` como documento principal).

## Pacotes LaTeX

Distribuição completa recomendada (TeX Live full, MiKTeX ou Overleaf). Pacotes:
`extsizes` (classe `extarticle`), `babel` (português), `inputenc`/`fontenc`,
`helvet`, `graphicx`, `tikz` + `eso-pic` (timbre), `geometry`, `setspace`,
`indentfirst`, `titlesec`, `caption`, `booktabs`, `array`, `float`, `enumitem`,
`hyperref`.
