const { check, equal, finish, section, useTempData } = require('./lib');

const temp = useTempData();
const {
  abdruck, alleGelesenen, anzahlGemerkt, erledigteNachrichten, halteFest,
  istEndgueltig, labelsVon, merke, ungeklaerte, zaehlung, zuruecksetzen,
} = require('../src/bild-gedaechtnis');
const {
  MAX_VERSUCHE, TAKT_MS,
  darfLesen, fortschritt, gpuLast, meldeUnterbrechung, offen, reiheEin, setzePause, zustand,
} = require('../src/bild-vorablesen');

// Was in einem Bild steht, aendert sich nie. Bisher wurde jedes Bild erst bei
// der Auszahlung gelesen - 153 Stueck am Stueck, dreieinhalb Stunden. Jetzt
// wird jedes gelesen, sobald es hochgeladen wird.

(async () => {
  zuruecksetzen();

  section('Der Inhalt ist der Schluessel');
  // Absichtlich NICHT die Nachrichten-ID: dasselbe Bild ein zweites Mal
  // hochgeladen trifft denselben Eintrag und wird gar nicht neu gelesen.
  equal('gleiches Bild, gleicher Abdruck', abdruck('AAAA'), abdruck('AAAA'));
  check('anderes Bild, anderer Abdruck', abdruck('AAAA') !== abdruck('BBBB'));
  check('kurz genug zum Speichern', abdruck('AAAA').length === 16);
  equal('leer geht auch', typeof abdruck(''), 'string');

  section('Merken und wiederfinden');
  equal('unbekannt', await merke('neues-bild'), null);

  await halteFest('bild-1', { antwort: { events: 'Krieg um Ressourcen' }, labels: ['40er'] });
  const eins = await merke('bild-1');
  equal('gefunden', eins.labels.join(), '40er');
  check('mit Zeitstempel', Boolean(eins.gelesenAm));

  // Ergaenzen, nicht ersetzen: Event und Uhrzeit werden getrennt gelesen.
  await halteFest('bild-1', { zeitpunkt: { text: '09.08.2026 20:46' } });
  const ergaenzt = await merke('bild-1');
  equal('Event bleibt', ergaenzt.labels.join(), '40er');
  equal('Uhrzeit dazu', ergaenzt.zeitpunkt.text, '09.08.2026 20:46');

  // Auch ein NULL-Ergebnis wird festgehalten - sonst liest er ein Bild ohne
  // lesbare Uhr bei jedem Lauf neu.
  await halteFest('bild-2', { zeitpunkt: null });
  const ohneUhr = await merke('bild-2');
  check('null ist auch ein Ergebnis', 'zeitpunkt' in ohneUhr && ohneUhr.zeitpunkt === null);

  section('Ein Fehlversuch faelscht den Zeitstempel nicht');
  // Vorher bekam auch ein gescheiterter Versuch ein frisches "gelesenAm". Im
  // Dashboard sah das aus, als wuerde er staendig alles neu auswerten - dabei
  // ist er nur immer wieder an denselben Bildern gescheitert.
  await halteFest('bild-x', { antwort: { events: 'Die Schlacht im Hafen' }, labels: ['Hafen'] });
  const zeitpunktVorher = (await merke('bild-x')).gelesenAm;

  await new Promise((r) => setTimeout(r, 5));
  await halteFest('bild-x', { wo: 'ticket', gelesen: false });
  const danach = await merke('bild-x');

  equal('Lesezeitpunkt bleibt', danach.gelesenAm, zeitpunktVorher);
  check('Versuch wird trotzdem vermerkt', danach.versuchtAm > zeitpunktVorher, danach.versuchtAm);

  section('Was das Dashboard zeigt');
  await halteFest('bild-3', { labels: ['BizWar'], werName: 'Danny', wo: 'ticket' });
  const liste = await alleGelesenen(10);
  check('neueste zuerst', liste[0].schluessel === abdruck('bild-3'), JSON.stringify(liste[0]));

  // Was ein Ergebnis hat, muss als erledigt wiederzufinden sein - sonst laeuft
  // er nach einem Verlust der Liste alle Tickets neu ab.
  await halteFest('bild-4', { antwort: { events: 'Bankueberfall' }, labels: ['Bank'], messageId: 'm99' });
  const fertige = await erledigteNachrichten();
  check('erledigte Nachricht gefunden', fertige.includes('m99'), fertige.join());

  await halteFest('bild-5', { messageId: 'm100', gelesen: false });
  check('gescheiterte NICHT als erledigt', !(await erledigteNachrichten()).includes('m100'));

  section('Ein Fund ist endgueltig, eine Fehlanzeige nicht');
  // "Da steht 40er" kann sich nicht aendern. "Da steht nichts" schon - der
  // Kasten oben rechts wird leicht uebersehen, genau so ist ihm ein gut
  // lesbares "Krieg um Ressourcen" durch die Lappen gegangen. Ein zu Unrecht
  // als leer abgehaktes Bild waere fuer die Auszahlung verloren.
  check('Fund gilt sofort', istEndgueltig({ antwort: { events: 'Krieg um Ressourcen' }, labels: ['40er'] }));

  // Die Zuordnung kommt IMMER frisch aus dem Katalog, nie aus der Datei.
  //
  // Im echten Gedaechtnis lagen Bilder als "Bizwar" abgelegt, weil der Katalog
  // damals noch das blanke "geschaeft" enthielt. Inzwischen ist klar, dass
  // "Kampf ums Geschaeft fuer inoffizielle Organisationen" die Gewinnmeldung
  // des Ressourcenkriegs ist, also der 40er.
  //
  // Genau deshalb darf die Zuordnung nicht in der Datei stehen: sie hat sich
  // hier zweimal geaendert, und beide Male haetten alle alten Eintraege von
  // Hand nachgezogen werden muessen.
  const veraltet = { antwort: { events: 'Kampf ums Geschäft für inoffizielle Organisationen' }, labels: ['Bizwar'] };
  equal('alte Zuordnung zaehlt nicht mehr', labelsVon(veraltet).join(), '40er');
  equal('echte Uebernahme ist BizWar', labelsVon({ antwort: { events: 'Übernahme des Geschäfts' } }).join(), 'Bizwar');

  // Und ein Text, den der Katalog wirklich nicht kennt, bleibt leer.
  const unbekannt = { antwort: { events: 'Driftwettbewerb' }, labels: ['Bizwar'] };
  equal('Unbekanntes bleibt unbekannt', labelsVon(unbekannt).join(), '');
  check('  und gilt nicht als geklaert', !istEndgueltig(unbekannt));
  check('Wappen gilt auch', istEndgueltig({ antwort: { events: 'keins', wappen: true }, labels: [] }));

  check('erste Fehlanzeige nicht', !istEndgueltig({ antwort: { events: 'keins' }, labels: [], leerVersuche: 1 }));
  check('zweite Fehlanzeige schon', istEndgueltig({ antwort: { events: 'keins' }, labels: [], leerVersuche: 2 }));
  check('ohne Ergebnis nie', !istEndgueltig({ wo: 'ticket' }));
  check('nichts vertraegt es', !istEndgueltig(null));

  // Nur endgueltige Ergebnisse gelten als abgehakt - sonst holt der Vorableser
  // die Fehlanzeige nicht nochmal.
  zuruecksetzen();
  await halteFest('leer-1', { antwort: { events: 'keins' }, labels: [], leerVersuche: 1, messageId: 'mA' });
  await halteFest('leer-2', { antwort: { events: 'keins' }, labels: [], leerVersuche: 2, messageId: 'mB' });
  await halteFest('fund-1', { antwort: { events: 'Ressourcenkrieg' }, labels: ['40er'], messageId: 'mC' });

  const fertig = await erledigteNachrichten();
  check('einmal leer -> kommt nochmal dran', !fertig.includes('mA'), fertig.join());
  check('zweimal leer -> erledigt', fertig.includes('mB'), fertig.join());
  check('Fund -> erledigt', fertig.includes('mC'), fertig.join());

  zuruecksetzen();
  await halteFest('bild-1', { antwort: { events: 'Krieg um Ressourcen' }, labels: ['40er'] });
  await halteFest('bild-2', { zeitpunkt: null });
  await halteFest('bild-3', { labels: ['BizWar'], werName: 'Danny', wo: 'ticket', antwort: { events: 'Uebernahme des Geschaefts' } });

  section('Wiedervorlage, wenn nichts zu tun ist');
  // Kevins Frage: "und wenn er dann kein Foto hat, guckt er die sich nochmal
  // an?" Vorher nicht - nach zwei Fehlanzeigen war fuer immer Schluss. Dabei
  // ist die Grafikkarte in so einem Moment frei, und an diesen Bildern haengt
  // Geld.
  await halteFest('u1', { antwort: { events: 'keins' }, labels: [], leerVersuche: 2, messageId: 'mX', kanalId: 'c1' });
  await halteFest('u2', { antwort: { events: 'Ressourcenkrieg' }, labels: ['40er'], messageId: 'mY', kanalId: 'c1' });
  await halteFest('u3', { messageId: 'mZ', kanalId: 'c1', gelesen: false });

  // Frisch versucht: noch nicht wieder dran.
  equal('gerade erst versucht', (await ungeklaerte(60 * 60 * 1000)).length, 0);

  // Drei Stunden spaeter sieht es anders aus.
  const spaeter = Date.now() + 3 * 60 * 60 * 1000;
  const namen = (await ungeklaerte(60 * 60 * 1000, spaeter)).map((w) => w.messageId).sort();

  check('die leere kommt wieder dran', namen.includes('mX'), namen.join());
  check('die ungelesene auch', namen.includes('mZ'), namen.join());
  check('der Fund nicht', !namen.includes('mY'), namen.join());

  section('Eine Zahl, nicht drei');
  // Vorher gab es drei Zaehler fuer "gelesen": Eintraege (9), ein eigener
  // Zaehler im Vorableser (7), und die wirklich gelesenen (6). Alle drei
  // standen im Dashboard und keine zwei stimmten ueberein.
  const z = await zaehlung();
  equal('gesamt stimmt mit der Anzahl', z.gesamt, await anzahlGemerkt());
  equal('gelesen + gescheitert = gesamt', z.gelesen + z.gescheitert, z.gesamt);
  check('gescheiterte zaehlen nicht als gelesen', z.gelesen < z.gesamt, JSON.stringify(z));

  section('Er liest immer');
  // Hier stand eine Sperre gegen belegte Grafikkarten. Im Alltag hat sie nur
  // gestoert: jedes Mal wenn Kevin kurz einen Stream aufmachte, blieb die
  // Warteschlange stehen. Und die kaputten Bilder kamen ohnehin nicht von der
  // Auslastung, sondern von der Zeitgrenze beim Lesen.
  equal('keine Sperre mehr', await darfLesen(), true);

  const last = await gpuLast();
  check('Last wird nur noch angezeigt', last === null || (last >= 0 && last <= 100), String(last));

  section('Kevins eigener Pause-Knopf');
  // Anders als die alte, automatische Grafikkarten-Sperre: die hier setzt nur
  // er selbst, ueber den Knopf im Dashboard, wenn er in Ruhe zocken will.
  // Chat und Events haengen nicht an dieser Schleife und merken nichts davon.
  equal('an', await setzePause(true), true);
  equal('darf jetzt nicht mehr lesen', await darfLesen(), false);

  const zWaehrendPause = await zustand();
  equal('Zustand sagt pausiert', zWaehrendPause.was, 'pausiert');
  check('nennt das Wort im Text', zWaehrendPause.text.toLowerCase().includes('pausiert'), zWaehrendPause.text);

  const f = await fortschritt();
  equal('steht auch in fortschritt()', f.pausiert, true);

  equal('aus', await setzePause(false), false);
  equal('darf wieder lesen', await darfLesen(), true);
  const zNachPause = await zustand();
  check('Zustand ist wieder normal', zNachPause.was !== 'pausiert', zNachPause.was);

  // Der eigentliche Kern der Sache: Kevin will, dass ein Neustart (Bot oder
  // ganzer PC) den Knopf nicht zuruecksetzt. sichereStand() schreibt aber eine
  // FESTE Feldliste, kein "alles speichern" - "pausiert" war beim ersten
  // Anlauf da nicht mit drin und ist beim naechsten Speichern wieder
  // verschwunden. Deshalb hier nicht nur den Rueckgabewert pruefen, sondern
  // das, was WIRKLICH auf der Platte liegt - genau das liest ein neu
  // gestarteter Prozess.
  section('Ueberlebt einen Neustart wirklich (nicht nur im Arbeitsspeicher)');
  await setzePause(true);
  const roh = JSON.parse(require('node:fs').readFileSync(`${temp.dir}/bild-vorablesen.json`, 'utf8'));
  equal('steht auch in der Datei, nicht nur im RAM', roh.pausiert, true);
  await setzePause(false); // aufgeraeumt fuer die naechsten Tests in dieser Datei

  section('Takt');
  // Ein Bild alle 45 Sekunden reicht: neue kommen einzeln rein, und der
  // Nachholstapel darf ruhig ueber Stunden laufen.
  equal('45 Sekunden', TAKT_MS, 45 * 1000);

  // "5 wartend" und dann Stillstand sieht aus wie kaputt. Er soll sagen, was los ist.
  const z2 = await zustand();
  check('sagt was er tut', typeof z2.text === 'string' && z2.text.length > 4, JSON.stringify(z2));
  check('  mit einer Einordnung', ['liest', 'leer', 'gleich'].includes(z2.was), z2.was);

  section('Ein Fehlversuch ist kein Ergebnis');
  // Sonst gilt ein abgestuerzter Aufruf als "nichts erkannt", das Bild wird
  // nie wieder angesehen, und beim Auszahlen fehlt was wirklich drauf steht.
  check('wird wiederholt', MAX_VERSUCHE >= 2, String(MAX_VERSUCHE));
  check('aber nicht endlos', MAX_VERSUCHE <= 5, String(MAX_VERSUCHE));

  const vorher = offen();
  const message = { id: 'm1', channelId: 'c1', content: '40er win', author: { id: 'u1' } };
  check('eingereiht', reiheEin(message, { url: 'http://x/1.png' }));
  equal('  eins mehr', offen(), vorher + 1);
  check('nicht zweimal dasselbe', !reiheEin(message, { url: 'http://x/1.png' }));
  equal('  immer noch eins', offen(), vorher + 1);

  // Ein frisch hochgeladenes Bild ist wichtiger als das Nachholen alter.
  const neu = { id: 'm2', channelId: 'c1', content: 'neu', author: { id: 'u1' } };
  reiheEin(neu, { url: 'http://x/2.png' }, { vorn: true });
  const p = await fortschritt();
  equal('zwei wartend', p.wartend, vorher + 2);

  section('Nach dem Ausschalten');
  // Der Rechner geht hier jeden Abend aus. Die Ergebnisse ueberleben das
  // (jedes Bild wird sofort gespeichert), die Warteschlange nicht - deshalb
  // merkt er sich die STELLE und sagt beim Start Bescheid.
  equal('ein Bild alle 45 Sekunden', TAKT_MS, 45 * 1000);
  // Zwei getrennte Orte: wo er GERADE liest und wo er nach neuer Arbeit sucht.
  // Als ein Feld sah es aus wie ein Widerspruch - "steht bei Bollywood",
  // waehrend er sichtbar Bilder von Big Migi las.
  check('Lesestelle wird gefuehrt', 'aktuell' in p, JSON.stringify(p));
  check('Suchstelle getrennt davon', 'sucht' in p, JSON.stringify(p));
  check('Runde wird gezaehlt', 'runde' in p);
  check('gelesene Anzahl bleibt', typeof p.gelesen === 'number');

  // Ohne vorherigen Lauf gibt es nichts zu melden.
  const meldung = await meldeUnterbrechung();
  check('frischer Stand meldet nichts', meldung === null || typeof meldung === 'string');

  finish();
})();
