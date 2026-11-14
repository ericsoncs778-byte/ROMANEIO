# ROMANEIO V48 — revisão antes da publicação

Data: 14/11/2026

## Resultado

Código da V48 preparado e verificado. Publicação pendente: a revisão automática bloqueou o envio ao repositório público ericsoncs778-byte/ROMANEIO e exige autorização explícita para esse destino. O aplicativo online continua no commit 43400ba92f7a2c542f08610bd6f24644f3b88cdb.

## Ajustes prontos

- Relatório PDF executivo com filtros de período/loja, indicadores, etapas, comparativo por loja, rastreabilidade e responsáveis. Bibliotecas PDF locais e licenças incluídas.
- Caixinha e relatório de tempo de descarga: chegada registrada na Loja até finalizar a conferência/liberar o veículo. Horários ausentes ou invertidos não entram como zero nas médias.
- Atualização automática de dados a cada 30 minutos, preservando formulários e recebimentos ativos.
- Falha temporária ao validar sessão oferece nova tentativa e mantém a edição, ocultando o conteúdo protegido até a revalidação.
- Login normaliza espaços e maiúsculas. O endereço cd.@hiperideal.com.br recebe orientação para usar cd@hiperideal.com.br.

## Contas reais verificadas no banco

| Conta | Perfil | Ativa e confirmada | Lojas visíveis | Pode salvar |
| --- | --- | --- | --- | --- |
| cd@hiperideal.com.br | admin | Sim | 36 | Sim |
| loja@hiperideal.com.br | admin | Sim | 36 | Sim |
| ericson.silva@hiperideal.com.br | admin | Sim | 36 | Sim |

As três contas pertencem ao mesmo workspace e enxergam a mesma carga existente. Não foi necessário alterar permissões nem senhas. O endereço cd.@hiperideal.com.br não corresponde a uma conta cadastrada.

## Verificação executada

- 21 testes automatizados aprovados: login/sessão, seis rotas protegidas, mesma interface por conta em autenticação simulada, autorização, gravação compartilhada, conflitos, validação de importação, paginação, atualização de 30 minutos, PDF/filtros e recuperação de conexão.
- 9 cenários operacionais aprovados: emissão em três lojas, QR Code gerado/decodificado, impressão, ordem das entregas, câmera simulada, recebimento, retornáveis/lacres, rejeição de códigos incorretos e backup/importação.
- Teste transacional no banco real: gravação, controle de versão, conflito atômico e isolamento por workspace. Alterações de teste revertidas; zero cargas ou workspaces de teste remanescentes.
- Consulta sob o papel authenticated e o identificador de cada conta: perfis e visibilidade equivalentes.
- npm audit das dependências de produção: zero vulnerabilidades reportadas.
- Verificação de sintaxe e git diff --check aprovados.

## Limites e observações

As senhas reais das três contas não foram testadas. A simulação de autenticação não substitui a entrada de cada titular no ambiente publicado. Não foram redefinidas senhas nem compartilhadas credenciais.

O navegador Chromium foi impedido de iniciar por restrição do ambiente. Os testes da interface usaram DOM simulado; a avaliação visual final em celular e computador reais continua pendente.

Os assessores do Supabase informam proteção contra senhas vazadas desativada e uma tabela privada report_config com RLS sem políticas. Não foi aberta a tabela privada nem alterado esse controle. As tabelas operacionais mantêm RLS e políticas de associação ao workspace.

## Destino identificado

- Repositório público existente: https://github.com/ericsoncs778-byte/ROMANEIO
- Aplicativo: https://romaneio-digital-five.vercel.app/login
- Projeto de hospedagem: romaneio-digital, equipe ericson-hi.
- Banco exclusivo do ROMANEIO: ddhirpnnuyflxnwszuqp.

O repositório foi confirmado como pertencente ao usuário GitHub conectado e é o mesmo indicado pela implantação atual. Ainda assim, o controle automático não autorizou o envio público; é necessário o consentimento explícito do usuário para esse destino.
