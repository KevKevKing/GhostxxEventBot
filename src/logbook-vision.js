const { config } = require('./config');
const { chat } = require('./ollama');
const { zuschneiden } = require('./bild-zuschnitt');
const { halteFest, merke } = require('./bild-gedaechtnis');
const { EVENTS, bewusstIgnoriert, findEventsInImageText } = require('./logbook-events');
const { normalizeText } = require('./text-match');

const ANZEIGE_MAX_LAENGE = 200;

// Erkennt eine Wiederholungsschleife im Rohtext: dasselbe Wortpaar taucht so
// oft auf, dass es fast den ganzen Text ausmacht. Das ist kein echter
// Lesefund mehr, sondern das Modell, das sich festgefahren hat.
//
// Kevins Meldung (30.08.): eine Auszahlungsnachricht zitierte woertlich
// "10 EL EGNU" ueber zehnmal hintereinander, einmal sogar mit "markdown"
// mittendrin - klarer Hinweis, dass das Modell fantasiert statt liest. Die
// 200-Token-Grenze (siehe frageModell oben) verhindert nur das ENDLOSE
// Weiterlaufen, nicht dass sich das Modell schon INNERHALB der Grenze in
// eine Schleife dreht.
//
// Wortbasiert statt Zeichen-Regex, weil sich die Schleife nicht immer exakt
// wiederholt (Leerzeichen, Reihenfolge) - das Wortpaar bleibt aber gleich.
// Schwelle (4x, 50% des Textes) gemessen an echten Beispielen aus diesem
// Ticket und an legitimen Lesungen aus frueheren Sessions - keine der
// legitimen Lesungen (auch lange mit mehrfachem "EL EGNU") schlaegt an.
function istWiederholungsschleife(text) {
  const woerter = String(text || '').toLowerCase().match(/\S+/g) || [];
  if (woerter.length < 8) return false;

  const bigramme = new Map();
  for (let i = 0; i < woerter.length - 1; i += 1) {
    const b = `${woerter[i]} ${woerter[i + 1]}`;
    bigramme.set(b, (bigramme.get(b) || 0) + 1);
  }
  const meist = Math.max(...bigramme.values());
  return meist >= 4 && (meist * 2) / woerter.length >= 0.5;
}

