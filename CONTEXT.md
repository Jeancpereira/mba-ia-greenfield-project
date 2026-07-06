# CONTEXT — StreamTube (glossário do domínio)

Glossário canônico dos termos do domínio. Somente vocabulário — sem detalhes de implementação.

## Termos

### Video
Agregado central da Fase 03. Pertence sempre a um **Channel** (nunca diretamente a um User). Nasce como rascunho (`draft`) no momento em que o upload é iniciado — antes de qualquer byte chegar ao storage.

### Channel
Canal de um usuário (relação 1:1 com User, criado no cadastro — Fase 02). Dono dos vídeos.

### Slug
Identificador público, curto e único de um Video, usado nas URLs. Distinto do identificador interno (chave primária). Não enumerável.

### Upload session
Sessão de upload multipart em andamento (identificador de upload + partes). Existe apenas entre o início do upload e sua conclusão (ou abandono). Não é um estado do Video.

### Processing job
Mensagem colocada na fila quando o upload é concluído; consumida pelo **Video Worker**, que extrai duração/metadados e gera a thumbnail.

### Video Worker
Processo em segundo plano (container próprio) que consome processing jobs. Único componente que executa processamento pesado de vídeo.

### Status (do Video)
`draft | processing | ready | failed` — transições apenas nessa ordem. `failed` é terminal e carrega o motivo do erro. `draft` cobre todo o período de upload; `processing` começa quando o upload é concluído.

### Thumbnail
Imagem extraída de um frame do vídeo pelo Video Worker. Pertence ao Video.

### Streaming
Reprodução progressiva do vídeo sem download completo (requisições parciais por faixa de bytes).
