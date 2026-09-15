const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const {
  bewusstIgnoriert, fremdeSiegerFamilie, findEventsInImageText, getEvent,
} = require('../src/logbook-events');
const { satzFuer } = require('../src/auszahlung-saetze');
const { pruefeEintrag } = require('../src/logbook-command');
const { verifyImage, parseAnswer } = require('../src/logbook-vision');
const { halteFest } = require('../src/bild-gedaechtnis');

// Wann ein Nachweis NICHT durchgewinkt wird.
//
// Alles hier kam aus echten Faellen im Logbuch, nicht aus dem Kopf:
//
//  - Kevin hat gemerkt, dass das Ankuendigungsbanner in der Ecke als
//    BizWar-Nachweis durchging, wenn daneben noch das echte Event stand.
//  - Zwei seiner Screenshots gehoerten zusammen: die Spielmeldung als erstes
//    Bild, der Abschlussbildschirm als zweites. Angesehen wurde nur das erste.
//  - Das Feld GEWINNENDE_FAMILIE wurde seit jeher abgefragt und danach
//    weggeworfen.

// Ein Bildmodell, das immer dasselbe antwortet - hier wird die Logik geprueft,
// nicht das Modell. Wie das Modell liest, laesst sich nur messen, nicht testen.
function bildleser(antwortenJeBild) {
  let i = 0;
  return async () => {
    const a = antwortenJeBild[Math.min(i, antwortenJeBild.length - 1)];
    i += 1;
    return a;
  };
}

// Kurzform: welche Katalog-Events stecken in dem, was das Modell abgelesen hat.
const alsVierziger = (t) => findEventsInImageText(t).map((e) => e.label).join();

section('Zwei Events auf einem Bild');
// Weg B (Text nennt kein Event) war schon immer streng: bei zweien wird nicht
// gewertet, weil unklar ist, welches gemeint war. Weg A (Text nennt das Event)
// hat dagegen abgehakt, sobald das angegebene dabei war - und gar nicht
// hingesehen, was sonst noch im Bild steht.
const zwei = findEventsInImageText('Krieg um Ressourcen, Übernahme des Geschäfts');
equal('beide erkannt', zwei.map((e) => e.label).sort().join(), '40er,Bizwar');

const eins = findEventsInImageText('RESSOURCENKRIEG');
equal('eins bleibt eins', eins.map((e) => e.label).join(), '40er');

section('Zwei Events, die sich ein Wort teilen');
// Hier lag ich zweimal falsch, deshalb steht es jetzt als Test da:
//
//   "Kampf ums Geschaeft fuer inoffizielle Organisationen"
//     = die GEWINNMELDUNG des Ressourcenkriegs, also 40er
//   "Uebernahme des Geschaefts"
//     = BizWar
//
// Erst hing beides am BizWar (weil "Geschaeft" darin vorkommt), dann hielt
// ich das erste fuer eine Ankuendigung und warf es ganz raus. Kevins
// Auskunft: es ist die Gewinnmeldung. Beides sind zwei verschiedene Events.
equal('Gewinnmeldung ist der 40er',
  alsVierziger('Kampf ums Geschäft für inoffizielle Organisationen'), '40er');

// Das Bildmodell liest das mittlere Wort mal so, mal so - gesucht wird
// deshalb nur nach "kampf ums geschaeft".
equal('  auch bei "infizielle"', alsVierziger('Kampf ums Geschäft für infizielle Organisationen'), '40er');
equal('  auch bei "informelle"', alsVierziger('Kampf ums Geschäft für informelle Organisationen'), '40er');
equal('  auch in Grossbuchstaben', alsVierziger('KAMPF UMS GESCHÄFT FÜR INOFFIZIELLE ORGANISATIONEN'), '40er');

equal('die Uebernahme ist BizWar', alsVierziger('Übernahme des Geschäfts'), 'Bizwar');

