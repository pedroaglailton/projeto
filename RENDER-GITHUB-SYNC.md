# Persistir equipes no GitHub (Render)

Para que o cadastro de equipes no NOC seja salvo automaticamente em `data/equipes.json` no repositório, configure estas variáveis no Render:

- `GITHUB_TOKEN` = token PAT com permissão de escrita no repositório
- `GITHUB_OWNER` = `pedroaglailton`
- `GITHUB_REPO` = `projeto`
- `GITHUB_BRANCH` = `main`

## Permissões do token

No GitHub, crie um token (fine-grained) com acesso ao repositório `projeto` e permissão:

- Repository permissions -> **Contents: Read and write**

## Comportamento

- Ao criar equipe (`POST /api/equipes`), o backend salva local e tenta commitar `data/equipes.json` no GitHub.
- Ao regenerar token e ativar/desativar equipe, também sincroniza.
- Se sincronização falhar, o NOC continua respondendo e o erro aparece no log do Render.
