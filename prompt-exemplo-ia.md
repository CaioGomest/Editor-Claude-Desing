# Prompt pra pedir um projeto pra IA (Claude Design ou outro)

Use esse texto (junto com `exemplo.project.json` como anexo) sempre que precisar que uma IA gere um
projeto pronto pra importar no SCP Motion Editor.

## Perguntas que a IA pode fazer antes de montar o zip

- **Qual roteiro exportar?** — você escolhe, é o conteúdo do seu vídeo.
- **Qual editor vai importar o project.json?** — responda: `SCP Motion Editor (editor próprio, feito sob medida)` e anexe `exemplo.project.json`.
- **Como gerar os assets visuais?** — escolha: *"Só um PNG de fundo por cena, textos e câmera no JSON"* (é como esse editor funciona: uma imagem por cena, zoom/pan e textos descritos no JSON, não "queimados" na imagem).
- **Áudio?** — se o vídeo tem narração/trilha, escolha a opção de enviar os arquivos; se não tem, escolha "sem áudio".

## O prompt

```
Me gera o projeto em formato zip: preciso de um arquivo {nome-do-projeto}.project.json com toda a
timeline (clipes, câmera, textos, áudio) + uma pasta assets/ com as imagens e áudios usados, tudo
dentro de um único .zip. Não quero o MP4 renderizado nem HTML do projeto — só o project.json + os
assets, pra eu importar no editor e continuar editando lá.
```

Esse mesmo texto (com botão de copiar) e o download de `exemplo.project.json` também estão
disponíveis direto na tela de projetos do editor, no botão **"?"** ao lado de "Importar ZIP".
