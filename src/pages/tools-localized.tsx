import { ToolPage, type ToolPageProps } from "@/components/tools/ToolPage";
import { LocaleLink } from "@/components/LocaleLink";
import {
  DcfCalculator,
  GrahamCalculator,
  MonteCarloCalculator,
  ReverseDcfCalculator,
} from "@/components/tools/calculators";
import { ALL_LOCALES, ROUTE_SLUGS, type Locale, type RouteId } from "@/lib/locale";

// Catalan and Spanish versions of the four valuation tool landings that had an
// English-only page (/en/dcf-calculator and friends). Each targets one search
// intent in its own language, with its own translated slug from ROUTE_SLUGS —
// a Spanish reader searches "calculadora DCF", not "dcf calculator".
//
// Only these four are localized. The other two English tool pages are
// deliberately NOT mirrored, because a ca/es version would compete with a page
// that already owns the intent:
//   • /en/portfolio-tracker  → the ca/es HOME page is the portfolio-tracker
//     landing (same promise: turn a broker Excel into a live dashboard).
//   • /en/etf-growth-calculator → /forecast already is the ETF projection tool
//     in all three languages, with the ETF guide attached.
// The FIFO page needed no new copy either: /calculadora-fifo already exists in
// ca/es and now simply hreflang-pairs with the English keyword URL.
//
// This file is the per-locale content source: which keys exist here IS the
// answer to "which translations are real". Adding a language to a tool means
// adding an entry — nothing else in the routing or the sitemap is hand-edited.

/** Everything a tool landing needs besides the calculator widget itself. */
type ToolCopy = Omit<ToolPageProps, "path" | "locale" | "alternates" | "tool">;

