# Guia rápido — novidades no PCP (produção)

Olá! Fizemos alguns ajustes no sistema para facilitar o dia a dia na fábrica.
Este guia explica, de forma simples, **o que mudou** e **o que você precisa
fazer** em cada caso. Nada aqui é complicado — a maioria é automático.

---

## 1. Máquinas desligadas somem das telas

**O que mudou:** as máquinas que você marcou como **inativas** não aparecem mais
poluindo as telas.

- Na tela **Centros de Produção**, agora aparecem só as máquinas **ativas**.
  - Precisa ver as desligadas (para religar ou conferir)? É só ligar a
    chavinha **"Mostrar inativos"** lá no canto de cima.
- No **Gantt** (o quadro de barras da produção), também não aparecem mais as
  máquinas inativas nem as que estão "fora da programação".

**O que você faz:** nada. Já está automático. Se alguma máquina ainda aparecer
no Gantt e você acha que não devia, é porque ela está marcada como **Ativa** e
**Disponível na Programação** no cadastro. Para tirar do quadro:

1. Vá em **PCP → Cadastros → Centros de Produção**.
2. Abra a máquina (lápis de editar).
3. Desmarque **"Disponível na Programação"** (ou desligue a máquina no botão de
   ligar/desligar) e salve.

---

## 2. Desmembrar um serviço informando QUANTIDADE e TIRAGEM juntas

**O problema de antes:** quando você dividia um serviço entre duas máquinas, só
dava para dividir por **uma** coisa — ou a quantidade (peças), ou a tiragem
(folhas). Se cada parte tinha quantidade **e** tiragem diferentes, o sistema não
deixava.

**O que mudou:** agora tem uma terceira opção no desmembrar.

**Como usar:**

1. No painel de **Programação**, clique no ícone de desmembrar (a tesourinha) na
   linha do serviço.
2. No topo do quadrinho, escolha a opção **"Qtd + Tiragem"**.
3. Para cada parte (cada máquina), preencha **os dois campos**: a **Quantidade
   (peças)** e a **Tiragem (folhas)**.
4. Embaixo aparecem **dois totais**. Quando os dois ficarem **verdes** (bateram
   com o total), o botão **"Desmembrar"** libera. Clique e pronto.

As duas opções antigas ("Por Quantidade" e "Por Tiragem") continuam iguais,
para quando você quiser dividir por uma coisa só.

---

## 3. Máquina "rodando a noite toda" — agora o tempo não infla mais

**O problema de antes:** se o operador começava um serviço e ia embora sem
pausar no fim do turno, o sistema continuava **contando o tempo a noite inteira**.
No dia seguinte parecia que a máquina tinha ficado horas e horas "trabalhando" ou
"parada" de madrugada, bagunçando os números.

**O que mudou:** agora o sistema **só conta o tempo dentro do horário de turno**
da máquina. O que acontece fora do turno (de madrugada, por exemplo) **não é mais
contado**. Quando o operador volta no dia seguinte, o tempo volta a contar
normalmente a partir do início do turno.

**O que você faz:** para funcionar, a máquina precisa ter um **Turno cadastrado**
(com hora de início e hora de fim). Confira assim:

1. Vá em **PCP → Cadastros → Centros de Produção**.
2. Abra a máquina (lápis de editar).
3. No campo **"Turno Operacional"**, escolha o turno dela (ex.: 07:00–17:00).
   Se não tiver o turno na lista, cadastre em **Cadastros → Turnos**.
4. Salve.

> Máquina **sem turno** continua contando o tempo corrido (como era antes). Se
> quiser que ela pare de contar de madrugada, é só colocar o turno dela.

---

## 4. Contador de máquina que "vira o dia" — não soma mais errado

**O problema de antes (o caso que você mostrou):** um serviço começa num dia e
termina no outro. Suponha que a máquina fechou o dia com o contador em **10.000**.
No dia seguinte, ela roda mais 10.000 e o contador vai pra **20.000**. Na hora de
apontar, o campo **"Leitura inicial" vinha zerado (0)**, então o sistema calculava
20.000 − 0 = **20.000** naquele dia. Somando com os 10.000 do dia anterior, dava
**30.000** — errado! O certo é **20.000** no total.

**O que mudou:** agora o campo **"Leitura inicial"** no apontamento do operador
pode ser **digitado/corrigido**. O sistema já sugere o número certo (a última
leitura do dia anterior), e você só confirma — ou ajusta se precisar.

**Como usar (no terminal, ao apontar produção):**

1. Abra o apontamento de **Produção** da máquina de contador.
2. O campo **"Leitura inicial"** já vem preenchido com a sugestão. Se aparecer o
   aviso *"Sugerida a partir da última leitura... Ajuste se o contador continuou
   de ontem"*, confira:
   - Se a máquina **continuou de onde parou** (ex.: estava em 10.000), deixe o
     **10.000** ali.
   - Se por algum motivo o número estiver errado, **corrija na mão**.
3. Preencha a **"Leitura final"** (o número que está no display agora, ex.:
   20.000).
4. O sistema mostra a **quantidade calculada** (20.000 − 10.000 = 10.000).
   Confirme.

> Também dá para o supervisor corrigir depois, pelo computador, em
> **PCP → Contagem por Contador → (máquina) → Histórico**, clicando no lápis da
> leitura.

### ⚠️ Importante — ajuste único que você precisa fazer uma vez

Para o contador **continuar de ontem automaticamente** (sem precisar corrigir
toda vez), as máquinas de contador precisam estar com a opção **"Zera
diariamente" DESMARCADA**. Isso porque o contador de vocês **não zera sozinho à
meia-noite** — ele é acumulativo.

Como conferir (uma vez por máquina):

1. Vá em **PCP → Cadastros → Centros de Produção**.
2. Abra a máquina de contador (lápis de editar).
3. Em **"Contagem"**, veja a opção **"Contador zera diariamente"**:
   - Se o contador da máquina **continua acumulando** de um dia pro outro
     (não volta a zero sozinho), deixe **DESMARCADO**.
   - Só marque se a máquina **realmente** zera o display todo dia.
4. Salve.

Com isso desmarcado, no dia seguinte a "Leitura inicial" já vem com o número
certo do dia anterior, e a conta fecha sozinha.

---

## Resumo de "o que preciso fazer"

| Novidade | Precisa fazer algo? |
|---|---|
| Máquinas inativas somem das telas | Nada (automático). Só desmarcar "Disponível na Programação" se quiser tirar alguma do Gantt. |
| Desmembrar com Qtd + Tiragem | Usar a nova opção "Qtd + Tiragem" quando precisar. |
| Não contar tempo de madrugada | Garantir que a máquina tenha um **Turno** cadastrado. |
| Contador que vira o dia | Deixar **"Zera diariamente" DESMARCADO** nas máquinas de contador (uma vez). No apontamento, conferir a "Leitura inicial". |

Qualquer dúvida é só chamar. 👍
