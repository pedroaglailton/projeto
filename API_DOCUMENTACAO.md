# API Preventiva-CE — Para Bot Telegram

## URL Base
```
https://projeto-ujbr.onrender.com
```

## Autenticação
Todas as requisições devem incluir o header:
```
X-Bot-API-Key: SUA_API_KEY_AQUI
```

Ou como query param: `?api_key=SUA_API_KEY_AQUI`

---

## Endpoints Disponíveis

### 1. Listar Pontos Coletados
```
GET /api/bot/pontos
```

**Parâmetros (query):**
- `data` (opcional): Data no formato YYYY-MM-DD (padrão: hoje)
- `equipe` (opcional): Filtrar por nome da equipe

**Exemplo:**
```bash
curl -H "X-Bot-API-Key: MINHA_KEY" \
  "https://projeto-ujbr.onrender.com/api/bot/pontos?data=2026-06-26"
```

**Resposta:**
```json
{
  "ok": true,
  "data": "2026-06-26",
  "total": 5,
  "pontos": [
    {
      "id": 123,
      "ponto_numero": "125",
      "equipe_nome": "EQUIPE-01",
      "equipe_id": "eq01",
      "operador": "João",
      "lat": -3.7319,
      "lng": -38.5267,
      "endereco": "Rua Exemplo, 123",
      "cidade_nome": "FORTALEZA",
      "ais": "AIS01",
      "data_hora": "2026-06-26T14:30:00.000Z",
      "config_cameras": "4 cameras",
      "observacoes": "Sem observacoes",
      "poste": "OK",
      "caixa_hermetica": "OK",
      "nobreak": "OK",
      "switch_cftv": "OK",
      "onu": "OK",
      "radio_ap": "OK"
    }
  ]
}
```

---

### 2. Detalhes de um Ponto
```
GET /api/bot/pontos/:id
```

**Parâmetros:**
- `id`: ID do ponto (obrigatório)

**Exemplo:**
```bash
curl -H "X-Bot-API-Key: MINHA_KEY" \
  "https://projeto-ujbr.onrender.com/api/bot/pontos/123"
```

**Resposta:**
```json
{
  "ok": true,
  "ponto": {
    "id": 123,
    "ponto_numero": "125",
    "equipe_nome": "EQUIPE-01",
    "operador": "João",
    "lat": -3.7319,
    "lng": -38.5267,
    "endereco": "Rua Exemplo, 123",
    "cidade_nome": "FORTALEZA",
    "ais": "AIS01",
    "data_hora": "2026-06-26T14:30:00.000Z",
    "config_cameras": "4 cameras",
    "observacoes": "Poste torto",
    "poste": "OK",
    "poste_status": "Bom",
    "caixa_hermetica": "OK",
    "status_caixa_hermetica": "Bom",
    "nobreak": "OK",
    "switch_cftv": "OK",
    "onu": "OK",
    "radio_ap": "OK",
    "lpr01": "LPR-001",
    "lpr01_sentido": "NORTE",
    "tombo_cpu": "CPU-123",
    "tombo_bullet": "BUL-456"
  }
}
```

---

### 3. Resumo do Dia
```
GET /api/bot/resumo
```

**Parâmetros (query):**
- `data` (opcional): Data no formato YYYY-MM-DD (padrão: hoje)

**Exemplo:**
```bash
curl -H "X-Bot-API-Key: MINHA_KEY" \
  "https://projeto-ujbr.onrender.com/api/bot/resumo?data=2026-06-26"
```

**Resposta:**
```json
{
  "ok": true,
  "data": "2026-06-26",
  "total_geral": 15,
  "por_equipe": {
    "EQUIPE-01": {
      "total": 8,
      "pontos": [
        { "id": 123, "numero": "125", "hora": "2026-06-26T14:30:00.000Z" },
        { "id": 124, "numero": "126", "hora": "2026-06-26T15:00:00.000Z" }
      ]
    },
    "EQUIPE-02": {
      "total": 7,
      "pontos": [...]
    }
  }
}
```

---

### 4. Lista de Equipes
```
GET /api/bot/equipes
```

**Parâmetros (query):**
- `data` (opcional): Data no formato YYYY-MM-DD (padrão: hoje)

**Exemplo:**
```bash
curl -H "X-Bot-API-Key: MINHA_KEY" \
  "https://projeto-ujbr.onrender.com/api/bot/equipes?data=2026-06-26"
```

**Resposta:**
```json
{
  "ok": true,
  "data": "2026-06-26",
  "total_equipes": 3,
  "equipes": [
    {
      "equipe_id": "eq01",
      "equipe_nome": "EQUIPE-01",
      "total_pontos": 8
    },
    {
      "equipe_id": "eq02",
      "equipe_nome": "EQUIPE-02",
      "total_pontos": 7
    }
  ]
}
```

---

## Códigos de Erro

| Código | Significado |
|--------|-------------|
| 200 | Sucesso |
| 400 | Parâmetro inválido |
| 401 | API key inválida ou ausente |
| 404 | Recurso não encontrado |
| 500 | Erro interno do servidor |

---

## Notas Importantes

1. **Datas**: Use sempre o formato YYYY-MM-DD (ex: 2026-06-26)
2. **Fusário**: Todos os horários são BRT (UTC-3)
3. **Limite**: Máximo 1000 pontos por requisição
4. **Cache**: Dados atualizados em tempo real

---

## Exemplo em JavaScript (Node.js)

```javascript
const axios = require('axios');

const API_KEY = 'SUA_API_KEY';
const BASE_URL = 'https://projeto-ujbr.onrender.com';

async function buscarPontos(data) {
  const response = await axios.get(`${BASE_URL}/api/bot/pontos`, {
    headers: { 'X-Bot-API-Key': API_KEY },
    params: { data }
  });
  return response.data;
}

// Uso
const pontos = await buscarPontos('2026-06-26');
console.log(`Encontrados ${pontos.total} pontos`);
```

---

## Exemplo em Python

```python
import requests

API_KEY = 'SUA_API_KEY'
BASE_URL = 'https://projeto-ujbr.onrender.com'

def buscar_pontos(data):
    response = requests.get(
        f'{BASE_URL}/api/bot/pontos',
        headers={'X-Bot-API-Key': API_KEY},
        params={'data': data}
    )
    return response.json()

# Uso
pontos = buscar_pontos('2026-06-26')
print(f"Encontrados {pontos['total']} pontos")
```
