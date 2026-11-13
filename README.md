# ROMANEIO Digital · Hiperideal

Versão web **v47**: login Supabase e romaneios compartilhados entre CD, lojas e gestão. Usa exclusivamente o projeto **ddhirpnnuyflxnwszuqp**, organização **ERICSON HI**, identificado como `ericson.silva@hiperideal.com.br`.

## Executar e validar

Requer Node.js 24.

```bash
npm ci --ignore-scripts
npm test
npm run test:operacao
npm run dev
```

Abra `http://localhost:3000/login`. O servidor usa apenas a URL e a chave publishable em `server/config.mjs`, com a sessão do usuário. Nenhuma senha de banco, chave secret ou `service_role` é necessária.

## Banco e autorização

A migração `supabase/migrations/20261113192625_romaneio_cloud_data.sql` já foi aplicada ao projeto de destino. `supabase/schema.sql` contém a mesma definição para consulta; não execute esse arquivo novamente sobre o banco já migrado. A tabela `profiles` existente e os usuários Auth foram preservados.

| Tabela | Finalidade |
| --- | --- |
| `romaneio_workspaces` | Ambiente compartilhado ROMANEIO Hiperideal |
| `romaneio_members` | Usuários explicitamente autorizados e seus papéis |
| `romaneio_lojas` | As 36 lojas da base original, com endereço e situação |
| `romaneios` | Carga completa, paletes, NFs, conferência, lacres e retornáveis |

As quatro tabelas possuem RLS. O usuário precisa de uma associação ativa ao mesmo workspace do registro. Não há acesso anônimo, autoinscrição em um workspace nem exclusão física de romaneios pela API. O cancelamento mantém o registro com motivo e data. Esta versão compartilha todas as lojas entre os membros do workspace; não implementa isolamento de uma loja por usuário.

Os papéis `admin` e `operator` podem gravar; `viewer` pode consultar. A conta Auth já existente e confirmada `ericson.silva@hiperideal.com.br` recebeu a associação inicial `admin`. Esse papel é mantido no banco e não usa metadados editáveis do usuário. Nenhuma senha foi criada, alterada ou incluída no código.

Para autorizar outro usuário, cadastre-o primeiro no Supabase Auth. Depois, um administrador SQL pode executar, com o e-mail correto:

```sql
insert into public.romaneio_members (user_id, workspace_id, access_role)
select u.id, w.id, 'operator'
from auth.users u cross join public.romaneio_workspaces w
where lower(u.email) = 'operador@hiperideal.com.br'
  and u.email_confirmed_at is not null
  and w.slug = 'romaneio-hiperideal';
```

Não há autoaprovação de novas contas. O provedor Auth pode manter o cadastro por API habilitado, mas uma conta nova não recebe acesso aos romaneios até ser associada ao workspace. A administração de usuários permanece no Supabase.

## Salvamento e atualização entre aparelhos

O HTML operacional é enviado somente após o servidor validar a sessão com `auth.getUser()`. Os dados passam pela rota `/data/romaneios`, que verifica a associação ao workspace e usa o token do próprio usuário sob RLS. Os tokens ficam em cookies HttpOnly, Secure em HTTPS, sem acesso pelo JavaScript.

Toda operação aguarda a confirmação do Supabase antes de indicar sucesso ou avançar para a impressão. A função `save_romaneios` executa um lote inteiro em uma transação, com uma versão por registro. Se outro aparelho já alterou o mesmo romaneio, o lote é recusado integralmente com conflito de versão. As funções são SECURITY INVOKER; a autorização continua aplicada no banco.

A interface busca atualizações a cada 15 segundos e ao retornar à janela. O botão **Atualizar dados** força uma busca. A atualização automática aguarda quando há campos em edição, recebimento em andamento, câmera aberta ou uma gravação pendente, evitando descartar um formulário. A lista é paginada e a API mantém cada resposta abaixo do limite da hospedagem.

Esta versão precisa de conexão para confirmar gravações. Em falhas ou conflitos, restaura o último estado confirmado e preserva uma cópia da tentativa em **Baixar alteração não confirmada**. Não há confirmação falsa de envio nem reenvio automático sobre uma versão mais recente.

## Preservar dados anteriores e importar backups

O cache local é auxiliar. Antes da primeira carga da nuvem, os dados v46 do próprio usuário são preservados, quando presentes, em uma chave separada. O botão **Exportar dados anteriores** baixa esse conteúdo no aparelho onde ele foi criado. Os registros não são enviados automaticamente.

Na aba **Backup**, importe esse JSON para mesclar os registros com a nuvem. A confirmação informa que códigos iguais serão atualizados. Cargas ausentes do backup continuam preservadas na nuvem. Por envio, o limite é de 200 registros alterados e 2 MB; cada carga admite até 200 paletes. Registros fora dos últimos 30 dias ficam fora do painel operacional, mas não são apagados.

## Hospedagem e rotas

`vercel.json` direciona `/login`, `/auth/*`, `/data/*` e `/app/*` para uma única função Node.js. O HTML operacional fica fora de `public/`. Não publique esta versão como HTML estático: autenticação e persistência dependem do servidor. As seis áreas continuam em `/app/inicio`, `/app/cd`, `/app/loja`, `/app/painel`, `/app/documentos` e `/app/backup`.

## Testes

`npm test` valida login, cookies, origem, rotas, autorização dos dados, gravações compartilhadas entre dois usuários, conflito de versões, lote atômico, dados inválidos, usuário somente leitura, paginação, falha de rede, preservação de dados antigos e recuperação de tentativas não confirmadas. As interfaces são executadas em JSDOM com o SDK real e transporte simulado.

`npm run test:operacao` preserva os nove testes da operação v45, agora aguardando a confirmação da nuvem: emissão com três lojas, QR real, impressão, lacres, conferência, câmera simulada e backup.

`tests/database-cloud.sql` foi executado no Supabase real: verifica RLS, isolamento entre workspaces, escrita/leitura, revisão de versões, rollback de lote com conflito e bloqueio de usuário não provisionado ou somente leitura. Todos os registros de teste são removidos pelo rollback.

O advisor não apontou novos problemas nas tabelas. Permanece o aviso Auth pré-existente de [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