// Ein unbekanntes Event daneben blockiert nicht - geprueft wird nur gegen den
// Katalog, und "Driftwettbewerb" steht nicht drin.
equal('Unbekanntes daneben stoert nicht',
  alsVierziger('Driftwettbewerb,Kampf ums Geschäft für informelle Organisationen'), '40er');

section('Der 50er heisst auch "Kampf ums Ranking"');
// Kevins Auskunft. Ohne das zaehlte ein Bild mit beiden Meldungen still als
// 40er - dabei stehen dort zwei Events, und genau dafuer ist das
// Achtungszeichen da.
equal('Ranking ist der 50er', alsVierziger('Der Kampf ums Ranking'), '50er');
equal('Rangfolge auch', alsVierziger('Kampf um die Rangfolge'), '50er');
equal('beides auf einem Bild -> zwei Events',
  alsVierziger('Der Kampf ums Ranking,Driftwettbewerbe,Kampf ums Geschäft für inoffizielle Organisationen'),
  '40er,50er');

section('SK steht auf dem Abschlussbildschirm doch da');
// Beim SK stand jahrelang "im Bild kein Text" und deshalb eine leere Liste.
// Das gilt nur WAEHREND des Events - auf dem Abschlussbildschirm steht
// "STAATLICHE KONTROLLE" so gross wie jeder andere Eventname.
//
// Das Bildmodell hatte es dreimal sauber abgelesen, und der Katalog hat es
// jedes Mal weggeworfen, weil nichts zum Vergleichen dastand.
equal('Abschlussbildschirm', alsVierziger('STAATLICHE KONTROLLE'), 'SK');

section('Verleser, die wirklich vorgekommen sind');
// Alle drei stehen so im Bildgedaechtnis. Erfunden ist keiner - was das
// Modell nie falsch gelesen hat, gehoert auch nicht in den Katalog.
equal('"Krieg am Ressourcen"', alsVierziger('Krieg am Ressourcen'), '40er');
// Aus der Messung an der festen Stichprobe: das Modell las im Zuschnitt
// "Krieg,Kressourcen,Driftwettbewerbe" - Kasten richtig gesehen, nur "um R"
// verschmolzen. Vorher fiel der Nachweis durch.
equal('"Kressourcen" verschmolzen', alsVierziger('Krieg,Kressourcen,Driftwettbewerbe'), '40er');
equal('"Glaserlei" statt Giesserei', alsVierziger('Übernahme der Glaserlei'), 'Gießerei');

section('Unscharfer Rueckfall (18.08.) - nur wenn kein Name woertlich passt');
// Gemessen: echte Verleser liegen bei 5-21% Abweichung vom echten Namen, die
// naechsten zwei VERSCHIEDENEN Events liegen sich erst bei 32% am naehsten.
// 20% Schwelle laesst also Verleser durch, bleibt aber weit unter jeder
// Verwechslungsgefahr.
equal('"Ressaurcen" statt Ressourcen (5%)', alsVierziger('Krieg um Ressaurcen'), '40er');
equal('"Pessourcen" statt Ressourcen (5%)', alsVierziger('Krieg um Pessourcen'), '40er');

// Kurze Namen bleiben aussen vor - "raid" (FamRaid) hat nur 4 Buchstaben,
// da wuerde ein Prozent-Vergleich fast ueberall zufaellig treffen. Gemessen:
// bei 25% Schwelle traf "raid" auf JEDEM von 15 echten Testbildern zu, auch
// auf voellig unverwandtem Text.
check('kurze Namen loesen keinen Fuzzy-Treffer aus',
  !findEventsInImageText('irgendein belangloser Text ohne jeden Bezug zu einem Event').some((e) => e.key === 'famraid'));

// Woertliche Treffer haben immer Vorrang - der unscharfe Rueckfall greift
// erst, wenn GAR NICHTS woertlich passt. Steht daneben noch ein verlesenes
// 40er (das fuer sich allein fuzzy treffen wuerde), darf das den woertlichen
// Bizwar-Fund nicht verwaessern.
const gemischt = findEventsInImageText('Übernahme des Geschäfts, nebenbei Krieg um Ressaurcen erwaehnt');
equal('nur der woertliche Treffer zaehlt', gemischt.map((e) => e.key).join(), 'bizwar');

