# SCP Motion Editor

Editor de vídeo no navegador, feito sob medida pra montar os vídeos do canal SCP: você gera o
roteiro/planejamento com uma IA, importa no editor, ajusta tudo visualmente (câmera, textos, ritmo)
e exporta o MP4 final. Sem build step — HTML/CSS/JS puro no front, PHP + sistema de arquivos no
back.

Rodando em produção em `editor.stackcode.com.br`.

## A regra principal: tudo passa pelo `project.json`

**O editor não entende vídeo pronto (MP4) nem HTML de animação.** Ele só sabe ler um formato
próprio: um arquivo `{nome-do-projeto}.project.json` (o "roteiro" em JSON — cenas, câmera, textos,
áudio, timing) + uma pasta `assets/` com as imagens/áudios que esse JSON referencia, os dois juntos
dentro de um `.zip`.

Esse é o contrato de importação/exportação em `api.php` (`import_zip` / `export_zip`), e é por isso
que, pra trazer um vídeo planejado no Claude Design (ou outra IA) pra dentro do editor, **você tem
que pedir explicitamente esse formato** — senão vem HTML, PDF, PPTX ou outra coisa que o editor não
sabe importar.

➡️ O prompt certo pra pedir, um exemplo de `project.json` válido (`exemplo.project.json`) e o
passo a passo estão em [`prompt-exemplo-ia.md`](./prompt-exemplo-ia.md) — e também ficam disponíveis
direto na tela de projetos do editor, no botão **"?"** ao lado de "Importar ZIP".

### Resumindo o ciclo

```
IA gera roteiro  →  zip (project.json + assets/)  →  Importar ZIP no editor
     ↑                                                        │
     │                                                  edita visualmente
     │                                              (câmera, texto, timing)
     │                                                        │
     └──────────── Baixar .zip (round-trip) ←──────  Exportar vídeo (MP4)
```

O botão de download de cada projeto (ícone ⬇ no card) abre um modal com duas opções:
- **Vídeo (MP4)** — os exports já renderizados, prontos pra baixar.
- **Projeto (.zip)** — o `project.json` atualizado com as edições + assets, pra reimportar depois ou
  mandar de volta pra uma IA continuar editando.

## Arquitetura

- **Front-end**: vanilla JS, sem framework/build. `index.html` + `projects.js` é a listagem de
  projetos; `editor.html` + `app.js` + `renderer.js` é o editor em si.
  - `renderer.js`: motor de renderização puro — lê um `project.json` e desenha o frame num instante
    `t` qualquer (usado tanto na preview ao vivo quanto na exportação frame a frame).
  - `app.js`: toda a interação do editor (timeline, drag de clipes, câmera, texto, seleção, etc.).
- **Back-end**: `api.php`, um único arquivo com todas as ações (projetos são pastas com
  `project.json` + `assets/` em `projects/{slug}/`). Sem banco de dados.
- **Exportação de vídeo**: o navegador renderiza cada frame como imagem e sobe pro servidor
  (`export_frame`); o servidor junta tudo com `ffmpeg` (`assemble_video`). Nesse host, PHP roda com
  `proc_open`/`exec` desabilitados, então os jobs de ffmpeg são enfileirados como arquivos `.cmd` e
  processados por um cron (`cron/process-jobs.sh`, agendado a cada minuto no hPanel) — não pelo
  próprio PHP diretamente.

## Formato do `project.json`

Veja [`exemplo.project.json`](./exemplo.project.json) pra um exemplo completo e comentado-por-uso
(cenas, câmera com zoom/pan, textos com entrada/saída animada, legendas, efeitos visuais como
vinheta/scanlines/glitch/HUD, CTA final). Campos principais:

- `canvas` / `duration` — resolução, fps, duração total.
- `assets.images` / `assets.audio` — mapeia um `id` curto pra um arquivo dentro de `assets/`.
- `theme` — cores e fontes reutilizáveis (referenciadas como `@nome` ou pelo token da fonte).
- `tracks` — as faixas da timeline: `image` (fundo + câmera por clipe), `text` (cartelas/títulos,
  com animação de entrada/saída configurável), `captions` (legendas), `effects` (camadas visuais com
  envelope de intensidade ao longo do tempo), `component` (blocos especiais como o CTA final).

## Projetos não ficam no Git

A pasta `projects/` (seus vídeos, imagens, áudios e os MP4 exportados) é ignorada no `.gitignore` —
fica só no servidor. Os exports sozinhos já passam de 5GB; versionar isso no Git não faz sentido (e
o GitHub bloqueia arquivos grandes assim). O que está versionado aqui é só o código do editor.