// Rohtext des Vision-Modells fuer einen Discord-Kommentar saeubern.
//
// glm-ocr ist am 18.08. bei einem Bild in eine Wiederholungsschleife aus
// leeren ``` -Bloecken gerutscht, statt nach dem gelesenen Text abzubrechen -
// der ganze Muell landete ungekuerzt und ungefiltert im Logbuch-Kommentar.
// Rohtext geht deshalb nie direkt in eine Nachricht, immer erst hier durch.
function fuerAnzeige(text) {
  const bereinigt = String(text || '').replace(/`+/g, '').replace(/\s+/g, ' ').trim();
  if (!bereinigt) return 'nichts';
  if (istWiederholungsschleife(bereinigt)) return 'wirkt wie eine Wiederholungsschleife, nicht lesbar';
  return bereinigt.length > ANZEIGE_MAX_LAENGE
    ? `${bereinigt.slice(0, ANZEIGE_MAX_LAENGE)}…`
    : bereinigt;
}

// Prueft, ob ein Screenshot zur Angabe im Text passt.
//
// Bewusst als Pruefung, nicht als freies Erkennen: der Text sagt bereits
// "40er win", das Bild muss das nur bestaetigen. Frueher (qwen3-vl) hat das
// Modell bei zwei gleichzeitig eingeblendeten Events manchmal das falsche
// gewaehlt - mit der Vorgabe aus dem Text passiert das nicht mehr.
//
// Der Eventname kann an zwei Stellen stehen: oben rechts im kleinen Kasten
// waehrend des Events, oder gross auf dem Abschlussbildschirm (SK zusaetzlich
// nur als zwei Wappen, siehe erkenneWappen()). glm-ocr bekommt deshalb erst
// den Ausschnitt oben rechts, bei Fehlanzeige das ganze Bild - siehe
// leseEventsFrisch().

const KATALOG = EVENTS
  .filter((event) => event.ingame.length)
  .map((event) => `- ${event.label}: heisst im Spiel "${event.ingame.join('" oder "')}"`)
  .join('\n');

// Erkennt die zwei Familienwappen waehrend SK, auch aus verlesenem OCR-Text.
//
// Gemessen an Kevins fuenf echten SK-Wappenbildern (17.08.): glm-ocr liest
// den eigenen Familiennamen "Unknown" nie zweimal gleich - "Unkowns" (Abstand
// 3), "Uknownow" (3), "Unikown" (2), "Uniknown" (1), "Unikarten" (weit weg -
// diese eine Lesung war zu kaputt, um sie zu retten) waren die fuenf Lesungen.
// Ein exakter Textvergleich haette keine einzige erkannt, und Abstand 2 nur
// zwei von fuenf.
//
// Bei Abstand 3 bleibt es sicher: das naechste unbeteiligte Wort aus der
// gesamten Messung (u.a. "Silent", "Shadow", "Ressourcen", "Rassauren") liegt
// bei Abstand 5, mit klarer Luft dazwischen.
//
// Zwei Signale zusammen, nicht eins alleine:
//  1. ein Wort nah an "unknown" (bis zu drei Buchstaben daneben)
//  2. eine Uhrzeit im Format MM:SS (der Timer zwischen den beiden Wappen)
//
// "Unknown" allein waere zu locker - es ist der Name der eigenen Familie und
// taucht auch in ganz anderen HUD-Elementen auf (z.B. als Status auf
// Rang-Tafeln). Der Timer allein waere es auch, jedes Event hat einen. Erst
// beides zusammen, UND kein bekanntes Event im Bild (das prueft der Aufrufer),
// ist das verlaessliche Muster des Wappen-Kastens.
function levenshtein(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i][j] = a[i - 1] === b[j - 1]
        ? d[i - 1][j - 1]
        : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
    }
  }
  return d[a.length][b.length];
}

const ZEIT_MUSTER = /\b\d{1,2}:\d{2}\b/;

// Erster Versuch hatte einen echten Fehlalarm: JEDER laufende Event-Kasten
// zeigt "<Zahl> Unknown <Timer>" (die eigene Teilnehmerzahl), nicht nur der
// SK-Wappen-Kasten. Gemessen an zwei echten Bildern ("Krieg um Rassauren",
// "Krieg / Feesourcen") - beides verlesene 40er-Kaesten, die der Katalog
// deshalb nicht fand - waeren faelschlich als SK bestaetigt worden.
//
// Der Unterschied: ein Event-Kasten hat vor der Teilnehmerzahl einen
// Ankuendigungs-Satz ("Krieg um ...", "Schlacht im ...", "Uebernahme ...").
// Der reine Wappen-Kasten hat das nie - dort steht nur der Gegnername neben
// dem eigenen, kein Verb. Diese Woerter schliessen die Erkennung deshalb aus.
const ANKUENDIGUNGS_WOERTER = ['krieg', 'schlacht', 'uebernahme', 'kampf'];

function erkenneWappen(text) {
  if (!ZEIT_MUSTER.test(text)) return false;

  const normText = normalizeText(text);
  if (ANKUENDIGUNGS_WOERTER.some((wort) => normText.includes(wort))) return false;

  const worte = normText.split(' ');
  return worte.some((wort) => (
    wort.length >= 6 && wort.length <= 10 && levenshtein(wort, 'unknown') <= 3
  ));
}

// Seit 17.08.: glm-ocr statt qwen3-vl:8b (siehe config.js).
//
// glm-ocr ist ein reines OCR-Modell - es liest stumpf ab, was im Bild steht,
// ohne zu interpretieren. Die Formatvorgabe (EVENTS:/GEWINNENDE_FAMILIE:/
// WAPPEN:) faellt weg: die Zuordnung zum Eventkatalog macht ohnehin der Code
// (findEventsInImageText), nicht das Modell.
const PROMPT = 'Lies allen Text im Bild ab.';

async function frageModell(imageBase64, prompt, optionen = {}) {
  // Standardmaessig auf dem Prozessor: die Auszahlung ist ein Stapeljob, da
  // wartet niemand. Dafuer bleibt die Grafikkarte frei - man kann also
  // weiterspielen, waehrend er auswertet.
  const aufCpu = optionen.aufCpu ?? config.ollamaVisionOnCpu;

  const result = await chat({
    model: optionen.model || config.ollamaEventVisionModel,
    messages: [{ role: 'user', content: prompt, images: [imageBase64] }],
    temperature: 0,
    ...(aufCpu ? { numGpu: 0 } : {}),
    keepAlive: config.ollamaVisionKeepAlive,
    // Ohne Obergrenze haengt glm-ocr endlos denselben Fund und irgendwann
    // sogar den PROMPT selbst aneinander, bis die Zeitgrenze zuschlaegt -
    // gemessen an Kevins fuenf SK-Bildern, wo nach dem echten Fund ("EL EGNU
    // 14:30 Unknown") "Lies allen Text im Bild ab." im Kreis wiederholt wurde.
    // 200 Token reichen fuer jede echte Lesung mit Luft (die laengste
    // gemessene Lesung ohne Wiederholung lag bei rund 90 Zeichen) und
    // schneiden VOR der Wiederholungsschleife ab.
    numPredict: 200,
  });

  // Ob die Zeit abgelaufen ist, muss durchgereicht werden: eine
  // Zeitueberschreitung sagt nichts ueber das Bild aus, sondern nur darueber,
  // dass die Grafikkarte gerade beschaeftigt war. So ein Versuch darf nicht
  // als "unlesbar" gelten.
  if (!result.ok) return { ok: false, error: result.error, timedOut: Boolean(result.timedOut) };

  const antwort = parseAnswer(result.content);
  return { ok: true, antwort, gefundene: matchCatalog(antwort.events), ms: result.ms };
}

/**
 * Liest ein Bild - aus dem Gedaechtnis, wenn moeglich, sonst frisch (siehe
 * leseEventsFrisch fuer die Reihenfolge Ausschnitt/ganzes Bild).
 */
async function leseEvents(imageBase64, optionen = {}) {
  // Schon einmal gelesen? Was im Bild steht, aendert sich nicht.
  //
  // Das ist der Grund, warum die Sammelauszahlung nicht mehr stundenlang
  // rechnet: die Bilder sind laengst gelesen, sobald sie hochgeladen wurden.
  // Ein Fund ist endgueltig, eine Fehlanzeige nicht.
  //
  // "Da steht 40er" kann sich nicht aendern - das Bild bleibt ja gleich.
  // "Da steht nichts" kann dagegen ein Uebersehen sein: der Kasten oben rechts
  // ist klein, und genau so ist ihm einmal ein "Krieg um Ressourcen" durch die
  // Lappen gegangen, das gut lesbar im Bild stand.
  //
  // Deshalb bekommt eine Fehlanzeige einen zweiten Blick. Beim zweiten Mal
  // dasselbe Ergebnis heisst: da ist wirklich nichts.
  const gemerkt = optionen.ohneGedaechtnis ? null : await merke(imageBase64).catch(() => null);

  if (gemerkt?.antwort) {
    const hatteFund = matchCatalog(gemerkt.antwort.events).length > 0 || gemerkt.antwort.wappen;
    const genugVersucht = (gemerkt.leerVersuche || 0) >= 2;

    if (hatteFund || genugVersucht) {
      return {
        ok: true,
        antwort: gemerkt.antwort,
        gefundene: matchCatalog(gemerkt.antwort.events),
        ms: 0,
        ausGedaechtnis: true,
        zweiterAnlauf: gemerkt.zweiterAnlauf,
      };
    }
  }

  // Fuer die Sammelauszahlung: nur aus dem Gedaechtnis vorlesen, nie selbst
  // die Grafikkarte anwerfen. Steht noch nichts Brauchbares da, wird das
  // Bild nicht hier und jetzt gelesen, sondern nur fuer den Hintergrund
  // vorgemerkt (siehe pruefeEintrag) - Kevins Ansage: "er schickt seinen
  // Stand und holt den Rest im Hintergrund nach".
  if (optionen.nurGedaechtnis) {
    return { ok: false, nichtGelesen: true, error: 'noch nicht gelesen' };
  }

  const ergebnis = await leseEventsFrisch(imageBase64, optionen);

  if (ergebnis.ok && !optionen.ohneGedaechtnis) {
    const fund = ergebnis.gefundene.length > 0 || ergebnis.antwort.wappen;
    await halteFest(imageBase64, {
      antwort: ergebnis.antwort,
      zweiterAnlauf: Boolean(ergebnis.zweiterAnlauf),
      events: ergebnis.gefundene.map((e) => e.key),
      labels: ergebnis.gefundene.map((e) => e.label),
      ms: ergebnis.ms,
      leerVersuche: fund ? 0 : (gemerkt?.leerVersuche || 0) + 1,
    }).catch(() => null);
  }

  return ergebnis;
}

/**
 * Erst der Ausschnitt, bei Fehlanzeige das ganze Bild.
 *
 * Umgekehrte Reihenfolge als frueher bei qwen3-vl - dort ging es zuerst ums
 * ganze Bild fuer den Zusammenhang. glm-ocr transkribiert dagegen stumpf
 * ALLES, was im Bild steht: beim vollen, unbeschnittenen Bild dauerte ein
 * einzelner Lesevorgang gemessen bis zu 101 Sekunden (Chat, Kaufgesuche,
 * Killerliste, alles wird mitgelesen). Im Ausschnitt (der kleine Kasten oben
 * rechts) sind es 2 bis 6 Sekunden - und an neun echten Nachweisen exakt
 * dieselben Treffer wie qwen3-vl mit vollem Bild plus Ausschnitt zusammen.
 *
 * Das ganze Bild bleibt als zweiter Anlauf: der Abschlussbildschirm zeigt
 * "GEWINNENDE FAMILIE" und den Eventnamen in riesigen Buchstaben MITTIG, nicht
 * oben rechts - der Ausschnitt sieht das nicht. Dieser Fall kostet also nur
 * dann die 101 Sekunden, wenn der schnelle Ausschnitt wirklich nichts fand.
 */
// Zuschnitt je nach behauptetem Typ (23.08., siehe bild-zuschnitt.js) - SK
// oben mittig (Wappen), alles andere enger oben rechts (Eventkasten, ohne
// Serverlogo und ohne die Popups darunter). Ohne einen Typ (kein Text-Claim,
// z.B. bei readEventFromImage) bleibt es beim breiten, generischen Streifen.
function schnittFuerTyp(vermuteterTyp) {
  if (vermuteterTyp === 'sk') return { links: 0.40, rechts: 0.60, hoehe: 0.13 };
  if (vermuteterTyp) return { links: 0.63, rechts: 0.90, hoehe: 0.10 };
  return {};
}

async function leseEventsFrisch(imageBase64, optionen = {}) {
  const buffer = Buffer.from(imageBase64, 'base64');
  const schnitt = await zuschneiden(buffer, schnittFuerTyp(optionen.vermuteterTyp));
  const schnittBase64 = schnitt.ok ? schnitt.buffer.toString('base64') : imageBase64;

  const ersterVersuch = await frageModell(schnittBase64, PROMPT, optionen);
  if (!ersterVersuch.ok) return ersterVersuch;
  if (ersterVersuch.gefundene.length) return { ...ersterVersuch, ausAusschnitt: schnitt.ok };

  // Der enge, typgeleitete Ausschnitt lag daneben - haeufigster Grund: der
  // Text behauptet etwas anderes, als tatsaechlich im Bild steht. Naechste
  // Stufe ist der alte, breite Ausschnitt (deckt SK und alle anderen Events
  // gleichzeitig ab), NICHT gleich das ganze Bild.
  //
  // Gemessen 23.08.: direkt zum vollen Bild zu springen fand ein echtes 40er
  // NICHT - das Modell liest beim ungeschnittenen Bild zuerst den Chatverlauf
  // vor und ist beim 200-Token-Limit fertig, bevor es zum Eventkasten kommt.
  // Der breite Ausschnitt laesst den Chat von vornherein weg und hat das
  // selbe Bild zuverlaessig gefunden. Nur wenn KEIN Typ vermutet wurde, war
  // der erste Anlauf schon der breite Ausschnitt - dann bringt diese Stufe
  // nichts Neues und wird uebersprungen.
  if (optionen.vermuteterTyp) {
    const breiterSchnitt = await zuschneiden(buffer);
    if (breiterSchnitt.ok) {
      const zweiterVersuch = await frageModell(breiterSchnitt.buffer.toString('base64'), PROMPT, optionen);
      if (zweiterVersuch.ok && zweiterVersuch.gefundene.length) {
        return { ...zweiterVersuch, zweiterAnlauf: true, ausBreitemSchnitt: true };
      }
    }
  }

  // Naechster Anlauf: das ganze Bild, falls beide Ausschnitte etwas verpasst
  // haben, das nicht oben steht - z.B. der Abschlussbildschirm mit
  // "GEWINNENDE FAMILIE" gross mittig.
  const drittVersuch = await frageModell(imageBase64, PROMPT, optionen);
  if (drittVersuch.ok && drittVersuch.gefundene.length) {
    return { ...drittVersuch, zweiterAnlauf: true };
  }

  // Letzter Anlauf, eng auf den Abschlussbildschirm zugeschnitten
  // (24.08., an Kevins RESSOURCENKRIEG-Bild gemessen): das VOLLE Bild liest
  // "TOP 20 KILLER" zuverlaessig, laesst aber den Titel ("RESSOURCENKRIEG")
  // manchmal einfach aus, bevor es zur Kill-Liste weiterspringt - 5/5 Treffer
  // im Testbild waren es erst NACH dem Zuschnitt, ohne die Kill-Liste als
  // Ablenkung. Titel und "GEWINNENDE FAMILIE" stehen beide links, zwischen
  // etwa 18% und 88% der Hoehe.
  const abschlussSchnitt = await zuschneiden(buffer, { links: 0, rechts: 0.46, oben: 0.18, hoehe: 0.70 });
  if (abschlussSchnitt.ok) {
    const viertVersuch = await frageModell(abschlussSchnitt.buffer.toString('base64'), PROMPT, optionen);
    if (viertVersuch.ok && viertVersuch.gefundene.length) {
      return { ...viertVersuch, zweiterAnlauf: true, ausAbschlussSchnitt: true };
    }
  }

  if (!drittVersuch.ok) return ersterVersuch;

  // Ein dritter Anlauf mit dem erwarteten Eventnamen als Hinweis wurde
  // versucht und wieder verworfen (18.08.): glm-ocr hat einen FALSCH
  // vorgegebenen Hinweis teils woertlich zurueckpapageit, statt zuzugeben,
  // dass es nichts sieht - und das waere als bestaetigter Fund durchgegangen.
  // Zwei Versuche, das sicher abzugrenzen (Wiederholungshaeufigkeit,
  // Aehnlichkeit zum ersten Anlauf), sind an echten Daten gescheitert - bei
  // 15 gemessenen Bildern ueberlappten sich die Werte fuer "Hinweis stimmt"
  // und "Hinweis stimmt nicht" so stark, dass keine Schwelle beides trennte.
  // Schiene 1 (Text ohne Bild-Beleg) ist abgesichert, Schiene 2 (Modell
  // "sieht" etwas, das nicht da ist) liess sich nicht sicher genug bauen.

  return ersterVersuch;
}

/**
 * glm-ocr liefert rohen Text, kein Formular. Das genuegt fuer die Zuordnung -
 * findEventsInImageText sucht direkt im Fliesstext, egal wie er aussieht.
 */
function parseAnswer(content) {
  const roh = String(content || '').trim();

  // glm-ocr wiederholt nach einem echten Fund manchmal seinen eigenen Prompt
  // im Kreis (siehe Kommentar bei numPredict oben) - die 200-Token-Grenze
  // deckelt nur die Laenge, kurze Wiederholungen (gemessen: 10x "05:40 /
  // Lies allen Text im Bild ab.") rutschen trotzdem durch und verschmutzen
  // sowohl den Katalog-Abgleich als auch den Discord-Kommentar. Der Prompt
  // kann nie echter Bildinhalt sein - sein erstes Auftauchen im Text ist
  // deshalb zuverlaessig das Ende der echten Lesung.
  const echoAb = roh.indexOf(PROMPT);
  const text = echoAb === -1 ? roh : roh.slice(0, echoAb).trim();

  // Bestenfalls extrahiert, kein verlaesslicher Wert: glm-ocr liest Woerter,
  // keine Formularfelder. "GEWINNENDE FAMILIE" steht meist gross auf dem
  // Abschlussbildschirm direkt vor dem Familiennamen.
  const gewinnerMatch = /gewinnende\s*famili\w*[:\s]+([a-zA-ZÀ-ÿ0-9 .\-]{2,30})/i.exec(text);
  const gewinner = gewinnerMatch ? gewinnerMatch[1].trim() : '';

  return {
    events: text,
    gewinner,
    wappen: erkenneWappen(text),
  };
}

/** Welche Events aus dem Katalog stecken im Gelesenen? Wohnt beim Katalog. */
const matchCatalog = findEventsInImageText;

/**
 * @returns {{ok: boolean, verified: boolean|null, reason: string, details: object}}
 *   verified === null heisst: nicht pruefbar (SK, EKZ haben keinen Namen im Bild).
 */
async function verifyImage(imageBase64, event, optionen = {}) {
  // Was im Text behauptet wird, sagt dem Zuschnitt, wo er hinschauen soll -
  // siehe schnittFuerTyp() oben.
  const result = await leseEvents(imageBase64, { ...optionen, vermuteterTyp: event?.key });

  if (!result.ok) {
    return {
      ok: false,
      verified: null,
      nichtGelesen: Boolean(result.nichtGelesen),
      reason: result.nichtGelesen
        ? 'noch nicht gelesen — wird nachgeholt'
        : `Bild nicht lesbar: ${result.error}`,
      details: {},
    };
  }

  const antwort = result.antwort;
  const gefundene = result.gefundene;
  const details = {
    ...antwort,
    gefundene: gefundene.map((e) => e.label),
    ms: result.ms,
    zweiterAnlauf: Boolean(result.zweiterAnlauf),
  };

  const andere = gefundene.filter((kandidat) => kandidat.key !== event.key);

  // Die zwei Familienwappen sind der zweite Weg zum SK.
  //
  // Waehrend des Events steht wirklich kein Name im Bild, nur die beiden
  // Wappen mit Spielerzahlen oben. Auf dem Abschlussbildschirm steht dagegen
  // "STAATLICHE KONTROLLE" gross da - deshalb hat SK jetzt beides: einen
  // Namen im Katalog UND die Wappen.
  //
  // Bis 17.08. stand hier zusaetzlich "!andere.length" - ein GEFUNDENES
  // anderes Event hat die Wappen-Bestaetigung blockiert. Der Gedanke damals:
  // ein anderes Event im Bild heisst, die Wappen sind vermutlich ein
  // Fehlalarm von DIESEM Event (jeder Kasten zeigt "N Unknown", siehe
  // erkenneWappen()).
  //
  // Genau das faengt erkenneWappen() seit seinem Bau aber schon selbst ab
  // (ANKUENDIGUNGS_WOERTER - "Krieg", "Schlacht" usw. schliessen die
  // Erkennung aus). Was durchkam, war deshalb ein ECHTER, EIGENSTAENDIGER
  // Fund - und "!andere.length" hat dann einen legitimen Nachweis kaputt
  // gemacht: Zarti spielte SK UND gleichzeitig einen Banküberfall - beides
  // echt, beides gleichzeitig im Bild, kein Widerspruch. Der Bot hat trotzdem
  // "Im Bild steht Bank, angegeben war SK" gesagt und den echten SK-Nachweis
  // abgelehnt.
  if (event.key === 'sk' && antwort.wappen) {
    return { ok: true, verified: true, reason: 'Zwei Familienwappen erkannt', details };
  }

  // Steht im Bild etwas, das wir kennen und bewusst nicht zaehlen, gehoert das
  // gesagt. "Kein Event drauf" waere unhoeflich und auch falsch - es steht ja
  // eins drauf, es zaehlt nur nicht.
  const ignoriert = !gefundene.length && bewusstIgnoriert(antwort.events);
  if (ignoriert) {
    return {
      ok: true,
      verified: null,
      reason: `Im Bild steht „${fuerAnzeige(antwort.events)}" — ${ignoriert.warum}`,
      details,
    };
  }

  // Ein Event ohne Namen im Bild laesst sich nicht bestaetigen. Das ist kein
  // Vorwurf - es steht dort einfach nichts zu lesen.
  if (!event.ingame.length) {
    return {
      ok: true,
      verified: null,
      reason: `${event.label} steht nicht als Name im Bild — nicht prüfbar`,
      details,
    };
  }

  const passt = gefundene.some((kandidat) => kandidat.key === event.key);

  // Das Angegebene steht drauf - aber es steht noch etwas anderes daneben.
  //
  // Frueher hat er hier abgehakt, sobald das angegebene Event dabei war, und
  // gar nicht hingesehen, was sonst noch im Bild steht. Genau so ist das
  // Ankuendigungsbanner in der Ecke als BizWar-Nachweis durchgegangen.
  //
  // Auf dem anderen Weg (Text nennt kein Event) galt das schon immer: bei
  // zwei Events wird nicht gewertet, weil unklar ist, welches gemeint war.
  // Hier gilt es jetzt auch. Menschenaugen entscheiden das besser.
  if (passt && andere.length) {
    return {
      ok: true,
      verified: null,
      reason: `${event.label} gefunden, aber auch ${andere.map((e) => e.label).join(' und ')}`
        + ' — muss angeschaut werden',
      details: { ...details, zweiEvents: true },
    };
  }

  if (passt) return { ok: true, verified: true, reason: '', details };

  // Nur widersprechen, wenn wirklich ein ANDERES bekanntes Event im Bild steht.
  //
  // Findet er gar nichts, heisst das nicht, dass die Angabe falsch ist - der
  // kleine Kasten oben rechts wird leicht uebersehen. Im ersten echten Lauf
  // hat genau das vier Leuten zu Unrecht eine Ermahnung eingebracht. Wer
  // nichts sieht, darf niemanden beschuldigen.
  if (!andere.length) {
    return {
      ok: true,
      verified: null,
      // Frueher stand hier "zaehlt trotzdem". Das stimmte einmal, seit dem
      // Achtungszeichen aber nicht mehr: ohne Bestaetigung gibt es keinen
      // Haken. Der Satz war stehengeblieben und hat das Gegenteil behauptet.
      reason: `${event.label} konnte ich im Bild nicht finden — nicht gewertet`,
      details,
    };
  }

  return {
    ok: true,
    verified: false,
    reason: `Im Bild steht ${andere.map((e) => e.label).join(' und ')}, angegeben war ${event.label}`,
    details,
  };
}

