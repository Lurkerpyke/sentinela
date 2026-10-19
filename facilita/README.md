# Facilita

PWA para conferir produtos próximos do vencimento e gerar uma planilha Excel por sessão. A conferência e os itens são gravados no IndexedDB do aparelho. Quando Supabase estiver configurado e houver login/rede, as sessões finalizadas são sincronizadas; falhas deixam os dados locais para reenvio.

## Rodar no VS Code

Abra um terminal na pasta `facilita` e execute:

```sh
npm install
npm run dev
```

O Vite mostrará um endereço local. Nesta etapa, os códigos são digitados manualmente e validados. A leitura pela câmera ficará para uma etapa posterior.

## Testes

```sh
npm test
npm run build
npm run lint
```

## Ativar Supabase

1. No painel Supabase, abra **SQL Editor** e execute `supabase/migrations/202610050001_initial_schema.sql`.
2. Em **Authentication → Users**, crie a conta do administrador e a conta compartilhada da loja.
3. A migration cria novos perfis como `worker`. Para dar acesso administrativo, rode no SQL Editor, substituindo pelo e-mail real:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'admin@loja.com');
```

4. No terminal do VS Code, dentro de `facilita`, crie `.env.local` a partir de `.env.example` e preencha a URL do projeto e a chave **publishable/anon** do Supabase. Nunca use `service_role` no navegador ou em variável `VITE_`.
5. Reinicie `npm run dev`, entre pelo botão **Acesso**, e no painel cadastre os setores e os quatro repositores. Depois importe a base de produtos em Excel/CSV.

As credenciais não são necessárias para o fluxo local e não devem ser enviadas pelo chat.

## Publicação e atualizações

No Vercel, importe o repositório e configure **Root Directory** como `facilita`; o build é `npm run build` e a saída é `dist`. Cadastre as mesmas variáveis públicas de ambiente no projeto Vercel. Use o domínio HTTPS da publicação para instalar o PWA no Android.

O service worker está configurado para autoatualizar o app publicado. Cada novo deploy do Vercel publica a versão; o navegador recebe a atualização quando verificar a conexão. O GitHub também verifica atualizações de dependências semanalmente em Pull Requests; revise testes e notas de versão antes de aceitar cada atualização.

## Teste manual offline

1. Inicie uma conferência, digite um código EAN-8, UPC-A ou EAN-13 e salve um item.
2. Finalize a sessão. O app baixa um `.xlsx` com `Código de barras`, `Descrição`, `Quantidade` e `Data de vencimento`, nessa ordem.
3. Feche e reabra o app; sessões em andamento podem ser retomadas e planilhas finalizadas podem ser baixadas ou compartilhadas novamente.
4. Abra o arquivo no Excel e confirme o código como texto e a validade como data `dd/mm/aaaa`.
5. Com conta e Supabase configurados, confira no painel que a sessão ficou sincronizada; sem eles, o Excel e os dados permanecem no aparelho para reenvio posterior.

## Dados de demonstração

A base local começa com quatro produtos fictícios para validar a busca. Produtos não encontrados podem ser identificados pelo nome e vão para a fila de revisão do painel. Substitua esses exemplos importando a base real antes do piloto.

## Ativar Supabase

1. No projeto Supabase, abra **SQL Editor** e execute `supabase/migrations/202610050001_initial_schema.sql`.
2. Em **Authentication → Users**, crie a conta administrativa e a conta compartilhada da loja.
3. O trigger cria novos perfis como `worker`. Para promover a conta administrativa, rode no SQL Editor, substituindo pelo e-mail real:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'admin@loja.com');
```

4. Crie `.env.local` a partir de `.env.example` e configure a URL e a chave publicável/anon do projeto. Nunca use `service_role` no navegador ou em uma variável `VITE_`.
5. Reinicie o app, abra **Acesso**, entre com a conta e cadastre setores/repositores no painel. Importe a base real pelo Excel ou CSV.

As senhas e chaves não devem ser enviadas pelo chat. Em Vercel, cadastre as mesmas variáveis nas configurações do projeto.

## Publicar e manter atualizado

No Vercel, importe o repositório, defina **Root Directory** como `facilita`, **Build Command** como `npm run build` e **Output Directory** como `dist`. O domínio HTTPS é necessário para instalar o PWA no Android.

O service worker está configurado com `autoUpdate`: cada deploy publica a versão nova, e o navegador a instala quando volta a verificar a conexão. O GitHub Dependabot abre Pull Requests semanais para as dependências do app; revise o changelog e rode `npm test`, `npm run build` e `npm run lint` antes de aceitar cada atualização.