section('FamWar gab es im Katalog gar nicht');
// In der Auszahlungstabelle steht FamWar seit jeher, im Eventkatalog nicht -
// es liess sich also ueberhaupt nicht eintragen. Im Spiel heisst er
// "Battle of Families".
equal('Battle of Families', alsVierziger('Battle of Families'), 'FamWar');
check('  und hat einen Auszahlungssatz', Boolean(satzFuer('famwar')));
check('  der von Hand bewertet wird', satzFuer('famwar').win === null);

section('Drei Namen fuers Geschaeft, zwei Events');
// Die gefaehrlichste Ecke des Katalogs - hier lag ich schon zweimal falsch.
equal('Kampf ums Geschaeft = 40er', alsVierziger('Kampf ums Geschäft für inoffizielle Organisationen'), '40er');
equal('Krieg um das Geschaeft = BizWar', alsVierziger('KRIEG UM DAS GESCHÄFT,SUBURBAN'), 'Bizwar');
equal('Uebernahme des Geschaefts = BizWar', alsVierziger('Übernahme des Geschäfts'), 'Bizwar');

section('Was KEIN Nachweis ist');
// Die Werbung in der Ecke, die Familiennamen aus der Wappenzeile, ein
// bekannter Anzeigefehler des Spiels - und ein echtes Event, das bei uns
// bewusst nicht gezaehlt wird.
equal('Roulette', alsVierziger('Roulette'), '');
equal('Familiennamen', alsVierziger('EL EGNU, UNKNOWN EROTICA'), '');
check('  und er weiss, dass es Wappen sind',
  /wappen|familienname/i.test(bewusstIgnoriert('EL EGNU, UNKNOWN EROTICA')?.warum || ''),
  JSON.stringify(bewusstIgnoriert('EL EGNU, UNKNOWN EROTICA')));
equal('Militaerbasis ist ein Anzeigefehler', alsVierziger('Überfall auf die Militärbasis'), '');
equal('Dealer-Anwerbung zaehlt nicht', alsVierziger('Anwerbung von Dealern'), '');

// Kevins Nachfrage: "Staatliche Anstellung" stand als unbekannte Lesung im
// Dashboard. Nachgesehen im echten Ticket: der Kasten oben rechts beim 40er
// zeigt "Krieg um Ressourcen / 5 Unknown / 0 Staatliche Angestellte".
//
// Kevins Auskunft danach: das ist ein bekannter BUG im Spiel selbst, kein
// Verleser. "Ganz wichtig": in dieser Lage darf NUR 40er gelesen werden -
// deshalb steht der Text jetzt direkt beim 40er im Katalog, nicht nur auf
// der Ignorieren-Liste. Faellt der Bug auch ohne die Kopfzeile "Krieg um
// Ressourcen" auf (z.B. beim Ausschnitt nur die untere Haelfte des Kastens),
// zaehlt es trotzdem als 40er statt als unlesbares Bild.
equal('Bug -> trotzdem 40er', alsVierziger('Staatliche Angestellte'), '40er');
equal('  auch verlesen', alsVierziger('Staatliche Anstellung'), '40er');
equal('  auch mit der Kopfzeile', alsVierziger('Krieg um Ressourcen, 5 Unknown, 0 Staatliche Angestellte'), '40er');

// Seit glm-ocr Text roh abliest (17.08.): dieselbe Phrase "Staatliche
// Angestellte" steht auch als harmloser Zaehler im UNABHAENGIGEN
// "Anwerbung von Dealern"-Kasten ("0 Staatliche Angestellte" = eine von zwei
// Rekruten-Kategorien, kein 40er-Bug). qwen3-vl hat diesen Kasten nie
// woertlich mitgelesen - genau deshalb ist die Kollision erst jetzt
// aufgefallen: zwei von Kevins fuenf echten SK-Bildern zeigten beide Kaesten
// gleichzeitig und wurden faelschlich als 40er erkannt.
equal('Anwerbung-Kasten sticht den 40er-Bug',
  alsVierziger('Anwerbung von Dealern 12 Gangster 0 Staatliche Angestellte'), '');