/**
 * Liest das Event aus dem Bild, wenn im Text keins steht.
 *
 * Manche schreiben nur "WIN" und lassen den Screenshot sprechen. Dann darf
 * nur gezaehlt werden, wenn genau EIN bekanntes Event zu sehen ist - bei
 * zweien waere unklar, welches gemeint war.
 */
async function readEventFromImage(imageBase64, optionen = {}) {
  const result = await leseEvents(imageBase64, optionen);

  if (!result.ok) {
    return {
      ok: false,
      event: null,
      nichtGelesen: Boolean(result.nichtGelesen),
      reason: result.nichtGelesen
        ? 'noch nicht gelesen — wird nachgeholt'
        : (result.timedOut
          ? 'Zeit abgelaufen — die Grafikkarte war belegt, kein Urteil über das Bild'
          : `Bild nicht lesbar: ${result.error}`),
      timedOut: Boolean(result.timedOut),
      details: {},
    };
  }

  const antwort = result.antwort;
  const gefundene = result.gefundene;
  const details = {
    ...antwort,
    gefundene: gefundene.map((e) => e.label),
    ms: result.ms,
    zweiterAnlauf: Boolean(result.zweiterAnlauf),
  };

  if (gefundene.length === 1) {
    return { ok: true, event: gefundene[0], reason: '', details };
  }

  if (gefundene.length > 1) {
    return {
      ok: false,
      event: null,
      reason: `Mehrere Events im Bild (${gefundene.map((e) => e.label).join(', ')}) — welches war gemeint?`,
      details,
    };
  }

  // Zwei Wappen ohne Namen sind das Erkennungszeichen der staatlichen Kontrolle.
  if (antwort.wappen) {
    return { ok: true, event: EVENTS.find((e) => e.key === 'sk'), reason: 'An den zwei Familienwappen erkannt', details };
  }

  return {
    ok: false,
    event: null,
    reason: `Im Bild ist kein bekanntes Event zu sehen (gelesen: "${fuerAnzeige(antwort.events)}")`,
    details,
  };
}

module.exports = {
  KATALOG,
  fuerAnzeige,
  leseEvents,
  parseAnswer,
  readEventFromImage,
  verifyImage,
};
