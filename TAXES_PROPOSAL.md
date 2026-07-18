# Proposta: secció "Taxes" — assistent fiscal per a inversors

*Proposta de projecte, 2026-07-18. Decisions preses amb l'usuari: abast ES = informe amb caselles + avisos avançats; dades = portfolio existent + Excel extra; accés públic amb trial; multi-país amb selector i EUA bàsic a la v1.*

## 1. Què és

Una nova secció del web (nav: **Dashboard · Construir portfolio · Explorar empreses · Anàlisis · Forecast · Taxes**) que converteix les operacions d'un inversor en un **informe fiscal guiat**, a l'estil TurboTax/Intuit: un wizard d'una pregunta per pantalla que acaba en una llista de "posa X € a la casella Y" de la Renda, amb avisos dels casos especials que la gent no coneix.

**No és assessorament fiscal** (disclaimer fort a cada pantalla i a l'informe): és una calculadora informativa que simplifica omplir Renta Web. No generem fitxers oficials ni esborranys — decisió expressa per evitar complexitat i risc regulatori.

## 2. Experiència d'usuari (el wizard)

Ruta pública `/taxes`. Stepper amb progrés, llenguatge planer, tot reversible:

1. **País** — selector (🇪🇸 Espanya actiu, 🇺🇸 EUA actiu-bàsic, altres "properament"). Arquitectura multi-país des del dia 1.
2. **Any fiscal** — p. ex. Renda 2025 (presentada el 2026). El motor porta un mapa de caselles/trams *per any*.
3. **Font de dades** — tres camins:
   - *El meu portfolio TrimmTrack* (loguejat): parteix de les transaccions/dividends/interessos ja al DB. Zero fricció.
   - *Pujar un Excel* (informe fiscal del broker): reutilitza `excel-parser`; si el format no es reconeix, un mini-assistent de mapeig de columnes (data, ticker, tipus, imports, retenció).
   - *Trial anònim* (sessionStorage, patró `trial.ts`): res es desa; banner "registra't per guardar l'informe per anys".
4. **Revisió de dades** — taula del que hem detectat (vendes, dividends, retencions, interessos) amb possibilitat de corregir/excloure files.
5. **Preguntes guiades** (només les rellevants segons les dades): tens comptes/valors a l'estranger per sobre de 50.000 €? has recomprat valors venuts amb pèrdues en <2 mesos (ho detectem i t'ho ensenyem)? tens pèrdues d'anys anteriors per compensar?
6. **Informe final** — targetes "Casella → import" agrupades per apartat de Renta Web, desglossament per operació (FIFO), avisos, i checklist imprimible. Desa't per `(usuari, país, any)` si estàs loguejat.

## 3. Càlculs — Espanya (IRPF), el gruix de la v1

Motor pur a `src/lib/tax/es.ts` (funcions pures + vitest, mateix patró que `forecast.ts`/`dcf.ts`):

- **Guanys/pèrdues patrimonials FIFO** per transmissió (reutilitza la lògica de `FifoCalculator`/`fifo` existent), en EUR (el llibre ja és EUR).
- **Rendiments del capital mobiliari**: dividends + interessos, retencions espanyoles ja practicades.
- **Integració i compensació** dins la base de l'estalvi: pèrdues vs guanys, límit del 25 % contra rendiments del capital mobiliari, arrossegament 4 anys (input manual de saldos pendents).
- **Doble imposició internacional**: retenció estrangera per dividend (el conveni habitual limita el deduïble al 15 % — connecta amb [[reference_yahoo_filing_vs_quote_currency]] per monedes), càlcul de la deducció i avís si el broker ha retingut de més (p. ex. 30 % US sense W-8BEN).
- **Trams de l'estalvi** de l'any triat per estimar la quota (informatiu).
- **Avisos avançats** (l'opció 2 triada):
  - *Regla dels 2 mesos* (antiaplicació de pèrdues amb valors homogenis) — detecció automàtica sobre les dates de compra/venda.
  - *Model 720* (béns a l'estranger > 50.000 €) i *Model 721* (cripto a l'estranger) — avís de si probablement toca, mai el formulari.
  - Cripto: mateixos guanys FIFO; avís del règim específic.
  - Els números de casella i llindars canvien cada any → viuen en un fitxer de configuració per exercici (`tax/es-2025.ts`…), mai hardcodejats al motor. Verificar contra Renta Web vigent abans de publicar cada exercici.

## 4. Càlculs — EUA (bàsic, v1)

`src/lib/tax/us.ts`: separació **short-term vs long-term** (>1 any), detecció **wash sale** bàsica (recompra ±30 dies d'una venda amb pèrdua), resum agregat amb l'estructura de **Form 8949 / Schedule D** (proceeds, cost basis, gain/loss per categoria) i total de dividends. Sense estats, sense qualified/ordinary split, sense casos exòtics — està etiquetat com a *beta*.

## 5. Arquitectura tècnica (restriccions dures del repo)

- **Cap ruta API nova.** L'API és exactament al límit de 12 funcions del pla Hobby. La v1 és càlcul 100 % client-side; la persistència de l'informe es plega dins una ruta existent via query-param (patró ja usat: `fundamentals-get?research=`), reutilitzant el patró JSONB de `scenarios` amb clau `tax:{country}:{year}`.
- **Motor per país amb registre**: `src/lib/tax/types.ts` (tipus comuns: `TaxInput`, `TaxReport`, `Warning`), `tax/index.ts` (registre `{ es: …, us: … }`), un mòdul per país. Afegir un país = un mòdul + un locale de contingut, sense tocar el wizard.
- **SEO** (seguir el contracte existent): `useSeo` amb claus `seo.taxes*`, entrada al sitemap amb les 3 variants d'idioma + hreflang, ruta afegida a `prerender.mjs` **i** a `gen-sitemap.mjs` alhora (contracte prerender↔sitemap, veure memòria trimmtrack-prerender). Landing amb copy indexable ("calculadora IRPF acciones y dividendos") + FAQ amb FAQPage JSON-LD, com `/calculadora-fifo`.
- **i18n**: blocs `taxes.*` amb paritat ca/es/en. El contingut fiscal ES es redacta en castellà primer (és el mercat objectiu del SEO) i es tradueix.
- **Privacitat**: al trial res surt del navegador; loguejat, les dades ja viuen a Neon com la resta del portfolio. Cap dada fiscal a URLs.

## 6. Fases

| Fase | Contingut | Resultat |
|---|---|---|
| **1 — MVP ES** | Wizard + motor FIFO fiscal ES + informe amb caselles, 3 fonts de dades, trial públic, disclaimer | Es pot fer servir per la Renda real |
| **2 — Avisos avançats** | Regla 2 mesos, 720/721, doble imposició amb límits, compensacions arrossegades, desar informe per any | Diferenciació real vs una calculadora simple |
| **3 — EUA + selector** | `tax/us.ts` (short/long, wash sales, 8949 summary), selector país complet | Prova que l'arquitectura és multi-país |
| **4 — Creixement** | Export PDF de l'informe, més països (PT/FR/DE), prefill de l'any següent | Retenció anual (la gent torna cada primavera) |

## 7. Per què encaixa amb TrimmTrack

- Reutilitza el 60 % del que ja hi ha: parser d'Excel, FIFO, llibre EUR, patró trial, patró SEO de pàgines públiques.
- És l'eina amb més potencial SEO estacional del web ("calculadora IRPF acciones" cada abril–juny) i un motiu de registre fort (guardar l'informe per anys).
- Tanca el cercle del producte: *construeix* el portfolio → *segueix-lo* → *analitza'l* → **declara'l**.