// Genau diese Schreibweise ist bei einem von Kevins Bildern durchgerutscht:
// "Dealeren" statt "Dealern" - ein exakter Vergleich griff nicht, und
// "Staatliche Angestellte" war beim selben Bild korrekt geschrieben.
equal('  auch bei "Dealeren" statt "Dealern"',
  alsVierziger('Anwerbung von Dealeren Gengster Staatliche Angestellte'), '');
equal('  der 40er-Bug bleibt sonst bestehen', alsVierziger('Staatliche Angestellte'), '40er');

// Die Gefahr, vor der Kevin gewarnt hat: beide Namen fangen mit "Staatliche"
// an. SK braucht aber "Staatliche KONTROLLE" - der Bug-Text trifft das nicht.
equal('SK bleibt SK', alsVierziger('STAATLICHE KONTROLLE'), 'SK');
equal('Bug wird nie zu SK', alsVierziger('Staatliche Angestellte'), '40er');

// Der Unterschied zwischen "da steht nichts" und "da steht etwas, das nicht
// zaehlt" gehoert ins Ticket - sonst liest es sich wie ein Vorwurf.
check('bewusst ignoriert ist etwas anderes als leer',
  bewusstIgnoriert('Anwerbung von Dealern')?.warum.includes('nicht gezaehlt'));
equal('  und ein unbekannter Text bleibt unbekannt', bewusstIgnoriert('Irgendwas Neues'), null);

section('Wappen aus rohem OCR-Text erkennen (glm-ocr, seit 17.08.)');
// glm-ocr liest ab statt zu interpretieren - es gibt kein "WAPPEN: ja/nein"
// mehr, das muss parseAnswer() selbst aus dem Gelesenen herausfinden.
//
// Fuenf echte Lesungen von Kevins SK-Wappenbildern: "Unknown" wurde nie
// gleich verlesen. Ein exakter Textvergleich haette keine einzige erkannt -
// erst die Levenshtein-Toleranz (bis zu zwei Buchstaben daneben) plus der
// Timer daneben ergeben ein verlaessliches Muster.
equal('EL EONU 14:30 Unknown', parseAnswer('EL EONU 14:30 Unknown gta5grand.com ID:266391').wappen, true);
equal('UNKOWNES', parseAnswer('gta5grand.com EL EGNU 10:20 UNKOWNES').wappen, true);
equal('Uknownow', parseAnswer('EL EGNU 10 10:10 Uknownow Anwerbung von Dealern').wappen, true);
equal('Unikown', parseAnswer('EL EGNO 10 13:50 Unikown Anwerbung von Dealeren').wappen, true);
equal('Uniknown', parseAnswer('gta5grand.com Uniknown 10 13:40 EL EGNUS').wappen, true);

// Der Fehlalarm, der beim ersten Anlauf durchgerutscht ist: JEDER laufende
// Event-Kasten zeigt "<Zahl> Unknown <Timer>" (die eigene Teilnehmerzahl),
// nicht nur der SK-Wappen-Kasten. Zwei echte Bilder - beides verlesene
// 40er-Kaesten, die der Katalog deshalb nicht fand - waeren ohne die
// Ankuendigungswort-Sperre faelschlich als SK-Wappen durchgegangen.
check('kein Wappen bei "Krieg um Rassauren" (verlesener 40er)',
  !parseAnswer('Krieg um Rassauren 7 Unknown 05:28').wappen);
check('  auch nicht bei "Krieg / Feesourcen"',
  !parseAnswer('Krieg / Feesourcen 3 Unknown 00:31 Driftwettbewerbe').wappen);

