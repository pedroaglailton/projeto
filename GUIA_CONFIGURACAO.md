# 📚 Guia Completo — API Bot Telegram

## 🎯 O que é isso?

Você tem um sistema de coleta de dados (Preventiva-CE). Seu amigo tem um bot no Telegram. Você quer enviar os dados coletados para o bot dele.

**Como funciona:**
1. Você cria uma chave de acesso (API Key)
2. Você envia a chave + URL para o amigo
3. O amigo usa a chave para acessar seus dados
4. Os dados aparecem no bot dele

---

## 📋 Passo a Passo

### PASSO 1: Gerar sua Chave de Acesso

A chave é como uma "senha" que protege sua API. Pode ser qualquer texto seguro.

**Exemplos de chaves:**
```
preventiva-2026-abc123
meu-bot-seguro-2026-xyz
pc-bot-8f4a2b1c9d7e
```

**Regras:**
- Mínimo 16 caracteres (recomendado)
- Misture letras e números
- Não use spaces (espaços)

---

### PASSO 2: Configurar no Render

1. Acesse o painel do Render: https://dashboard.render.com
2. Clique no seu serviço (Preventiva-CE)
3. Vá em **Environment** (ou Variáveis de Ambiente)
4. Clique em **Add Environment Variable**
5. Adicione:
   - **Key**: `BOT_API_KEY`
   - **Value**: `sua-chave-aqui`
6. Clique em **Save Changes**

**Exemplo:**
```
BOT_API_KEY = preventiva-2026-abc123xyz
```

⚠️ **IMPORTANTE**: O serviço vai reiniciar automaticamente após salvar.

---

### PASSO 3: Enviar para o Amigo

Copie e cole esta mensagem para o amigo:

```
Olá! Aqui estão os dados para acessar a API da Preventiva-CE:

URL Base: https://projeto-ujbr.onrender.com

Sua Chave de Acesso:
preventiva-2026-abc123xyz

Endpoints Disponíveis:

1. Listar Pontos
GET https://projeto-ujbr.onrender.com/api/bot/pontos
Exemplo: .../pontos?data=2026-06-26

2. Detalhes de um Ponto
GET https://projeto-ujbr.onrender.com/api/bot/pontos/123
(substitua 123 pelo ID do ponto)

3. Resumo do Dia
GET https://projeto-ujbr.onrender.com/api/bot/resumo
Exemplo: .../resumo?data=2026-06-26

4. Lista de Equipes
GET https://projeto-ujbr.onrender.com/api/bot/equipes
Exemplo: .../equipes?data=2026-06-26

Como usar a chave:
Header: X-Bot-API-Key: preventiva-2026-abc123xyz

Precisa de ajuda? Me avisa!
```

**⚠️ ATENÇÃO**: Troque `preventiva-2026-abc123xyz` pela chave que você gerou!

---

### PASSO 4: O que o Amigo Faz

O amigo vai usar a chave no código dele. Exemplo:

**JavaScript:**
```javascript
const response = await fetch('https://projeto-ujbr.onrender.com/api/bot/pontos', {
  headers: {
    'X-Bot-API-Key': 'preventiva-2026-abc123xyz'
  }
});
const dados = await response.json();
```

**Python:**
```python
import requests

response = requests.get(
    'https://projeto-ujbr.onrender.com/api/bot/pontos',
    headers={'X-Bot-API-Key': 'preventiva-2026-abc123xyz'}
)
dados = response.json()
```

---

## 🔍 Testar se Está Funcionando

### Teste 1: Verificar se a API responde

Abra o navegador e acesse:
```
https://projeto-ujbr.onrender.com/api/bot/pontos
```

**Se funcionar**, vai aparecer:
```json
{"ok":false,"error":"API key invalida"}
```

**Se NÃO funcionar**, vai aparecer mensagem de erro.

---

### Teste 2: Testar com a chave

No navegador, acesse (substitua pela sua chave):
```
https://projeto-ujbr.onrender.com/api/bot/pontos?api_key=SUA_CHAVE
```

**Se funcionar**, vai retornar os pontos:
```json
{"ok":true,"data":"2026-06-26","total":5,"pontos":[...]}
```

---

## ❓ Perguntas Frequentes

### P: Escolho a chave ou o amigo escolhe?
**R:** Você escolhe! É sua API, sua chave.

### P: Preciso enviar o token do bot do Telegram?
**NÃO!** O token do bot é dele. Você só envia a API Key que você criou.

### P: E se eu quiser mudar a chave depois?
No Render, vá em Environment e altere o valor de `BOT_API_KEY`.

### P: O amigo pode acessar qualquer dado?
**NÃO!** Ele só acessa os endpoints que você criou (`/api/bot/*`). Não tem acesso aos dados internos.

### P: Preciso instalar algo?
**NÃO!** É só configurar no Render e enviar a chave para o amigo.

---

## 🛡️ Dicas de Segurança

1. **Nunca envie a chave por áudio ou vídeo** — sempre texto
2. **Não publique a chave na internet**
3. **Se suspeitar que vazou**, gere uma nova no Render
4. **Use chaves diferentes** para cada amigo/bot

---

## 📞 Problemas Comuns

| Problema | Solução |
|----------|---------|
| "API key invalida" | Verifique se digitou a chave corretamente |
| "BOT_API_KEY nao configurada" | Configure a variável no Render |
| Serviço não responde | Verifique se o Render está ativo |
| CORS error | Configure `CORS_ALLOW_ORIGIN` no Render |

---

## 📊 Resumo Final

| O que fazer | Onde | Quem |
|-------------|------|------|
| Gerar chave | Qualquer lugar | Você |
| Configurar no Render | Painel do Render | Você |
| Enviar chave + URL | WhatsApp/Telegram | Você |
| Usar a chave | Código do bot | Amigo |

---

## ✅ Checklist

- [ ] Gerar API Key segura
- [ ] Configurar `BOT_API_KEY` no Render
- [ ] Testar a API no navegador
- [ ] Enviar documentação + chave para o amigo
- [ ] Amigo testa a conexão
- [ ] Pronto! 🚀

---

**Dúvidas?** Me pergunte que ajudo!
