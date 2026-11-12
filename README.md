# ROMANEIO Digital · Hiperideal

Aplicativo web v46, com a operação da versão Android v45 e login pelo Supabase
**ddhirpnnuyflxnwszuqp**. O repositório continha apenas um README; a interface foi
recuperada de `ROMANEIO_HIPERIDEAL_V45_ANDROID_PROJETO_E_GUIA.zip`.

## Executar

Requer Node.js 24.

```bash
npm ci
npm test
npm run test:operacao
npm run dev
```

Abra `http://localhost:3000/login`. A URL e a chave **publishable** do projeto
estão em `server/config.mjs`. Não é necessária uma senha de banco nem uma chave
`service_role`. Não adicione essas credenciais ao código ou ao navegador.

## Primeiro acesso

O projeto estava ativo e sem usuários quando esta integração foi preparada.
O provedor de e-mail está habilitado e exige confirmação de e-mail. A conta de
acesso ao painel Supabase e os usuários do aplicativo são cadastros separados.

1. No [Supabase Auth — Users](https://supabase.com/dashboard/project/ddhirpnnuyflxnwszuqp/auth/users),
   o administrador deve usar **Add user → Create new user**, informar o e-mail do
   operador e uma senha individual. Confirmar a identidade/e-mail do operador
   antes de habilitar **Auto Confirm User**.
2. Entrar no aplicativo com esse e-mail e essa senha. Nenhum usuário ou senha
   foi criado automaticamente ou incluído neste repositório.
3. Para recuperação de acesso, o administrador gerencia o usuário em Auth.
   Esta versão não inclui cadastro público, convites nem recuperação por e-mail
   na interface; portanto não depende de URLs de redirecionamento por e-mail.

O cadastro por API permanece conforme a configuração existente do Supabase
(`disable_signup=false`). Não confundir ausência de botão de cadastro com
cadastro fechado. O controle desta versão é por usuário autenticado com e-mail
confirmado: **todas as seis áreas são acessíveis a qualquer conta assim
autenticada**. Não há aprovação adicional, restrição por loja ou diferença
de permissões CD/loja/gestor. Para fechar novos cadastros, o administrador pode
desativar **Allow new users to sign up** em Auth → Sign In / Providers.

## Rotas

| Rota | Acesso |
| --- | --- |
| `/login` | Público; quem já está autenticado segue para o aplicativo |
| `/auth/login` | POST de e-mail/senha, somente da mesma origem |
| `/auth/logout` | POST para encerrar a sessão deste dispositivo |
| `/auth/session` | GET; 200 para sessão verificada, 401 sem sessão |
| `/app/inicio` | Visão geral, exige login |
| `/app/cd` | Emissão, exige login |
| `/app/loja` | Recebimento, exige login |
| `/app/painel` | Gestão, exige login |
| `/app/documentos` | Impressões, exige login |
| `/app/backup` | Backup, exige login |

O HTML operacional fica em `private/`, fora da pasta pública, e só é enviado
após `auth.getUser()` consultar o Supabase Auth no servidor. Links diretos
sem sessão redirecionam ao login e retornam à área desejada após a entrada.
Redirecionamentos pós-login são limitados às seis rotas acima.

Cookies são HttpOnly e SameSite=Lax; em HTTPS/Vercel usam Secure. O SDK renova
sessões e propaga os cookies atualizados. O navegador revalida ao retornar à
aba, ao voltar no histórico e a cada minuto; logout também avisa outras abas.
Respostas autenticadas não podem ser armazenadas pelo navegador nem pela CDN.
Falhas do Auth bloqueiam o acesso. A aplicação não usa metadados editáveis pelo
usuário para conceder privilégios.

## Dados operacionais e RLS

Esta alteração integra **autenticação e rotas protegidas**. As cargas, notas,
paletes e backups continuam no armazenamento local do navegador, sem
sincronização entre dispositivos. Cada conta usa uma chave local diferente;
isso evita misturar registros na interface, mas não substitui controle de
acesso no banco nem criptografa os dados no aparelho. Não use um dispositivo
compartilhado sem proteger o próprio perfil do navegador.

As chaves antigas da v45 são preservadas, sem importação automática para a
primeira conta que entrar. Exporte um backup na versão anterior e importe-o
na conta correta quando necessário.

A tabela existente `public.profiles` foi verificada: RLS habilitada, três
políticas para o próprio usuário e nenhum SELECT para `anon`. Não foi alterada
a estrutura do banco. A consulta de segurança do Supabase não apresentou
alertas. Futuras tabelas operacionais precisarão de suas próprias políticas
por loja/perfil, além deste login.

## Hospedagem

`vercel.json` prepara uma única função Node.js, com rewrites para as rotas do
aplicativo e arquivos estáticos em `public/`. Não hospede esta versão como HTML
estático nem mova `private/romaneio.html` para `public/`: a validação depende
do servidor. Um deploy não foi executado nesta alteração.

## Validação

`npm test` verifica a integração real do SDK com transporte Auth simulado:
login, cookies, acesso direto sem sessão, rejeição de cookie adulterado,
renovação de sessão, isolamento de requisições entre usuários, logout, origem,
redirecionamentos e falha do Auth. Não cria contas no Supabase real.

`npm run test:operacao` executa os nove testes de operação da v45 adaptados à
estrutura web: emissão com três lojas, QR, impressão, recebimento, lacres,
conferência, câmera simulada e backup. A conexão real foi verificada pelo
endpoint de configurações Auth e por consultas de RLS. O primeiro login real
deve ser validado após o administrador cadastrar um usuário.
