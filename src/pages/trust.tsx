import { useMemo, type ReactNode } from "react";
import { LocaleLink } from "@/components/LocaleLink";
import { useSeo } from "@/lib/seo";
import { ALL_LOCALES, ROUTE_SLUGS, localeUrl, type Locale } from "@/lib/locale";
import { X_URL, X_HANDLE } from "@/lib/brand";

// The three trust pages — about, privacy and terms — in all three languages.
// Static prose only: no serverless function, no client data fetch, so they
// prerender into real HTML like every other public route. Content lives here
// per locale (the same pattern as tools-localized.tsx): which keys exist IS the
// answer to "which translations are real".
//
// LEGAL REVIEW REQUIRED (owner): the terms and privacy copy describes what the
// code actually does and is written to be prudent, but it has not been reviewed
// by a lawyer. It makes no claim of GDPR/LOPD compliance, states no retention
// period, no jurisdiction and no encryption guarantee, because none of those can
// be verified from the source tree. Anything added here later must stay
// verifiable in the code.

export type TrustId = "about" | "privacy" | "terms";

type Section = { title: string; body: ReactNode };
type Copy = {
  seoTitle: string;
  seoDescription: string;
  h1: string;
  lead: string;
  sections: Section[];
};

const EDITORIAL: Record<Locale, string> = {
  ca: "Equip editorial de TrimmTrack",
  es: "Equipo editorial de TrimmTrack",
  en: "TrimmTrack Editorial Team",
};

/** The editorial byline used across articles, exported for the Article schema. */
export function editorialName(locale: Locale): string {
  return EDITORIAL[locale];
}

const XLink = () => (
  <a
    href={X_URL}
    target="_blank"
    rel="me noopener noreferrer"
    className="text-brand-700 hover:underline"
  >
    {X_HANDLE}
  </a>
);

// ---------------------------------------------------------------------------
// Catalan
// ---------------------------------------------------------------------------

