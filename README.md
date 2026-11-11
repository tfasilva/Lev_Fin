# LevFin com XAMPP ou GitHub Pages

A página funciona por padrão em modo local, usando o IndexedDB do navegador. O servidor PHP/MySQL permanece apenas como código opcional para instalações futuras.

No modo local, os dados ficam neste navegador e dispositivo. Para não perder informações ao trocar de computador ou limpar os dados do site, use regularmente os botões **Baixar Backup JSON** e **Restaurar Backup JSON**.

Cada navegador mantém seu próprio rascunho, nomes de empresas e histórico. Um navegador ou computador novo começa vazio; o mesmo navegador preserva os dados criados nele. Para guardar ou transportar um levantamento, use **Salvar PDF** ou **Exportar Excel**.

## Requisitos

- XAMPP com Apache e MySQL/MariaDB ativos (Apache na porta 80 e MySQL na 3306)
- PHP com `PDO` e `pdo_mysql` habilitados

## Uso no GitHub Pages

Publique `index.html`, `app.js`, `styles.css` e `por.traineddata` no GitHub Pages. A aplicação inicia diretamente em **Somente Neste Navegador (Offline / Sem servidor)**.

O GitHub Pages não executa PHP nem fornece MySQL. Para usar a mesma senha e os mesmos dados em computadores diferentes, mantenha a API PHP/MySQL publicada em um servidor HTTPS e informe a URL da API nas configurações. O GitHub Pages sozinho continua limitado ao banco local de cada navegador.

## Configuração local com XAMPP

O banco `levfin`, as tabelas `reports` e `settings`, o usuário `levfin_app` e o `.env` são usados pelo MySQL local do XAMPP. A senha do usuário deve permanecer no `.env`, fora da pasta pública do Apache.

O ponto de entrada Apache em `C:\xampp\htdocs\levfin-api.php` carrega a API em `C:\xampp\levfin\api.php`. A pasta `C:\xampp\levfin` fica fora da raiz pública do Apache e contém o `.env` privado.

Abra `index.html` com o Live Server do VS Code (`http://127.0.0.1:5500`). A página envia as chamadas à API PHP do Apache em `http://127.0.0.1/levfin-api.php`. Para validar a conexão, acesse essa URL com `?path=%2Fhealth`; a resposta esperada é `{"ok":true,"database":"mysql"}`.

Se atualizar `api.php` ou `.env` no projeto, execute `deploy-xampp.ps1` para copiar as versões atuais para a pasta privada do XAMPP e atualizar o ponto de entrada.

O reconhecimento de texto usa o arquivo local `por.traineddata`, que deve permanecer na mesma pasta de `index.html`. A leitura faz uma segunda tentativa quando faltam campos. A biblioteca principal do OCR ainda vem da CDN, portanto é necessária conexão com a internet.

Ao importar um print com vencimentos reconhecidos, as datas inicial e final do levantamento são preenchidas automaticamente pelo menor e maior vencimento encontrados. Prints adicionais ampliam o intervalo sem remover lançamentos já existentes.

## Segurança

O usuário MySQL `levfin_app` tem somente permissões de leitura e gravação no banco `levfin`. A API aceita chamadas do Live Server local configuradas em `WEB_ORIGIN`. Para acesso pela rede, defina `API_TOKEN` com pelo menos 24 caracteres, ajuste `WEB_ORIGIN` e proteja o Apache com HTTPS e firewall. Nunca publique `.env` ou tokens no GitHub Pages.

Para a proteção combinada entre computadores, a API cria a senha do servidor no primeiro acesso e armazena somente um hash usando `password_hash`. Depois do login, o navegador usa um token de sessão derivado no servidor; a senha não é enviada nas consultas de relatórios. Configure `AUTH_SECRET` no `.env` com um segredo longo e privado (ou mantenha `API_TOKEN` configurado para que ele seja usado como segredo de fallback). A proteção da interface não substitui HTTPS, controle de acesso ao servidor ou criptografia do disco: alguém com acesso técnico ao perfil do navegador ainda pode inspecionar o IndexedDB local.