// Ohne Timer kein Wappen - "Unknown" allein taucht auch anderswo im HUD auf
// (z.B. als Status auf Rang-Tafeln).
check('kein Timer, kein Wappen', !parseAnswer('5 Silent 2 Unknown 1 Ruthless').wappen);
// Ohne "unknown"-aehnliches Wort auch nicht, ein Timer allein hat jedes Event.
check('kein "unknown", kein Wappen', !parseAnswer('Krieg um Ressourcen 03:31').wappen);

section('Wer hat gewonnen');
// Nur die FREMDE Familie ist verwertbar. Unsere heisst "Unknown" - dasselbe
// Wort, das ein Bildmodell hinschreibt, wenn es etwas nicht lesen konnte.
equal('fremde Familie', fremdeSiegerFamilie('EL EGNU'), 'EL EGNU');
equal('  auch mit Vorwort', fremdeSiegerFamilie('Familie axxw'), 'Familie axxw');
equal('unsere zaehlt nicht als Beweis', fremdeSiegerFamilie('UNKNOWN'), '');
equal('  auch klein nicht', fremdeSiegerFamilie('Unknown'), '');
// Im Wappen steht "UNKNOWN EROTICA" - Erotica sind die Turfleader, deswegen
// wurde das Wappen geaendert. Ohne diese Zeile waere "Erotica" als GEGNER
// durchgegangen und ein sauberer Sieg als Widerspruch markiert worden.
equal('unser ganzes Wappen', fremdeSiegerFamilie('UNKNOWN EROTICA'), '');
equal('  nur die Turfleader', fremdeSiegerFamilie('Erotica'), '');
equal('  echte Gegner bleiben Gegner', fremdeSiegerFamilie('Silent'), 'Silent');
equal('keine Angabe', fremdeSiegerFamilie('steht nicht da'), '');
equal('  leer', fremdeSiegerFamilie(''), '');
equal('  nichts', fremdeSiegerFamilie(null), '');

