# Painel do Davi: app para o celular

App web instalável (PWA) com as mesmas seções do painel:

- **Agenda:** próximos 7 dias do Google Agenda, convites sem resposta e link do Meet.
- **Literatura:** artigos novos no PubMed nos 4 temas do projeto de doutorado, com marca de "novo" desde a última visita.
- **Congressos:** travel awards de 2027, com prazo, valor, data e local, e filtros.
- **Início:** um resumo de tudo, mais os prazos dos próximos 60 dias.

Ele funciona sem internet, mostrando os últimos dados salvos, e avisa quando há uma versão nova.

## 1. Publicar no GitHub Pages (grátis, cerca de 5 min)

1. Entre em github.com e crie um repositório **público** chamado `painel`.
2. Clique em **Add file → Upload files** e arraste **todo o conteúdo** desta pasta: `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest` e as pastas `data` e `icons`. Depois clique em **Commit changes**.
3. Vá em **Settings → Pages**. Em *Source*, escolha **Deploy from a branch**, depois `main` e `/ (root)`, e salve.
4. Em 1 ou 2 minutos o app estará em `https://SEU-USUARIO.github.io/painel/`.

O repositório é público, mas só a lista de congressos e os temas de busca ficam nele. Seus eventos da agenda nunca saem do seu celular.

## 2. Configurar o login do Google (cerca de 10 min, uma vez só)

1. Abra console.cloud.google.com e crie um projeto (por exemplo, "Painel").
2. Em **APIs e serviços → Biblioteca**, procure **Google Calendar API** e clique em **Ativar**.
3. Em **Google Auth Platform**, ou "Tela de consentimento OAuth":
   - **Branding:** preencha o nome do app e o seu e-mail.
   - **Público:** escolha *Externo*, deixe em modo **Teste** e adicione como usuário de teste o e-mail da conta onde fica sua agenda.
   - **Acesso a dados:** adicione o escopo `.../auth/calendar.events.readonly`.
4. Em **Clientes → Criar cliente**, escolha o tipo **Aplicativo da Web**. Em *Origens JavaScript autorizadas*, coloque `https://SEU-USUARIO.github.io`, sem `/painel` e sem barra no final. Clique em Criar e copie o **Client ID**.
5. Abra o app, vá em **Ajustes**, cole o Client ID e toque em **Conectar Google Agenda**.

O Google vai mostrar um aviso de "app não verificado". Isso é normal para apps em modo de teste: clique em *Continuar*.

Por segurança, o acesso do Google dura cerca de 1 hora. Depois disso, a agenda mostra os últimos dados salvos e um botão **Reconectar**, que basta um toque.

## 3. Instalar no celular

- **Android (Chrome):** abra o link, toque no menu ⋮ e depois em **Instalar app**.
- **iPhone (Safari):** abra o link, toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.

## 4. Como o app se atualiza

| O quê | Como atualiza |
|---|---|
| Agenda | Sozinha, a cada 5 minutos com o app aberto, e ao voltar para o app |
| PubMed | Sozinho, a cada hora |
| Congressos | Sempre que o app abre, lendo `data/congressos.json` |
| Temas do PubMed | Editando `data/temas.json` |
| O próprio app | Mude `VERSION` em `sw.js` e envie os arquivos de novo. O app mostra "Nova versão disponível". |

Para mudar um congresso, abra `data/congressos.json` no GitHub, clique no lápis, edite e salve. As datas ficam no formato `AAAA-MM-DD`; use `null` quando o prazo ainda não saiu. O app pega a mudança na próxima vez que abrir.