const TOOLS: Partial<Record<Locale, Partial<Record<RouteId, ToolCopy>>>> = {
  ca: {
    dcf: {
      appName: "Calculadora DCF de TrimmTrack",
      seoTitle: "Calculadora DCF gratuïta — valora qualsevol acció | TrimmTrack",
      seoDescription:
        "Calculadora de descompte de fluxos de caixa (DCF) gratuïta i sense registre. Introdueix el benefici per acció o el flux de caixa lliure, una taxa de creixement, un múltiple de sortida i la rendibilitat que exigeixes, i obtén el valor intrínsec i el potencial.",
      h1: "Calculadora DCF gratuïta",
      lead: "Calcula què val realment una acció. Introdueix unes poques hipòtesis i obtén un valor intrínsec, el potencial respecte del preu d'avui i la rendibilitat anual que el preu actual ja implica. Al navegador, sense compte i sense límit d'accions.",
      example: {
        title: "Exemple resolt",
        body: (
          <>
            <p>
              Imagina una empresa amb un benefici per acció previst de{" "}
              <strong>6,00 €</strong>. Esperes un creixement del <strong>10%</strong> anual durant{" "}
              <strong>10 anys</strong> i creus que cotitzarà a un PER de sortida de{" "}
              <strong>18×</strong>. L'any 10 el BPA serà 6 × 1,10<sup>10</sup> ≈{" "}
              <strong>15,56 €</strong>, és a dir un preu per acció de 15,56 × 18 ≈{" "}
              <strong>280 €</strong>.
            </p>
            <p className="mt-2">
              Descomptant aquest preu deu anys enrere a una rendibilitat exigida del{" "}
              <strong>10%</strong> obtens un valor raonable de 280 / 1,10<sup>10</sup> ≈{" "}
              <strong>108 €</strong>. Si l'acció cotitza avui a 150 €, el model diu que està un{" "}
              <strong>28% sobrevalorada</strong> per a l'objectiu que t'has posat: necessitaries més
              creixement o un múltiple més alt per justificar el preu.
            </p>
          </>
        ),
      },
      sections: [
        {
          title: "Què és un DCF i com funciona aquesta calculadora?",
          body: (
            <>
              <p>
                Un model de descompte de fluxos de caixa (DCF) valora un negoci projectant el que
                guanyarà o generarà en efectiu i portant aquelles quantitats futures al present,
                perquè un euro d'aquí a deu anys val menys que un euro avui. Aquesta calculadora fa
                servir una versió compacta per acció: capitalitza la mètrica de partida (BPA previst
                o flux de caixa lliure per acció) a la teva taxa de creixement, hi aplica un múltiple
                de sortida per obtenir un preu futur i descompta aquell preu a la rendibilitat que
                exigeixes.
              </p>
              <p>
                El resultat és un <strong>valor raonable</strong> — el màxim que pots pagar avui i
                encara obtenir la rendibilitat objectiu — juntament amb el potencial implícit i la
                TAE que aconseguiries realment comprant al preu actual.
              </p>
            </>
          ),
        },
        {
          title: "Quines dades pesen més en el resultat?",
          body: (
            <p>
              La taxa de creixement i el múltiple de sortida són les que mouen més el resultat i
              també les més difícils de saber: petites diferències es multipliquen al llarg de deu
              anys. Sigues prudent, fes servir un creixement que un negoci de qualitat pugui
              sostenir de veritat i un múltiple en línia amb competidors madurs, no amb l'eufòria
              actual. Quan no tinguis clar un número, prova el{" "}
              <LocaleLink className="text-brand-700 underline" to="/simulador-monte-carlo">
                simulador de Monte Carlo
              </LocaleLink>{" "}
              per veure un rang en lloc d'una falsa precisió, o el{" "}
              <LocaleLink className="text-brand-700 underline" to="/dcf-invers">
                DCF invers
              </LocaleLink>{" "}
              per saber quin creixement dóna per fet el preu.
            </p>
          ),
        },
      ],
      faqs: [
        {
          q: "Aquesta calculadora DCF és realment gratuïta?",
          a: "Sí. Funciona sencera al teu navegador, sense registre, sense mur de pagament i sense límit d'accions que pots valorar.",
        },
        {
          q: "Faig servir el BPA o el flux de caixa lliure?",
          a: "Tots dos funcionen: el model capitalitza la mètrica per acció que hi posis. El flux de caixa lliure per acció s'acosta més al que un DCF hauria de valorar, però el BPA previst és més fàcil de trobar i serveix per a una primera aproximació.",
        },
        {
          q: "Quina taxa de descompte hi he de posar?",
          a: "La rendibilitat anual que vols obtenir pel risc que assumeixes. Molts inversors a llarg termini fan servir entre el 8% i el 12%; com més alta, més conservador és el resultat i més baix el valor raonable.",
        },
        {
          q: "Per què el valor raonable depèn tant del múltiple de sortida?",
          a: "Perquè multiplica directament la mètrica de l'últim any. Passar de 15× a 25× canvia el preu final en dos terços. Ancora el múltiple a nivells sostenibles d'un negoci madur, no al múltiple d'avui.",
        },
      ],
      cta: {
        title: "Valora tota la cartera, no només una acció",
        body: "TrimmTrack executa aquest DCF (i el DCF invers, el número de Graham i Monte Carlo) sobre cada posició de la teva cartera, amb preus en directe.",
        primaryTo: "/upload",
        primaryLabel: "Puja la teva cartera",
        secondaryTo: "/explore",
        secondaryLabel: "Prova-ho amb qualsevol acció",
      },
    },
    reverseDcf: {
      appName: "Calculadora de DCF invers de TrimmTrack",
      seoTitle: "DCF invers — quin creixement descompta el preu? | TrimmTrack",
      seoDescription:
        "Calculadora de DCF invers gratuïta. Introdueix el preu actual, el BPA, el múltiple de sortida i la rendibilitat exigida per descobrir quina taxa de creixement anual està descomptant el mercat en una acció.",
      h1: "Calculadora de DCF invers",
      lead: "En lloc d'endevinar una taxa de creixement, deixa que el preu te la digui. Un DCF invers resol el model al revés i revela exactament quin creixement anual dóna per fet el mercat, perquè puguis jutjar si l'expectativa és raonable.",
      example: {
        title: "Exemple resolt",
        body: (
          <p>
            Una acció cotitza a <strong>150 €</strong> amb un BPA de <strong>6,00 €</strong>. Si
            exigeixes un <strong>10%</strong> anual i assumeixes un múltiple de sortida de{" "}
            <strong>18×</strong> d'aquí a deu anys, el preu només té sentit si el benefici creix a
            prop del <strong>14% anual</strong> durant una dècada sencera. Aquesta és la pregunta
            útil: no "quant val", sinó "m'crec un 14% anual durant deu anys?". Si l'empresa ha
            crescut històricament al 7%, el preu ja descompta una acceleració que encara no ha
            passat.
          </p>
        ),
      },
      sections: [
        {
          title: "Per què un DCF invers és més honest que un DCF normal",
          body: (
            <>
              <p>
                En un DCF convencional tu tries el creixement, i és fàcil moure aquell número fins
                que el model diu el que vols sentir. El DCF invers elimina aquesta temptació: fixa
                el preu de mercat com a resultat i calcula quina hipòtesi de creixement el
                justifica. Deixes de produir una valoració i comences a avaluar una expectativa.
              </p>
              <p>
                Això converteix la valoració en una pregunta que sí que pots respondre amb la teva
                pròpia recerca: compares el creixement implícit amb el creixement històric de
                l'empresa, amb el del sector i amb el que la direcció guia. Si el creixement
                implícit és molt superior a tot això, el marge de seguretat és negatiu encara que el
                múltiple sembli normal.
              </p>
            </>
          ),
        },
        {
          title: "Com llegir el creixement implícit",
          body: (
            <p>
              No hi ha un llindar universal, però l'ordre de magnitud importa: un creixement
              implícit d'un dígit baix el compleix qualsevol negoci decent, un de mig-alt exigeix un
              avantatge competitiu real i un de més del 20% durant deu anys només l'aconsegueix una
              minoria d'empreses. Quan el número surti alt, no descartis l'acció automàticament:
              contrasta'l amb el{" "}
              <LocaleLink className="text-brand-700 underline" to="/calculadora-dcf">
                DCF directe
              </LocaleLink>{" "}
              i amb el rang del{" "}
              <LocaleLink className="text-brand-700 underline" to="/simulador-monte-carlo">
                simulador de Monte Carlo
              </LocaleLink>
              .
            </p>
          ),
        },
      ],
      faqs: [
        {
          q: "Què és exactament un DCF invers?",
          a: "És un descompte de fluxos resolt a l'inrevés: en lloc de calcular un valor a partir d'un creixement, calcula el creixement que fa que el valor coincideixi amb el preu de mercat actual.",
        },
        {
          q: "El creixement implícit em diu si l'acció és cara?",
          a: "Et diu què cal creure per justificar el preu. Si aquest creixement és superior al que l'empresa ha demostrat i al que el sector permet, el preu és exigent; si és inferior, tens marge.",
        },
        {
          q: "Quin múltiple de sortida hi he de posar?",
          a: "Un múltiple sostenible per a un negoci madur del mateix sector. Si hi poses el múltiple d'avui en un valor molt car, el creixement implícit sortirà artificialment baix.",
        },
        {
          q: "Serveix per a empreses sense beneficis?",
          a: "Amb precaució. Si el BPA és negatiu o erràtic, fes servir el flux de caixa lliure per acció normalitzat; si tampoc és estable, cap model de descompte donarà una resposta fiable.",
        },
      ],
      cta: {
        title: "Mira el creixement implícit de cada posició",
        body: "A TrimmTrack cada acció de la teva cartera porta la pestanya de DCF invers amb les dades ja carregades.",
        primaryTo: "/explore",
        primaryLabel: "Prova-ho amb una acció",
        secondaryTo: "/upload",
        secondaryLabel: "Puja la teva cartera",
      },
    },
    graham: {
      appName: "Calculadora del número de Graham de TrimmTrack",
      seoTitle: "Calculadora del número de Graham — valor intrínsec | TrimmTrack",
      seoDescription:
        "Calcula el número de Graham gratis: introdueix el benefici per acció i el creixement esperat i obtén l'estimació de valor intrínsec de la fórmula de Benjamin Graham, amb el rendiment dels bons ajustable.",
      h1: "Calculadora del número de Graham",
      lead: "La fórmula clàssica de Benjamin Graham per estimar el valor intrínsec d'una acció a partir del benefici i el creixement esperat. És un filtre ràpid, no un veredicte: serveix per descartar, no per decidir.",
      example: {
        title: "Exemple resolt",
        body: (
          <p>
            Amb un BPA de <strong>6,00 €</strong> i un creixement esperat del <strong>8%</strong>,
            la fórmula dóna 6 × (8,5 + 2 × 8) × 4,4 / Y. Amb un rendiment dels bons corporatius (Y)
            del <strong>4,5%</strong>, surt 6 × 24,5 × 4,4 / 4,5 ≈ <strong>143,7 €</strong>. Si
            l'acció cotitza a 150 €, està aproximadament en línia amb l'estimació de Graham; a 90 €
            hi hauria un descompte prou ampli per justificar mirar-s'ho amb atenció.
          </p>
        ),
      },
      sections: [
        {
          title: "D'on surt la fórmula",
          body: (
            <>
              <p>
                Graham va proposar V = BPA × (8,5 + 2g) × 4,4 / Y, on <strong>g</strong> és el
                creixement anual esperat a set-deu anys, <strong>8,5</strong> el PER que atribuïa a
                una empresa sense creixement, <strong>4,4</strong> el rendiment mitjà dels bons
                corporatius de qualitat quan va escriure la fórmula i <strong>Y</strong> el
                rendiment actual d'aquells bons. L'últim factor és el que ajusta la valoració a
                l'entorn de tipus d'interès: quan els bons paguen més, les accions valen menys.
              </p>
              <p>
                Aquesta calculadora limita el creixement al 15% perquè la fórmula és lineal en g i
                es dispara amb creixements alts, un dels seus defectes coneguts. Tracta el resultat
                com una <strong>estimació de cribratge</strong>.
              </p>
            </>
          ),
        },
        {
          title: "Quan la fórmula de Graham enganya",
          body: (
            <p>
              Va ser pensada per a negocis industrials estables amb beneficis comptables
              representatius. Falla amb empreses molt intensives en intangibles, amb resultats
              cíclics o amb beneficis puntualment deprimits, i no té en compte el deute ni la
              qualitat del negoci. Fes-la servir per generar candidats i valida'ls després amb el{" "}
              <LocaleLink className="text-brand-700 underline" to="/calculadora-dcf">
                DCF
              </LocaleLink>{" "}
              i amb els estats financers reals de l'empresa.
            </p>
          ),
        },
      ],
      faqs: [
        {
          q: "Quina fórmula del número de Graham fa servir?",
          a: "La revisada: valor = BPA × (8,5 + 2g) × 4,4 / Y, amb el creixement limitat al 15% i el rendiment dels bons (Y) ajustable per adaptar-la als tipus d'avui.",
        },
        {
          q: "Quin rendiment de bons hi he de posar?",
          a: "El rendiment actual dels bons corporatius de qualitat (grau d'inversió, llarg termini). És el que fa que la fórmula reaccioni a l'entorn de tipus en lloc de quedar ancorada als anys cinquanta.",
        },
        {
          q: "Si el número de Graham és més alt que el preu, l'acció és una compra?",
          a: "No per si sol. Indica que val la pena estudiar-la. La fórmula ignora el deute, la qualitat del negoci i la sostenibilitat del benefici, i cap d'aquestes tres coses és secundària.",
        },
        {
          q: "Serveix per a empreses tecnològiques?",
          a: "Poc. Amb creixements alts i molta inversió comptabilitzada com a despesa, la fórmula subestima sistemàticament el valor. Per a aquests casos, un DCF per acció s'hi ajusta molt millor.",
        },
      ],
      cta: {
        title: "El número de Graham de totes les teves accions",
        body: "TrimmTrack calcula el número de Graham amb el BPA ja carregat per a cada posició de la cartera, al costat dels altres cinc models de valoració.",
        primaryTo: "/explore",
        primaryLabel: "Prova-ho amb una acció",
        secondaryTo: "/upload",
        secondaryLabel: "Puja la teva cartera",
      },
    },
    monteCarlo: {
      appName: "Simulador de Monte Carlo de TrimmTrack",
      seoTitle: "Simulador de Monte Carlo per a accions | TrimmTrack",
      seoDescription:
        "Simulador de Monte Carlo gratuït per valorar accions: en lloc d'un únic valor raonable, obtén una distribució de resultats amb percentils p10, p50 i p90 variant el creixement i el múltiple de sortida.",
      h1: "Simulador de Monte Carlo per a accions",
      lead: "Un valor raonable únic amaga tot el que no saps. Aquest simulador executa milers d'escenaris variant el creixement i el múltiple de sortida, i et retorna una distribució de valors en lloc d'una xifra amb falsa precisió.",
      example: {
        title: "Exemple resolt",
        body: (
          <p>
            Parteix del mateix cas del DCF: BPA de <strong>6,00 €</strong>, creixement del{" "}
            <strong>10%</strong> i múltiple de sortida de <strong>18×</strong>, valor raonable ≈ 108
            €. Ara admet que no coneixes cap dels dos números amb precisió i deixa que el creixement
            oscil·li ± <strong>3 punts</strong> i el múltiple ± <strong>4×</strong>. La simulació ja
            no dóna 108 € sinó un rang: potser <strong>p10 ≈ 74 €</strong>,{" "}
            <strong>mediana ≈ 107 €</strong> i <strong>p90 ≈ 152 €</strong>. La conclusió canvia:
            comprar a 150 € no és "un 28% car", és apostar pel decil més optimista.
          </p>
        ),
      },
      sections: [
        {
          title: "Què fa exactament la simulació",
          body: (
            <>
              <p>
                Cada iteració agafa una mostra aleatòria del creixement i del múltiple de sortida
                al voltant dels valors centrals que has posat, seguint una distribució normal amb la
                desviació que triis, i calcula el valor raonable resultant. Repetint-ho milers de
                vegades s'obté una distribució completa, de la qual es llegeixen els percentils: el
                p10 és l'escenari pessimista, el p50 la mediana i el p90 l'optimista.
              </p>
              <p>
                L'objectiu no és una predicció més precisa, sinó veure com de sensible és la teva
                tesi a les hipòtesis. Si el p10 i el p90 estan molt separats, el que et falta no és
                un model millor sinó més certesa sobre el negoci.
              </p>
            </>
          ),
        },
        {
          title: "Com triar les desviacions",
          body: (
            <p>
              Fes-les proporcionals a la teva incertesa real. Un negoci regulat i previsible admet
              una desviació de creixement estreta; una empresa en un mercat que encara s'està
              formant, no. Si acabes posant desviacions grans en tot, el resultat útil és
              precisament aquest: la valoració no és el factor decisiu i el que cal és entendre
              millor l'empresa. Compara la mediana amb el{" "}
              <LocaleLink className="text-brand-700 underline" to="/calculadora-dcf">
                DCF puntual
              </LocaleLink>{" "}
              i el rang amb el creixement que revela el{" "}
              <LocaleLink className="text-brand-700 underline" to="/dcf-invers">
                DCF invers
              </LocaleLink>
              .
            </p>
          ),
        },
      ],
      faqs: [
        {
          q: "Quantes simulacions executa?",
          a: "Milers per cada càlcul, suficients perquè els percentils siguin estables entre execucions. Tot passa al navegador, de manera instantània.",
        },
        {
          q: "Què signifiquen p10, p50 i p90?",
          a: "Són percentils de la distribució de valors: el 10% dels escenaris queda per sota del p10, la meitat per sota del p50 (la mediana) i el 90% per sota del p90. El tram p10–p90 és el rang central raonable.",
        },
        {
          q: "És més fiable que un DCF normal?",
          a: "No és més fiable en el sentit de predir millor; és més honest, perquè mostra explícitament la incertesa que un valor únic oculta.",
        },
        {
          q: "Puc fer servir Monte Carlo per projectar la cartera sencera?",
          a: "Sí, però aquesta pàgina simula una acció. Per projectar una cartera amb aportacions periòdiques, comissions i correlacions, fes servir la secció de projeccions de TrimmTrack.",
        },
      ],
      cta: {
        title: "Simula la cartera, no només una acció",
        body: "La secció de projeccions de TrimmTrack aplica Monte Carlo a tota la cartera, amb aportacions periòdiques, TER i bandes p10–p90.",
        primaryTo: "/forecast",
        primaryLabel: "Obre les projeccions",
        secondaryTo: "/explore",
        secondaryLabel: "Prova-ho amb una acció",
      },
    },
  },
  es: {
    dcf: {
      appName: "Calculadora DCF de TrimmTrack",
      seoTitle: "Calculadora DCF gratis — valora cualquier acción | TrimmTrack",
      seoDescription:
        "Calculadora de descuento de flujos de caja (DCF) gratis y sin registro. Introduce el beneficio por acción o el flujo de caja libre, una tasa de crecimiento, un múltiplo de salida y la rentabilidad que exiges, y obtén el valor intrínseco y el potencial.",
      h1: "Calculadora DCF gratis",
      lead: "Calcula lo que realmente vale una acción. Introduce unas pocas hipótesis y obtén un valor intrínseco, el potencial frente al precio de hoy y la rentabilidad anual que el precio actual ya implica. En el navegador, sin cuenta y sin límite de acciones.",
      example: {
        title: "Ejemplo resuelto",
        body: (
          <>
            <p>
              Imagina una empresa con un beneficio por acción previsto de <strong>6,00 €</strong>.
              Esperas un crecimiento del <strong>10%</strong> anual durante{" "}
              <strong>10 años</strong> y crees que cotizará a un PER de salida de{" "}
              <strong>18×</strong>. En el año 10 el BPA será 6 × 1,10<sup>10</sup> ≈{" "}
              <strong>15,56 €</strong>, es decir un precio por acción de 15,56 × 18 ≈{" "}
              <strong>280 €</strong>.
            </p>
            <p className="mt-2">
              Descontando ese precio diez años hacia atrás a una rentabilidad exigida del{" "}
              <strong>10%</strong> obtienes un valor razonable de 280 / 1,10<sup>10</sup> ≈{" "}
              <strong>108 €</strong>. Si la acción cotiza hoy a 150 €, el modelo dice que está un{" "}
              <strong>28% sobrevalorada</strong> para el objetivo que te has fijado: necesitarías
              más crecimiento o un múltiplo más alto para justificar el precio.
            </p>
          </>
        ),
      },
      sections: [
        {
          title: "¿Qué es un DCF y cómo funciona esta calculadora?",
          body: (
            <>
              <p>
                Un modelo de descuento de flujos de caja (DCF) valora un negocio proyectando lo que
                va a ganar o generar en efectivo y trayendo esas cantidades futuras al presente,
                porque un euro dentro de diez años vale menos que un euro hoy. Esta calculadora usa
                una versión compacta por acción: capitaliza la métrica de partida (BPA previsto o
                flujo de caja libre por acción) a tu tasa de crecimiento, le aplica un múltiplo de
                salida para obtener un precio futuro y descuenta ese precio a la rentabilidad que
                exiges.
              </p>
              <p>
                El resultado es un <strong>valor razonable</strong> — lo máximo que puedes pagar hoy
                y aun así lograr tu rentabilidad objetivo — junto con el potencial implícito y la
                TAE que obtendrías realmente comprando al precio actual.
              </p>
            </>
          ),
        },
        {
          title: "¿Qué datos pesan más en el resultado?",
          body: (
            <p>
              La tasa de crecimiento y el múltiplo de salida son los que más mueven el resultado y
              también los más difíciles de conocer: pequeñas diferencias se multiplican a lo largo
              de diez años. Sé prudente: usa un crecimiento que un negocio de calidad pueda
              sostener de verdad y un múltiplo en línea con competidores maduros, no con la euforia
              actual. Cuando no tengas claro un número, prueba el{" "}
              <LocaleLink className="text-brand-700 underline" to="/simulador-monte-carlo">
                simulador de Monte Carlo
              </LocaleLink>{" "}
              para ver un rango en lugar de una falsa precisión, o el{" "}
              <LocaleLink className="text-brand-700 underline" to="/dcf-inverso">
                DCF inverso
              </LocaleLink>{" "}
              para saber qué crecimiento da por hecho el precio.
            </p>
          ),
        },
      ],
      faqs: [
        {
          q: "¿Esta calculadora DCF es realmente gratis?",
          a: "Sí. Funciona entera en tu navegador, sin registro, sin muro de pago y sin límite de acciones que puedes valorar.",
        },
        {
          q: "¿Uso el BPA o el flujo de caja libre?",
          a: "Ambos funcionan: el modelo capitaliza la métrica por acción que introduzcas. El flujo de caja libre por acción se acerca más a lo que un DCF debería valorar, pero el BPA previsto es más fácil de encontrar y sirve para una primera aproximación.",
        },
        {
          q: "¿Qué tasa de descuento debo usar?",
          a: "La rentabilidad anual que quieres obtener por el riesgo que asumes. Muchos inversores a largo plazo usan entre el 8% y el 12%; cuanto más alta, más conservador es el resultado y más bajo el valor razonable.",
        },
        {
          q: "¿Por qué el valor razonable depende tanto del múltiplo de salida?",
          a: "Porque multiplica directamente la métrica del último año. Pasar de 15× a 25× cambia el precio final en dos tercios. Ancla el múltiplo a niveles sostenibles de un negocio maduro, no al múltiplo de hoy.",
        },
      ],
      cta: {
        title: "Valora toda la cartera, no solo una acción",
        body: "TrimmTrack ejecuta este DCF (y el DCF inverso, el número de Graham y Monte Carlo) sobre cada posición de tu cartera, con precios en directo.",
        primaryTo: "/upload",
        primaryLabel: "Sube tu cartera",
        secondaryTo: "/explore",
        secondaryLabel: "Pruébalo con cualquier acción",
      },
    },
    reverseDcf: {
      appName: "Calculadora de DCF inverso de TrimmTrack",
      seoTitle: "DCF inverso — ¿qué crecimiento descuenta el precio? | TrimmTrack",
      seoDescription:
        "Calculadora de DCF inverso gratis. Introduce el precio actual, el BPA, el múltiplo de salida y la rentabilidad exigida para descubrir qué tasa de crecimiento anual está descontando el mercado en una acción.",
      h1: "Calculadora de DCF inverso",
      lead: "En lugar de adivinar una tasa de crecimiento, deja que el precio te la diga. Un DCF inverso resuelve el modelo al revés y revela exactamente qué crecimiento anual da por hecho el mercado, para que puedas juzgar si la expectativa es razonable.",
      example: {
        title: "Ejemplo resuelto",
        body: (
          <p>
            Una acción cotiza a <strong>150 €</strong> con un BPA de <strong>6,00 €</strong>. Si
            exiges un <strong>10%</strong> anual y asumes un múltiplo de salida de{" "}
            <strong>18×</strong> dentro de diez años, el precio solo tiene sentido si el beneficio
            crece cerca del <strong>14% anual</strong> durante una década entera. Esa es la pregunta
            útil: no "cuánto vale", sino "¿me creo un 14% anual durante diez años?". Si la empresa
            ha crecido históricamente al 7%, el precio ya descuenta una aceleración que todavía no
            ha ocurrido.
          </p>
        ),
      },
      sections: [
        {
          title: "Por qué un DCF inverso es más honesto que un DCF normal",
          body: (
            <>
              <p>
                En un DCF convencional tú eliges el crecimiento, y es fácil mover ese número hasta
                que el modelo dice lo que quieres oír. El DCF inverso elimina esa tentación: fija el
                precio de mercado como resultado y calcula qué hipótesis de crecimiento lo
                justifica. Dejas de producir una valoración y empiezas a evaluar una expectativa.
              </p>
              <p>
                Eso convierte la valoración en una pregunta que sí puedes responder con tu propia
                investigación: comparas el crecimiento implícito con el histórico de la empresa, con
                el del sector y con el que guía la dirección. Si el crecimiento implícito es muy
                superior a todo eso, el margen de seguridad es negativo aunque el múltiplo parezca
                normal.
              </p>
            </>
          ),
        },
        {
          title: "Cómo leer el crecimiento implícito",
          body: (
            <p>
              No hay un umbral universal, pero el orden de magnitud importa: un crecimiento
              implícito de un dígito bajo lo cumple cualquier negocio decente, uno medio-alto exige
              una ventaja competitiva real y uno superior al 20% durante diez años solo lo logra una
              minoría de empresas. Cuando el número salga alto, no descartes la acción
              automáticamente: contrástalo con el{" "}
              <LocaleLink className="text-brand-700 underline" to="/calculadora-dcf">
                DCF directo
              </LocaleLink>{" "}
              y con el rango del{" "}
              <LocaleLink className="text-brand-700 underline" to="/simulador-monte-carlo">
                simulador de Monte Carlo
              </LocaleLink>
              .
            </p>
          ),
        },
      ],
      faqs: [
        {
          q: "¿Qué es exactamente un DCF inverso?",
          a: "Es un descuento de flujos resuelto al revés: en lugar de calcular un valor a partir de un crecimiento, calcula el crecimiento que hace que el valor coincida con el precio de mercado actual.",
        },
        {
          q: "¿El crecimiento implícito me dice si la acción está cara?",
          a: "Te dice qué hay que creer para justificar el precio. Si ese crecimiento es superior al que la empresa ha demostrado y al que el sector permite, el precio es exigente; si es inferior, tienes margen.",
        },
        {
          q: "¿Qué múltiplo de salida debo poner?",
          a: "Un múltiplo sostenible para un negocio maduro del mismo sector. Si pones el múltiplo de hoy en un valor muy caro, el crecimiento implícito saldrá artificialmente bajo.",
        },
        {
          q: "¿Sirve para empresas sin beneficios?",
          a: "Con precaución. Si el BPA es negativo o errático, usa el flujo de caja libre por acción normalizado; si tampoco es estable, ningún modelo de descuento dará una respuesta fiable.",
        },
      ],
      cta: {
        title: "Mira el crecimiento implícito de cada posición",
        body: "En TrimmTrack cada acción de tu cartera lleva la pestaña de DCF inverso con los datos ya cargados.",
        primaryTo: "/explore",
        primaryLabel: "Pruébalo con una acción",
        secondaryTo: "/upload",
        secondaryLabel: "Sube tu cartera",
      },
    },
    graham: {
      appName: "Calculadora del número de Graham de TrimmTrack",
      seoTitle: "Calculadora del número de Graham — valor intrínseco | TrimmTrack",
      seoDescription:
        "Calcula el número de Graham gratis: introduce el beneficio por acción y el crecimiento esperado y obtén la estimación de valor intrínseco de la fórmula de Benjamin Graham, con el rendimiento de los bonos ajustable.",
      h1: "Calculadora del número de Graham",
      lead: "La fórmula clásica de Benjamin Graham para estimar el valor intrínseco de una acción a partir del beneficio y el crecimiento esperado. Es un filtro rápido, no un veredicto: sirve para descartar, no para decidir.",
      example: {
        title: "Ejemplo resuelto",
        body: (
          <p>
            Con un BPA de <strong>6,00 €</strong> y un crecimiento esperado del <strong>8%</strong>,
            la fórmula da 6 × (8,5 + 2 × 8) × 4,4 / Y. Con un rendimiento de los bonos corporativos
            (Y) del <strong>4,5%</strong>, sale 6 × 24,5 × 4,4 / 4,5 ≈ <strong>143,7 €</strong>. Si
            la acción cotiza a 150 €, está aproximadamente en línea con la estimación de Graham; a
            90 € habría un descuento lo bastante amplio para justificar mirarla con atención.
          </p>
        ),
      },
      sections: [
        {
          title: "De dónde sale la fórmula",
          body: (
            <>
              <p>
                Graham propuso V = BPA × (8,5 + 2g) × 4,4 / Y, donde <strong>g</strong> es el
                crecimiento anual esperado a siete-diez años, <strong>8,5</strong> el PER que
                atribuía a una empresa sin crecimiento, <strong>4,4</strong> el rendimiento medio de
                los bonos corporativos de calidad cuando escribió la fórmula e <strong>Y</strong> el
                rendimiento actual de esos bonos. El último factor es el que ajusta la valoración al
                entorno de tipos de interés: cuando los bonos pagan más, las acciones valen menos.
              </p>
              <p>
                Esta calculadora limita el crecimiento al 15% porque la fórmula es lineal en g y se
                dispara con crecimientos altos, uno de sus defectos conocidos. Trata el resultado
                como una <strong>estimación de cribado</strong>.
              </p>
            </>
          ),
        },
        {
          title: "Cuándo engaña la fórmula de Graham",
          body: (
            <p>
              Fue pensada para negocios industriales estables con beneficios contables
              representativos. Falla con empresas muy intensivas en intangibles, con resultados
              cíclicos o con beneficios puntualmente deprimidos, y no tiene en cuenta la deuda ni la
              calidad del negocio. Úsala para generar candidatos y valídalos después con el{" "}
              <LocaleLink className="text-brand-700 underline" to="/calculadora-dcf">
                DCF
              </LocaleLink>{" "}
              y con los estados financieros reales de la empresa.
            </p>
          ),
        },
      ],
      faqs: [
        {
          q: "¿Qué fórmula del número de Graham usa?",
          a: "La revisada: valor = BPA × (8,5 + 2g) × 4,4 / Y, con el crecimiento limitado al 15% y el rendimiento de los bonos (Y) ajustable para adaptarla a los tipos de hoy.",
        },
        {
          q: "¿Qué rendimiento de bonos debo poner?",
          a: "El rendimiento actual de los bonos corporativos de calidad (grado de inversión, largo plazo). Es lo que hace que la fórmula reaccione al entorno de tipos en lugar de quedar anclada en los años cincuenta.",
        },
        {
          q: "Si el número de Graham es más alto que el precio, ¿la acción es una compra?",
          a: "No por sí solo. Indica que merece la pena estudiarla. La fórmula ignora la deuda, la calidad del negocio y la sostenibilidad del beneficio, y ninguna de las tres es secundaria.",
        },
        {
          q: "¿Sirve para empresas tecnológicas?",
          a: "Poco. Con crecimientos altos y mucha inversión contabilizada como gasto, la fórmula subestima sistemáticamente el valor. Para esos casos, un DCF por acción se ajusta mucho mejor.",
        },
      ],
      cta: {
        title: "El número de Graham de todas tus acciones",
        body: "TrimmTrack calcula el número de Graham con el BPA ya cargado para cada posición de la cartera, junto a los otros cinco modelos de valoración.",
        primaryTo: "/explore",
        primaryLabel: "Pruébalo con una acción",
        secondaryTo: "/upload",
        secondaryLabel: "Sube tu cartera",
      },
    },
    monteCarlo: {
      appName: "Simulador de Monte Carlo de TrimmTrack",
      seoTitle: "Simulador de Monte Carlo para acciones | TrimmTrack",
      seoDescription:
        "Simulador de Monte Carlo gratis para valorar acciones: en lugar de un único valor razonable, obtén una distribución de resultados con percentiles p10, p50 y p90 variando el crecimiento y el múltiplo de salida.",
      h1: "Simulador de Monte Carlo para acciones",
      lead: "Un valor razonable único esconde todo lo que no sabes. Este simulador ejecuta miles de escenarios variando el crecimiento y el múltiplo de salida, y te devuelve una distribución de valores en lugar de una cifra con falsa precisión.",
      example: {
        title: "Ejemplo resuelto",
        body: (
          <p>
            Parte del mismo caso del DCF: BPA de <strong>6,00 €</strong>, crecimiento del{" "}
            <strong>10%</strong> y múltiplo de salida de <strong>18×</strong>, valor razonable ≈ 108
            €. Ahora admite que no conoces ninguno de los dos números con precisión y deja que el
            crecimiento oscile ± <strong>3 puntos</strong> y el múltiplo ± <strong>4×</strong>. La
            simulación ya no da 108 € sino un rango: quizá <strong>p10 ≈ 74 €</strong>,{" "}
            <strong>mediana ≈ 107 €</strong> y <strong>p90 ≈ 152 €</strong>. La conclusión cambia:
            comprar a 150 € no es "un 28% caro", es apostar por el decil más optimista.
          </p>
        ),
      },
      sections: [
        {
          title: "Qué hace exactamente la simulación",
          body: (
            <>
              <p>
                Cada iteración toma una muestra aleatoria del crecimiento y del múltiplo de salida
                alrededor de los valores centrales que has puesto, siguiendo una distribución normal
                con la desviación que elijas, y calcula el valor razonable resultante. Repitiéndolo
                miles de veces se obtiene una distribución completa, de la que se leen los
                percentiles: el p10 es el escenario pesimista, el p50 la mediana y el p90 el
                optimista.
              </p>
              <p>
                El objetivo no es una predicción más precisa, sino ver lo sensible que es tu tesis a
                las hipótesis. Si el p10 y el p90 están muy separados, lo que te falta no es un
                modelo mejor sino más certeza sobre el negocio.
              </p>
            </>
          ),
        },
        {
          title: "Cómo elegir las desviaciones",
          body: (
            <p>
              Hazlas proporcionales a tu incertidumbre real. Un negocio regulado y previsible admite
              una desviación de crecimiento estrecha; una empresa en un mercado que todavía se está
              formando, no. Si acabas poniendo desviaciones grandes en todo, el resultado útil es
              precisamente ese: la valoración no es el factor decisivo y lo que hace falta es
              entender mejor la empresa. Compara la mediana con el{" "}
              <LocaleLink className="text-brand-700 underline" to="/calculadora-dcf">
                DCF puntual
              </LocaleLink>{" "}
              y el rango con el crecimiento que revela el{" "}
              <LocaleLink className="text-brand-700 underline" to="/dcf-inverso">
                DCF inverso
              </LocaleLink>
              .
            </p>
          ),
        },
      ],
      faqs: [
        {
          q: "¿Cuántas simulaciones ejecuta?",
          a: "Miles por cada cálculo, suficientes para que los percentiles sean estables entre ejecuciones. Todo ocurre en el navegador, de forma instantánea.",
        },
        {
          q: "¿Qué significan p10, p50 y p90?",
          a: "Son percentiles de la distribución de valores: el 10% de los escenarios queda por debajo del p10, la mitad por debajo del p50 (la mediana) y el 90% por debajo del p90. El tramo p10–p90 es el rango central razonable.",
        },
        {
          q: "¿Es más fiable que un DCF normal?",
          a: "No es más fiable en el sentido de predecir mejor; es más honesto, porque muestra explícitamente la incertidumbre que un valor único oculta.",
        },
        {
          q: "¿Puedo usar Monte Carlo para proyectar la cartera entera?",
          a: "Sí, pero esta página simula una acción. Para proyectar una cartera con aportaciones periódicas, comisiones y correlaciones, usa la sección de proyecciones de TrimmTrack.",
        },
      ],
      cta: {
        title: "Simula la cartera, no solo una acción",
        body: "La sección de proyecciones de TrimmTrack aplica Monte Carlo a toda la cartera, con aportaciones periódicas, TER y bandas p10–p90.",
        primaryTo: "/forecast",
        primaryLabel: "Abre las proyecciones",
        secondaryTo: "/explore",
        secondaryLabel: "Pruébalo con una acción",
      },
    },
  },
};