(async () => {
  section('Das Urteil bei zwei Events');
  // Kein Modell noetig: was einmal gelesen wurde, kommt aus dem Gedaechtnis.
  // Damit laesst sich die Entscheidung pruefen, ohne die Grafikkarte zu
  // beschaeftigen - und ohne dass das Ergebnis vom Tagesform des Modells
  // abhaengt.
  const sauber = 'bild-nur-40er';
  await halteFest(sauber, { antwort: { events: 'RESSOURCENKRIEG', gewinner: 'UNKNOWN' } });
  const a = await verifyImage(sauber, getEvent('40er'));
  equal('nur das angegebene Event -> bestaetigt', a.verified, true);

  const doppelt = 'bild-zwei-events';
  await halteFest(doppelt, {
    antwort: { events: 'Krieg um Ressourcen, Übernahme des Geschäfts', gewinner: 'steht nicht da' },
  });
  const b = await verifyImage(doppelt, getEvent('40er'));
  // Frueher: Haken, weil das 40er ja dabei war. Jetzt: Menschenaugen.
  equal('zweites Event daneben -> nicht gewertet', b.verified, null);
  check('  beide genannt', /Bizwar/.test(b.reason), b.reason);
  check('  als Aufforderung formuliert', /angeschaut/.test(b.reason), b.reason);

  const falsch = 'bild-anderes-event';
  await halteFest(falsch, { antwort: { events: 'Die Schlacht im Hafen', gewinner: 'steht nicht da' } });
  const c = await verifyImage(falsch, getEvent('40er'));
  equal('nur ein anderes Event -> Widerspruch', c.verified, false);

  const leer = 'bild-ohne-event';
  await halteFest(leer, { antwort: { events: 'keins', gewinner: 'steht nicht da' }, leerVersuche: 2 });
  const e = await verifyImage(leer, getEvent('40er'));
  equal('nichts gefunden -> nicht gewertet', e.verified, null);
  // Hier stand frueher "zaehlt trotzdem". Das war seit der Umstellung auf das
  // Achtungszeichen falsch: ohne Bestaetigung gibt es keinen Haken.
  check('  und sagt das auch', /nicht gewertet/.test(e.reason), e.reason);

  section('SK: zwei Wege zum selben Nachweis');
  // Auf dem Abschlussbildschirm steht der Name. Waehrend des Events steht dort
  // wirklich nichts - nur die beiden Familienwappen mit Spielerzahlen oben.
  // Beide Wege muessen gelten, sonst nehme ich ihm einen Nachweis weg, den er
  // vorher hatte.
  const skEnde = 'sk-abschluss';
  await halteFest(skEnde, { antwort: { events: 'STAATLICHE KONTROLLE', gewinner: 'UNKNOWN' } });
  equal('ueber den Namen', (await verifyImage(skEnde, getEvent('sk'))).verified, true);

  const skWappen = 'sk-waehrenddessen';
  await halteFest(skWappen, { antwort: { events: 'keins', wappen: true, gewinner: 'steht nicht da' } });
  const w = await verifyImage(skWappen, getEvent('sk'));
  equal('ueber die Wappen', w.verified, true);
  check('  und sagt warum', /wappen/i.test(w.reason), w.reason);

  // Bis 17.08. stand hier "Wappen zaehlen nicht, wenn ein anderes Event im
  // Bild steht" - mit der Begruendung, das waere sonst ein Freifahrtschein.
  //
  // Genau das hat einen echten Nachweis kaputt gemacht: Zarti Erotica spielte
  // SK und gleichzeitig einen Banküberfall, beides ECHT im selben Bild. Der
  // Bot lehnte den Nachweis ab: "Im Bild steht Bank, angegeben war SK" -
  // obwohl beide Wappen klar zu sehen waren.
  //
  // Der urspruengliche Freifahrtschein-Gedanke ist trotzdem nicht vergessen:
  // erkenneWappen() selbst schliesst Bilder mit einem Ankuendigungswort
  // ("Krieg", "Schlacht", "Uebernahme", "Kampf") aus - genau die Faelle, bei
  // denen die Wappen eigentlich nur die Teilnehmerzahl eines ANDEREN Events
  // gewesen waeren. Eine echte, unabhaengige Nebentaetigkeit wie ein
  // Banküberfall hat keins dieser Woerter und blockiert die Wappen deshalb
  // zu Recht nicht mehr.
  const skMitBank = 'sk-mit-bankueberfall';
  await halteFest(skMitBank, { antwort: { events: 'Banküberfall Schalte den Strom ab', wappen: true, gewinner: 'steht nicht da' } });
  equal('Wappen zaehlen auch neben einer echten Nebentaetigkeit',
    (await verifyImage(skMitBank, getEvent('sk'))).verified, true);

  section('Mehrere Bilder an einem Beitrag');
  // Kevins Fall: erstes Bild die Spielmeldung (kein Katalogtreffer), zweites
  // der Abschlussbildschirm mit RESSOURCENKRIEG. Vorher wurde nur das erste
  // geoeffnet und der Beitrag fiel durch.
  const beitrag = {
    images: [{ url: 'a' }, { url: 'b' }],
    claim: { ok: true, event: getEvent('40er'), result: 'win' },
  };

  await pruefeEintrag(beitrag, {
    ladeBild: async (a) => a.url,
    verifyImage: bildleser([
      { ok: true, verified: null, reason: 'nicht gefunden', details: {} },
      { ok: true, verified: true, reason: '', details: { gewinner: 'UNKNOWN' } },
    ]),
    leseUhrzeit: async () => null,
  });

  equal('zweites Bild rettet den Nachweis', beitrag.verified, true);
  equal('  zwei Bilder angesehen', beitrag.bilderAngesehen, 2);

  // Passt schon das erste, wird das zweite gar nicht erst geladen - jedes Bild
  // kostet Rechenzeit.
  const sofort = {
    images: [{ url: 'a' }, { url: 'b' }],
    claim: { ok: true, event: getEvent('40er'), result: 'win' },
  };
  await pruefeEintrag(sofort, {
    ladeBild: async (a) => a.url,
    verifyImage: bildleser([{ ok: true, verified: true, reason: '', details: {} }]),
    leseUhrzeit: async () => null,
  });
  equal('beim Treffer nur eins', sofort.bilderAngesehen, 1);

  section('nurGedaechtnis: /sammelauszahlung wartet nicht auf frische Bilder');
  // Kevins Ansage: "er schickt seinen Stand und holt den Rest im Hintergrund
  // nach". Steht noch nichts im Gedaechtnis, wird NICHT selbst gelesen -
  // das Bild wird nur vorgemerkt, damit Kevin und Johannes nicht warten
  // muessen, bis die Grafikkarte durch ist.
  const nochNichtGelesen = {
    images: [{ url: 'a' }],
    claim: { ok: true, event: getEvent('40er'), result: 'win' },
  };
  let erhalteneOptionen = null;
  await pruefeEintrag(nochNichtGelesen, {
    ladeBild: async (a) => a.url,
    verifyImage: async (bild, event, optionen) => {
      erhalteneOptionen = optionen;
      return { ok: false, verified: null, nichtGelesen: true, reason: 'noch nicht gelesen — wird nachgeholt', details: {} };
    },
    leseUhrzeit: async () => null,
    nurGedaechtnis: true,
  });

  equal('kein Urteil erzwungen', nochNichtGelesen.verified, null);
  check('Grund ist "noch nicht gelesen", nicht "kaputt"',
    /noch nicht gelesen/.test(nochNichtGelesen.verifyReason), nochNichtGelesen.verifyReason);
  equal('Bild wird vorgemerkt statt geraten', nochNichtGelesen.nachzuholendeBilder.length, 1);
  check('der Modus wird auch wirklich durchgereicht', erhalteneOptionen?.nurGedaechtnis === true);

  // Steht dagegen schon etwas im Gedaechtnis (verifyImage liefert ein
  // richtiges Ergebnis), gilt das ganz normal - nurGedaechtnis bremst nur
  // das FRISCHE Lesen, nicht das Vorlesen aus dem Speicher.
  const schonBekannt = {
    images: [{ url: 'a' }],
    claim: { ok: true, event: getEvent('40er'), result: 'win' },
  };
  await pruefeEintrag(schonBekannt, {
    ladeBild: async (a) => a.url,
    verifyImage: bildleser([{ ok: true, verified: true, reason: '', details: {} }]),
    leseUhrzeit: async () => null,
    nurGedaechtnis: true,
  });
  equal('aus dem Gedaechtnis zaehlt sofort', schonBekannt.verified, true);
  equal('nichts vorzumerken', schonBekannt.nachzuholendeBilder.length, 0);

  section('Sieg behauptet, im Bild gewinnt jemand anders');
  const fremd = {
    images: [{ url: 'a' }],
    claim: { ok: true, event: getEvent('40er'), result: 'win' },
  };
  await pruefeEintrag(fremd, {
    ladeBild: async (a) => a.url,
    verifyImage: bildleser([
      { ok: true, verified: true, reason: '', details: { gewinner: 'EL EGNU' } },
    ]),
    leseUhrzeit: async () => null,
  });
  // Bewusst kein Urteil, sondern eine Vorlage: der Screenshot koennte mitten
  // im Event entstanden sein, als noch jemand anders vorne lag.
  equal('nicht gewertet', fremd.verified, null);
  check('  Grund genannt', /EL EGNU/.test(fremd.verifyReason), fremd.verifyReason);

  // Bei "lose" ist eine fremde Siegerfamilie genau das, was man erwartet.
  const verloren = {
    images: [{ url: 'a' }],
    claim: { ok: true, event: getEvent('40er'), result: 'lose' },
  };
  await pruefeEintrag(verloren, {
    ladeBild: async (a) => a.url,
    verifyImage: bildleser([
      { ok: true, verified: true, reason: '', details: { gewinner: 'EL EGNU' } },
    ]),
    leseUhrzeit: async () => null,
  });
  equal('bei lose kein Widerspruch', verloren.verified, true);

  finish();
})();