const CA: Record<TrustId, Copy> = {
  about: {
    seoTitle: "Sobre TrimmTrack — qui hi ha darrere i com funciona",
    seoDescription:
      "Què és TrimmTrack, quines eines ofereix, d'on surten els preus i els fonamentals, com funcionen els models DCF, Graham, Monte Carlo i FIFO, i com s'escriuen les anàlisis.",
    h1: "Sobre TrimmTrack",
    lead: "TrimmTrack converteix l'Excel del teu bròker en un seguiment de cartera viu i posa al costat les eines de valoració que fas servir per decidir. Aquesta pàgina explica què fa exactament, amb quines dades i amb quins límits.",
    sections: [
      {
        title: "Què és TrimmTrack",
        body: (
          <>
            <p>
              És una aplicació web per a inversors particulars. Puges l'Excel d'operacions del teu
              bròker (o hi afegeixes posicions a mà) i obtens la cartera valorada a preus de mercat,
              el resultat realitzat i no realitzat, els dividends, la rendibilitat des de l'inici i
              la TIR. A sobre hi ha una capa d'eines de valoració i d'anàlisi que pots fer servir
              tant sobre les teves posicions com sobre qualsevol empresa cotitzada.
            </p>
            <p>
              És un projecte independent, sense publicitat i sense comissions de cap bròker.
            </p>
          </>
        ),
      },
      {
        title: "Quines eines inclou",
        body: (
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <LocaleLink to="/dashboard" className="text-brand-700 hover:underline">
                Panell de cartera
              </LocaleLink>{" "}
              amb valor, pesos, P&L, dividends, evolució i mètriques de risc.
            </li>
            <li>
              <LocaleLink to="/explore" className="text-brand-700 hover:underline">
                Fitxes d'empresa
              </LocaleLink>{" "}
              amb estats financers, múltiples i sis models de valoració.
            </li>
            <li>
              <LocaleLink to="/radiografia" className="text-brand-700 hover:underline">
                Radiografia de cartera
              </LocaleLink>
              : nota de diversificació, concentració i exposició per regió i sector.
            </li>
            <li>
              <LocaleLink to="/forecast" className="text-brand-700 hover:underline">
                Simulador d'ETFs
              </LocaleLink>{" "}
              amb projecció determinista i Monte Carlo.
            </li>
            <li>
              <LocaleLink to="/taxes" className="text-brand-700 hover:underline">
                Esborrany fiscal
              </LocaleLink>{" "}
              i{" "}
              <LocaleLink to={ROUTE_SLUGS.fifo.ca} className="text-brand-700 hover:underline">
                calculadora FIFO
              </LocaleLink>{" "}
              de plusvàlues.
            </li>
            <li>
              <LocaleLink to="/research" className="text-brand-700 hover:underline">
                Anàlisis
              </LocaleLink>{" "}
              escrites sobre empreses concretes.
            </li>
          </ul>
        ),
      },
      {
        title: "D'on surten les dades",
        body: (
          <>
            <p>
              Els preus, els tipus de canvi, els fonamentals, els dividends i els estats financers
              venen de Yahoo Finance. Els preus es refresquen amb una tasca diària i es poden
              refrescar manualment; l'històric setmanal serveix per a l'evolució de la cartera i les
              mètriques de risc. Els logotips de les empreses els serveix logo.dev.
            </p>
            <p>
              Les dades de la teva cartera surten del fitxer que puges tu: TrimmTrack no es connecta
              al teu bròker, tret que facis servir la verificació opcional amb un informe Flex
              d'Interactive Brokers de només lectura.
            </p>
            <p>
              Les dades de proveïdors externs poden arribar amb retard, incompletes o errònies.
              Contrasta sempre qualsevol xifra abans de decidir res amb ella.
            </p>
          </>
        ),
      },
      {
        title: "Com funcionen els models, a grans trets",
        body: (
          <>
            <p>
              <strong>DCF simple</strong>: projecta el benefici per acció (o el flux de caixa lliure
              per acció) amb una taxa de creixement durant N anys, hi aplica un múltiple de sortida
              per obtenir un preu futur i el descompta a la rendibilitat que exigeixes. El resultat
              és el preu màxim que et pots permetre pagar avui per obtenir aquesta rendibilitat.
            </p>
            <p>
              <strong>DCF invers</strong>: el mateix model resolt al revés. Donat el preu d'avui,
              quin creixement constant hauria d'estar descomptant el mercat?
            </p>
            <p>
              <strong>Número de Graham</strong>: V = BPA × (8,5 + 2g) × 4,4 / Y, la revisió
              ajustada per tipus d'interès. És un cribratge ràpid i conservador, no una valoració
              precisa; el creixement es limita perquè el terme lineal 2g s'infla per sobre d'un
              cert punt.
            </p>
            <p>
              <strong>Monte Carlo</strong>: repeteix el DCF simple milers de vegades variant el
              creixement i el múltiple de sortida amb una desviació que tries tu, i mostra la
              distribució del valor raonable (P10, mediana, P90) en comptes d'un únic número fals
              de precís.
            </p>
            <p>
              <strong>FIFO</strong>: casa cada venda amb les compres més antigues encara obertes per
              calcular el resultat realitzat, que és el criteri que s'aplica a Espanya per als
              valors homogenis.
            </p>
          </>
        ),
      },
      {
        title: "Com s'escriuen les anàlisis",
        body: (
          <>
            <p>
              Les anàlisis les redacta l'{EDITORIAL.ca} i es publiquen amb la data de publicació
              visible. Cada text parteix dels comptes publicats per l'empresa i de les dades de
              mercat que fa servir la resta de l'aplicació; quan una xifra ve d'una font externa,
              s'enllaça la font. No són recomanacions de compra ni de venda, i no hi ha cap acord
              de patrocini amb les empreses analitzades.
            </p>
            <p>
              Els comentaris qualitatius de les fitxes d'empresa (punts forts, riscos i tesi) estan
              escrits en català. Quan encara no hi ha traducció, la versió en un altre idioma no
              mostra el text català: t'enllaça la versió catalana i manté totes les dades
              quantitatives, que sí que estan traduïdes.
            </p>
          </>
        ),
      },
      {
        title: "Això no és assessorament financer",
        body: (
          <p>
            TrimmTrack és una eina d'informació i càlcul. No som assessors financers ni fiscals, no
            coneixem la teva situació i res del que hi ha aquí és una recomanació personalitzada.
            Les decisions d'inversió, i la verificació de les dades en què es basen, són teves.
            Consulta la{" "}
            <LocaleLink to={ROUTE_SLUGS.terms.ca} className="text-brand-700 hover:underline">
              informació legal
            </LocaleLink>{" "}
            i el{" "}
            <LocaleLink to="/disclaimer" className="text-brand-700 hover:underline">
              descàrrec de responsabilitat
            </LocaleLink>
            .
          </p>
        ),
      },
      {
        title: "Contacte",
        body: (
          <p>
            El canal oficial és <XLink /> a X. No fem servir cap altre perfil ni cap altre canal de
            suport.
          </p>
        ),
      },
    ],
  },
  privacy: {
    seoTitle: "Privacitat — quines dades tracta TrimmTrack",
    seoDescription:
      "Quines dades desa TrimmTrack, quines no surten mai del teu navegador, quins proveïdors hi intervenen i com demanar-ne l'esborrat.",
    h1: "Privacitat",
    lead: "Aquesta pàgina descriu el que fa el codi de TrimmTrack amb les teves dades. Està escrita a partir de la implementació, no d'una plantilla.",
    sections: [
      {
        title: "Què es desa al servidor",
        body: (
          <>
            <p>
              Si crees un compte, l'autenticació la gestiona Neon Auth: hi queda desat el teu correu
              i les credencials d'accés. La resta de dades es desen a una base de dades Neon
              Postgres associada al teu identificador d'usuari:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>les operacions, dividends, interessos i patrimoni que importes de l'Excel;</li>
              <li>les hipòtesis dels models de valoració que deses per a cada empresa;</li>
              <li>
                les instantànies verificades que emetis, amb les xifres que contenen i el seu codi
                públic (les pots revocar des del panell).
              </li>
            </ul>
            <p>
              Els preus, els fonamentals i els estats financers es guarden en taules compartides per
              ticker, no per usuari: no diuen res de qui té què.
            </p>
          </>
        ),
      },
      {
        title: "Què no surt del navegador",
        body: (
          <>
            <p>
              La{" "}
              <LocaleLink to="/radiografia" className="text-brand-700 hover:underline">
                radiografia de cartera
              </LocaleLink>{" "}
              i la prova sense compte llegeixen l'Excel dins del navegador i el guarden només a la
              sessió del navegador (<code>sessionStorage</code>), que s'esborra en tancar la
              pestanya. El fitxer no es puja enlloc. L'esborrany fiscal i la calculadora FIFO també
              calculen en local.
            </p>
            <p>
              Al navegador s'hi desen, a més, l'idioma triat, la divisa de visualització i el fet
              que ja has llegit el descàrrec de responsabilitat. No hi ha cookies de publicitat ni
              de seguiment entre webs.
            </p>
          </>
        ),
      },
      {
        title: "Proveïdors que hi intervenen",
        body: (
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Vercel</strong>: allotjament i funcions de servidor. Rep les peticions HTTP
              (i per tant l'adreça IP) i proporciona Vercel Web Analytics, que fem servir per veure
              visites agregades per pàgina.
            </li>
            <li>
              <strong>Neon</strong>: base de dades i autenticació.
            </li>
            <li>
              <strong>Yahoo Finance</strong>: preus i dades d'empresa. Les consultes les fa el
              servidor i només hi viatgen símbols de cotització, mai qui els demana.
            </li>
            <li>
              <strong>logo.dev</strong>: logotips d'empresa. Les imatges les demana el teu navegador
              directament, de manera que logo.dev en veu l'adreça IP i el ticker sol·licitat.
            </li>
            <li>
              <strong>Google Fonts</strong>: tipografies de la interfície, carregades pel navegador.
            </li>
            <li>
              <strong>Notion</strong>: allotja el text de les anàlisis, que el servidor llegeix per
              publicar-les.
            </li>
            <li>
              <strong>Interactive Brokers</strong>: només si fas servir la verificació opcional. El
              testimoni Flex de només lectura que hi enganxes s'utilitza per a aquella crida i no es
              desa, no s'escriu a cap registre i no es retorna.
            </li>
          </ul>
        ),
      },
      {
        title: "Publicitat i venda de dades",
        body: (
          <p>
            El codi no conté cap SDK de publicitat, de màrqueting ni de seguiment entre webs més
            enllà de Vercel Web Analytics. Les teves dades de cartera no s'envien a cap tercer: els
            únics destinataris són els proveïdors d'infraestructura de la llista anterior.
          </p>
        ),
      },
      {
        title: "Esborrar les teves dades",
        body: (
          <p>
            Pots eliminar posicions des del panell i revocar qualsevol instantània verificada que
            hagis emès. Per esborrar el compte sencer i tot el que hi ha associat, escriu-nos a{" "}
            <XLink />.
          </p>
        ),
      },
    ],
  },
  terms: {
    seoTitle: "Informació legal i condicions d'ús | TrimmTrack",
    seoDescription:
      "Condicions d'ús de TrimmTrack: ús informatiu, absència d'assessorament financer o fiscal, fonts externes, disponibilitat, propietat intel·lectual i limitació de responsabilitat.",
    h1: "Condicions d'ús",
    lead: "En fer servir TrimmTrack acceptes el que s'explica en aquesta pàgina. Està escrita en llenguatge planer i descriu el servei tal com funciona.",
    sections: [
      {
        title: "Ús informatiu",
        body: (
          <p>
            TrimmTrack és una eina d'informació i càlcul per a inversors particulars. Els resultats
            que mostra són el producte de les dades disponibles i de les hipòtesis que introdueixes
            tu; canviar una hipòtesi canvia el resultat.
          </p>
        ),
      },
      {
        title: "No és assessorament financer ni fiscal",
        body: (
          <p>
            Res del que publica TrimmTrack no constitueix assessorament d'inversió, recomanació
            personalitzada ni assessorament fiscal o legal. L'esborrany fiscal és orientatiu i les
            caselles poden canviar entre exercicis: verifica-ho sempre amb la teva assessoria o amb
            l'administració tributària abans de presentar res.
          </p>
        ),
      },
      {
        title: "Verificació de les dades",
        body: (
          <p>
            Ets responsable de comprovar qualsevol xifra abans de fer-la servir. Les dades venen de
            fonts externes que poden estar endarrerides, incompletes o ser incorrectes, i el
            processament del teu Excel depèn que el fitxer segueixi el format documentat.
          </p>
        ),
      },
      {
        title: "Disponibilitat del servei",
        body: (
          <p>
            El servei s'ofereix tal com és i tal com estigui disponible. No hi ha cap compromís de
            disponibilitat ininterrompuda: pot haver-hi aturades, manteniments o canvis de
            funcionalitat, i els proveïdors externs poden deixar de servir dades en qualsevol
            moment.
          </p>
        ),
      },
      {
        title: "Ús permès",
        body: (
          <p>
            Pots fer servir TrimmTrack per a l'anàlisi de les teves pròpies inversions. No pots
            extreure'n dades de manera automatitzada o massiva, revendre'n el contingut ni fer-lo
            servir per prestar un servei equivalent a tercers, ni intentar accedir a dades d'altres
            usuaris.
          </p>
        ),
      },
      {
        title: "Propietat intel·lectual",
        body: (
          <p>
            El nom, la marca, el disseny, el codi i els textos de TrimmTrack pertanyen als seus
            titulars. Les dades de mercat pertanyen als seus proveïdors i les xifres publicades per
            les empreses, a les empreses.
          </p>
        ),
      },
      {
        title: "Limitació de responsabilitat",
        body: (
          <p>
            En la mesura que ho permeti la llei aplicable, TrimmTrack no respon de les pèrdues
            derivades de decisions preses a partir de la informació que ofereix, ni d'errors,
            retards o interrupcions de les fonts externes. Si no estàs d'acord amb aquest punt, no
            facis servir el servei.
          </p>
        ),
      },
      {
        title: "Canvis i contacte",
        body: (
          <p>
            Aquestes condicions poden canviar quan canviï el servei. El canal oficial de contacte és{" "}
            <XLink />.
          </p>
        ),
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Spanish
// ---------------------------------------------------------------------------

const ES: Record<TrustId, Copy> = {
  about: {
    seoTitle: "Sobre TrimmTrack — qué es y cómo funciona",
    seoDescription:
      "Qué es TrimmTrack, qué herramientas ofrece, de dónde salen los precios y los fundamentales, cómo funcionan los modelos DCF, Graham, Monte Carlo y FIFO, y cómo se escriben los análisis.",
    h1: "Sobre TrimmTrack",
    lead: "TrimmTrack convierte el Excel de tu bróker en un seguimiento de cartera vivo y pone al lado las herramientas de valoración que usas para decidir. Esta página explica qué hace exactamente, con qué datos y con qué límites.",
    sections: [
      {
        title: "Qué es TrimmTrack",
        body: (
          <>
            <p>
              Es una aplicación web para inversores particulares. Subes el Excel de operaciones de
              tu bróker (o añades posiciones a mano) y obtienes la cartera valorada a precios de
              mercado, el resultado realizado y no realizado, los dividendos, la rentabilidad desde
              el inicio y la TIR. Encima hay una capa de herramientas de valoración y análisis que
              puedes usar tanto sobre tus posiciones como sobre cualquier empresa cotizada.
            </p>
            <p>Es un proyecto independiente, sin publicidad y sin comisiones de ningún bróker.</p>
          </>
        ),
      },
      {
        title: "Qué herramientas incluye",
        body: (
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <LocaleLink to="/dashboard" className="text-brand-700 hover:underline">
                Panel de cartera
              </LocaleLink>{" "}
              con valor, pesos, P&L, dividendos, evolución y métricas de riesgo.
            </li>
            <li>
              <LocaleLink to="/explore" className="text-brand-700 hover:underline">
                Fichas de empresa
              </LocaleLink>{" "}
              con estados financieros, múltiplos y seis modelos de valoración.
            </li>
            <li>
              <LocaleLink to="/radiografia" className="text-brand-700 hover:underline">
                Radiografía de cartera
              </LocaleLink>
              : nota de diversificación, concentración y exposición por región y sector.
            </li>
            <li>
              <LocaleLink to="/forecast" className="text-brand-700 hover:underline">
                Simulador de ETFs
              </LocaleLink>{" "}
              con proyección determinista y Monte Carlo.
            </li>
            <li>
              <LocaleLink to="/taxes" className="text-brand-700 hover:underline">
                Borrador fiscal
              </LocaleLink>{" "}
              y{" "}
              <LocaleLink to={ROUTE_SLUGS.fifo.es} className="text-brand-700 hover:underline">
                calculadora FIFO
              </LocaleLink>{" "}
              de plusvalías.
            </li>
            <li>
              <LocaleLink to="/research" className="text-brand-700 hover:underline">
                Análisis
              </LocaleLink>{" "}
              escritos sobre empresas concretas.
            </li>
          </ul>
        ),
      },
      {
        title: "De dónde salen los datos",
        body: (
          <>
            <p>
              Los precios, los tipos de cambio, los fundamentales, los dividendos y los estados
              financieros vienen de Yahoo Finance. Los precios se refrescan con una tarea diaria y
              pueden refrescarse manualmente; el histórico semanal alimenta la evolución de la
              cartera y las métricas de riesgo. Los logotipos los sirve logo.dev.
            </p>
            <p>
              Los datos de tu cartera salen del fichero que subes tú: TrimmTrack no se conecta a tu
              bróker, salvo que uses la verificación opcional con un informe Flex de solo lectura de
              Interactive Brokers.
            </p>
            <p>
              Los datos de proveedores externos pueden llegar con retraso, incompletos o erróneos.
              Contrasta siempre cualquier cifra antes de decidir con ella.
            </p>
          </>
        ),
      },
      {
        title: "Cómo funcionan los modelos, a grandes rasgos",
        body: (
          <>
            <p>
              <strong>DCF simple</strong>: proyecta el beneficio por acción (o el flujo de caja
              libre por acción) con una tasa de crecimiento durante N años, le aplica un múltiplo de
              salida para obtener un precio futuro y lo descuenta a la rentabilidad que exiges. El
              resultado es el precio máximo que puedes pagar hoy para obtener esa rentabilidad.
            </p>
            <p>
              <strong>DCF inverso</strong>: el mismo modelo resuelto al revés. Dado el precio de
              hoy, ¿qué crecimiento constante tendría que estar descontando el mercado?
            </p>
            <p>
              <strong>Número de Graham</strong>: V = BPA × (8,5 + 2g) × 4,4 / Y, la revisión
              ajustada por tipos. Es un cribado rápido y conservador, no una valoración precisa; el
              crecimiento se limita porque el término lineal 2g se infla por encima de cierto punto.
            </p>
            <p>
              <strong>Monte Carlo</strong>: repite el DCF simple miles de veces variando el
              crecimiento y el múltiplo de salida con una desviación que eliges tú, y muestra la
              distribución del valor razonable (P10, mediana, P90) en lugar de un único número
              falsamente preciso.
            </p>
            <p>
              <strong>FIFO</strong>: casa cada venta con las compras más antiguas todavía abiertas
              para calcular el resultado realizado, que es el criterio aplicable en España para
              valores homogéneos.
            </p>
          </>
        ),
      },
      {
        title: "Cómo se escriben los análisis",
        body: (
          <>
            <p>
              Los análisis los redacta el {EDITORIAL.es} y se publican con la fecha de publicación
              visible. Cada texto parte de las cuentas publicadas por la empresa y de los datos de
              mercado que usa el resto de la aplicación; cuando una cifra viene de una fuente
              externa, se enlaza la fuente. No son recomendaciones de compra ni de venta, y no
              existe ningún acuerdo de patrocinio con las empresas analizadas.
            </p>
            <p>
              Los comentarios cualitativos de las fichas de empresa (fortalezas, riesgos y tesis)
              están escritos en catalán. Cuando todavía no hay traducción, la versión en otro idioma
              no muestra el texto catalán: te enlaza la versión catalana y mantiene todos los datos
              cuantitativos, que sí están traducidos.
            </p>
          </>
        ),
      },
      {
        title: "Esto no es asesoramiento financiero",
        body: (
          <p>
            TrimmTrack es una herramienta de información y cálculo. No somos asesores financieros ni
            fiscales, no conocemos tu situación y nada de lo que hay aquí es una recomendación
            personalizada. Las decisiones de inversión, y la verificación de los datos en que se
            basan, son tuyas. Consulta la{" "}
            <LocaleLink to={ROUTE_SLUGS.terms.es} className="text-brand-700 hover:underline">
              información legal
            </LocaleLink>{" "}
            y el{" "}
            <LocaleLink to="/disclaimer" className="text-brand-700 hover:underline">
              descargo de responsabilidad
            </LocaleLink>
            .
          </p>
        ),
      },
      {
        title: "Contacto",
        body: (
          <p>
            El canal oficial es <XLink /> en X. No usamos ningún otro perfil ni canal de soporte.
          </p>
        ),
      },
    ],
  },
  privacy: {
    seoTitle: "Privacidad — qué datos trata TrimmTrack",
    seoDescription:
      "Qué datos guarda TrimmTrack, cuáles no salen nunca de tu navegador, qué proveedores intervienen y cómo pedir su borrado.",
    h1: "Privacidad",
    lead: "Esta página describe lo que hace el código de TrimmTrack con tus datos. Está escrita a partir de la implementación, no de una plantilla.",
    sections: [
      {
        title: "Qué se guarda en el servidor",
        body: (
          <>
            <p>
              Si creas una cuenta, la autenticación la gestiona Neon Auth: ahí quedan tu correo y
              tus credenciales de acceso. El resto de datos se guardan en una base de datos Neon
              Postgres asociada a tu identificador de usuario:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>las operaciones, dividendos, intereses y patrimonio que importas del Excel;</li>
              <li>las hipótesis de los modelos de valoración que guardas para cada empresa;</li>
              <li>
                las instantáneas verificadas que emitas, con las cifras que contienen y su código
                público (puedes revocarlas desde el panel).
              </li>
            </ul>
            <p>
              Los precios, los fundamentales y los estados financieros se guardan en tablas
              compartidas por ticker, no por usuario: no dicen nada de quién tiene qué.
            </p>
          </>
        ),
      },
      {
        title: "Qué no sale del navegador",
        body: (
          <>
            <p>
              La{" "}
              <LocaleLink to="/radiografia" className="text-brand-700 hover:underline">
                radiografía de cartera
              </LocaleLink>{" "}
              y la prueba sin cuenta leen el Excel dentro del navegador y lo guardan solo en la
              sesión del navegador (<code>sessionStorage</code>), que se borra al cerrar la pestaña.
              El fichero no se sube a ningún sitio. El borrador fiscal y la calculadora FIFO también
              calculan en local.
            </p>
            <p>
              En el navegador se guardan además el idioma elegido, la divisa de visualización y el
              hecho de que ya has leído el descargo de responsabilidad. No hay cookies de
              publicidad ni de seguimiento entre webs.
            </p>
          </>
        ),
      },
      {
        title: "Proveedores que intervienen",
        body: (
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Vercel</strong>: alojamiento y funciones de servidor. Recibe las peticiones
              HTTP (y por tanto la dirección IP) y proporciona Vercel Web Analytics, que usamos para
              ver visitas agregadas por página.
            </li>
            <li>
              <strong>Neon</strong>: base de datos y autenticación.
            </li>
            <li>
              <strong>Yahoo Finance</strong>: precios y datos de empresa. Las consultas las hace el
              servidor y solo viajan símbolos de cotización, nunca quién los pide.
            </li>
            <li>
              <strong>logo.dev</strong>: logotipos de empresa. Las imágenes las pide tu navegador
              directamente, de modo que logo.dev ve su dirección IP y el ticker solicitado.
            </li>
            <li>
              <strong>Google Fonts</strong>: tipografías de la interfaz, cargadas por el navegador.
            </li>
            <li>
              <strong>Notion</strong>: aloja el texto de los análisis, que el servidor lee para
              publicarlos.
            </li>
            <li>
              <strong>Interactive Brokers</strong>: solo si usas la verificación opcional. El token
              Flex de solo lectura que pegas se usa para esa llamada y no se guarda, no se escribe
              en ningún registro y no se devuelve.
            </li>
          </ul>
        ),
      },
      {
        title: "Publicidad y venta de datos",
        body: (
          <p>
            El código no contiene ningún SDK de publicidad, marketing o seguimiento entre webs más
            allá de Vercel Web Analytics. Tus datos de cartera no se envían a ningún tercero: los
            únicos destinatarios son los proveedores de infraestructura de la lista anterior.
          </p>
        ),
      },
      {
        title: "Borrar tus datos",
        body: (
          <p>
            Puedes eliminar posiciones desde el panel y revocar cualquier instantánea verificada que
            hayas emitido. Para borrar la cuenta entera y todo lo asociado, escríbenos a <XLink />.
          </p>
        ),
      },
    ],
  },
  terms: {
    seoTitle: "Información legal y condiciones de uso | TrimmTrack",
    seoDescription:
      "Condiciones de uso de TrimmTrack: uso informativo, ausencia de asesoramiento financiero o fiscal, fuentes externas, disponibilidad, propiedad intelectual y limitación de responsabilidad.",
    h1: "Condiciones de uso",
    lead: "Al usar TrimmTrack aceptas lo que se explica en esta página. Está escrita en lenguaje llano y describe el servicio tal como funciona.",
    sections: [
      {
        title: "Uso informativo",
        body: (
          <p>
            TrimmTrack es una herramienta de información y cálculo para inversores particulares. Los
            resultados que muestra son producto de los datos disponibles y de las hipótesis que
            introduces tú; cambiar una hipótesis cambia el resultado.
          </p>
        ),
      },
      {
        title: "No es asesoramiento financiero ni fiscal",
        body: (
          <p>
            Nada de lo que publica TrimmTrack constituye asesoramiento de inversión, recomendación
            personalizada ni asesoramiento fiscal o legal. El borrador fiscal es orientativo y las
            casillas pueden cambiar entre ejercicios: verifícalo siempre con tu asesoría o con la
            administración tributaria antes de presentar nada.
          </p>
        ),
      },
      {
        title: "Verificación de los datos",
        body: (
          <p>
            Eres responsable de comprobar cualquier cifra antes de usarla. Los datos vienen de
            fuentes externas que pueden estar retrasadas, incompletas o ser incorrectas, y el
            procesamiento de tu Excel depende de que el fichero siga el formato documentado.
          </p>
        ),
      },
      {
        title: "Disponibilidad del servicio",
        body: (
          <p>
            El servicio se ofrece tal cual y según disponibilidad. No hay compromiso de
            disponibilidad ininterrumpida: puede haber paradas, mantenimientos o cambios de
            funcionalidad, y los proveedores externos pueden dejar de servir datos en cualquier
            momento.
          </p>
        ),
      },
      {
        title: "Uso permitido",
        body: (
          <p>
            Puedes usar TrimmTrack para analizar tus propias inversiones. No puedes extraer datos de
            forma automatizada o masiva, revender su contenido ni usarlo para prestar un servicio
            equivalente a terceros, ni intentar acceder a datos de otros usuarios.
          </p>
        ),
      },
      {
        title: "Propiedad intelectual",
        body: (
          <p>
            El nombre, la marca, el diseño, el código y los textos de TrimmTrack pertenecen a sus
            titulares. Los datos de mercado pertenecen a sus proveedores y las cifras publicadas por
            las empresas, a las empresas.
          </p>
        ),
      },
      {
        title: "Limitación de responsabilidad",
        body: (
          <p>
            En la medida en que lo permita la ley aplicable, TrimmTrack no responde de las pérdidas
            derivadas de decisiones tomadas a partir de la información que ofrece, ni de errores,
            retrasos o interrupciones de las fuentes externas. Si no estás de acuerdo con este
            punto, no uses el servicio.
          </p>
        ),
      },
      {
        title: "Cambios y contacto",
        body: (
          <p>
            Estas condiciones pueden cambiar cuando cambie el servicio. El canal oficial de contacto
            es <XLink />.
          </p>
        ),
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// English
// ---------------------------------------------------------------------------

const EN: Record<TrustId, Copy> = {
  about: {
    seoTitle: "About TrimmTrack — what it is and how it works",
    seoDescription:
      "What TrimmTrack is, which tools it offers, where prices and fundamentals come from, how the DCF, Graham, Monte Carlo and FIFO models work, and how the analyses are written.",
    h1: "About TrimmTrack",
    lead: "TrimmTrack turns your broker's Excel export into a live portfolio tracker and puts the valuation tools you actually decide with right next to it. This page explains exactly what it does, with which data, and with which limits.",
    sections: [
      {
        title: "What TrimmTrack is",
        body: (
          <>
            <p>
              A web app for individual investors. You upload your broker's transaction Excel (or add
              positions by hand) and get the portfolio marked to market: realised and unrealised
              P&L, dividends, return since inception and IRR. On top of that sits a layer of
              valuation and analysis tools you can run on your own holdings or on any listed
              company.
            </p>
            <p>It is an independent project, with no advertising and no broker commissions.</p>
          </>
        ),
      },
      {
        title: "What is included",
        body: (
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <LocaleLink to="/dashboard" className="text-brand-700 hover:underline">
                Portfolio dashboard
              </LocaleLink>{" "}
              with value, weights, P&L, dividends, history and risk metrics.
            </li>
            <li>
              <LocaleLink to="/explore" className="text-brand-700 hover:underline">
                Company pages
              </LocaleLink>{" "}
              with financial statements, multiples and six valuation models.
            </li>
            <li>
              <LocaleLink to="/radiografia" className="text-brand-700 hover:underline">
                Portfolio X-ray
              </LocaleLink>
              : a diversification grade, concentration, and region and sector exposure.
            </li>
            <li>
              <LocaleLink to="/forecast" className="text-brand-700 hover:underline">
                ETF simulator
              </LocaleLink>{" "}
              with deterministic and Monte Carlo projections.
            </li>
            <li>
              <LocaleLink to="/taxes" className="text-brand-700 hover:underline">
                Tax draft
              </LocaleLink>{" "}
              and{" "}
              <LocaleLink to={ROUTE_SLUGS.fifo.en} className="text-brand-700 hover:underline">
                FIFO capital-gains calculator
              </LocaleLink>
              .
            </li>
            <li>
              <LocaleLink to="/research" className="text-brand-700 hover:underline">
                Written analyses
              </LocaleLink>{" "}
              of individual companies.
            </li>
          </ul>
        ),
      },
      {
        title: "Where the data comes from",
        body: (
          <>
            <p>
              Prices, FX rates, fundamentals, dividends and financial statements come from Yahoo
              Finance. Prices refresh on a daily job and can be refreshed manually; the weekly
              history feeds the portfolio evolution chart and the risk metrics. Company logos are
              served by logo.dev.
            </p>
            <p>
              Your portfolio data comes from the file you upload: TrimmTrack does not connect to
              your broker, unless you use the optional verification with a read-only Interactive
              Brokers Flex report.
            </p>
            <p>
              Third-party data can be delayed, incomplete or wrong. Always check a figure before
              acting on it.
            </p>
          </>
        ),
      },
      {
        title: "How the models work, at a high level",
        body: (
          <>
            <p>
              <strong>Simple DCF</strong>: projects earnings per share (or free cash flow per share)
              at a growth rate for N years, applies an exit multiple to get a future price, and
              discounts that back at the return you require. The result is the highest price you can
              pay today and still earn that return.
            </p>
            <p>
              <strong>Reverse DCF</strong>: the same model solved backwards. Given today's price,
              what constant growth would the market have to be assuming?
            </p>
            <p>
              <strong>Graham number</strong>: V = EPS × (8.5 + 2g) × 4.4 / Y, the
              interest-rate-adjusted revision. A fast, conservative screen rather than a precise
              valuation; growth is capped because the linear 2g term over-inflates beyond a point.
            </p>
            <p>
              <strong>Monte Carlo</strong>: runs the simple DCF thousands of times, varying growth
              and the exit multiple by a standard deviation you choose, and shows the distribution
              of fair value (P10, median, P90) instead of one falsely precise number.
            </p>
            <p>
              <strong>FIFO</strong>: matches each sale against the oldest open purchases to compute
              the realised result — the rule Spain applies to fungible securities.
            </p>
          </>
        ),
      },
      {
        title: "How the analyses are written",
        body: (
          <>
            <p>
              Analyses are written by the {EDITORIAL.en} and published with a visible publication
              date. Each one starts from the company's published accounts and the same market data
              the rest of the app uses; when a figure comes from an external source, that source is
              linked. They are not buy or sell recommendations, and there is no sponsorship
              arrangement with the companies covered.
            </p>
            <p>
              The qualitative commentary on company pages (strengths, risks and thesis) is written
              in Catalan. Where no translation exists yet, the other language versions do not show
              the Catalan text: they link to the Catalan version and keep all the quantitative data,
              which is translated.
            </p>
          </>
        ),
      },
      {
        title: "This is not financial advice",
        body: (
          <p>
            TrimmTrack is an information and calculation tool. We are not financial or tax advisers,
            we do not know your circumstances, and nothing here is a personalised recommendation.
            Investment decisions — and verifying the data behind them — are yours. See the{" "}
            <LocaleLink to={ROUTE_SLUGS.terms.en} className="text-brand-700 hover:underline">
              terms
            </LocaleLink>{" "}
            and the{" "}
            <LocaleLink to="/disclaimer" className="text-brand-700 hover:underline">
              disclaimer
            </LocaleLink>
            .
          </p>
        ),
      },
      {
        title: "Contact",
        body: (
          <p>
            The official channel is <XLink /> on X. We use no other profile and no other support
            channel.
          </p>
        ),
      },
    ],
  },
  privacy: {
    seoTitle: "Privacy — what data TrimmTrack handles",
    seoDescription:
      "What TrimmTrack stores, what never leaves your browser, which providers are involved, and how to request deletion.",
    h1: "Privacy",
    lead: "This page describes what TrimmTrack's code does with your data. It is written from the implementation, not from a template.",
    sections: [
      {
        title: "What is stored on the server",
        body: (
          <>
            <p>
              If you create an account, authentication is handled by Neon Auth, which holds your
              email address and sign-in credentials. Everything else is stored in a Neon Postgres
              database against your user id:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>the transactions, dividends, interest and wealth entries you import from Excel;</li>
              <li>the valuation-model assumptions you save per company;</li>
              <li>
                any verified snapshot you issue, with the figures it contains and its public code
                (revocable from the dashboard).
              </li>
            </ul>
            <p>
              Prices, fundamentals and financial statements live in tables shared per ticker, not
              per user: they say nothing about who holds what.
            </p>
          </>
        ),
      },
      {
        title: "What never leaves the browser",
        body: (
          <>
            <p>
              The{" "}
              <LocaleLink to="/radiografia" className="text-brand-700 hover:underline">
                portfolio X-ray
              </LocaleLink>{" "}
              and the no-account trial read the Excel inside your browser and keep it only in
              browser session storage (<code>sessionStorage</code>), which is cleared when you close
              the tab. The file is not uploaded anywhere. The tax draft and the FIFO calculator also
              compute locally.
            </p>
            <p>
              The browser additionally stores your chosen language, your display currency, and the
              fact that you have read the disclaimer. There are no advertising or cross-site
              tracking cookies.
            </p>
          </>
        ),
      },
      {
        title: "Providers involved",
        body: (
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Vercel</strong>: hosting and serverless functions. It receives the HTTP
              requests (and therefore the IP address) and provides Vercel Web Analytics, which we
              use for aggregate page views.
            </li>
            <li>
              <strong>Neon</strong>: database and authentication.
            </li>
            <li>
              <strong>Yahoo Finance</strong>: prices and company data. Queries are made by the
              server and carry ticker symbols only, never who asked for them.
            </li>
            <li>
              <strong>logo.dev</strong>: company logos. Your browser requests those images directly,
              so logo.dev sees its IP address and the ticker requested.
            </li>
            <li>
              <strong>Google Fonts</strong>: interface typefaces, loaded by the browser.
            </li>
            <li>
              <strong>Notion</strong>: hosts the text of the analyses, which the server reads to
              publish them.
            </li>
            <li>
              <strong>Interactive Brokers</strong>: only if you use the optional verification. The
              read-only Flex token you paste is used for that call and is never stored, never logged
              and never returned.
            </li>
          </ul>
        ),
      },
      {
        title: "Advertising and data sales",
        body: (
          <p>
            The code contains no advertising, marketing or cross-site tracking SDK beyond Vercel Web
            Analytics. Your portfolio data is not sent to any third party: the only recipients are
            the infrastructure providers listed above.
          </p>
        ),
      },
      {
        title: "Deleting your data",
        body: (
          <p>
            You can remove positions from the dashboard and revoke any verified snapshot you have
            issued. To delete the whole account and everything attached to it, write to <XLink />.
          </p>
        ),
      },
    ],
  },
  terms: {
    seoTitle: "Terms of use | TrimmTrack",
    seoDescription:
      "TrimmTrack terms of use: informational purpose, no financial or tax advice, external sources, availability, intellectual property and limitation of liability.",
    h1: "Terms of use",
    lead: "By using TrimmTrack you accept what this page describes. It is written in plain language and reflects how the service actually works.",
    sections: [
      {
        title: "Informational use",
        body: (
          <p>
            TrimmTrack is an information and calculation tool for individual investors. What it
            shows is the product of the available data and the assumptions you enter; change an
            assumption and the result changes.
          </p>
        ),
      },
      {
        title: "Not financial or tax advice",
        body: (
          <p>
            Nothing TrimmTrack publishes constitutes investment advice, a personalised
            recommendation, or tax or legal advice. The tax draft is indicative and box numbers can
            change between tax years: always verify with your adviser or the tax authority before
            filing anything.
          </p>
        ),
      },
      {
        title: "Verifying the data",
        body: (
          <p>
            You are responsible for checking any figure before relying on it. Data comes from
            external sources that may be delayed, incomplete or wrong, and processing your Excel
            depends on the file following the documented format.
          </p>
        ),
      },
      {
        title: "Service availability",
        body: (
          <p>
            The service is provided as is and as available. There is no uptime commitment: outages,
            maintenance and functional changes can happen, and external providers can stop serving
            data at any time.
          </p>
        ),
      },
      {
        title: "Permitted use",
        body: (
          <p>
            You may use TrimmTrack to analyse your own investments. You may not extract data in an
            automated or bulk fashion, resell its content, use it to provide an equivalent service
            to third parties, or attempt to access other users' data.
          </p>
        ),
      },
      {
        title: "Intellectual property",
        body: (
          <p>
            The TrimmTrack name, brand, design, code and texts belong to their owners. Market data
            belongs to its providers, and figures published by companies belong to those companies.
          </p>
        ),
      },
      {
        title: "Limitation of liability",
        body: (
          <p>
            To the extent permitted by applicable law, TrimmTrack is not liable for losses arising
            from decisions taken on the basis of the information it provides, nor for errors, delays
            or interruptions in external sources. If you do not agree with this, do not use the
            service.
          </p>
        ),
      },
      {
        title: "Changes and contact",
        body: (
          <p>
            These terms may change as the service changes. The official contact channel is <XLink />
            .
          </p>
        ),
      },
    ],
  },
};

const CONTENT: Record<Locale, Record<TrustId, Copy>> = { ca: CA, es: ES, en: EN };

const SCHEMA_TYPE: Record<TrustId, string> = {
  about: "AboutPage",
  privacy: "WebPage",
  terms: "WebPage",
};

export function TrustPage({ id, locale }: { id: TrustId; locale: Locale }) {
  const copy = CONTENT[locale][id];
  const path = ROUTE_SLUGS[id][locale];
  const canonical = localeUrl(path, locale);

  const jsonLd = useMemo(
    () => ({
      "@context": "https://schema.org",
      "@type": SCHEMA_TYPE[id],
      name: copy.h1,
      description: copy.seoDescription,
      url: canonical,
      inLanguage: locale,
      publisher: {
        "@type": "Organization",
        name: "TrimmTrack",
        url: `${localeUrl("/", "ca")}`,
        sameAs: [X_URL],
      },
    }),
    [id, copy.h1, copy.seoDescription, canonical, locale],
  );

  useSeo({
    title: copy.seoTitle,
    description: copy.seoDescription,
    path,
    alternates: ALL_LOCALES,
    jsonLd,
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{copy.h1}</h1>
        <p className="mt-2 text-slate-600">{copy.lead}</p>
      </header>

      {copy.sections.map((s) => (
        <section key={s.title} className="space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">{s.title}</h2>
          <div className="space-y-3 text-sm leading-relaxed text-slate-600">{s.body}</div>
        </section>
      ))}
    </div>
  );
}