/** The calculator widget for each tool — shared by every language. */
const WIDGET: Record<RouteId, React.ReactNode> = {
  dcf: <DcfCalculator />,
  reverseDcf: <ReverseDcfCalculator />,
  graham: <GrahamCalculator />,
  monteCarlo: <MonteCarloCalculator />,
  // The FIFO page has its own dedicated route in ca/es (/calculadora-fifo) and
  // its English keyword page in en-tools; it is here only so the map is total.
  fifo: null,
};

/**
 * Which locales a tool landing genuinely exists in. English copy lives in
 * en-tools.tsx, ca/es in this file — so this reads both sources and is the one
 * function the sitemap, the hreflang set and the prerender list agree on.
 */
export function toolLocales(id: RouteId): Locale[] {
  return ALL_LOCALES.filter((l) => l === "en" || !!TOOLS[l]?.[id]);
}

/** Renders the ca/es landing for `id`. Locale comes from the URL prefix. */
export function LocalizedToolPage({ id, locale }: { id: RouteId; locale: Locale }) {
  const copy = TOOLS[locale]?.[id];
  // No translation for this language: the router never mounts this (the route
  // is only registered for locales with copy), but stay defensive rather than
  // render an English page under a Spanish URL.
  if (!copy) return null;
  return (
    <ToolPage
      {...copy}
      path={ROUTE_SLUGS[id][locale]}
      locale={locale}
      alternates={toolLocales(id)}
      tool={WIDGET[id]}
    />
  );
}

/** One exported component per (tool, locale) pair, for the route table. */
export const CaDcfPage = () => <LocalizedToolPage id="dcf" locale="ca" />;
export const CaReverseDcfPage = () => <LocalizedToolPage id="reverseDcf" locale="ca" />;
export const CaGrahamPage = () => <LocalizedToolPage id="graham" locale="ca" />;
export const CaMonteCarloPage = () => <LocalizedToolPage id="monteCarlo" locale="ca" />;
export const EsDcfPage = () => <LocalizedToolPage id="dcf" locale="es" />;
export const EsReverseDcfPage = () => <LocalizedToolPage id="reverseDcf" locale="es" />;
export const EsGrahamPage = () => <LocalizedToolPage id="graham" locale="es" />;
export const EsMonteCarloPage = () => <LocalizedToolPage id="monteCarlo" locale="es" />;
